import {
  addDays,
  computeMuscleFreshness,
  estimateDurationMinutes,
  fitToDuration,
  isCompound,
  isEquipmentAvailable,
  isExcludedByLimitations,
  normalizeMuscleName,
  planWorkout,
  prescribeSets,
  rationaleFor,
  resolveExerciseModality,
  selectTargetMuscles,
  todayInZone,
  warmupSetsFor,
  withWarmups,
  workoutRecommendationPayloadSchema,
  GENERATION_TUNABLES,
  RECOVERY_TUNABLES,
  type CandidateExercise,
  type ExerciseHistoryInput,
  type GenerationOptions,
  type MuscleFreshness,
  type MuscleRecoveryResponse,
  type PlannedExercise,
  type RecommendedExercise,
  type WorkoutGoal,
  type WorkoutRecommendationPayload,
  type WorkoutRecommendationResponse,
  type AlternativeExercise,
  type WorkoutRecommendationStatus,
} from '@workspace/shared';
import { log } from '../config/logging.js';
import { normalizeToStringArray } from '../utils/exerciseJsonFields.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';
import workoutRecommendationRepository, {
  type WorkoutRecommendationRow,
} from '../models/workoutRecommendationRepository.js';
import coachProfileRepository from '../models/coachProfileRepository.js';
import gymEquipmentProfileRepository from '../models/gymEquipmentProfileRepository.js';
import exerciseEntryModel from '../models/exerciseEntry.js';
import exerciseService from './exerciseService.js';

/**
 * Orchestration for the workout recommendation engine: resolve the user's
 * calendar day, read history, hand it to the pure math in `@workspace/shared`.
 *
 * The split is load-bearing. Everything time- or database-dependent stays here;
 * the scoring stays pure and deterministic, which is what lets "Up Next" be
 * stable across app opens and lets Swap mean something.
 */

/**
 * The user's per-muscle recovery for today, freshest first.
 *
 * `today` comes from the user's timezone, never the server's — an entry logged
 * "yesterday" in Los Angeles is 2 days old to a UTC process for seven hours
 * every day, and at a 2-day half-life that is a 30% error in the score.
 *
 * Ties break on muscle name so the ordering is total. Without that, muscles at
 * the untrained 1.0 plateau — most of the vector for most users — would come
 * back in whatever order the sort happened to leave them, and a client
 * rendering "your freshest muscle" would see it change between two identical
 * calls.
 */
async function loadFreshness(
  userId: string
): Promise<{ today: string; muscles: MuscleFreshness[] }> {
  const tz = await loadUserTimezone(userId);
  const today = todayInZone(tz);
  // Inclusive lower bound, so the read spans `windowDays` days *plus today*.
  // The extra day is free: at a 2-day half-life the oldest entry in the window
  // retains under 1% of its fatigue, so the bound exists to keep the query
  // bounded, not to shape the score.
  const since = addDays(today, -RECOVERY_TUNABLES.windowDays);

  // Bounded above at today so a plan session prescribed for a future day
  // cannot count against today's freshness before it happens.
  const inputs = await workoutRecommendationRepository.getMuscleFatigueInputs(
    userId,
    since,
    today
  );
  // Plain string comparison, not `localeCompare`: the ordering has to be the
  // same on every machine, and collation is an ICU/locale-dependent thing.
  const muscles = computeMuscleFreshness(inputs, today).sort(
    (a: MuscleFreshness, b: MuscleFreshness) =>
      b.freshness - a.freshness ||
      (a.muscle < b.muscle ? -1 : a.muscle > b.muscle ? 1 : 0)
  );
  return { today, muscles };
}

async function getMuscleRecovery(
  userId: string
): Promise<MuscleRecoveryResponse> {
  const { today, muscles } = await loadFreshness(userId);

  return {
    date: today,
    muscles: muscles.map((entry) => ({
      muscle: entry.muscle,
      freshness: entry.freshness,
      fatigue_sets: entry.fatigueSets,
      last_trained: entry.lastTrained,
    })),
    tunables: {
      window_days: RECOVERY_TUNABLES.windowDays,
      half_life_days: RECOVERY_TUNABLES.halfLifeDays,
      secondary_weight: RECOVERY_TUNABLES.secondaryWeight,
      full_fatigue_sets: RECOVERY_TUNABLES.fullFatigueSets,
    },
  };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  durationMinutes?: number;
  gymProfileId?: string | null;
  swap?: boolean;
}

