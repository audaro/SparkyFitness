import type { TFunction } from 'i18next';
import type {
  ExerciseEntrySetRequest,
  ExerciseEntrySetResponse,
  ExerciseModality,
  ExerciseRecentSessionSet,
  EntryExerciseSnapshotResponse,
  ExerciseSessionResponse,
  PresetSessionExerciseRequest,
  PresetSessionResponse,
  RecommendedExercise,
  WorkoutRecommendationPayload,
} from '@workspace/shared';
import {
  epley1RmKg,
  estimateRepMaxKg,
  isCardioModality,
  isExerciseModality,
  isWarmupSetType,
  resolveExerciseModality,
  setsDurationMinutes,
} from '@workspace/shared';
import type { IconName } from '../components/Icon';
// Type-only, so the store's runtime import of this module stays acyclic.
import type { CompletedSetMap, PrSetMap } from '../stores/activeWorkoutStore';
import type { WorkoutDraftExercise, WorkoutDraftSet } from '../types/drafts';
import type { Exercise } from '../types/exercise';
import type { ExternalExerciseItem } from '../types/externalExercises';
import type {
  WorkoutPreset,
  WorkoutPresetExercise,
  WorkoutPresetSet,
} from '../types/workoutPresets';
import type { WorkoutPresetExercisePayload } from '../services/api/workoutPresetsApi';
import type { CreateExerciseEntryPayload } from '../services/api/exerciseApi';
import {
  weightToKg,
  weightFromKg,
  distanceFromKm,
  distanceToKm,
} from './unitConversions';
import { parseDecimalInput } from './numericInput';
import { getDefaultRestSec, type PlannedExercise } from './workoutSupersets';
import { formatLocalizedNumber } from '../localization';

// The superset/reorder algebra lives in its own module; re-exported here so
// the many existing import sites keep working.
export * from './workoutSupersets';

/**
 * Reads a record keyed by library exercise id, tolerating an entry whose
 * exercise has been deleted (`exercise_id` is then null).
 *
 * Such an entry has no library-scoped history to look up -- no PREVIOUS column,
 * no PR baseline -- so the lookup simply yields nothing. Centralising it here
 * keeps the null out of a dozen call sites that would otherwise each need a
 * guard, and makes "deleted exercise means no history" a single decision.
 */
export function historyForExercise<T>(
  record: Record<string, T>,
  exerciseId: string | null
): T | undefined {
  return exerciseId == null ? undefined : record[exerciseId];
}

export const CATEGORY_ICON_MAP: Record<string, IconName> = {
  Strength: 'exercise-weights',
  Cardio: 'exercise-running',
  Running: 'exercise-running',
  Cycling: 'exercise-cycling',
  Swimming: 'exercise-swimming',
  Walking: 'exercise-walking',
  Hiking: 'exercise-hiking',
  Yoga: 'exercise-yoga',
  Pilates: 'exercise-pilates',
  Dance: 'exercise-dance',
  Boxing: 'exercise-boxing',
  Rowing: 'exercise-rowing',
  Tennis: 'exercise-tennis',
  Basketball: 'exercise-basketball',
  Soccer: 'exercise-soccer',
  Elliptical: 'exercise-elliptical',
  'Stair Stepper': 'exercise-stair',
};

// Keyword matching for exercise names that don't exactly match CATEGORY_ICON_MAP keys
// (e.g. HealthKit's "Traditional Strength Training", "Stair Climbing")
const NAME_KEYWORDS: [string, IconName][] = [
  ['cycling', 'exercise-cycling'],
  ['biking', 'exercise-cycling'],
  ['swim', 'exercise-swimming'],
  ['walk', 'exercise-walking'],
  ['hik', 'exercise-hiking'],
  ['yoga', 'exercise-yoga'],
  ['pilates', 'exercise-pilates'],
  ['danc', 'exercise-dance'],
  ['box', 'exercise-boxing'],
  ['row', 'exercise-rowing'],
  ['tennis', 'exercise-tennis'],
  ['basketball', 'exercise-basketball'],
  ['soccer', 'exercise-soccer'],
  ['elliptical', 'exercise-elliptical'],
  ['stair', 'exercise-stair'],
  ['strength', 'exercise-weights'],
  ['weight', 'exercise-weights'],
  ['run', 'exercise-running'],
];

export function getWorkoutIcon(session: ExerciseSessionResponse): IconName {
  if (session.type === 'preset') return 'exercise-weights';

  const name = session.name ?? session.exercise_snapshot?.name ?? '';
  const category = session.exercise_snapshot?.category;

  // Exact name match (handles synced workouts where name is the activity type)
  if (name in CATEGORY_ICON_MAP) return CATEGORY_ICON_MAP[name];

  // Category match (for manually created exercises with proper categories)
  if (category && category !== 'Cardio' && category in CATEGORY_ICON_MAP) {
    return CATEGORY_ICON_MAP[category];
  }

  // Keyword match on name (e.g. "Traditional Strength Training" → strength → weights icon)
  const nameLower = name.toLowerCase();
  for (const [keyword, icon] of NAME_KEYWORDS) {
    if (nameLower.includes(keyword)) return icon;
  }

  // Generic Cardio category fallback
  if (category && category in CATEGORY_ICON_MAP) {
    return CATEGORY_ICON_MAP[category];
  }

  return 'exercise-default';
}

const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  manual: 'Sparky',
  sparky: 'Sparky',
  'workout plan': 'Sparky',
  healthkit: 'Apple Health',
  'health connect': 'Health Connect',
  garmin: 'Garmin',
  garmin_fit: 'Garmin',
  strava: 'Strava',
  fitbit: 'Fitbit',
  withings: 'Withings',
};

/**
 * Present a human-readable label for a workout session source. This function
 * is purely presentational — editability is decided by
 * `canEditGroupedWorkout` from `@workspace/shared`, never by this label map.
 */
export function getSourceLabel(source: string | null | undefined): string {
  if (source == null) {
    return 'Sparky';
  }

  const trimmed = source.trim();
  const normalized = trimmed.toLowerCase();

  return SOURCE_DISPLAY_NAMES[normalized] ?? trimmed;
}

