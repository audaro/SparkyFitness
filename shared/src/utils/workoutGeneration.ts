import {
  ALWAYS_AVAILABLE_EQUIPMENT,
  isLowerBodyMuscle,
  normalizeEquipmentName,
  normalizeMuscleName,
  type Muscle,
} from "../constants/exerciseTaxonomy.ts";
import {
  isApparatusAvailable,
  isOptInEquipment,
  requiredApparatus,
} from "../constants/exerciseApparatus.ts";
import {
  resolveExerciseModality,
  type ExerciseModality,
} from "../constants/exercise.ts";
import { DEFAULT_SET_TYPE, isWarmupSetType } from "../constants/setTypes.ts";
import { quantizeLoadKg } from "./strengthMath.ts";
import type { MuscleFreshness } from "./muscleRecovery.ts";
import type {
  RecommendationSet,
  RecommendedExercise,
} from "../schemas/api/WorkoutRecommendations.api.zod.ts";

/**
 * The deterministic workout generator: pick muscles, pick exercises, program
 * their sets, fit the result to a time budget.
 *
 * This is plain arithmetic, not an LLM call, and that is the whole design.
 * It runs on every app open, so it has to be instant and free; "Up Next" has
 * to be the same workout when the user comes back to it, so it has to be
 * reproducible; and it is the thing most likely to be wrong in a way only a
 * lifter would notice, so it has to be unit-testable rule by rule.
 *
 * Nothing here reads a clock, a random source, or a database. Every input
 * arrives as an argument. Determinism is a tested contract, not a convention:
 * a workout that quietly changed between two app opens would make the surface
 * untrustworthy, and Swap — which exists precisely to change it — would stop
 * meaning anything.
 *
 * All weights are kilograms, all durations and rests whole seconds.
 */

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Every magic number the generator uses, in one object so a tuning change is
 * one diff and the tests can assert against the constants rather than
 * hard-coded copies of them.
 */
export const GENERATION_TUNABLES = {
  /** A muscle must be at least this fresh to be worth building around. */
  minTargetFreshness: 0.5,
  /** The "5 Muscles" header caps here. */
  maxTargetMuscles: 5,
  /**
   * Below this many qualifying muscles, take the freshest anyway. Someone who
   * trained everything yesterday still opens the app wanting a workout;
   * refusing to produce one is worse than producing a light one.
   */
  minTargetMuscles: 2,
  /** Freshness the other half of the body needs to earn the balance swap. */
  balanceSwapFreshness: 0.6,

  /** Score for a movement the user has performed before. */
  familiarityBonus: 2,
  /** Score for matching the coach profile's stated experience level. */
  levelMatchBonus: 1,
  /** Penalty for an exercise the current workout already used (Swap). */
  swapPenalty: -3,
  /**
   * Penalty for a mobility movement competing for a training slot.
   *
   * Sized to lose to any real movement, including an unfamiliar one: it has to
   * beat `familiarityBonus + levelMatchBonus`, or a stretch the user has done
   * before would outrank a press they have not. Not a hard exclusion, so a
   * muscle whose catalog offers nothing else still gets something — programmed
   * as a hold, which is what {@link isMobilityExercise} is really for.
   */
  mobilityPenalty: -4,

  /** Working sets per exercise; strength trades reps for one more set. */
  workingSetsDefault: 3,
  workingSetsStrength: 4,

  /** Mobility work: holds, not sets of reps, and fewer of them. */
  mobilitySets: 2,
  mobilityHoldSeconds: 30,
  restMobility: 30,

  /** Rep target per goal. */
  repTargetStrength: 5,
  repTargetHypertrophy: 10,
  repTargetGeneral: 10,

  /** Progression multipliers, per the coaching prompt's rules. */
  progressionUpperBody: 1.025,
  progressionLowerBody: 1.05,
  deloadMultiplier: 0.95,
  /** Reps this far under target, twice running, means the load is too heavy. */
  deloadRepShortfall: 2,

  /** Rest between sets, seconds. */
  restCompoundStrength: 180,
  restCompound: 120,
  restIsolation: 90,
  restDuration: 60,

  /** No warm-up ramp below this working load — the bar is the warm-up. */
  warmupMinLoadKg: 30,
  /** Above this, one ramp set is not enough. */
  warmupTwoStepLoadKg: 60,
  warmupSingleFraction: 0.6,
  warmupFirstFraction: 0.45,
  warmupSecondFraction: 0.7,
  warmupSingleReps: 8,
  warmupFirstReps: 8,
  warmupSecondReps: 4,
  warmupRestSeconds: 60,

  /** Duration estimation. */
  secondsPerRep: 4,
  setupSecondsPerExercise: 90,
  /** Default work interval for a `duration` modality set. */
  defaultDurationSeconds: 60,
  /** Default cardio block when history says nothing. */
  defaultCardioSeconds: 1200,

  /** Slack before the fitter bothers adding another exercise. */
  underBudgetSlackMinutes: 15,
  /** How many bench candidates the service should pre-program for extension. */
  maxAlternatesPrescribed: 3,
  /**
   * Ceiling on free-exercise-db imports in one generation. A fresh install can
   * have an empty catalog, and each import is a network round trip plus image
   * downloads; without a cap the first generation is unbounded.
   */
  maxCatalogImports: 10,
  /**
   * How deep to page a free-exercise-db muscle search before picking an import.
   *
   * Upstream matches a muscle in either the primary or the secondary list and
   * returns the page in name order, so the first few hits for a small muscle are
   * usually exercises that merely involve it. Asking for five and then filtering
   * for a primary mover found nothing at all for triceps or forearms — the first
   * primary match for triceps is the 20th row. Fifty is a slice of an already
   * fetched, hour-cached payload, so the extra depth is free.
   */
  catalogImportSearchLimit: 50,
} as const;