const DEFAULT_SESSION_MINUTES = 60;

/**
 * Read the training goal out of the coach profile's free-text goals.
 *
 * Keyword matching on prose, which is as good as this gets until the profile
 * has a real field for it. Strength is checked first because "build strength
 * and muscle" is a strength answer with the word muscle in it, and the
 * rep scheme has to pick one.
 */
export function deriveGoal(goals: string | null | undefined): WorkoutGoal {
  const text = goals?.toLowerCase() ?? '';
  if (/strength|powerlifting|1rm|heavy/.test(text)) return 'strength';
  if (/hypertrophy|muscle|bodybuild|size|tone/.test(text)) return 'hypertrophy';
  return 'general';
}

/**
 * Fill muscles the local catalog cannot serve from free-exercise-db.
 *
 * A fresh install has almost no exercises, and the failure mode without this is
 * silent and awful: the muscle is in the "5 Muscles" header and has no exercise
 * under it.
 *
 * One import per unserved muscle, so the real ceiling is `maxTargetMuscles` and
 * the `maxCatalogImports` check never fires today. It stays as a backstop: it
 * is the loop's only bound, and if the caller ever passes a longer list — every
 * muscle rather than every target muscle — an uncapped loop would turn one app
 * open into seventeen network round trips and seventeen image downloads.
 *
 * Muscle names go out canonical lowercase because the upstream match is exact
 * element equality; equipment goes out as the active profile's list because
 * upstream matches it as a case-sensitive substring. Neither is a real
 * availability guarantee — the re-query and the planner's own
 * `isEquipmentAvailable` are what enforce that — so this is a way to ask for
 * something plausible, not a filter to rely on.
 *
 * Failures are logged and swallowed: a GitHub outage should cost the user the
 * one muscle it could not fill, not their whole workout.
 */
async function importMissingMuscles(
  userId: string,
  missingMuscles: readonly string[],
  availableEquipment: string[] | null
): Promise<number> {
  const { default: freeExerciseDBService } =
    await import('../integrations/freeexercisedb/FreeExerciseDBService.js');
  let imported = 0;
  for (const muscle of missingMuscles) {
    if (imported >= GENERATION_TUNABLES.maxCatalogImports) break;
    try {
      const found = (await freeExerciseDBService.searchExercises(
        null,
        availableEquipment ?? [],
        [muscle],
        GENERATION_TUNABLES.catalogImportSearchLimit,
        0
      )) as {
        exercises: { id?: string; name?: string; primaryMuscles?: unknown }[];
      };
      // Upstream matches a muscle in either list, but the planner slots on the
      // primary mover only — so taking the top result imports exercises that
      // the very next catalog read then ignores, and the slot stays empty
      // anyway. Two of five muscles came back bare in the first live run for
      // exactly this reason. Insist on a primary match.
      //
      // This is why the search above pages deep: the filter runs after upstream
      // has already paginated, so a shallow page can contain no primary mover at
      // all even when the catalog has nineteen of them.
      const top = (found.exercises ?? []).find(
        (item) =>
          item.id &&
          normalizeToStringArray(item.primaryMuscles).some(
            (value) => normalizeMuscleName(value) === muscle
          )
      );
      if (!top?.id) {
        log(
          'info',
          `[workoutRecommendation] no free-exercise-db exercise has "${muscle}" as a primary mover; leaving the slot empty`
        );
        continue;
      }
      await exerciseService.addFreeExerciseDBExerciseToUserExercises(
        userId,
        top.id
      );
      imported += 1;
      log(
        'info',
        `[workoutRecommendation] imported "${top.name ?? top.id}" from free-exercise-db to cover ${muscle} for user ${userId}`
      );
    } catch (error) {
      log(
        'error',
        `[workoutRecommendation] free-exercise-db fallback failed for muscle "${muscle}":`,
        error
      );
    }
  }
  return imported;
}