export function formatDuration(minutes: number): string {
  // A session that lasted seconds is still a session: never round it to "0 min".
  if (minutes > 0 && minutes < 1) return '<1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

export function getFirstImage(session: ExerciseSessionResponse): string | null {
  if (session.type === 'individual') {
    return session.exercise_snapshot?.images?.[0] ?? null;
  }
  for (const exercise of session.exercises) {
    const img = exercise.exercise_snapshot?.images?.[0];
    if (img) return img;
  }
  return null;
}

export function getSessionCalories(session: ExerciseSessionResponse): number {
  if (session.type === 'preset') {
    return session.exercises.reduce((sum, e) => sum + e.calories_burned, 0);
  }
  return session.calories_burned || 0;
}

// --- Exercise stats (single-pass over sessions array) ---

export interface ExerciseStats {
  caloriesBurned: number;
  activeCalories: number;
  otherExerciseCalories: number;
  durationMinutes: number;
}

export function calculateExerciseStats(
  sessions: ExerciseSessionResponse[]
): ExerciseStats {
  let caloriesBurned = 0;
  let activeCalories = 0;
  let otherExerciseCalories = 0;
  let durationMinutes = 0;

  for (const session of sessions) {
    const sessionCals = getSessionCalories(session);
    caloriesBurned += sessionCals;

    if (session.type === 'preset') {
      otherExerciseCalories += sessionCals;
      durationMinutes += session.total_duration_minutes;
    } else {
      const isActiveCals =
        session.exercise_snapshot?.name === 'Active Calories';
      if (isActiveCals) {
        activeCalories += session.calories_burned || 0;
      } else {
        otherExerciseCalories += sessionCals;
        durationMinutes += session.duration_minutes ?? 0;
      }
    }
  }

  return {
    caloriesBurned,
    activeCalories,
    otherExerciseCalories,
    durationMinutes,
  };
}

/** Total calories across all sessions. */
export const calculateCaloriesBurned = (
  sessions: ExerciseSessionResponse[]
): number => calculateExerciseStats(sessions).caloriesBurned;

/** Calories from "Active Calories" individual entries only (e.g. watch/fitness tracker). */
export const calculateActiveCalories = (
  sessions: ExerciseSessionResponse[]
): number => calculateExerciseStats(sessions).activeCalories;

/** Calories from all sessions except "Active Calories" entries. */
export const calculateOtherExerciseCalories = (
  sessions: ExerciseSessionResponse[]
): number => calculateExerciseStats(sessions).otherExerciseCalories;

/** Total duration in minutes, excluding "Active Calories" entries. */
export const calculateExerciseDuration = (
  sessions: ExerciseSessionResponse[]
): number => calculateExerciseStats(sessions).durationMinutes;

export function getWorkoutSummary(
  session: ExerciseSessionResponse,
  t: TFunction
): {
  name: string;
  duration: number;
  calories: number;
} {
  if (session.type === 'preset') {
    return {
      name: session.name,
      duration: session.total_duration_minutes,
      calories: getSessionCalories(session),
    };
  }
  return {
    name:
      session.name ??
      session.exercise_snapshot?.name ??
      t('workout.unknownExercise', { defaultValue: 'Unknown exercise' }),
    duration: session.duration_minutes,
    calories: session.calories_burned,
  };
}

export function buildSessionSubtitle(
  session: ExerciseSessionResponse,
  duration: number,
  calories: number,
  t: TFunction,
  weightUnit: 'kg' | 'lbs' = 'kg',
  distanceUnit: 'km' | 'miles' = 'km'
): string {
  if (session.type === 'preset') {
    const exerciseCount = session.exercises.length;
    // A cardio effort's backing set is an implementation detail (every read
    // surface renders it as duration+distance), so cardio exercises stay out
    // of the set count and contribute their distance instead — the cardio
    // analog of strength volume.
    let totalSets = 0;
    let totalVolumeKg = 0;
    let totalDistanceKm = 0;
    for (const ex of session.exercises) {
      if (isCardioModality(resolveSnapshotModality(ex.exercise_snapshot))) {
        totalDistanceKm += ex.distance ?? 0;
        continue;
      }
      totalSets += ex.sets.length;
      for (const set of ex.sets)
        totalVolumeKg += (set.weight ?? 0) * (set.reps ?? 0);
    }

    const parts: string[] = [];
    parts.push(
      t('workout.exerciseCount', {
        count: exerciseCount,
        formattedCount: String(exerciseCount),
        defaultValue: '{{formattedCount}} exercises',
        defaultValue_one: '{{formattedCount}} exercise',
        defaultValue_other: '{{formattedCount}} exercises',
      })
    );
    if (totalSets > 0)
      parts.push(
        t('workout.setCount', {
          count: totalSets,
          formattedCount: String(totalSets),
          defaultValue: '{{formattedCount}} sets',
          defaultValue_one: '{{formattedCount}} set',
          defaultValue_other: '{{formattedCount}} sets',
        })
      );
    if (totalVolumeKg > 0) {
      const vol = Math.round(weightFromKg(totalVolumeKg, weightUnit));
      parts.push(`${formatLocalizedNumber(vol)} ${weightUnit}`);
    }
    if (totalDistanceKm > 0) {
      const dist = distanceFromKm(totalDistanceKm, distanceUnit);
      parts.push(
        `${formatLocalizedNumber(dist, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${distanceUnit === 'miles' ? 'mi' : 'km'}`
      );
    }
    if (calories > 0)
      parts.push(
        `${Math.round(calories)} ${t('workout.caloriesUnit', { defaultValue: 'Cal' })}`
      );
    return parts.join(' · ');
  }

  // Individual with sets: show sets info + duration/calories. Cardio is
  // excluded even though it is set-backed — "1 set" would hide the run;
  // its entry totals render through the activity branch below instead.
  const cardio = isCardioModality(
    resolveSnapshotModality(session.exercise_snapshot)
  );
  if (!cardio && session.sets.length > 0) {
    const totalSets = session.sets.length;
    const totalVolumeKg = session.sets.reduce(
      (sum, set) => sum + (set.weight ?? 0) * (set.reps ?? 0),
      0
    );
    const parts: string[] = [];
    parts.push(
      t('workout.setCount', {
        count: totalSets,
        formattedCount: String(totalSets),
        defaultValue: '{{formattedCount}} sets',
        defaultValue_one: '{{formattedCount}} set',
        defaultValue_other: '{{formattedCount}} sets',
      })
    );
    if (totalVolumeKg > 0) {
      const vol = Math.round(weightFromKg(totalVolumeKg, weightUnit));
      parts.push(`${formatLocalizedNumber(vol)} ${weightUnit}`);
    }
    if (duration > 0) parts.push(formatDuration(duration));
    if (calories > 0)
      parts.push(
        `${Math.round(calories)} ${t('workout.caloriesUnit', { defaultValue: 'Cal' })}`
      );
    return parts.join(' · ');
  }

  // Individual activity (and set-backed cardio): duration, distance, calories
  const parts: string[] = [];
  if (duration > 0) parts.push(formatDuration(duration));
  if (session.distance != null && session.distance > 0) {
    const dist = distanceFromKm(session.distance, distanceUnit);
    const label = distanceUnit === 'miles' ? 'mi' : 'km';
    parts.push(
      `${formatLocalizedNumber(dist, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${label}`
    );
  }
  if (calories > 0)
    parts.push(
      `${Math.round(calories)} ${t('workout.caloriesUnit', { defaultValue: 'Cal' })}`
    );
  return parts.join(' · ');
}

export function buildExercisesPayload(
  exercises: WorkoutDraftExercise[],
  weightUnit: 'kg' | 'lbs',
  distanceUnit: 'km' | 'miles'
) {
  // Server enforces "all or none" for exercise IDs on preset-session update
  // (exerciseService.js ~L1713). If any exercise is new, we strip IDs from all
  // exercises AND all sets so the server takes its delete-and-recreate path.
  // Set IDs within an exercise, by contrast, reconcile correctly with mixed
  // IDs — update for present IDs, insert for absent, delete for omitted.
  const allExercisesHaveServerId =
    exercises.length > 0 && exercises.every((e) => e.serverId !== undefined);

  return exercises.map((exercise, index) => {
    // The server recomputes calories from duration and sets whenever
    // calories_burned is omitted; a user-edited value is sent as a manual
    // override for this save only.
    const caloriesOverride = exercise.caloriesManuallySet
      ? parseDecimalInput(exercise.calories ?? '')
      : NaN;

    const sets = exercise.sets.map((set, setIndex) => {
      const weight = parseDecimalInput(set.weight);
      const reps = parseInt(set.reps, 10);
      const distance = parseDecimalInput(set.distance ?? '');
      // The server set UPDATE writes every column with `set.x ?? null`, so
      // fields the form has no UI for must still be round-tripped
      // explicitly — omitting them silently wipes the stored values.
      return {
        ...(allExercisesHaveServerId && set.serverId !== undefined
          ? { id: set.serverId }
          : {}),
        set_number: setIndex + 1,
        set_type: set.setType ?? null,
        weight: isNaN(weight) ? null : weightToKg(weight, weightUnit),
        reps: isNaN(reps) ? null : reps,
        duration: set.duration ?? null,
        distance: isNaN(distance) ? null : distanceToKm(distance, distanceUnit),
        ...(set.restTime != null ? { rest_time: set.restTime } : {}),
        notes: set.notes ?? null,
        rpe: set.rpe ?? null,
        completed_at: set.completedAt ?? null,
        is_pr: set.isPr ?? false,
      };
    });

    const modality = resolveSnapshotModality({
      modality: exercise.exerciseModality,
      category: exercise.exerciseCategory,
    });

    return {
      ...(allExercisesHaveServerId && exercise.serverId !== undefined
        ? { id: exercise.serverId }
        : {}),
      exercise_id: exercise.exerciseId,
      sort_order: index,
      // Cardio duration is the sum of its set durations — the sets are the
      // source of truth, and an explicit entry value would beat the server's
      // own derivation. Elsewhere the value round-trips from the session (the
      // form has no duration UI); sending 0 would zero the stored duration
      // and the calories derived from it.
      duration_minutes: isCardioModality(modality)
        ? setsDurationMinutes(sets)
        : (exercise.durationMinutes ?? 0),
      ...(!isNaN(caloriesOverride) && caloriesOverride >= 0
        ? { calories_burned: caloriesOverride }
        : {}),
      // The server nulls omitted entry fields, so the note must always be
      // sent — otherwise an edit-save wipes notes recorded during a live
      // workout.
      notes: exercise.notes ?? null,
      // The form has no superset UI; round-trip the value opaquely so manual
      // edits don't flatten grouping (the server nulls omitted fields).
      superset_group: exercise.supersetGroup ?? null,
      sets,
    };
  });
}

// --- Set metrics (active-workout log column + volume summaries) ---

/**
 * Snap a set weight to the server's storage precision (`exercise_entry_sets.weight`
 * is DECIMAL(10,2)) so a saved session echoes back value-identical. Storing an
 * unrounded lbs→kg conversion would make the autosave echo differ, and
 * ActiveWorkoutSetRow re-seeds its drafts from stored values.
 */
export function quantizeSetWeightKg(kg: number): number {
  return Math.round(kg * 100) / 100;
}

// Epley 1RM and its inverse now live in `@workspace/shared`
// (`utils/strengthMath.ts`) so the server recommendation engine prescribes
// loads with the same math the set row displays. Re-exported here because the
// screens and tests import them from this module.
export { epley1RmKg, estimateRepMaxKg };

export function setVolumeKg(
  set: Pick<ExerciseEntrySetResponse, 'weight' | 'reps'>
): number {
  return (set.weight ?? 0) * (set.reps ?? 0);
}

/** Total working volume for an exercise entry. Warmup sets are excluded. */
export function getExerciseVolumeKg(exercise: {
  sets: WorkoutCardSet[];
}): number {
  return exercise.sets.reduce(
    (total, set) =>
      isWarmupSetType(set.set_type) ? total : total + setVolumeKg(set),
    0
  );
}

// --- Exercise modality ---

/**
 * Resolve an exercise's modality from any snapshot-shaped source — an
 * `exercise_snapshot`, a full `Exercise`, or a preset exercise row. Explicit
 * valid modality wins; otherwise derived from category (old servers, legacy
 * rows).
 */
export function resolveSnapshotModality(
  snapshot:
    { modality?: string | null; category?: string | null } | null | undefined
): ExerciseModality {
  return resolveExerciseModality(
    snapshot?.modality,
    snapshot?.category ?? null
  );
}

/** True for the modalities whose set tables render a single duration cell. */
export function isDurationModality(modality: ExerciseModality): boolean {
  return modality === 'duration' || modality === 'duration_distance';
}

export { isCardioModality };

/**
 * True when a workout card renders the Duration+Distance cardio form in place
 * of a set table: a cardio exercise with at most one set. Multi-set cardio
 * (imports, future intervals) keeps the duration-style table so no set is
 * hidden. Surfaces that can disable the form entirely (the preset editor)
 * AND this with their own `cardioFormEnabled` gate.
 */
export function rendersCardioEffortForm(
  snapshot:
    { modality?: string | null; category?: string | null } | null | undefined,
  setCount: number
): boolean {
  return isCardioModality(resolveSnapshotModality(snapshot)) && setCount <= 1;
}

/**
 * Duration in seconds a set displays/fills/adopts. Legacy isometric rows hold
 * their seconds in `reps` (they predate the duration column), so `duration`
 * modality — and ONLY that modality — falls back to reps-as-seconds. The
 * fallback must never widen to `duration_distance`: backfilled cardio presets
 * carry seeded `reps: 10` that would otherwise render as 10-second sets.
 */
export function effectiveSetDurationSec(
  set: { duration?: number | null; reps?: number | null },
  modality: ExerciseModality
): number | null {
  return (
    set.duration ??
    (modality === 'duration' && set.reps != null ? set.reps : null)
  );
}

/** Read-only duration prose: `45s` under a minute, `1:30` from there up. */
export function formatDurationSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

// --- Card-stack input shapes ---

export interface WorkoutCardSet {
  /** Server set id (number) or `WorkoutDraftSet.clientId` (string). */
  id: string | number;
  set_number: number;
  set_type?: string | null;
  /** ALWAYS kg — display conversion happens in the row. */
  weight: number | null;
  reps: number | null;
  rpe?: number | null;
  rest_time?: number | null;
  notes?: string | null;
  duration?: number | null;
  /** ALWAYS km — display conversion happens in the cardio form. */
  distance?: number | null;
  /** Raw draft strings backing the edit-mode controlled inputs (draft mapper only). */
  editWeightText?: string;
  editRepsText?: string;
}

export interface WorkoutCardExercise {
  /** Entry id or `WorkoutDraftExercise.clientId`. */
  id: string;
  /**
   * Null once the library exercise has been deleted. Nothing the card renders
   * needs it -- name, category, modality and images all come from
   * `exercise_snapshot` -- it is only used to look up library-scoped history
   * (stats, PREVIOUS column, PR baseline), which a deleted exercise has none of.
   */
  exercise_id: string | null;
  superset_group?: number | null;
  /** Per-exercise note. Present on live/session entries and workout drafts; absent on preset sources. */
  notes?: string | null;
  /** Present on session entries; absent on draft/preset sources. */
  calories_burned?: number | null;
  exercise_snapshot: {
    name?: string | null;
    category?: string | null;
    modality?: string | null;
    images?: string[] | null;
    /** Region for the collapsed row's muscle badge; only the first is drawn. */
    primary_muscles?: string[] | null;
  } | null;
  sets: WorkoutCardSet[];
  /** Raw draft string backing the edit-mode calories input (draft mapper only). */
  editCaloriesText?: string;

  // Progression & Equipment Fields
  progression_mode?: 'rep_goal' | 'fixed' | 'step_load' | 'manual' | null;
  rep_goal?: number | null;
  increment_type?: 'weight' | 'reps' | null;
  increment_value?: number | null;
  equipment_brand?: string | null;
}

/**
 * Adapt a form-draft exercise for the card stack. Weight parsing matches
 * `buildExercisesPayload` exactly (parseDecimalInput → weightToKg, NaN → null)
 * so what the card displays is what a save would persist.
 */
/**
 * Adapt one exercise of a generated "Up Next" workout for the card stack.
 *
 * Sibling of {@link draftExerciseToCardExercise}: the recommendation payload is
 * already metric (kg, whole seconds, km), so nothing is converted here. The one
 * thing it has to invent is set ids — a `RecommendationSet` has none, because
 * nothing has been persisted yet — so each set gets a stable client id from its
 * position. Those ids are the handle the sheet edits against and never leave
 * the client: `buildRecommendationStartPayload` renumbers from the array order
 * when the workout actually starts.
 */
export function plannedExerciseToCardExercise(
  planned: PlannedExercise,
  setIds: readonly string[]
): WorkoutCardExercise {
  return {
    id: planned.exercise_id,
    exercise_id: planned.exercise_id,
    superset_group: planned.superset_group ?? null,
    notes: null,
    exercise_snapshot: {
      name: planned.exercise_name,
      category: null,
      modality: planned.modality,
      images: planned.images,
    },
    sets: planned.sets.map((set, index) => ({
      id: setIds[index] ?? `set-${index}`,
      set_number: set.set_number,
      set_type: CANONICAL_TO_MOBILE_SET_TYPE[set.set_type] ?? 'normal',
      weight: set.weight,
      reps: set.reps,
      duration: set.duration,
      distance: set.distance,
      rest_time: set.rest_time,
      notes: null,
      rpe: null,
    })),
  };
}

/**
 * Fold the card's edited sets back onto the planned exercise, so what the Up
 * Next list shows -- and what starting the workout writes -- is what the sheet
 * was showing. `set_number` is renumbered from the array order: the sheet can
 * add and delete sets, and a gap would survive into the started session.
 */
export function applyCardSetsToPlannedExercise(
  planned: PlannedExercise,
  sets: readonly WorkoutCardSet[]
): PlannedExercise {
  const toCanonical = (mobile: string | null | undefined): string => {
    const match = Object.entries(CANONICAL_TO_MOBILE_SET_TYPE).find(
      ([, value]) => value === mobile
    );
    return match?.[0] ?? 'Working Set';
  };
  // `rest_seconds` is the same number the sets carry -- it is what the Up Next
  // row's rest chip reads -- so a uniform rest is mirrored onto it. A mixed
  // one, or one the user cleared, leaves it alone rather than picking a set's
  // value to stand for all (the field is not nullable).
  const restValues = sets.map((set) => set.rest_time ?? null);
  const first = restValues[0];
  const uniformRest =
    first != null && restValues.every((rest) => rest === first)
      ? first
      : undefined;
  return {
    ...planned,
    ...(uniformRest === undefined ? {} : { rest_seconds: uniformRest }),
    sets: sets.map((set, index) => ({
      set_number: index + 1,
      set_type: toCanonical(
        set.set_type
      ) as PlannedExercise['sets'][number]['set_type'],
      reps: set.reps,
      weight: set.weight,
      duration: set.duration ?? null,
      distance: set.distance ?? null,
      rest_time: set.rest_time ?? null,
    })),
  };
}

export function draftExerciseToCardExercise(
  exercise: WorkoutDraftExercise,
  weightUnit: 'kg' | 'lbs',
  distanceUnit: 'km' | 'miles' = 'km'
): WorkoutCardExercise {
  return {
    id: exercise.clientId,
    exercise_id: exercise.exerciseId,
    superset_group: exercise.supersetGroup ?? null,
    notes: exercise.notes ?? null,
    editCaloriesText: exercise.calories ?? '',
    progression_mode: exercise.progressionMode ?? 'rep_goal',
    rep_goal: exercise.repGoal ?? null,
    increment_type: exercise.incrementType ?? 'weight',
    increment_value: exercise.incrementValue ?? 5,
    equipment_brand: exercise.equipmentBrand ?? null,
    exercise_snapshot: exercise.snapshot ?? {
      name: exercise.exerciseName,
      category: exercise.exerciseCategory,
      modality: exercise.exerciseModality ?? null,
      images: exercise.images,
    },
    sets: exercise.sets.map((set, index) => {
      const weight = parseDecimalInput(set.weight);
      const reps = parseInt(set.reps, 10);
      const distance = parseDecimalInput(set.distance ?? '');
      return {
        id: set.clientId,
        set_number: index + 1,
        set_type: set.setType ?? null,
        weight: isNaN(weight) ? null : weightToKg(weight, weightUnit),
        reps: isNaN(reps) ? null : reps,
        rpe: set.rpe ?? null,
        rest_time: set.restTime ?? null,
        notes: set.notes ?? null,
        duration: set.duration ?? null,
        distance: isNaN(distance) ? null : distanceToKm(distance, distanceUnit),
        editWeightText: set.weight,
        editRepsText: set.reps,
      };
    }),
  };
}

/** Adapt a saved preset exercise for the card stack (weights already kg). */
export function presetExerciseToCardExercise(
  exercise: WorkoutPresetExercise
): WorkoutCardExercise {
  return {
    id: String(exercise.id),
    exercise_id: exercise.exercise_id,
    superset_group: exercise.superset_group ?? null,
    progression_mode: exercise.progression_mode ?? 'rep_goal',
    rep_goal: exercise.rep_goal ?? null,
    increment_type: exercise.increment_type ?? 'weight',
    increment_value: exercise.increment_value ?? 5,
    equipment_brand: exercise.equipment_brand ?? null,
    exercise_snapshot: {
      name: exercise.exercise_name,
      category: exercise.category ?? null,
      modality: exercise.modality ?? null,
      images: exercise.image_url ? [exercise.image_url] : [],
    },
    sets: exercise.sets.map((set, index) => ({
      id: set.id,
      set_number: index + 1,
      set_type: set.set_type ?? null,
      weight: set.weight ?? null,
      reps: set.reps ?? null,
      rpe: null,
      rest_time: set.rest_time ?? null,
      notes: set.notes ?? null,
      duration: set.duration ?? null,
      distance: set.distance ?? null,
    })),
  };
}

export function formatVolume(volumeKg: number, weightUnit: string): string {
  const value = weightFromKg(volumeKg, weightUnit as 'kg' | 'lbs');
  return `${formatLocalizedNumber(Math.round(value))} ${weightUnit}`;
}

/** Compact historical-set text, e.g. `W 60 × 8`, `100 × 5`, `12 reps`, `45s`, or `30:00 · 5.2 km`; weight is unitless display units. */
export function formatRecentSessionSet(
  set: ExerciseRecentSessionSet,
  weightUnit: 'kg' | 'lbs',
  t: TFunction,
  modality?: ExerciseModality,
  distanceUnit: 'km' | 'miles' = 'km'
): string {
  const prefix = isWarmupSetType(set.setType) ? 'W ' : '';
  if (modality != null && isDurationModality(modality)) {
    const seconds = effectiveSetDurationSec(
      { duration: set.duration ?? null, reps: set.reps },
      modality
    );
    const parts: string[] = [];
    if (seconds != null) parts.push(formatDurationSeconds(seconds));
    if (isCardioModality(modality) && set.distance != null) {
      const dist = formatLocalizedNumber(
        distanceFromKm(set.distance, distanceUnit),
        { maximumFractionDigits: 2 }
      );
      parts.push(`${dist} ${distanceUnit === 'miles' ? 'mi' : 'km'}`);
    }
    return parts.length > 0 ? `${prefix}${parts.join(' · ')}` : '–';
  }
  const w =
    set.weight != null
      ? formatLocalizedNumber(weightFromKg(set.weight, weightUnit), {
          maximumFractionDigits: 1,
        })
      : null;
  if (w != null && set.reps != null) return `${prefix}${w} × ${set.reps}`;
  if (w != null) return `${prefix}${w}`;
  if (set.reps != null)
    return `${prefix}${t('workout.repCount', { count: set.reps, formattedCount: formatLocalizedNumber(set.reps), defaultValue: '{{formattedCount}} reps', defaultValue_one: '{{formattedCount}} rep' })}`;
  if (set.duration != null)
    return `${prefix}${formatDurationSeconds(set.duration)}`;
  return '–';
}

/**
 * The programmed-set line on an "Up Next" row — `3 sets · 8 reps · 105 lb`,
 * `3 sets · 45s`, `30:00 · 5.2 km`.
 *
 * Counts WORKING sets only: the warm-up ramp is part of the prescription but
 * "5 sets" would misread as five hard sets. Weight is stored in kilograms and
 * converted here for display only, and a null weight (band, bodyweight, or a
 * lift the engine had no honest number for) drops the segment rather than
 * printing a zero.
 */
export function formatRecommendedSets(
  exercise: {
    modality: ExerciseModality;
    sets: readonly {
      set_type: string;
      reps: number | null;
      weight: number | null;
      duration: number | null;
      distance: number | null;
    }[];
  },
  weightUnit: 'kg' | 'lbs',
  distanceUnit: 'km' | 'miles' = 'km'
): string {
  const working = exercise.sets.filter((set) => !isWarmupSetType(set.set_type));
  const first = working[0];
  if (!first) return '';

  if (isCardioModality(exercise.modality)) {
    const parts: string[] = [];
    if (first.duration != null)
      parts.push(formatDurationSeconds(first.duration));
    if (first.distance != null) {
      const dist = parseFloat(
        distanceFromKm(first.distance, distanceUnit).toFixed(2)
      );
      parts.push(`${dist} ${distanceUnit === 'miles' ? 'mi' : 'km'}`);
    }
    return parts.join(' · ');
  }

  const parts = [`${working.length} ${working.length === 1 ? 'set' : 'sets'}`];
  if (isDurationModality(exercise.modality)) {
    if (first.duration != null)
      parts.push(formatDurationSeconds(first.duration));
    return parts.join(' · ');
  }
  if (first.reps != null) parts.push(`${first.reps} reps`);
  if (first.weight != null) {
    const weight = parseFloat(
      weightFromKg(first.weight, weightUnit).toFixed(1)
    );
    parts.push(`${weight} ${weightUnit}`);
  }
  return parts.join(' · ');
}

/**
 * Capitalize a canonical lowercase catalog value for display — muscle and
 * equipment names are stored lowercase because the catalog filter
 * (`equipment::jsonb ?|`) is exact and case-sensitive, so capitalizing is a
 * render-time concern only. Leaves the rest of each word alone, which is what
 * keeps `ez-bar` and `v-bar` intact.
 */
export function titleCaseCanonical(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/** `2:00 rest` chip text for a recommended exercise. */
export function formatRestChip(restSeconds: number): string {
  const minutes = Math.floor(restSeconds / 60);
  const seconds = restSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')} rest`;
}

/**
 * Structured description of the set the active-workout cursor points at.
 * Shared by the workout HUD, the active-workout screen, and the rest-complete
 * notification so their labels can't drift apart; each consumer applies its
 * own name fallback and formatting.
 */
export interface ActiveSetDescription {
  /** Snapshot name; null when the exercise carries no snapshot name. */
  exerciseName: string | null;
  setNumber: number;
  setCount: number;
  reps: number | null;
  weightKg: number | null;
  /** Effective duration in seconds; non-null only for duration-modality sets. */
  durationSec: number | null;
}

/** Look up the session set matching the active-set cursor id. */
export function describeActiveSet(
  session: PresetSessionResponse | null,
  setId: string | null
): ActiveSetDescription | null {
  if (session == null || setId == null) return null;
  for (const exercise of session.exercises) {
    const set = exercise.sets.find((s) => String(s.id) === setId);
    if (!set) continue;
    const modality = resolveSnapshotModality(exercise.exercise_snapshot);
    const durationLike = isDurationModality(modality);
    return {
      exerciseName: exercise.exercise_snapshot?.name ?? null,
      setNumber: set.set_number,
      setCount: exercise.sets.length,
      reps: durationLike ? null : (set.reps ?? null),
      weightKg: durationLike ? null : (set.weight ?? null),
      durationSec: durationLike ? effectiveSetDurationSec(set, modality) : null,
    };
  }
  return null;
}

/**
 * Assumed weight/reps for a set whose fields are still empty — the gray
 * Hevy-style placeholder the live row renders, and the values a completion
 * adopts when the user logs the set without typing. Weight is kg. A `null`
 * field means nothing can be assumed (a brand-new exercise with no history,
 * plan, or earlier entries).
 */
export interface AssumedSetValues {
  weight: number | null;
  reps: number | null;
  duration?: number | null;
  distance?: number | null;
}

type AssumableSet = Pick<
  WorkoutCardSet,
  'id' | 'set_type' | 'weight' | 'reps' | 'duration' | 'distance'
>;

/**
 * Resolve the assumed (placeholder) weight/reps for every set of one exercise
 * in a live workout. Each field resolves independently, first match wins:
 *
 *   1. The same-position set from the exercise's most recent prior session
 *      (what the PREVIOUS column shows), bumped by the progression increment
 *      when weight-progression overload is active — each set is bumped from
 *      its own prior weight, not flattened to one suggested weight, so
 *      pyramid/ascending-weight sets keep their relative spread.
 *   2. The planned value captured at live start (the preset's programmed set).
 *   3. The preceding row's effective value — its entered value, else its
 *      resolved placeholder.
 *
 * `plannedOutranksPrevious` swaps the first two, and exists because those two
 * kinds of plan are not the same kind of claim. A preset's programmed set is a
 * template that may be months stale, so what the user actually lifted last
 * time is the better guess. A generated workout's set is today's prescription,
 * computed *from* that history by the server engine — the row on Up Next says
 * so in words ("load adjusted to today's rep target") — so letting the same
 * history overwrite it throws the whole generation away and shows the user
 * last week's numbers under this week's plan.
 */
export function resolveAssumedSetValues(
  sets: readonly AssumableSet[],
  previousSets: readonly ExerciseRecentSessionSet[] | undefined,
  plannedBySetId?: Record<string, AssumedSetValues>,
  progressionIncrementKg?: number | null,
  plannedOutranksPrevious = false
): AssumedSetValues[] {
  const lastEffective = {
    warmup: {
      weight: null,
      reps: null,
      duration: null,
      distance: null,
    } as AssumedSetValues,
    working: {
      weight: null,
      reps: null,
      duration: null,
      distance: null,
    } as AssumedSetValues,
  };
  return sets.map((set, index) => {
    const tier = isWarmupSetType(set.set_type) ? 'warmup' : 'working';
    const previous = previousSets?.[index];
    const planned = plannedBySetId?.[String(set.id)];

    const effectivePreviousWeight =
      tier === 'working' &&
      progressionIncrementKg != null &&
      progressionIncrementKg > 0 &&
      previous?.weight != null &&
      previous.weight > 0
        ? previous.weight + progressionIncrementKg
        : previous?.weight;

    // The client-side progression suggestion rides with `previous` rather than
    // ahead of everything: it is an inference from the same history, so a plan
    // that outranks the history outranks a number derived from it too.
    const pick = (
      plannedValue: number | null | undefined,
      previousValue: number | null | undefined,
      carried: number | null
    ): number | null =>
      (plannedOutranksPrevious
        ? (plannedValue ?? previousValue ?? carried)
        : (previousValue ?? plannedValue ?? carried)) ?? null;

    const assumed: AssumedSetValues = {
      weight: pick(
        planned?.weight,
        effectivePreviousWeight,
        lastEffective[tier].weight
      ),
      reps: pick(planned?.reps, previous?.reps, lastEffective[tier].reps),
      duration: pick(
        planned?.duration,
        previous?.duration,
        lastEffective[tier].duration ?? null
      ),
      distance: pick(
        planned?.distance,
        previous?.distance,
        lastEffective[tier].distance ?? null
      ),
    };
    lastEffective[tier].weight = set.weight ?? assumed.weight;
    lastEffective[tier].reps = set.reps ?? assumed.reps;
    lastEffective[tier].duration = set.duration ?? assumed.duration;
    lastEffective[tier].distance = set.distance ?? assumed.distance;
    return assumed;
  });
}

/**
 * {@link describeActiveSet} with empty weight/reps backfilled from
 * {@link resolveAssumedSetValues}, so the HUD bar and the rest-complete
 * notification describe the set the user is assumed to perform.
 */
export function describeActiveSetAssumed(
  session: PresetSessionResponse | null,
  setId: string | null,
  previousSetsByExerciseId: Record<string, ExerciseRecentSessionSet[]>,
  plannedBySetId: Record<string, AssumedSetValues>,
  /** See {@link resolveAssumedSetValues}: true for a generated workout. */
  plannedOutranksPrevious = false
): ActiveSetDescription | null {
  const desc = describeActiveSet(session, setId);
  if (desc == null || session == null) return desc;
  for (const exercise of session.exercises) {
    const setIndex = exercise.sets.findIndex((s) => String(s.id) === setId);
    if (setIndex < 0) continue;
    const modality = resolveSnapshotModality(exercise.exercise_snapshot);
    if (isDurationModality(modality)) {
      if (desc.durationSec != null) return desc;
    } else if (desc.weightKg != null && desc.reps != null) {
      return desc;
    }
    const assumed = resolveAssumedSetValues(
      exercise.sets,
      historyForExercise(previousSetsByExerciseId, exercise.exercise_id),
      plannedBySetId,
      null,
      plannedOutranksPrevious
    )[setIndex];
    if (isDurationModality(modality)) {
      return { ...desc, durationSec: assumed.duration ?? null };
    }
    return {
      ...desc,
      weightKg: desc.weightKg ?? assumed.weight,
      reps: desc.reps ?? assumed.reps,
    };
  }
  return desc;
}

/**
 * Collapse the three-way preference unit to the two display units the workout
 * formatters understand: `st_lbs` (and anything unexpected) renders as lbs,
 * while a missing preference defaults to kg (the server-side storage unit).
 */
export function normalizeWeightUnit(unit: string | undefined): 'kg' | 'lbs' {
  if (unit == null || unit === 'kg') return 'kg';
  return 'lbs';
}

/** Elapsed workout clock as `MM:SS`, growing to `HH:MM:SS` past an hour. */
export function formatElapsed(startedAt: number | null, now: number): string {
  const totalSeconds =
    startedAt == null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Elapsed time as `H:MM:SS`, hours always present and never zero-padded.
 *
 * The compact `formatElapsed` drops the hour until there is one, which is
 * right beside a label in a 12px line. This one is the active workout's
 * display clock, where the field has to stop moving: a clock that grows a
 * column an hour in reflows the one thing on that screen the eye returns to.
 */
export function formatElapsedClock(
  startedAt: number | null,
  now: number
): string {
  const totalSeconds =
    startedAt == null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}

/** Rest countdown as `M:SS`, rounding partial seconds up and clamping at zero. */
export function formatRestCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Target-load text for a set, e.g. `135 lbs × 8`, `8 reps`, `60 kg`, or `45s`;
 * null when the set has no weight, reps, or duration.
 */
export function formatSetLoad(
  set: Pick<ActiveSetDescription, 'weightKg' | 'reps'> & {
    durationSec?: number | null;
  },
  weightUnit: 'kg' | 'lbs',
  t: TFunction
): string | null {
  if (set.durationSec != null) return formatDurationSeconds(set.durationSec);
  const w =
    set.weightKg != null
      ? `${formatLocalizedNumber(weightFromKg(set.weightKg, weightUnit), { maximumFractionDigits: 1 })} ${weightUnit}`
      : null;
  if (w != null && set.reps != null) return `${w} × ${set.reps}`;
  if (set.reps != null)
    return t('workout.repCount', {
      count: set.reps,
      formattedCount: formatLocalizedNumber(set.reps),
      defaultValue: '{{formattedCount}} reps',
      defaultValue_one: '{{formattedCount}} rep',
    });
  return w;
}

export type RpeTone = 'easy' | 'moderate' | 'hard' | 'max';

/** Effort bucket for tinting a logged RPE value. */
export function getRpeTone(rpe: number): RpeTone {
  if (rpe <= 7) return 'easy';
  if (rpe < 9) return 'moderate';
  if (rpe < 10) return 'hard';
  return 'max';
}

/** Client-added sets carry negative placeholder ids until the server assigns real ones. */
export function isTempSetId(id: number): boolean {
  return id < 0;
}

/**
 * Build the `exercises` payload for a preset-session PUT from a live session
 * snapshot (the active-workout autosave path). Session values are already
 * metric (kg), so unlike the draft builder there is no unit conversion or
 * string parsing.
 */
export function buildSessionExercisesPayload(
  session: PresetSessionResponse,
  completedSetIds: CompletedSetMap,
  prSetIds: PrSetMap,
  startedAtMs?: number | null
): PresetSessionExerciseRequest[] {
  const durationByEntryId = buildSessionDurationMinutes(
    session,
    completedSetIds,
    startedAtMs
  );

  return session.exercises.map((exercise, index) => ({
    id: exercise.id,
    exercise_id: exercise.exercise_id,
    sort_order: index,
    duration_minutes: isCardioModality(
      resolveSnapshotModality(exercise.exercise_snapshot)
    )
      ? setsDurationMinutes(exercise.sets)
      : (durationByEntryId?.get(exercise.id) ?? exercise.duration_minutes ?? 0),
    notes: exercise.notes ?? null,
    superset_group: exercise.superset_group ?? null,
    sets: exercise.sets.map((set, setIndex) => {
      const completedMs = completedSetIds[String(set.id)];
      return {
        ...(!isTempSetId(set.id) ? { id: set.id } : {}),
        set_number: setIndex + 1,
        set_type: set.set_type ?? null,
        reps: set.reps ?? null,
        weight: set.weight ?? null,
        duration: set.duration ?? null,
        distance: set.distance ?? null,
        rest_time: set.rest_time ?? null,
        notes: set.notes ?? null,
        rpe: set.rpe ?? null,
        completed_at:
          completedMs != null ? new Date(completedMs).toISOString() : null,
        is_pr: prSetIds[String(set.id)] === true,
      };
    }),
  }));
}

export function buildSessionDurationMinutes(
  session: PresetSessionResponse,
  completedSetIds: CompletedSetMap,
  startedAtMs?: number | null
): Map<string, number> | null {
  if (startedAtMs == null) return null;

  let lastCompletedMs = 0;
  let totalCompleted = 0;
  let anyCompletedAfterStart = false;
  const completedCountByEntryId = new Map<string, number>();
  for (const exercise of session.exercises) {
    const cardio = isCardioModality(
      resolveSnapshotModality(exercise.exercise_snapshot)
    );
    let count = 0;
    for (const s of exercise.sets) {
      const ms = completedSetIds[String(s.id)];
      if (ms == null) continue;
      if (ms > startedAtMs) anyCompletedAfterStart = true;
      if (cardio) continue;
      count++;
      totalCompleted++;
      if (ms > lastCompletedMs) lastCompletedMs = ms;
    }
    if (!cardio) completedCountByEntryId.set(exercise.id, count);
  }
  if (totalCompleted === 0 || lastCompletedMs <= startedAtMs) {
    if (!anyCompletedAfterStart) return null;
    const zeroed = new Map<string, number>();
    for (const [entryId, count] of completedCountByEntryId) {
      if (count === 0) zeroed.set(entryId, 0);
    }
    return zeroed;
  }

  const totalMinutes = (lastCompletedMs - startedAtMs) / 60_000;
  const byEntryId = new Map<string, number>();
  for (const exercise of session.exercises) {
    const count = completedCountByEntryId.get(exercise.id) ?? 0;
    const share = (totalMinutes * count) / totalCompleted;
    byEntryId.set(exercise.id, Math.round(share * 10) / 10);
  }
  return byEntryId;
}

export const WORKOUT_LONG_GAP_MINUTES = 30;

export interface WorkoutSpanSummary {
  totalMinutes: number;
  activeMinutes: number;
  hasLongGap: boolean;
}

export function summarizeWorkoutSpan(
  completedSetIds: CompletedSetMap,
  startedAtMs: number | null | undefined
): WorkoutSpanSummary | null {
  if (startedAtMs == null) return null;
  const times = Object.values(completedSetIds)
    .filter((ms): ms is number => ms != null && ms > startedAtMs)
    .sort((a, b) => a - b);
  if (times.length === 0) return null;

  const gapLimitMs = WORKOUT_LONG_GAP_MINUTES * 60_000;
  let activeMs = 0;
  let hasLongGap = false;
  let prev = startedAtMs;
  for (const ms of times) {
    const gap = ms - prev;
    if (gap > gapLimitMs) hasLongGap = true;
    else activeMs += gap;
    prev = ms;
  }
  return {
    totalMinutes: (times[times.length - 1] - startedAtMs) / 60_000,
    activeMinutes: Math.max(1, Math.round(activeMs / 60_000)),
    hasLongGap,
  };
}

export const SET_TYPE_OPTIONS = [
  'warmup',
  'normal',
  'drop',
  'failure',
] as const;

export function isDropSetType(setType: string | null | undefined): boolean {
  return setType === 'drop';
}

export function setTypeLetter(
  setType: string | null | undefined
): 'W' | 'D' | 'F' | null {
  switch (setType) {
    case 'warmup':
      return 'W';
    case 'drop':
      return 'D';
    case 'failure':
      return 'F';
    default:
      return null;
  }
}

// --- Personal record (PR) detection ---
//
// A PR is a working set that beats the historical best for its exercise —
// heavier weight, or more reps at the same top weight. Warmups never count.
// Detection is pure so it can run in the store (both the screen and the HUD
// complete-set paths) and be exhaustively tested.

// Warmup detection (lowercase, strip non-alphanumerics, prefix-match `warmup`,
// mirroring the server's SQL filter) now lives in `@workspace/shared`
// (`constants/setTypes.ts`). Re-exported because the store, the screens, and
// the tests import it from this module.
export { isWarmupSetType };

export interface PrBaselineEntry {
  weight: number | null;
  reps: number | null;
}

export function compareSetRecords(
  a: { weight: number; reps: number | null },
  b: { weight: number; reps: number | null }
): number {
  const wa = Math.round(a.weight * 100);
  const wb = Math.round(b.weight * 100);
  if (wa !== wb) return wa - wb;
  return (a.reps ?? 0) - (b.reps ?? 0);
}

export function matchesSetRecord(
  set: { weight: number | null; reps: number | null; set_type?: string | null },
  best: { weight: number | null; reps: number | null } | null | undefined
): boolean {
  if (best == null || best.weight == null || set.weight == null) return false;
  if (isWarmupSetType(set.set_type)) return false;
  return (
    compareSetRecords(
      { weight: set.weight, reps: set.reps },
      { weight: best.weight, reps: best.reps }
    ) === 0
  );
}

export function isPrSet(
  session: PresetSessionResponse,
  candidateSetId: string,
  completedSetIds: CompletedSetMap,
  prBaseline: Record<string, PrBaselineEntry | null>
): boolean {
  let candidate: ExerciseEntrySetResponse | undefined;
  // Null for a preserved entry whose exercise is gone; the `== null` guard
  // below then short-circuits, so a deleted exercise never earns a PR.
  let exerciseId: string | null | undefined;
  for (const exercise of session.exercises) {
    const found = exercise.sets.find((s) => String(s.id) === candidateSetId);
    if (found) {
      candidate = found;
      exerciseId = exercise.exercise_id;
      break;
    }
  }
  if (!candidate || exerciseId == null) return false;
  if (candidate.weight == null) return false;
  if (isWarmupSetType(candidate.set_type)) return false;

  if (!(exerciseId in prBaseline)) return false;
  const baseline = prBaseline[exerciseId];
  if (baseline == null) return false;

  let best: { weight: number; reps: number | null } | null =
    baseline.weight != null
      ? { weight: baseline.weight, reps: baseline.reps }
      : null;

  for (const exercise of session.exercises) {
    if (exercise.exercise_id !== exerciseId) continue;
    for (const s of exercise.sets) {
      if (String(s.id) === candidateSetId) continue;
      if (s.weight == null) continue;
      if (isWarmupSetType(s.set_type)) continue;
      if (completedSetIds[String(s.id)] == null) continue;
      const contender = { weight: s.weight, reps: s.reps };
      if (best == null || compareSetRecords(contender, best) > 0)
        best = contender;
    }
  }

  if (best == null) return false;

  return (
    compareSetRecords(
      { weight: candidate.weight, reps: candidate.reps },
      best
    ) > 0
  );
}

export function seedPrFromSession(session: PresetSessionResponse): PrSetMap {
  const seeded: PrSetMap = {};
  for (const exercise of session.exercises) {
    for (const s of exercise.sets) {
      if (s.is_pr) seeded[String(s.id)] = true;
    }
  }
  return seeded;
}

export interface WorkoutCompletionExercise {
  entryId: string;
  name: string;
  notes: string | null;
  completedSetCount: number;
  totalSetCount: number;
  volumeKg: number;
  topSet: {
    weightKg: number | null;
    reps: number | null;
    durationSec?: number | null;
  } | null;
  hasPr: boolean;
}

export interface WorkoutCompletionPrRow {
  exerciseName: string;
  weightKg: number | null;
  reps: number | null;
  durationSec?: number | null;
}

export interface WorkoutCompletionSummary {
  completedSetCount: number;
  totalSetCount: number;
  skippedSetCount: number;
  volumeKg: number;
  totalDistanceKm: number;
  averageRpe: number | null;
  prRows: WorkoutCompletionPrRow[];
  exercises: WorkoutCompletionExercise[];
}

export function buildWorkoutCompletionSummary(
  session: PresetSessionResponse,
  completedSetIds: CompletedSetMap,
  prSetIds: PrSetMap,
  t: TFunction
): WorkoutCompletionSummary {
  let completedSetCount = 0;
  let totalSetCount = 0;
  let volumeKg = 0;
  let totalDistanceKm = 0;
  let rpeSum = 0;
  let rpeCount = 0;
  const prRows: WorkoutCompletionPrRow[] = [];
  const exercises: WorkoutCompletionExercise[] = [];

  for (const exercise of session.exercises) {
    const name =
      exercise.exercise_snapshot?.name ??
      t('workout.exercise', { defaultValue: 'Exercise' });
    const modality = resolveSnapshotModality(exercise.exercise_snapshot);
    let exerciseCompleted = 0;
    let exerciseVolumeKg = 0;
    let topWeighted: { weightKg: number; reps: number | null } | null = null;
    let topRepsOnly: { weightKg: null; reps: number } | null = null;
    let topDurationSec: number | null = null;
    let hasPr = false;

    for (const set of exercise.sets) {
      totalSetCount++;
      if (completedSetIds[String(set.id)] == null) continue;
      exerciseCompleted++;
      if (set.rpe != null) {
        rpeSum += set.rpe;
        rpeCount++;
      }
      if (prSetIds[String(set.id)] === true) {
        hasPr = true;
        prRows.push({
          exerciseName: name,
          weightKg: set.weight,
          reps: set.reps,
        });
      }
      if (isWarmupSetType(set.set_type)) continue;
      exerciseVolumeKg += setVolumeKg(set);
      if (set.distance != null) totalDistanceKm += set.distance;
      if (isDurationModality(modality)) {
        const seconds = effectiveSetDurationSec(set, modality);
        if (
          seconds != null &&
          (topDurationSec == null || seconds > topDurationSec)
        ) {
          topDurationSec = seconds;
        }
      }
      if (set.weight != null) {
        const contender = { weightKg: set.weight, reps: set.reps };
        if (
          topWeighted == null ||
          compareSetRecords(
            { weight: contender.weightKg, reps: contender.reps },
            { weight: topWeighted.weightKg, reps: topWeighted.reps }
          ) > 0
        ) {
          topWeighted = contender;
        }
      } else if (
        !isDurationModality(modality) &&
        set.reps != null &&
        (topRepsOnly == null || set.reps > topRepsOnly.reps)
      ) {
        topRepsOnly = { weightKg: null, reps: set.reps };
      }
    }

    completedSetCount += exerciseCompleted;
    volumeKg += exerciseVolumeKg;
    exercises.push({
      entryId: exercise.id,
      name,
      notes: exercise.notes ?? null,
      completedSetCount: exerciseCompleted,
      totalSetCount: exercise.sets.length,
      volumeKg: exerciseVolumeKg,
      topSet:
        topWeighted ??
        topRepsOnly ??
        (topDurationSec != null
          ? { weightKg: null, reps: null, durationSec: topDurationSec }
          : null),
      hasPr,
    });
  }

  return {
    completedSetCount,
    totalSetCount,
    skippedSetCount: totalSetCount - completedSetCount,
    volumeKg,
    totalDistanceKm,
    averageRpe: rpeCount > 0 ? rpeSum / rpeCount : null,
    prRows,
    exercises,
  };
}

// --- Live-start payload builders ---

function makeDefaultStartSet(
  setNumber: number,
  modality: ExerciseModality
): ExerciseEntrySetRequest {
  return {
    set_number: setNumber,
    set_type: 'normal',
    reps: null,
    weight: null,
    duration: null,
    distance: null,
    rest_time: isCardioModality(modality) ? 0 : getDefaultRestSec(),
    notes: null,
    rpe: null,
    completed_at: null,
  };
}

export function buildPresetStartExercisesPayload(
  preset: WorkoutPreset
): PresetSessionExerciseRequest[] {
  return preset.exercises.map((exercise, index) => {
    const modality = resolveSnapshotModality(exercise);
    return {
      exercise_id: exercise.exercise_id,
      sort_order: index,
      duration_minutes: 0,
      notes: null,
      // Live sessions started from a preset inherit its superset grouping.
      superset_group: exercise.superset_group ?? null,
      sets:
        exercise.sets.length === 0
          ? [makeDefaultStartSet(1, modality)]
          : exercise.sets.map((set, setIndex) => ({
              set_number: setIndex + 1,
              set_type: set.set_type ?? 'normal',
              reps: set.reps ?? null,
              weight: set.weight ?? null,
              duration: set.duration ?? null,
              // Distance is only meaningful on cardio sets; elsewhere a stored
              // value is junk that must not seed the session.
              distance: isCardioModality(modality)
                ? (set.distance ?? null)
                : null,
              // Cardio takes no between-set rest.
              rest_time: isCardioModality(modality)
                ? 0
                : (set.rest_time ?? null),
              notes: set.notes ?? null,
              rpe: null,
              completed_at: null,
            })),
    };
  });
}

/**
 * Canonical write vocabulary (`@workspace/shared` `CANONICAL_SET_TYPES`, what
 * the recommendation engine emits) → the lowercase strings mobile stores and
 * renders.
 *
 * The two vocabularies are display-level drift the shared constant documents
 * and deliberately does not migrate. Warm-up *detection* is normalization-based
 * everywhere, so an unmapped `'Warmup'` would still be excluded from PRs — but
 * mobile's `setTypeLetter` and `isDropSetType` are exact lowercase matches, so
 * an unmapped set would render as a numbered working set and a drop set would
 * take a full rest. Mapping at the payload boundary keeps every stored set_type
 * in the vocabulary the rest of mobile already writes.
 */
const CANONICAL_TO_MOBILE_SET_TYPE: Record<
  string,
  (typeof SET_TYPE_OPTIONS)[number]
> = {
  'Working Set': 'normal',
  Warmup: 'warmup',
  'Drop Set': 'drop',
  Failure: 'failure',
};

/**
 * Build the `exercises` payload for starting a live session from a generated
 * "Up Next" workout. Sibling of {@link buildPresetStartExercisesPayload}: the
 * payload is already metric (kg, whole seconds, km) and already ordered
 * warm-ups-first with `set_number` renumbered across the whole list, so this
 * only re-keys the set type and gates the measures the modality allows.
 *
 * Takes the exercises **in the order to start them** rather than the payload:
 * grouping an Up Next workout into supersets reorders the list so each run is
 * adjacent, and re-sorting by the engine's `sort_order` here would undo that.
 * Callers holding an unedited payload pass
 * {@link orderedRecommendationExercises}.
 *
 * Band and bodyweight prescriptions legitimately carry a null weight — the
 * engine declines to invent a kilogram it cannot know — and that null is
 * passed through so the live row renders an empty cell rather than "0 kg".
 */
/**
 * Payload exercises in prescribed order. Every consumer that turns a generated
 * workout into rows the user will edit or log must walk it through this, so a
 * payload whose array order ever disagrees with `sort_order` cannot make the
 * saved preset and the started session differ.
 */
export function orderedRecommendationExercises(
  payload: WorkoutRecommendationPayload
): RecommendedExercise[] {
  return [...payload.exercises].sort((a, b) => a.sort_order - b.sort_order);
}

export function buildRecommendationStartPayload(
  exercises: readonly PlannedExercise[]
): PresetSessionExerciseRequest[] {
  return exercises.map((exercise, index) => {
    const cardio = isCardioModality(exercise.modality);
    return {
      exercise_id: exercise.exercise_id,
      sort_order: index,
      duration_minutes: 0,
      notes: null,
      // The engine has no superset concept, so this is null unless the user
      // built a group on Up Next — grouping lives on the entries this
      // creates, never on the recommendation payload (blueprint D9).
      superset_group: exercise.superset_group ?? null,
      sets: exercise.sets.map((set, setIndex) => ({
        set_number: setIndex + 1,
        set_type: CANONICAL_TO_MOBILE_SET_TYPE[set.set_type] ?? 'normal',
        reps: set.reps,
        weight: set.weight,
        duration: set.duration,
        // Distance is only meaningful on cardio sets; elsewhere a value is
        // junk that must not seed the session.
        distance: cardio ? set.distance : null,
        // Cardio takes no between-set rest.
        rest_time: cardio ? 0 : set.rest_time,
        notes: null,
        rpe: null,
        completed_at: null,
      })),
    };
  });
}

/**
 * Seed name for "Save workout": a generated workout has no name of its own, so
 * the muscles it was built around become one — the same string the Up Next
 * header shows under the title. It is a seed, not a decision: the create form
 * puts it in an editable field before anything is written.
 */
export function recommendationPresetName(
  payload: WorkoutRecommendationPayload
): string {
  return payload.muscle_groups.map(titleCaseCanonical).join(', ');
}

/**
 * Seed the preset create form from a generated workout ("Save workout" on Up
 * Next). Sibling of {@link buildRecommendationStartPayload} and gated the same
 * way on purpose — the template the user saves has to match what starting the
 * workout would log: canonical set types re-keyed to mobile's vocabulary,
 * distance kept only where the modality means it, and no between-set rest on
 * cardio. Weights and distances become display-unit text because the form
 * edits strings, not metric (`buildPresetPayload` converts them back).
 *
 * `clientIds` is indexed against {@link orderedRecommendationExercises}, which
 * is what the caller must generate them from — the reducer stays pure, so id
 * generation belongs to the hook, exactly as the session/preset paths do it.
 */
export function buildRecommendationDraftExercises(
  payload: WorkoutRecommendationPayload,
  weightUnit: 'kg' | 'lbs',
  distanceUnit: 'km' | 'miles',
  clientIds: { exerciseClientId: string; setClientIds: string[] }[]
): WorkoutDraftExercise[] {
  return orderedRecommendationExercises(payload).map((exercise, index) => {
    const cardio = isCardioModality(exercise.modality);
    return {
      clientId: clientIds[index].exerciseClientId,
      exerciseId: exercise.exercise_id,
      exerciseName: exercise.exercise_name,
      // The payload carries no catalog category — it is display-only in the
      // form, and the modality it does carry is what drives the set fields.
      exerciseCategory: null,
      exerciseModality: exercise.modality,
      images: exercise.images,
      // D9: grouping is applied at start-workout, never stored on a payload,
      // so there is none to carry into the template.
      supersetGroup: null,
      sets: exercise.sets.map((set, setIndex) => ({
        clientId: clientIds[index].setClientIds[setIndex],
        setType: CANONICAL_TO_MOBILE_SET_TYPE[set.set_type] ?? 'normal',
        restTime: cardio ? 0 : set.rest_time,
        duration: set.duration,
        notes: null,
        weight:
          set.weight != null
            ? String(
                parseFloat(weightFromKg(set.weight, weightUnit).toFixed(1))
              )
            : '',
        reps: set.reps != null ? String(set.reps) : '',
        distance:
          cardio && set.distance != null
            ? String(
                parseFloat(
                  distanceFromKm(set.distance, distanceUnit).toFixed(2)
                )
              )
            : '',
      })),
    };
  });
}

/**
 * Planned weight/reps per exercise/set position from a live-start payload,
 * captured before {@link stripPlannedSetValues} empties the create request.
 * The store keys these to the created session's set ids (same order) so
 * placeholder resolution can fall back to the preset's programmed values.
 */
export function extractPlannedSetValues(
  exercises: PresetSessionExerciseRequest[]
): AssumedSetValues[][] {
  return exercises.map((exercise) =>
    (exercise.sets || []).map((set: any, i: number) => ({
      weight: set.weight ?? null,
      reps: set.reps ?? null,
      duration: set.duration ?? null,
      distance: set.distance ?? null,
    }))
  );
}

export function stripPlannedSetValues(
  exercises: PresetSessionExerciseRequest[]
): PresetSessionExerciseRequest[] {
  return exercises.map((exercise) => ({
    ...exercise,
    sets: (exercise.sets || []).map((set: any, setIndex: number) => ({
      ...set,
      weight: null,
      reps: null,
      duration: null,
      distance: null,
    })),
  }));
}

export function exerciseFromSnapshot(
  snapshot: EntryExerciseSnapshotResponse | null,
  exerciseId: string | null,
  t: TFunction
): Exercise {
  return {
    // Empty when the library exercise has been deleted and the entry is running
    // on its snapshot alone. ExerciseDetailScreen gates every library-backed
    // feature on `UUID_REGEX.test(item.id)`, so an empty id renders the page
    // from the snapshot and quietly drops the History tab and detail refetch.
    id: snapshot?.id ?? exerciseId ?? '',
    name: snapshot?.name ?? t('workout.exercise', { defaultValue: 'Exercise' }),
    category: snapshot?.category ?? null,
    modality: snapshot?.modality ?? null,
    equipment: snapshot?.equipment ?? [],
    primary_muscles: snapshot?.primary_muscles ?? [],
    secondary_muscles: snapshot?.secondary_muscles ?? [],
    calories_per_hour: snapshot?.calories_per_hour ?? 0,
    source: snapshot?.source ?? '',
    images: snapshot?.images ?? [],
    tags: snapshot?.tags ?? [],
    force: snapshot?.force ?? null,
    level: snapshot?.level ?? null,
    mechanic: snapshot?.mechanic ?? null,
    instructions: snapshot?.instructions ?? undefined,
    description: snapshot?.description ?? undefined,
    userId: snapshot?.user_id ?? null,
    isCustom: snapshot?.is_custom ?? undefined,
  };
}

export function makeSparseExercise(
  params: {
    /** Empty/null when the library exercise has been deleted; see exerciseFromSnapshot. */
    id: string | null;
    name?: string | null;
    category?: string | null;
    modality?: string | null;
    images?: string[] | null;
  },
  t: TFunction
): Exercise {
  return {
    id: params.id ?? '',
    name: params.name ?? t('workout.exercise', { defaultValue: 'Exercise' }),
    category: params.category ?? null,
    modality: isExerciseModality(params.modality) ? params.modality : null,
    equipment: [],
    primary_muscles: [],
    secondary_muscles: [],
    calories_per_hour: 0,
    source: '',
    images: params.images ?? [],
    tags: [],
    force: null,
    level: null,
    mechanic: null,
    instructions: undefined,
    description: undefined,
    userId: null,
    isCustom: undefined,
  };
}

export function exerciseFromExternalItem(
  item: ExternalExerciseItem,
  t: TFunction
): Exercise {
  return {
    ...makeSparseExercise(
      {
        id: item.id,
        name: item.name,
        category: item.category,
        modality: item.modality ?? null,
        images: item.images,
      },
      t
    ),
    equipment: item.equipment ?? [],
    primary_muscles: item.primary_muscles ?? [],
    secondary_muscles: item.secondary_muscles ?? [],
    calories_per_hour: item.calories_per_hour ?? 0,
    source: item.source,
    force: item.force ?? null,
    level: item.level ?? null,
    mechanic: item.mechanic ?? null,
    instructions: Array.isArray(item.instructions)
      ? item.instructions
      : undefined,
    description: item.description,
  };
}

export function exerciseFromDraft(
  exercise: WorkoutDraftExercise,
  t: TFunction
): Exercise {
  if (exercise.snapshot) {
    return exerciseFromSnapshot(exercise.snapshot, exercise.exerciseId, t);
  }
  return makeSparseExercise(
    {
      id: exercise.exerciseId,
      name: exercise.exerciseName,
      category: exercise.exerciseCategory,
      modality: exercise.exerciseModality ?? null,
      images: exercise.images,
    },
    t
  );
}

export function buildSingleExerciseStartPayload(
  exercise: Pick<Exercise, 'id' | 'modality' | 'category'>
): PresetSessionExerciseRequest[] {
  return [
    {
      exercise_id: exercise.id,
      sort_order: 0,
      duration_minutes: 0,
      notes: null,
      sets: [makeDefaultStartSet(1, resolveSnapshotModality(exercise))],
    },
  ];
}

type ActivitySetPayload = NonNullable<
  CreateExerciseEntryPayload['sets']
>[number];

export interface CardioEffortValues {
  durationSec: number | null;
  distanceKm: number | null;
}

export function buildActivitySetsPayload(
  draftSets: readonly WorkoutDraftSet[],
  originals: ReadonlyMap<string, ExerciseEntrySetResponse>,
  weightUnit: 'kg' | 'lbs',
  modality: ExerciseModality,
  cardio?: CardioEffortValues
): ActivitySetPayload[] {
  if (cardio && draftSets.length === 0) {
    return [
      {
        set_number: 1,
        set_type: 'Working Set',
        weight: null,
        reps: null,
        duration: cardio.durationSec,
        distance: cardio.distanceKm,
        rest_time: 0,
      },
    ];
  }
  return draftSets.map((set, index) => {
    const w = parseDecimalInput(set.weight);
    const r = parseInt(set.reps, 10);
    const original = originals.get(set.clientId);
    return {
      ...(original && {
        id: original.id,
        set_type: original.set_type,
        duration: original.duration,
        distance: original.distance,
        rest_time: original.rest_time,
        notes: original.notes,
        rpe: original.rpe,
        // Editing an activity's sets must not erase what a live workout
        // recorded on them: the server replaces the set list wholesale, so
        // anything left off here reads as "never completed".
        completed_at: original.completed_at,
        is_pr: original.is_pr,
      }),
      set_type: original?.set_type ?? 'Working Set',
      set_number: index + 1,
      weight: isNaN(w) ? null : weightToKg(w, weightUnit),
      reps: isNaN(r) ? null : r,
      ...(isDurationModality(modality)
        ? { duration: set.duration ?? null }
        : {}),
      ...(cardio
        ? {
            duration: cardio.durationSec,
            distance: cardio.distanceKm,
            rest_time: 0,
          }
        : {}),
    };
  });
}

export function buildPresetExercisesPayload(
  exercises: WorkoutDraftExercise[],
  weightUnit: 'kg' | 'lbs',
  distanceUnit: 'km' | 'miles' = 'km'
): WorkoutPresetExercisePayload[] {
  // Preset exercises with zero sets are valid on the server and render as
  // "No sets" in the detail view. Do NOT filter them out – saving an unrelated
  // edit would silently delete the user's zero-set rows from the preset.
  //
  // An exercise with no library id IS dropped, though, and that is a different
  // case: workout_preset_exercises.exercise_id still cascades from the library
  // row, so a deleted exercise cannot live in a template at all. Keeping it
  // would mean writing a row the database immediately rejects.
  return exercises
    .filter(
      (exercise): exercise is WorkoutDraftExercise & { exerciseId: string } =>
        exercise.exerciseId != null
    )
    .map((exercise, index) => {
      const modality = resolveSnapshotModality({
        modality: exercise.exerciseModality,
        category: exercise.exerciseCategory,
      });
      return {
        exercise_id: exercise.exerciseId,
        image_url: exercise.images[0] ?? null,
        sort_order: index,
        superset_group: exercise.supersetGroup ?? null,
        progression_mode: exercise.progressionMode ?? 'rep_goal',
        rep_goal: exercise.repGoal ?? null,
        increment_type: exercise.incrementType ?? 'weight',
        increment_value: exercise.incrementValue ?? 5,
        equipment_brand: exercise.equipmentBrand ?? null,
        sets: exercise.sets.map((set, setIndex) => {
          const weight = parseDecimalInput(set.weight);
          const reps = parseInt(set.reps, 10);
          const distance = parseDecimalInput(set.distance ?? '');
          return {
            set_number: setIndex + 1,
            set_type: set.setType ?? 'normal',
            reps: isNaN(reps) ? null : reps,
            weight: isNaN(weight) ? null : weightToKg(weight, weightUnit),
            // Modality-gated like the live builders: a session's junk duration
            // on a weights exercise must not become preset structure, and
            // distance is only meaningful on cardio sets.
            duration: isDurationModality(modality)
              ? (set.duration ?? null)
              : null,
            distance:
              isCardioModality(modality) && !isNaN(distance)
                ? distanceToKm(distance, distanceUnit)
                : null,
            rest_time: set.restTime ?? null,
            notes: set.notes ?? null,
          };
        }),
      };
    });
}

interface CanonicalPresetSet {
  set_number: number;
  set_type: string;
  reps: number | null;
  weight: number | null;
  duration: number | null;
  distance: number | null;
  rest_time: number | null;
  notes: string | null;
}

interface CanonicalPresetExercise {
  exercise_id: string;
  image_url: string | null;
  sort_order: number;
  superset_group: number | null;
  progression_mode?: 'rep_goal' | 'fixed' | 'step_load' | 'manual' | null;
  rep_goal?: number | null;
  increment_type?: 'weight' | 'reps' | null;
  increment_value?: number | null;
  equipment_brand?: string | null;
  sets: CanonicalPresetSet[];
}

function canonicalDecimal(value: number | null): number | null {
  return value == null ? null : Number(value.toFixed(3));
}

function canonicalizeSessionSet(
  set: ExerciseEntrySetResponse,
  setNumber: number,
  modality: ExerciseModality,
  completed: boolean,
  plannedValues: AssumedSetValues | undefined
): CanonicalPresetSet {
  const planned = completed ? undefined : plannedValues;
  return {
    set_number: setNumber,
    set_type: set.set_type ?? 'normal',
    reps: set.reps ?? planned?.reps ?? null,
    weight: canonicalDecimal(set.weight ?? planned?.weight ?? null),
    duration: isDurationModality(modality)
      ? (set.duration ?? planned?.duration ?? null)
      : null,
    distance: isCardioModality(modality)
      ? canonicalDecimal(set.distance ?? planned?.distance ?? null)
      : null,
    rest_time: isCardioModality(modality) ? 0 : (set.rest_time ?? null),
    notes: set.notes ?? null,
  };
}

/**
 * A live start creates every set empty and only records values when a set is
 * completed or typed over, so a finished workout's skipped sets carry nothing.
 * Anything that turns the session into a *routine* (Save as Preset) wants the
 * programmed values back on those sets, the same way `canonicalizeSessionSet`
 * treats them for the update-preset diff. Completed sets are left alone —
 * they are authoritative, nulls included.
 */
export function backfillPlannedSetValues(
  session: PresetSessionResponse,
  completedSetIds: CompletedSetMap,
  plannedSetValues: Record<string, AssumedSetValues>
): PresetSessionResponse {
  let changed = false;
  const exercises = session.exercises.map((exercise) => {
    const sets = exercise.sets.map((set) => {
      const planned = plannedSetValues[String(set.id)];
      if (planned == null || completedSetIds[String(set.id)] != null)
        return set;
      const filled = {
        ...set,
        reps: set.reps ?? planned.reps ?? null,
        weight: set.weight ?? planned.weight ?? null,
        duration: set.duration ?? planned.duration ?? null,
        distance: set.distance ?? planned.distance ?? null,
      };
      if (
        filled.reps === set.reps &&
        filled.weight === set.weight &&
        filled.duration === set.duration &&
        filled.distance === set.distance
      ) {
        return set;
      }
      changed = true;
      return filled;
    });
    return sets.some((set, i) => set !== exercise.sets[i])
      ? { ...exercise, sets }
      : exercise;
  });
  return changed ? { ...session, exercises } : session;
}

function canonicalizePresetSet(
  set: WorkoutPresetSet,
  setNumber: number,
  modality: ExerciseModality
): CanonicalPresetSet {
  return {
    set_number: setNumber,
    set_type: set.set_type ?? 'normal',
    reps: set.reps ?? null,
    weight: canonicalDecimal(set.weight ?? null),
    duration: isDurationModality(modality) ? (set.duration ?? null) : null,
    distance: isCardioModality(modality)
      ? canonicalDecimal(set.distance ?? null)
      : null,
    rest_time: isCardioModality(modality) ? 0 : (set.rest_time ?? null),
    notes: set.notes ?? null,
  };
}

function canonicalSetsEqual(
  a: CanonicalPresetSet,
  b: CanonicalPresetSet
): boolean {
  return (
    a.set_type === b.set_type &&
    a.reps === b.reps &&
    a.weight === b.weight &&
    a.duration === b.duration &&
    a.distance === b.distance &&
    a.rest_time === b.rest_time &&
    a.notes === b.notes
  );
}

function canonicalExercisesEqual(
  a: CanonicalPresetExercise,
  b: CanonicalPresetExercise
): boolean {
  return (
    a.exercise_id === b.exercise_id &&
    a.image_url === b.image_url &&
    a.superset_group === b.superset_group &&
    a.progression_mode === b.progression_mode &&
    a.rep_goal === b.rep_goal &&
    a.increment_type === b.increment_type &&
    a.increment_value === b.increment_value &&
    a.equipment_brand === b.equipment_brand &&
    a.sets.length === b.sets.length &&
    a.sets.every((set, i) => canonicalSetsEqual(set, b.sets[i]))
  );
}

export function buildPresetUpdateExercises(
  session: PresetSessionResponse,
  preset: WorkoutPreset,
  opts: {
    completedSetIds: CompletedSetMap;
    plannedSetValues: Record<string, AssumedSetValues>;
  }
): WorkoutPresetExercisePayload[] | null {
  // An exercise whose library row has been deleted cannot go into a preset at
  // all — workout_preset_exercises.exercise_id still cascades from the library,
  // so the row would be rejected. Drop those up front rather than letting a
  // null reach the pairing below, where it would also match every OTHER
  // deleted exercise and pair them with each other. Every index in this
  // function is relative to this filtered list, so it has to happen first.
  const sessionExercises = session.exercises.filter(
    (
      exercise
    ): exercise is (typeof session.exercises)[number] & {
      exercise_id: string;
    } => exercise.exercise_id != null
  );

  // Pair each session exercise with the first unconsumed preset exercise of
  // the same exercise_id (duplicates pair in order; unmatched = added). The
  // pair supplies the preset's image_url, the zero-set detection, and the
  // preset side's modality — the session snapshot beats the preset row,
  // which old servers leave without a modality.
  const consumed = new Set<number>();
  const matchedPresetIndex = sessionExercises.map((exercise) => {
    const index = preset.exercises.findIndex(
      (candidate, i) =>
        !consumed.has(i) && candidate.exercise_id === exercise.exercise_id
    );
    if (index >= 0) consumed.add(index);
    return index >= 0 ? index : null;
  });

  const fromSession: CanonicalPresetExercise[] = sessionExercises.map(
    (exercise, index) => {
      const modality = resolveSnapshotModality(exercise.exercise_snapshot);
      const matchedIdx = matchedPresetIndex[index];
      const matched = matchedIdx == null ? null : preset.exercises[matchedIdx];
      const rawMatched = matched as Partial<CanonicalPresetExercise> | null;
      const [only] = exercise.sets;
      const untouchedFabricatedSet =
        matched != null &&
        matched.sets.length === 0 &&
        exercise.sets.length === 1 &&
        opts.completedSetIds[String(only.id)] == null &&
        only.weight == null &&
        only.reps == null &&
        only.duration == null &&
        only.distance == null &&
        only.notes == null;
      return {
        exercise_id: exercise.exercise_id,
        image_url:
          matched != null
            ? (matched.image_url ?? null)
            : (exercise.exercise_snapshot?.images?.[0] ?? null),
        sort_order: index,
        superset_group: exercise.superset_group ?? null,
        // Carry over existing preset progression rules if they exist
        ...(rawMatched?.progression_mode
          ? { progression_mode: rawMatched.progression_mode }
          : {}),
        ...(rawMatched?.rep_goal != null
          ? { rep_goal: rawMatched.rep_goal }
          : {}),
        ...(rawMatched?.increment_type
          ? { increment_type: rawMatched.increment_type }
          : {}),
        ...(rawMatched?.increment_value != null
          ? { increment_value: Number(rawMatched.increment_value) }
          : {}),
        ...(rawMatched?.equipment_brand
          ? { equipment_brand: rawMatched.equipment_brand }
          : {}),
        sets: untouchedFabricatedSet
          ? []
          : exercise.sets.map((set, setIndex) =>
              canonicalizeSessionSet(
                set,
                setIndex + 1,
                modality,
                opts.completedSetIds[String(set.id)] != null,
                opts.plannedSetValues[String(set.id)]
              )
            ),
      };
    }
  );

  const sessionModalityByPresetIndex = new Map<number, ExerciseModality>();
  matchedPresetIndex.forEach((presetIdx, sessionIdx) => {
    if (presetIdx != null) {
      sessionModalityByPresetIndex.set(
        presetIdx,
        resolveSnapshotModality(sessionExercises[sessionIdx].exercise_snapshot)
      );
    }
  });

  const fromPreset: CanonicalPresetExercise[] = preset.exercises.map(
    (exercise, index) => {
      const rawExercise = exercise as Partial<CanonicalPresetExercise>;
      const modality =
        sessionModalityByPresetIndex.get(index) ??
        resolveSnapshotModality(exercise);

      return {
        exercise_id: exercise.exercise_id,
        image_url: exercise.image_url ?? null,
        sort_order: index,
        superset_group: exercise.superset_group ?? null,
        ...(rawExercise.progression_mode
          ? { progression_mode: rawExercise.progression_mode }
          : {}),
        ...(rawExercise.rep_goal != null
          ? { rep_goal: rawExercise.rep_goal }
          : {}),
        ...(rawExercise.increment_type
          ? { increment_type: rawExercise.increment_type }
          : {}),
        ...(rawExercise.increment_value != null
          ? { increment_value: Number(rawExercise.increment_value) }
          : {}),
        ...(rawExercise.equipment_brand
          ? { equipment_brand: rawExercise.equipment_brand }
          : {}),
        sets: exercise.sets.map((set, setIndex) =>
          canonicalizePresetSet(set, setIndex + 1, modality)
        ),
      };
    }
  );

  const equivalent =
    fromSession.length === fromPreset.length &&
    fromSession.every((exercise, i) =>
      canonicalExercisesEqual(exercise, fromPreset[i])
    );
  return equivalent ? null : fromSession;
}