/**
 * Cold-start loads, kg, by canonical equipment. Deliberately timid: the first
 * session's job is to find out what the user can do, and a first prescription
 * that is too heavy costs a failed set and some trust, while one that is too
 * light costs one easy session. Barbell is an empty olympic bar; dumbbell is
 * per hand.
 *
 * Absent equipment means no load worth guessing — the prescription comes back
 * reps-only rather than inventing a number.
 */
export const COLD_START_LOAD_KG: Readonly<Record<string, number>> = {
  barbell: 20,
  "e-z curl bar": 10,
  dumbbell: 5,
  kettlebells: 8,
  machine: 20,
  cable: 10,
};

/**
 * Rough muscle size, used only to order the finished workout: 0 = large,
 * 1 = medium, 2 = small. Big compounds belong at the front, when the user is
 * fresh; curls belong at the end.
 */
export const MUSCLE_SIZE_RANK: Readonly<Record<Muscle, number>> = {
  quadriceps: 0,
  hamstrings: 0,
  glutes: 0,
  chest: 0,
  lats: 0,
  "middle back": 0,
  shoulders: 1,
  "lower back": 1,
  abdominals: 1,
  traps: 1,
  adductors: 1,
  abductors: 1,
  biceps: 2,
  triceps: 2,
  calves: 2,
  forearms: 2,
  neck: 2,
};

const DEFAULT_MUSCLE_SIZE_RANK = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkoutGoal = "strength" | "hypertrophy" | "general";

/** A catalog row, reduced to what selection needs. */
export interface CandidateExercise {
  id: string;
  name: string;
  modality: string;
  /**
   * `exercises.category` — the free-exercise-db vocabulary (`strength`,
   * `stretching`, `plyometrics`, …), which the row already carries and which
   * until now only fed the modality derivation. It is what separates a hamstring
   * *stretch* from a hamstring *exercise*: both are `body only`, both name
   * hamstrings as the primary mover, and only one of them is three sets of ten.
   */
  category: string | null;
  /** `exercises.source` — which catalog the row came from. */
  source: string;
  /** `exercises.source_id` — the upstream id, and the apparatus override key. */
  sourceId: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
  mechanic: string | null;
  level: string | null;
  images: string[];
  /** How many times the user has logged it — drives the familiarity bonus. */
  timesPerformed: number;
}

export interface GenerationOptions {
  targetDurationMinutes: number;
  /** `null` = no active gym profile = nothing is filtered out. */
  availableEquipment: string[] | null;
  /** `coach_profiles.limitations`, lowercased. */
  limitations: string[];
  goal: WorkoutGoal;
  /** `coach_profiles` experience, when stated. */
  experienceLevel?: string | null;
  /** Exercise ids in the workout being swapped away from. */
  excludeIds?: string[];
}

export interface PlannedExercise {
  candidate: CandidateExercise;
  /** The target muscle this exercise was chosen to train. */
  targetMuscle: string;
  slot: "compound" | "isolation";
}

export interface WorkoutPlan {
  /** The muscles the workout was built around, freshest first. */
  targetMuscles: string[];
  exercises: PlannedExercise[];
  /**
   * Ranked, unused isolation picks. The duration fitter uses these to fill a
   * workout that came in well under budget, so the planner has to surface them
   * — otherwise the fitter can only ever remove work, never add it.
   */
  alternates: PlannedExercise[];
}

/** One prior session, as the history readers return it. */
export interface HistorySession {
  entryDate: string;
  sets: {
    setType: string | null;
    reps: number | null;
    weight: number | null;
    duration?: number | null;
    distance?: number | null;
  }[];
}

export interface ExerciseHistoryInput {
  /** At most 2, newest first. Warm-ups included; this module filters them. */
  lastSessions: HistorySession[];
  bestSet: { weight: number | null; reps: number | null } | null;
}

export type ProgressionDecision =
  | "increase"
  | "decrease"
  | "hold"
  | "cold-start";