/**
 * Which target muscles no eligible candidate covers.
 *
 * Eligibility, not mere presence: a muscle with five candidates that the user's
 * gym profile rules out is exactly as unservable as one with none, and the
 * blueprint's "zero local candidates" test would miss it.
 */
function unservedMuscles(
  targetMuscles: readonly string[],
  candidates: readonly CandidateExercise[],
  options: GenerationOptions
): string[] {
  const eligible = candidates.filter(
    (candidate) =>
      isEquipmentAvailable(candidate.equipment, options.availableEquipment) &&
      !isExcludedByLimitations(candidate, options.limitations)
  );
  return targetMuscles.filter(
    (muscle) =>
      !eligible.some((candidate) =>
        candidate.primaryMuscles.some(
          (value) => normalizeMuscleName(value) === muscle
        )
      )
  );
}

/**
 * Turn a planned exercise into a programmed one: read its history, prescribe
 * its sets, ramp into them.
 *
 * History comes from the existing readers rather than new SQL, and they are
 * awaited one at a time on purpose. The pool caps at 10 clients and each reader
 * takes one; fanning a ten-exercise workout out with `Promise.all` would take
 * the entire pool and deadlock against anything else the request needs.
 */
async function programExercise(
  userId: string,
  planned: PlannedExercise,
  options: GenerationOptions
): Promise<RecommendedExercise> {
  const sessions = await exerciseEntryModel.getRecentSessionsForExercise(
    userId,
    planned.candidate.id,
    null,
    2
  );
  const history: ExerciseHistoryInput = {
    lastSessions: sessions.map((session) => ({
      entryDate: session.entry_date,
      sets: (session.sets ?? []).map((set) => ({
        setType: set.set_type,
        reps: set.reps,
        weight: set.weight,
        duration: set.duration,
        distance: set.distance,
      })),
    })),
    bestSet: null,
  };

  const prescription = prescribeSets(
    planned.candidate,
    history.lastSessions.length > 0 ? history : null,
    options,
    planned.slot
  );
  const sets = withWarmups(
    prescription.sets,
    warmupSetsFor(
      prescription.workingWeightKg,
      planned.candidate.equipment,
      planned.candidate.modality
    )
  );

  return {
    exercise_id: planned.candidate.id,
    exercise_name: planned.candidate.name,
    // Already resolved by the repository; re-resolving narrows the planner's
    // plain `string` back to the enum the payload schema requires without a
    // cast that would lie if the value were ever bad.
    modality: resolveExerciseModality(planned.candidate.modality, null),
    primary_muscles: planned.candidate.primaryMuscles,
    secondary_muscles: planned.candidate.secondaryMuscles,
    equipment: planned.candidate.equipment,
    images: planned.candidate.images,
    sort_order: 0, // fitToDuration renumbers across the final list.
    rest_seconds: prescription.restSeconds,
    rationale: rationaleFor(planned.targetMuscle, prescription),
    sets,
  };
}

/**
 * Build the user's next workout and store it as the one "Up Next" row.
 *
 * Order matters: freshness picks the muscles, the muscles bound the catalog
 * read, an empty slot triggers a free-exercise-db import and a re-read, and
 * only then does the pure planner run. Everything after that point is
 * arithmetic on data already in hand.
 */
async function generateRecommendation(
  userId: string,
  opts: GenerateOptions = {}
): Promise<WorkoutRecommendationResponse> {
  const [{ muscles }, coachProfile, activeGymProfile] = await Promise.all([
    loadFreshness(userId),
    coachProfileRepository.getCoachProfile(userId),
    gymEquipmentProfileRepository.getActiveGymProfile(userId),
  ]);

  const targetDurationMinutes =
    opts.durationMinutes ??
    coachProfile?.session_minutes ??
    DEFAULT_SESSION_MINUTES;

  // An explicit `gym_profile_id` in the request wins; otherwise whichever
  // profile is active. `null` means the user asked for no constraint at all,
  // which is different from not asking — hence the `undefined` check.
  const gymProfile =
    opts.gymProfileId === undefined
      ? activeGymProfile
      : opts.gymProfileId === null
        ? null
        : await gymEquipmentProfileRepository.getGymProfile(
            userId,
            opts.gymProfileId
          );

  // The previous workout's exercises, so Swap can prefer different ones. Read
  // before the upsert overwrites the row.
  const previous = opts.swap
    ? await workoutRecommendationRepository.getWorkoutRecommendation(userId)
    : null;
  const excludeIds = opts.swap ? previousExerciseIds(previous?.payload) : [];

  const options: GenerationOptions = {
    targetDurationMinutes,
    availableEquipment: gymProfile ? gymProfile.equipment : null,
    limitations: (coachProfile?.limitations ?? []).map((value) =>
      String(value).toLowerCase()
    ),
    goal: deriveGoal(coachProfile?.goals),
    // `coach_profiles` has no experience column yet. The planner's level-match
    // bonus is therefore inert rather than wrong; when a profile gains the
    // field this is the single line that turns it on.
    experienceLevel: null,
    excludeIds,
  };

  const targetMuscles = selectTargetMuscles(muscles);
  let candidates = await workoutRecommendationRepository.getCandidateExercises(
    userId,
    targetMuscles
  );

  const missing = unservedMuscles(targetMuscles, candidates, options);
  if (missing.length > 0) {
    const imported = await importMissingMuscles(
      userId,
      missing,
      options.availableEquipment
    );
    if (imported > 0) {
      candidates = await workoutRecommendationRepository.getCandidateExercises(
        userId,
        targetMuscles
      );
    }
  }

  const plan = planWorkout(muscles, candidates, options);

  const programmed = [];
  for (const planned of plan.exercises) {
    programmed.push({
      exercise: await programExercise(userId, planned, options),
      slot: planned.slot,
      targetMuscle: planned.targetMuscle,
    });
  }
  const alternates = [];
  for (const planned of plan.alternates.slice(
    0,
    GENERATION_TUNABLES.maxAlternatesPrescribed
  )) {
    alternates.push({
      exercise: await programExercise(userId, planned, options),
      slot: planned.slot,
      targetMuscle: planned.targetMuscle,
    });
  }

  const exercises = fitToDuration(
    programmed,
    targetDurationMinutes,
    alternates,
    plan.targetMuscles
  );

  if (exercises.length === 0) {
    // The payload schema requires at least one exercise, and an empty workout
    // is not a workout. Fail loudly rather than persisting a row every client
    // would then have to special-case.
    throw new WorkoutGenerationError(
      'No exercises available to build a workout. Add exercises to your catalog, or relax your gym profile.'
    );
  }

  const payload: WorkoutRecommendationPayload = {
    muscle_groups: plan.targetMuscles,
    estimated_duration_minutes: estimateDurationMinutes(exercises),
    exercises,
  };

  const row = await workoutRecommendationRepository.upsertWorkoutRecommendation(
    userId,
    {
      gymProfileId: gymProfile?.id ?? null,
      targetDurationMinutes,
      payload,
    }
  );
  return toResponse(row);
}

/** The exercise ids in a stored payload, tolerating a row written by an older shape. */
function previousExerciseIds(payload: unknown): string[] {
  const parsed = workoutRecommendationPayloadSchema.safeParse(payload);
  if (!parsed.success) return [];
  return parsed.data.exercises.map((exercise) => exercise.exercise_id);
}

/**
 * Raised when there is genuinely nothing to program. The route maps it to a
 * 422: the request was well-formed, the user's catalog just cannot answer it.
 */
export class WorkoutGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkoutGenerationError';
  }
}

function toResponse(
  row: WorkoutRecommendationRow
): WorkoutRecommendationResponse {
  return {
    id: row.id,
    status: row.status,
    target_duration_minutes: row.target_duration_minutes,
    gym_profile_id: row.gym_profile_id,
    generated_at: row.generated_at.toISOString(),
    payload: workoutRecommendationPayloadSchema.parse(row.payload),
  };
}

/** The stored workout, or null when the user has never generated one. */
async function getRecommendation(
  userId: string
): Promise<WorkoutRecommendationResponse | null> {
  const row =
    await workoutRecommendationRepository.getWorkoutRecommendation(userId);
  return row ? toResponse(row) : null;
}