export interface Prescription {
  sets: RecommendationSet[];
  restSeconds: number;
  progression: ProgressionDecision;
  /** The working load the sets were built on, kg; null for unloaded work. */
  workingWeightKg: number | null;
  /** The load multiplier applied to the last session; 1 when holding. */
  appliedMultiplier: number;
  /**
   * The modality the sets were actually built as — what the payload has to
   * carry, which is not always the catalog's stored value. A stretch is stored
   * `weight_reps` and programmed as a hold; publishing the stored value would
   * hand the client duration sets under a weight-and-reps editor, which is
   * exactly the "right in JSON, nonsense on screen" failure this function
   * exists to avoid.
   */
  modality: ExerciseModality;
  /** True when this was programmed as mobility work rather than a training set. */
  mobility: boolean;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function muscleSizeRank(muscle: string): number {
  return (
    MUSCLE_SIZE_RANK[normalizeMuscleName(muscle) as Muscle] ??
    DEFAULT_MUSCLE_SIZE_RANK
  );
}

/**
 * Freshest muscles first, ties broken by muscle size, then by name.
 *
 * The tiebreak is not cosmetic, and it is not arbitrary either. Every muscle
 * the user has never trained sits at exactly 1.0, so for a new or rested user
 * most of the vector is tied and the comparator alone decides the workout.
 *
 * Breaking those ties by name looks harmless and is not: the canonical muscle
 * list is alphabetical, so a fresh user's first workout came back as
 * abdominals, abductors, adductors, calves and glutes — five muscles chosen for
 * how they are spelled. It is stable and reproducible and nobody would call it
 * a full-body day.
 *
 * Size first gives chest, lats and quadriceps instead: when there is no
 * evidence to separate two muscles, train the bigger one. Name remains the
 * final term so the order is still total and still machine-independent.
 */
function rankByFreshness(freshness: readonly MuscleFreshness[]): string[] {
  return [...freshness]
    .sort(
      (a, b) =>
        b.freshness - a.freshness ||
        muscleSizeRank(a.muscle) - muscleSizeRank(b.muscle) ||
        (a.muscle < b.muscle ? -1 : a.muscle > b.muscle ? 1 : 0),
    )
    .map((entry) => entry.muscle);
}

/**
 * The muscles to build the workout around.
 *
 * Takes the freshest muscles clearing {@link GENERATION_TUNABLES.minTargetFreshness},
 * capped at five. If fewer than two clear it the two freshest are taken
 * regardless — someone who trained everything yesterday still wants a workout,
 * and refusing to produce one is worse than producing a light one.
 *
 * The balance guard then fixes the failure this scoring makes easy. Freshness
 * is per-muscle, so a heavy leg day leaves the entire upper body at 1.0 and the
 * top five come back all-upper — a "full body" workout with no legs in it, five
 * days running. If the picks are homogeneous and the other half of the body has
 * anything reasonably fresh, the least-fresh slot is given away to it.
 */
export function selectTargetMuscles(
  freshness: readonly MuscleFreshness[],
): string[] {
  const ranked = rankByFreshness(freshness);
  if (ranked.length === 0) return [];

  const byMuscle = new Map(freshness.map((entry) => [entry.muscle, entry]));
  const scoreOf = (muscle: string): number =>
    byMuscle.get(muscle)?.freshness ?? 0;

  const qualifying = ranked.filter(
    (muscle) => scoreOf(muscle) >= GENERATION_TUNABLES.minTargetFreshness,
  );
  const selected =
    qualifying.length >= GENERATION_TUNABLES.minTargetMuscles
      ? qualifying.slice(0, GENERATION_TUNABLES.maxTargetMuscles)
      : ranked.slice(0, GENERATION_TUNABLES.minTargetMuscles);

  if (selected.length < GENERATION_TUNABLES.minTargetMuscles) return selected;

  const lowerCount = selected.filter(isLowerBodyMuscle).length;
  const homogeneous = lowerCount === 0 || lowerCount === selected.length;
  if (!homogeneous) return selected;

  const wantLower = lowerCount === 0;
  const swapIn = ranked.find(
    (muscle) =>
      isLowerBodyMuscle(muscle) === wantLower &&
      !selected.includes(muscle) &&
      scoreOf(muscle) >= GENERATION_TUNABLES.balanceSwapFreshness,
  );
  if (!swapIn) return selected;

  // The last slot is the least fresh of the picks, so it is the cheapest to
  // give away.
  return [...selected.slice(0, selected.length - 1), swapIn];
}

/**
 * Whether the user can actually perform this exercise where they are training.
 *
 * A **subset** test, not an overlap test. Reusing the catalog's browse filter
 * here would be wrong in both directions, and both were live bugs in the gym
 * profile work: an exercise needing `["dumbbell","barbell"]` passes an
 * overlap test against a dumbbell-only garage, and an exercise with no
 * equipment recorded at all matches nothing and silently disappears — which is
 * most user-created exercises.
 *
 * So: no equipment listed means nothing is required, which is available
 * everywhere. Otherwise every item must be on hand. Both sides are normalized,
 * because the `exercises.equipment` column is free text with no write-side
 * canonicalization — a user's `"Dumbbell"` must not be invisible to their own
 * `dumbbell` profile.
 */
export function isEquipmentAvailable(
  exerciseEquipment: readonly string[],
  availableEquipment: readonly string[] | null,
): boolean {
  const required = exerciseEquipment
    .map(normalizeEquipmentName)
    .filter((value) => value.length > 0);
  if (required.length === 0) return true;
  // Opt-in equipment is the one thing "no gym profile" does not admit. See
  // OPT_IN_EQUIPMENT: `other` is a strongman yard, not an unclassified value,
  // and not having said where you train is not a claim to own one.
  if (availableEquipment === null) return !required.some(isOptInEquipment);
  const available = new Set([
    ...availableEquipment.map(normalizeEquipmentName),
    ...ALWAYS_AVAILABLE_EQUIPMENT.map(normalizeEquipmentName),
  ]);
  return required.every((item) => available.has(item));
}

/**
 * Whether this exercise can actually be performed where the user is training —
 * the equipment test above, plus the apparatus its stated equipment omits.
 *
 * The second half exists because `body only` is a lie for 21 rows: `Chin-Up`
 * needs something to hang from and the vocabulary has no word for it
 * (`exerciseApparatus.ts` carries the list and the reasoning). Availability is
 * inferred from the profile — a bar and a bench come with a barbell, a cable
 * stack or a machine — so it is a guess where the equipment test is a fact, and
 * having logged the exercise before overrides the guess. Somebody who has done
 * ten sessions of pull-ups owns a bar, whatever their profile implies.
 *
 * The familiarity escape deliberately does NOT extend to the equipment test:
 * that one is the user's own statement of what is in the room, and a barbell
 * squat logged at the gym last month is still not doable in a dumbbell-only
 * garage today.
 */
export function isPerformable(
  candidate: CandidateExercise,
  availableEquipment: readonly string[] | null,
): boolean {
  if (!isEquipmentAvailable(candidate.equipment, availableEquipment)) {
    return false;
  }
  const apparatus = requiredApparatus(candidate.source, candidate.sourceId);
  if (apparatus.length === 0) return true;
  if (candidate.timesPerformed > 0) return true;
  return isApparatusAvailable(apparatus, availableEquipment);
}

/**
 * Whether this row is mobility work rather than a training movement.
 *
 * Category, not modality: the catalog stores a stretch as `weight_reps` because
 * `deriveExerciseModality` only knows `cardio` and `isometric`, and that value
 * is shared with the diary and the set editors and pinned by a backfill
 * migration — changing it would re-render sets a user already logged. So the
 * engine reads the category the row has always carried and decides the shape of
 * its own prescription from it, leaving the stored modality alone.
 *
 * `isometric`/`isometrics` are NOT mobility: a plank is a training set that
 * happens to be timed, and it already resolves to the `duration` modality.
 */
export function isMobilityExercise(
  candidate: Pick<CandidateExercise, "category">,
): boolean {
  return candidate.category?.trim().toLowerCase() === "stretching";
}

/**
 * Whether a stated limitation rules this exercise out.
 *
 * Substring matching on the name and the muscle lists, which is blunt on
 * purpose: "shoulder" knocks out every shoulder press and every exercise
 * naming the shoulders, including some the user could have done. That is the
 * right side to err on — the coaching prompt's rule is never to program a
 * contraindicated movement, and the cost of one missing exercise is nothing
 * next to the cost of programming into an injury.
 */
export function isExcludedByLimitations(
  candidate: CandidateExercise,
  limitations: readonly string[],
): boolean {
  if (limitations.length === 0) return false;
  const haystack = [
    candidate.name,
    ...candidate.primaryMuscles,
    ...candidate.secondaryMuscles,
  ]
    .join(" ")
    .toLowerCase();
  return limitations.some((limitation) => {
    const needle = limitation.trim().toLowerCase();
    return needle.length > 0 && haystack.includes(needle);
  });
}

/**
 * Exported because slot assignment happens in two places now: the planner
 * builds a whole workout, and Replace re-slots a single incoming exercise
 * without a plan to read it from. The slot drives set count and rest, so a
 * second copy of this rule would quietly prescribe a different workout for the
 * same exercise depending on how it got in.
 */
export function isCompound(candidate: CandidateExercise): boolean {
  return candidate.mechanic?.trim().toLowerCase() === "compound";
}

function trainsPrimarily(
  candidate: CandidateExercise,
  muscle: string,
): boolean {
  return candidate.primaryMuscles.some(
    (value) => normalizeMuscleName(value) === muscle,
  );
}

/**
 * Rank one muscle's candidates.
 *
 * Familiarity is the heaviest term because a workout made entirely of
 * movements the user has never done is a workout they cannot load correctly —
 * every exercise would cold-start, and the whole session becomes calibration.
 * Fitbod biases the same way.
 */
function scoreCandidate(
  candidate: CandidateExercise,
  options: GenerationOptions,
  excludeIds: ReadonlySet<string>,
): number {
  let score = 0;
  if (candidate.timesPerformed > 0) {
    score += GENERATION_TUNABLES.familiarityBonus;
  }
  const level = options.experienceLevel?.trim().toLowerCase();
  if (level && candidate.level?.trim().toLowerCase() === level) {
    score += GENERATION_TUNABLES.levelMatchBonus;
  }
  if (excludeIds.has(candidate.id)) {
    score += GENERATION_TUNABLES.swapPenalty;
  }
  if (isMobilityExercise(candidate)) {
    score += GENERATION_TUNABLES.mobilityPenalty;
  }
  return score;
}

/**
 * Highest-scoring candidate, or null.
 *
 * `usedIds` is a hard exclusion rather than the score penalty the blueprint
 * sketched. A penalty leaves the door open to picking the same exercise for two
 * muscles when it is the only option for both — which is not a slightly worse
 * workout, it is a broken one: the same card twice, and the second one's
 * prescription silently ignoring the first's fatigue.
 */
function pickBest(
  candidates: readonly CandidateExercise[],
  options: GenerationOptions,
  usedIds: ReadonlySet<string>,
  excludeIds: ReadonlySet<string>,
): CandidateExercise | null {
  let best: CandidateExercise | null = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    if (usedIds.has(candidate.id)) continue;
    const score = scoreCandidate(candidate, options, excludeIds);
    // Strictly greater, plus an id tiebreak: never `>=`, which would make the
    // winner depend on input order.
    if (
      score > bestScore ||
      (score === bestScore && best !== null && candidate.id < best.id)
    ) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Choose the workout: which muscles, which exercises, in which order.
 *
 * One compound and up to one isolation per target muscle. Compounds first
 * within a muscle because they are what the muscle is actually there to do,
 * and a user who runs out of time should lose the curl, not the row.
 *
 * The finished order is compounds before isolation, then larger muscles before
 * smaller — heavy work while fresh — then the muscle's own freshness rank, then
 * id. That last term is what keeps two runs identical.
 *
 * Returns {@link WorkoutPlan} rather than the bare array the blueprint sketched:
 * the duration fitter has to be able to *add* work to a workout that came in
 * short, and it cannot invent a candidate the planner never surfaced.
 */
export function planWorkout(
  freshness: readonly MuscleFreshness[],
  candidates: readonly CandidateExercise[],
  options: GenerationOptions,
): WorkoutPlan {
  const targetMuscles = selectTargetMuscles(freshness);
  const excludeIds = new Set(options.excludeIds ?? []);

  const eligible = candidates.filter(
    (candidate) =>
      isPerformable(candidate, options.availableEquipment) &&
      !isExcludedByLimitations(candidate, options.limitations),
  );

  const usedIds = new Set<string>();
  const exercises: PlannedExercise[] = [];
  const alternates: PlannedExercise[] = [];

  for (const muscle of targetMuscles) {
    const forMuscle = eligible.filter((candidate) =>
      trainsPrimarily(candidate, muscle),
    );
    const compounds = forMuscle.filter(isCompound);
    const isolations = forMuscle.filter((candidate) => !isCompound(candidate));

    // A muscle with no compound available still gets its best movement — a
    // machine-only gym may have no compound row at all, and an empty slot is
    // worse than an isolation one.
    const compoundPool = compounds.length > 0 ? compounds : isolations;
    const compound = pickBest(compoundPool, options, usedIds, excludeIds);
    if (compound) {
      usedIds.add(compound.id);
      exercises.push({
        candidate: compound,
        targetMuscle: muscle,
        slot: compounds.length > 0 ? "compound" : "isolation",
      });
    }

    const isolationPool = isolations.filter(
      (candidate) => !usedIds.has(candidate.id),
    );
    const isolation = pickBest(isolationPool, options, usedIds, excludeIds);
    if (isolation) {
      usedIds.add(isolation.id);
      exercises.push({
        candidate: isolation,
        targetMuscle: muscle,
        slot: "isolation",
      });
    }

    const bench = pickBest(
      isolationPool.filter((candidate) => !usedIds.has(candidate.id)),
      options,
      usedIds,
      excludeIds,
    );
    if (bench) {
      alternates.push({
        candidate: bench,
        targetMuscle: muscle,
        slot: "isolation",
      });
    }
  }

  const muscleRank = new Map(
    targetMuscles.map((muscle, index) => [muscle, index]),
  );
  const ordered = [...exercises].sort((a, b) => {
    const slotDelta =
      (a.slot === "compound" ? 0 : 1) - (b.slot === "compound" ? 0 : 1);
    if (slotDelta !== 0) return slotDelta;
    const sizeDelta =
      muscleSizeRank(a.targetMuscle) - muscleSizeRank(b.targetMuscle);
    if (sizeDelta !== 0) return sizeDelta;
    const rankDelta =
      (muscleRank.get(a.targetMuscle) ?? 0) -
      (muscleRank.get(b.targetMuscle) ?? 0);
    if (rankDelta !== 0) return rankDelta;
    return a.candidate.id < b.candidate.id
      ? -1
      : a.candidate.id > b.candidate.id
        ? 1
        : 0;
  });

  return { targetMuscles, exercises: ordered, alternates };
}

// ---------------------------------------------------------------------------
// Prescription
// ---------------------------------------------------------------------------

export function repTargetFor(goal: WorkoutGoal): number {
  if (goal === "strength") return GENERATION_TUNABLES.repTargetStrength;
  if (goal === "hypertrophy") return GENERATION_TUNABLES.repTargetHypertrophy;
  return GENERATION_TUNABLES.repTargetGeneral;
}

export function workingSetCountFor(goal: WorkoutGoal): number {
  return goal === "strength"
    ? GENERATION_TUNABLES.workingSetsStrength
    : GENERATION_TUNABLES.workingSetsDefault;
}

/**
 * Rest between sets, seconds — the exercise sheet's "2:00 rest" chip, also
 * stamped on every set so the existing rest-timer machinery picks it up with
 * no changes.
 */
export function restSecondsFor(
  slot: "compound" | "isolation",
  modality: string,
  goal: WorkoutGoal,
): number {
  if (modality === "duration" || modality === "duration_distance") {
    return GENERATION_TUNABLES.restDuration;
  }
  if (slot === "compound") {
    return goal === "strength"
      ? GENERATION_TUNABLES.restCompoundStrength
      : GENERATION_TUNABLES.restCompound;
  }
  return GENERATION_TUNABLES.restIsolation;
}

function workingSetsOf(session: HistorySession) {
  return session.sets.filter((set) => !isWarmupSetType(set.setType));
}

/**
 * The load the last session was actually done at: the most common working-set
 * weight, not the heaviest and not the mean.
 *
 * The mode is what survives the shapes real logs take. A top set followed by
 * two back-offs has a max that overstates the session, and a dropset has a mean
 * that matches none of its sets. Ties go to the heavier load, so a straight
 * two-and-two reads as the harder of the two.
 */
export function modalWorkingWeightKg(session: HistorySession): number | null {
  const weights = workingSetsOf(session)
    .map((set) => set.weight)
    .filter((weight): weight is number => weight != null && weight > 0);
  if (weights.length === 0) return null;

  const counts = new Map<number, number>();
  for (const weight of weights) {
    counts.set(weight, (counts.get(weight) ?? 0) + 1);
  }
  let best = weights[0]!;
  let bestCount = 0;
  for (const [weight, count] of counts) {
    if (count > bestCount || (count === bestCount && weight > best)) {
      best = weight;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Up, down, or hold — the progression rules from the coaching prompt, made
 * arithmetic.
 *
 * Earning an increase takes a clean sweep: every working set at or above
 * target. One set short means the load was already at the edge, and adding to
 * it buys a failed session.
 *
 * A deload takes two sessions, not one. A single bad day is a bad day — poor
 * sleep, a rushed lunch — and dropping the weight for it teaches the app to
 * chase noise downward. Two in a row is a pattern.
 */
export function decideProgression(
  history: ExerciseHistoryInput,
  repTarget: number,
): ProgressionDecision {
  const [latest, previous] = history.lastSessions;
  if (!latest) return "cold-start";

  const latestWorking = workingSetsOf(latest).filter(
    (set) => set.reps != null && set.reps > 0,
  );
  if (latestWorking.length === 0) return "hold";

  const shortfall = repTarget - GENERATION_TUNABLES.deloadRepShortfall;
  const missedIn = (session: HistorySession | undefined): boolean =>
    session !== undefined &&
    workingSetsOf(session).some(
      (set) => set.reps != null && set.reps < shortfall,
    );

  if (latestWorking.every((set) => (set.reps ?? 0) >= repTarget)) {
    return "increase";
  }
  if (missedIn(latest) && missedIn(previous)) return "decrease";
  return "hold";
}

/**
 * Progression step. Lower body moves in 5% jumps against upper body's 2.5%
 * because the absolute loads are so much larger — a squat that adds 2.5% a
 * session is adding less than the smallest pair of plates.
 */
function progressionMultiplier(
  decision: ProgressionDecision,
  primaryMuscles: readonly string[],
): number {
  if (decision === "decrease") return GENERATION_TUNABLES.deloadMultiplier;
  if (decision !== "increase") return 1;
  const first = primaryMuscles[0];
  return first && isLowerBodyMuscle(first)
    ? GENERATION_TUNABLES.progressionLowerBody
    : GENERATION_TUNABLES.progressionUpperBody;
}

function coldStartLoadKg(equipment: readonly string[]): number | null {
  for (const item of equipment) {
    const load = COLD_START_LOAD_KG[normalizeEquipmentName(item)];
    if (load != null) return load;
  }
  return null;
}

function lastDurationSeconds(history: ExerciseHistoryInput | null) {
  const latest = history?.lastSessions[0];
  if (!latest) return null;
  for (const set of workingSetsOf(latest)) {
    if (set.duration != null && set.duration > 0) return set.duration;
  }
  return null;
}

function lastDistanceKm(history: ExerciseHistoryInput | null) {
  const latest = history?.lastSessions[0];
  if (!latest) return null;
  for (const set of workingSetsOf(latest)) {
    if (set.distance != null && set.distance > 0) return set.distance;
  }
  return null;
}

/**
 * Program one exercise's sets.
 *
 * Modality decides the shape before anything else does: a plank is not
 * three-sets-of-ten with a null weight, it is a duration hold, and a run is a
 * single block with a distance. Getting this wrong produces a workout that
 * looks right in JSON and is nonsense on the screen.
 *
 * Returns the rest prescription and the progression decision alongside the
 * sets, rather than the bare array the blueprint sketched — the rationale
 * string the card displays ("+2.5% from last session") is only derivable from
 * the decision, and recomputing it outside would mean two copies of these
 * rules.
 */
export function prescribeSets(
  exercise: CandidateExercise,
  history: ExerciseHistoryInput | null,
  options: GenerationOptions,
  slot: "compound" | "isolation" = "compound",
): Prescription {
  const repTarget = repTargetFor(options.goal);
  const restSeconds = restSecondsFor(slot, exercise.modality, options.goal);
  const modality = resolveExerciseModality(
    exercise.modality,
    exercise.category,
  );

  // Mobility first, ahead of the modality branches: a stretch is stored
  // `weight_reps` like everything else, so reading modality alone programs
  // "Chin To Chest Stretch" as three sets of ten with a cold-start load on it.
  // A stretch is a hold — a short one, twice, with no load and no progression
  // to make. The last session's hold is honoured if there is one, so a user who
  // logs 45 s keeps 45 s.
  if (isMobilityExercise(exercise)) {
    const duration =
      lastDurationSeconds(history) ?? GENERATION_TUNABLES.mobilityHoldSeconds;
    return {
      sets: Array.from(
        { length: GENERATION_TUNABLES.mobilitySets },
        (_, index) => ({
          set_number: index + 1,
          set_type: DEFAULT_SET_TYPE,
          reps: null,
          weight: null,
          duration,
          distance: null,
          rest_time: GENERATION_TUNABLES.restMobility,
        }),
      ),
      restSeconds: GENERATION_TUNABLES.restMobility,
      progression: "hold",
      workingWeightKg: null,
      appliedMultiplier: 1,
      modality: "duration",
      mobility: true,
    };
  }

  if (exercise.modality === "duration_distance") {
    // Cardio is one block, not a set scheme.
    return {
      sets: [
        {
          set_number: 1,
          set_type: DEFAULT_SET_TYPE,
          reps: null,
          weight: null,
          duration:
            lastDurationSeconds(history) ??
            GENERATION_TUNABLES.defaultCardioSeconds,
          distance: lastDistanceKm(history),
          rest_time: restSeconds,
        },
      ],
      restSeconds,
      progression: history?.lastSessions.length ? "hold" : "cold-start",
      workingWeightKg: null,
      appliedMultiplier: 1,
      modality,
      mobility: false,
    };
  }

  const setCount = workingSetCountFor(options.goal);

  if (exercise.modality === "duration") {
    const duration =
      lastDurationSeconds(history) ??
      GENERATION_TUNABLES.defaultDurationSeconds;
    return {
      sets: Array.from({ length: setCount }, (_, index) => ({
        set_number: index + 1,
        set_type: DEFAULT_SET_TYPE,
        reps: null,
        weight: null,
        duration,
        distance: null,
        rest_time: restSeconds,
      })),
      restSeconds,
      progression: history?.lastSessions.length ? "hold" : "cold-start",
      workingWeightKg: null,
      appliedMultiplier: 1,
      modality,
      mobility: false,
    };
  }

  const latest =
    history && history.lastSessions.length > 0
      ? history.lastSessions[0]
      : undefined;
  const decision = latest
    ? decideProgression(history!, repTarget)
    : "cold-start";

  let workingWeightKg: number | null = null;
  let appliedMultiplier = 1;
  if (exercise.modality === "weight_reps") {
    // A logged session with no usable weights (all reps-only, or all zero)
    // leaves nothing to progress from, so it cold-starts like a first session
    // rather than progressing off a number that was never lifted.
    const baseline = latest ? modalWorkingWeightKg(latest) : null;
    if (baseline == null) {
      workingWeightKg = coldStartLoadKg(exercise.equipment);
    } else {
      appliedMultiplier = progressionMultiplier(
        decision,
        exercise.primaryMuscles,
      );
      workingWeightKg = quantizeLoadKg(
        baseline * appliedMultiplier,
        exercise.equipment[0],
      );
    }
    if (workingWeightKg != null && workingWeightKg <= 0) workingWeightKg = null;
  }

  return {
    sets: Array.from({ length: setCount }, (_, index) => ({
      set_number: index + 1,
      set_type: DEFAULT_SET_TYPE,
      reps: repTarget,
      weight: workingWeightKg,
      duration: null,
      distance: null,
      rest_time: restSeconds,
    })),
    restSeconds,
    progression: decision,
    workingWeightKg,
    appliedMultiplier,
    modality,
    mobility: false,
  };
}

/**
 * The one-line "why this, why this weight" the card shows. Display only —
 * nothing parses it back, so it is free to read like a sentence.
 *
 * The percentage is rendered from the multiplier the prescription actually
 * applied rather than re-derived from the goal, so the string can never claim
 * a step the sets were not built with.
 */
export function rationaleFor(
  targetMuscle: string,
  prescription: Prescription,
): string {
  const fresh = `fresh ${targetMuscle}`;
  const percent = (multiplier: number): string => {
    const delta = Math.round(Math.abs(multiplier - 1) * 1000) / 10;
    return `${delta}%`;
  };
  // Mobility work has no load to explain, so none of the progression sentences
  // below say anything true about it: "first time — starting light" reads as a
  // conservative weight on a movement that has no weight.
  if (prescription.mobility) return `${fresh} · mobility hold`;
  switch (prescription.progression) {
    case "cold-start":
      return `${fresh} · first time — starting light`;
    case "increase":
      return `${fresh} · +${percent(prescription.appliedMultiplier)} from last session`;
    case "decrease":
      return `${fresh} · -${percent(prescription.appliedMultiplier)} after two short sessions`;
    default:
      return `${fresh} · holding last session's load`;
  }
}

// ---------------------------------------------------------------------------
// Warm-ups
// ---------------------------------------------------------------------------

/**
 * The ramp before the first working set.
 *
 * Nothing below {@link GENERATION_TUNABLES.warmupMinLoadKg}: at an empty bar
 * or a 20 kg machine stack the first working set *is* the warm-up, and adding
 * a 12 kg ramp set wastes a minute and insults the user. Past 60 kg one ramp
 * is not enough, so it becomes two.
 *
 * These never earn PRs — the PR logic already excludes warm-up set types, both
 * in the detector and in `getBestSetForExercise`'s SQL — so a light ramp cannot
 * pollute the user's records.
 */
export function warmupSetsFor(
  workingWeightKg: number | null,
  equipment: readonly string[],
  modality = "weight_reps",
): RecommendationSet[] {
  if (modality !== "weight_reps") return [];
  if (
    workingWeightKg == null ||
    workingWeightKg < GENERATION_TUNABLES.warmupMinLoadKg
  ) {
    return [];
  }
  const increment = equipment[0];
  const ramp = (fraction: number, reps: number) => ({
    weight: quantizeLoadKg(workingWeightKg * fraction, increment),
    reps,
  });
  const steps =
    workingWeightKg >= GENERATION_TUNABLES.warmupTwoStepLoadKg
      ? [
          ramp(
            GENERATION_TUNABLES.warmupFirstFraction,
            GENERATION_TUNABLES.warmupFirstReps,
          ),
          ramp(
            GENERATION_TUNABLES.warmupSecondFraction,
            GENERATION_TUNABLES.warmupSecondReps,
          ),
        ]
      : [
          ramp(
            GENERATION_TUNABLES.warmupSingleFraction,
            GENERATION_TUNABLES.warmupSingleReps,
          ),
        ];

  return steps.map((step, index) => ({
    set_number: index + 1,
    set_type: "Warmup" as const,
    reps: step.reps,
    weight: step.weight > 0 ? step.weight : null,
    duration: null,
    distance: null,
    rest_time: GENERATION_TUNABLES.warmupRestSeconds,
  }));
}

/** Warm-ups first, then working sets, renumbered from 1 across the whole list. */
export function withWarmups(
  workingSets: readonly RecommendationSet[],
  warmups: readonly RecommendationSet[],
): RecommendationSet[] {
  return [...warmups, ...workingSets].map((set, index) => ({
    ...set,
    set_number: index + 1,
  }));
}

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

/**
 * How long the workout will take, minutes.
 *
 * Work plus rest plus a fixed per-exercise overhead for finding the station,
 * loading it and reading the screen. Reps are charged a flat
 * {@link GENERATION_TUNABLES.secondsPerRep}, which is about right for a
 * controlled tempo across the rep ranges the generator programs.
 *
 * Not reusable from `calorieCalculations.setsDurationMinutes`, which sums
 * *recorded* duration and rest from a finished workout — there is nothing to
 * sum here yet. It does share that function's discipline of staying in seconds
 * until the last step.
 */
export function estimateDurationMinutes(
  exercises: readonly RecommendedExercise[],
): number {
  let seconds = 0;
  for (const exercise of exercises) {
    seconds += GENERATION_TUNABLES.setupSecondsPerExercise;
    for (const set of exercise.sets) {
      seconds +=
        set.duration ?? (set.reps ?? 0) * GENERATION_TUNABLES.secondsPerRep;
      seconds += set.rest_time ?? 0;
    }
  }
  return Math.ceil(seconds / 60);
}

function workingSetCount(exercise: RecommendedExercise): number {
  return exercise.sets.filter((set) => !isWarmupSetType(set.set_type)).length;
}

function dropLastWorkingSet(
  exercise: RecommendedExercise,
): RecommendedExercise {
  const sets = [...exercise.sets];
  for (let i = sets.length - 1; i >= 0; i--) {
    if (!isWarmupSetType(sets[i]!.set_type)) {
      sets.splice(i, 1);
      break;
    }
  }
  return {
    ...exercise,
    sets: sets.map((set, index) => ({ ...set, set_number: index + 1 })),
  };
}

/**
 * One programmed exercise plus the planning facts the fitter needs.
 *
 * Slot and target muscle are deliberately NOT on the wire payload — a client
 * has no use for them — but the fitter cannot work without them. Inferring
 * them back out of the payload was the alternative, and it does not survive
 * contact: "compound" would have to be read off the rest time, which makes a
 * cardio exercise look like an isolation one, and the target muscle would have
 * to be guessed from the first primary muscle, which is right only until an
 * exercise is slotted against its secondary.
 */
export interface FittableExercise {
  exercise: RecommendedExercise;
  slot: "compound" | "isolation";
  targetMuscle: string;
}

/**
 * Trim or extend the workout to land near the requested duration.
 *
 * Over budget, work comes off in the order it can best be spared: isolation
 * exercises first and from the least fresh muscle backwards, then fourth sets.
 * A compound is never removed, and an isolation is never removed while it is
 * the only exercise left for its target muscle — a "chest and back" workout
 * that has lost its chest movement is not a shorter version of the workout, it
 * is a different one.
 *
 * Under budget by more than the slack, pre-programmed bench candidates are
 * added while they still fit. Anything added must arrive already prescribed:
 * this function places sets, it cannot invent them.
 */
export function fitToDuration(
  items: readonly FittableExercise[],
  targetMinutes: number,
  alternates: readonly FittableExercise[] = [],
  targetMuscles: readonly string[] = [],
): RecommendedExercise[] {
  let current = [...items];

  const muscleOrder = new Map(
    targetMuscles.map((muscle, index) => [muscle, index]),
  );
  const durationOf = (list: readonly FittableExercise[]): number =>
    estimateDurationMinutes(list.map((item) => item.exercise));

  // A while loop with a hard iteration cap rather than `while (true)`: each
  // pass must remove something, but a bug that stopped removing would
  // otherwise hang the request rather than return a slightly long workout.
  const guard = current.length * 2 + 16;
  let iterations = 0;
  while (durationOf(current) > targetMinutes && iterations++ < guard) {
    const counts = new Map<string, number>();
    for (const item of current) {
      counts.set(item.targetMuscle, (counts.get(item.targetMuscle) ?? 0) + 1);
    }

    const removable = current
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) =>
          item.slot === "isolation" && (counts.get(item.targetMuscle) ?? 0) > 1,
      )
      .sort(
        (a, b) =>
          (muscleOrder.get(b.item.targetMuscle) ?? 0) -
          (muscleOrder.get(a.item.targetMuscle) ?? 0),
      );

    if (removable.length > 0) {
      const target = removable[0]!.index;
      current = current.filter((_, index) => index !== target);
      continue;
    }

    const trimmable = current.findIndex(
      (item) =>
        workingSetCount(item.exercise) > GENERATION_TUNABLES.workingSetsDefault,
    );
    if (trimmable >= 0) {
      current[trimmable] = {
        ...current[trimmable]!,
        exercise: dropLastWorkingSet(current[trimmable]!.exercise),
      };
      continue;
    }
    break;
  }

  const usedIds = new Set(current.map((item) => item.exercise.exercise_id));
  for (const alternate of alternates) {
    if (usedIds.has(alternate.exercise.exercise_id)) continue;
    if (
      durationOf(current) >
      targetMinutes - GENERATION_TUNABLES.underBudgetSlackMinutes
    ) {
      break;
    }
    const extended = [...current, alternate];
    if (durationOf(extended) > targetMinutes) continue;
    current = extended;
    usedIds.add(alternate.exercise.exercise_id);
  }

  return current.map((item, index) => ({
    ...item.exercise,
    sort_order: index,
  }));
}