async function updateRecommendationStatus(
  userId: string,
  id: string,
  status: WorkoutRecommendationStatus
): Promise<WorkoutRecommendationResponse | null> {
  const row =
    await workoutRecommendationRepository.updateWorkoutRecommendationStatus(
      userId,
      id,
      status
    );
  return row ? toResponse(row) : null;
}

// ---------------------------------------------------------------------------
// Replace one exercise
// ---------------------------------------------------------------------------

/**
 * The muscle the replacement should be programmed and explained against.
 *
 * Normally the slot's own muscle — the outgoing exercise's first primary mover,
 * which is also what the alternatives ranker anchors on, so anything picked
 * from the suggested list lands here. A user who ignores the suggestions and
 * searches freely can pick something that trains a different muscle entirely;
 * then the slot's muscle is a lie, and the incoming exercise's own primary
 * mover is the honest answer. Getting this wrong is not cosmetic: it is the
 * word in "fresh quads · +2.5% from last session".
 */
function replacementTargetMuscle(
  outgoingPrimaryMuscles: readonly string[],
  candidate: CandidateExercise
): string {
  const slotMuscle = outgoingPrimaryMuscles[0]
    ? normalizeMuscleName(outgoingPrimaryMuscles[0])
    : null;
  if (
    slotMuscle &&
    candidate.primaryMuscles.some(
      (value) => normalizeMuscleName(value) === slotMuscle
    )
  ) {
    return slotMuscle;
  }
  return candidate.primaryMuscles[0]
    ? normalizeMuscleName(candidate.primaryMuscles[0])
    : (slotMuscle ?? '');
}

/**
 * Swap one exercise in the stored workout for another, re-prescribing it.
 *
 * The point of doing this server-side rather than letting the client splice the
 * row is that the replacement arrives programmed: its own history, its own
 * progression, its own set count and rest for its own slot. A client-side swap
 * would either carry the outgoing exercise's sets — wrong load, wrong rep
 * scheme — or fall back to placeholders.
 *
 * Everything the prescription depends on is re-derived from the **stored** row
 * (its target duration, the gym profile it was built with) rather than from
 * what is active now, so the replacement is programmed like the workout it is
 * joining and not like one generated today.
 *
 * Deliberately not filtered by `isEquipmentAvailable`: the user named this
 * exercise. Suggestions are filtered by the gym profile, but an explicit search
 * result the user chose is a decision, not a candidate to be vetoed.
 *
 * Returns null when the user has no stored recommendation (the route answers
 * 404). Anything else the request asks for but cannot be given raises
 * `WorkoutGenerationError` → 422: the request is well-formed, the workout just
 * cannot answer it.
 */
async function replaceRecommendationExercise(
  userId: string,
  exerciseIdOut: string,
  exerciseIdIn: string
): Promise<WorkoutRecommendationResponse | null> {
  const row =
    await workoutRecommendationRepository.getWorkoutRecommendation(userId);
  if (!row) return null;

  const payload = workoutRecommendationPayloadSchema.parse(row.payload);
  const index = payload.exercises.findIndex(
    (exercise) => exercise.exercise_id === exerciseIdOut
  );
  if (index === -1) {
    throw new WorkoutGenerationError(
      'That exercise is not in your current workout.'
    );
  }
  if (
    payload.exercises.some((exercise) => exercise.exercise_id === exerciseIdIn)
  ) {
    // The same movement twice in one session is never what the user meant, and
    // the client renders rows keyed by exercise id.
    throw new WorkoutGenerationError(
      'That exercise is already in this workout.'
    );
  }

  const [candidate, coachProfile, gymProfile] = await Promise.all([
    workoutRecommendationRepository.getCandidateExerciseById(
      userId,
      exerciseIdIn
    ),
    coachProfileRepository.getCoachProfile(userId),
    row.gym_profile_id
      ? gymEquipmentProfileRepository.getGymProfile(userId, row.gym_profile_id)
      : Promise.resolve(null),
  ]);
  if (!candidate) {
    // An external suggestion has to be imported before it can be swapped in;
    // until then it has no local uuid and nothing to prescribe against.
    throw new WorkoutGenerationError(
      'That exercise is not in your catalog. Add it first, then replace.'
    );
  }

  const options: GenerationOptions = {
    targetDurationMinutes: row.target_duration_minutes,
    availableEquipment: gymProfile ? gymProfile.equipment : null,
    limitations: (coachProfile?.limitations ?? []).map((value) =>
      String(value).toLowerCase()
    ),
    goal: deriveGoal(coachProfile?.goals),
    experienceLevel: null,
    excludeIds: [],
  };

  const outgoing = payload.exercises[index];
  const programmed = await programExercise(
    userId,
    {
      candidate,
      targetMuscle: replacementTargetMuscle(
        outgoing.primary_muscles,
        candidate
      ),
      slot: isCompound(candidate) ? 'compound' : 'isolation',
    },
    options
  );

  const exercises = [...payload.exercises];
  // The replacement takes the slot's position, not a new one — Replace swaps in
  // place. `programExercise` returns `sort_order: 0` because generation renumbers
  // the whole list afterwards; there is no renumber here, so carry it over.
  exercises[index] = { ...programmed, sort_order: outgoing.sort_order };

  const next: WorkoutRecommendationPayload = {
    ...payload,
    exercises,
    // Set counts and rest differ per exercise, so the header's estimate moves.
    estimated_duration_minutes: estimateDurationMinutes(exercises),
    // `muscle_groups` deliberately does not move: it names what the workout was
    // planned around, which one substitution does not change.
  };

  const updated =
    await workoutRecommendationRepository.updateWorkoutRecommendationPayload(
      userId,
      next
    );
  return updated ? toResponse(updated) : null;
}

// ---------------------------------------------------------------------------
// Alternatives (feeds Replace)
// ---------------------------------------------------------------------------

/** Scoring weights for a replacement candidate, in one place like the rest. */
export const ALTERNATIVE_TUNABLES = {
  primaryMuscleMatch: 3,
  sameMechanic: 2,
  sameLevel: 1,
  sharedSecondary: 1,
  maxSharedSecondary: 2,
  familiar: 2,
  /** Below this many local results, reach upstream for more. */
  minLocalResults: 3,
} as const;

function scoreAlternative(
  candidate: CandidateExercise,
  source: CandidateExercise,
  muscle: string
): number {
  let score = 0;
  if (
    candidate.primaryMuscles.some(
      (value) => normalizeMuscleName(value) === muscle
    )
  ) {
    score += ALTERNATIVE_TUNABLES.primaryMuscleMatch;
  }
  const mechanic = source.mechanic?.trim().toLowerCase();
  if (mechanic && candidate.mechanic?.trim().toLowerCase() === mechanic) {
    score += ALTERNATIVE_TUNABLES.sameMechanic;
  }
  const level = source.level?.trim().toLowerCase();
  if (level && candidate.level?.trim().toLowerCase() === level) {
    score += ALTERNATIVE_TUNABLES.sameLevel;
  }
  const sourceSecondary = new Set(
    source.secondaryMuscles.map(normalizeMuscleName)
  );
  const shared = candidate.secondaryMuscles.filter((value) =>
    sourceSecondary.has(normalizeMuscleName(value))
  ).length;
  score +=
    Math.min(shared, ALTERNATIVE_TUNABLES.maxSharedSecondary) *
    ALTERNATIVE_TUNABLES.sharedSecondary;
  if (candidate.timesPerformed > 0) score += ALTERNATIVE_TUNABLES.familiar;
  return score;
}

/**
 * Ranked replacements for one exercise, best first.
 *
 * Anchored on the source's **first** primary muscle, which is what "replace
 * this" means in practice: the user wants a different way to train the thing
 * this exercise was in the workout for. Local rows come first because the
 * client can select them immediately; upstream results are appended only when
 * the local catalog is too thin to offer a real choice, and are flagged
 * `external` so the client knows to import before selecting.
 */
async function getAlternatives(
  userId: string,
  exerciseId: string,
  limit: number
): Promise<AlternativeExercise[]> {
  const source = await workoutRecommendationRepository.getCandidateExerciseById(
    userId,
    exerciseId
  );
  if (!source) return [];
  const muscle = source.primaryMuscles[0]
    ? normalizeMuscleName(source.primaryMuscles[0])
    : null;
  if (!muscle) return [];

  const activeGymProfile =
    await gymEquipmentProfileRepository.getActiveGymProfile(userId);
  const availableEquipment = activeGymProfile
    ? activeGymProfile.equipment
    : null;

  const candidates =
    await workoutRecommendationRepository.getCandidateExercises(
      userId,
      [muscle],
      true
    );

  const local = candidates
    .filter(
      (candidate) =>
        candidate.id !== source.id &&
        isEquipmentAvailable(candidate.equipment, availableEquipment)
    )
    .map((candidate) => ({
      candidate,
      score: scoreAlternative(candidate, source, muscle),
    }))
    // Total order: score, then id. Ties are common — most candidates score
    // identically — so without the id term the list would reorder between two
    // identical calls and Replace would look like it was shuffling.
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.candidate.id < b.candidate.id
          ? -1
          : a.candidate.id > b.candidate.id
            ? 1
            : 0)
    )
    .slice(0, limit)
    .map(
      ({ candidate, score }): AlternativeExercise => ({
        exercise_id: candidate.id,
        exercise_name: candidate.name,
        source: 'local',
        primary_muscles: candidate.primaryMuscles,
        secondary_muscles: candidate.secondaryMuscles,
        equipment: candidate.equipment,
        images: candidate.images,
        mechanic: candidate.mechanic,
        level: candidate.level,
        score,
      })
    );

  if (local.length >= ALTERNATIVE_TUNABLES.minLocalResults) return local;

  const externals = await searchExternalAlternatives(
    muscle,
    availableEquipment,
    limit - local.length,
    new Set(local.map((item) => item.exercise_name.toLowerCase()))
  );
  return [...local, ...externals];
}

interface ExternalExerciseResult {
  id?: string;
  name?: string;
  primaryMuscles?: unknown;
  secondaryMuscles?: unknown;
  equipment?: unknown;
  images?: unknown;
  mechanic?: string | null;
  level?: string | null;
}

/**
 * Upstream fallbacks, scored 0 so every local row outranks them.
 *
 * Deduped by name against what the local catalog already offered — the same
 * movement imported earlier would otherwise appear twice, once selectable and
 * once needing an import.
 *
 * An upstream failure returns nothing rather than throwing: a thin list is a
 * worse answer than a full one, but it is still an answer.
 */
async function searchExternalAlternatives(
  muscle: string,
  availableEquipment: string[] | null,
  limit: number,
  seenNames: ReadonlySet<string>
): Promise<AlternativeExercise[]> {
  if (limit <= 0) return [];
  try {
    const { default: freeExerciseDBService } =
      await import('../integrations/freeexercisedb/FreeExerciseDBService.js');
    const found = (await freeExerciseDBService.searchExercises(
      null,
      availableEquipment ?? [],
      [muscle],
      limit + seenNames.size,
      0
    )) as { exercises: ExternalExerciseResult[] };
    return (found.exercises ?? [])
      .filter(
        (item): item is ExternalExerciseResult & { id: string; name: string } =>
          typeof item.id === 'string' &&
          typeof item.name === 'string' &&
          !seenNames.has(item.name.toLowerCase())
      )
      .slice(0, limit)
      .map((item) => ({
        exercise_id: item.id,
        exercise_name: item.name,
        source: 'external' as const,
        primary_muscles: normalizeToStringArray(item.primaryMuscles),
        secondary_muscles: normalizeToStringArray(item.secondaryMuscles),
        equipment: normalizeToStringArray(item.equipment),
        images: normalizeToStringArray(item.images),
        mechanic: item.mechanic ?? null,
        level: item.level ?? null,
        score: 0,
      }));
  } catch (error) {
    log(
      'error',
      `[workoutRecommendation] free-exercise-db alternatives lookup failed for muscle "${muscle}":`,
      error
    );
    return [];
  }
}

export {
  getMuscleRecovery,
  generateRecommendation,
  getRecommendation,
  updateRecommendationStatus,
  getAlternatives,
  replaceRecommendationExercise,
};
export default {
  getMuscleRecovery,
  generateRecommendation,
  getRecommendation,
  updateRecommendationStatus,
  getAlternatives,
  replaceRecommendationExercise,
};
