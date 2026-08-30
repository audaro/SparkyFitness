#!/usr/bin/env node
/**
 * The verdict for qa/flows/content-crawl.yaml.
 *
 * That flow exists to unlock screens, and the screens are judged by
 * app-logs.mjs — but everything it taps on the way there is content being
 * WRITTEN, and a walk that reaches a detail screen full of the wrong numbers
 * is not the coverage it looks like. So this oracle asserts the rows behind
 * each visit: the exercise the workout claims to be of, the set the workout
 * says was logged, the activity's duration, the medication's name.
 *
 * The food chain is checked here only to the depth this scenario depends on —
 * that the seed landed and links up — because custom-food-log.mjs already
 * asserts it field by field, and two oracles disagreeing about the same rows
 * is worse than one asserting them once.
 *
 * The failure modes it is built around, all of which leave a green flow:
 *   - a live workout writes its session but no set, because "Log set 1" landed
 *     on the row and not the ring;
 *   - the set is written with the weight and the reps in one field (the
 *     keyboard-occlusion bug that shaped every field tap in this harness);
 *   - the activity is filed against a different exercise from the one the
 *     detail screen was opened from;
 *   - the workout preset is saved with no exercises, which still renders as a
 *     preset screen.
 */
import { createReport } from './lib/report.mjs';
import { query, qaAccount, lit } from './lib/db.mjs';

const report = createReport('content-crawl');
const runDir = process.env.QA_RUN_DIR;
const { userId } = qaAccount();

// Everything the flow types, in one place, so the flow and the oracle can be
// read against each other.
const EXPECTED = {
  foodName: 'QA Harness Oat Bar',
  foodServingSize: 50,
  foodCalories: 212,
  exerciseName: 'QA Harness Lift',
  // ExerciseForm's own defaults, which the flow accepts rather than picking:
  // 'general' derives weight_reps, and weight_reps is what gives the live
  // workout a weight and a reps cell to type into.
  exerciseCategory: 'general',
  exerciseModality: 'weight_reps',
  setWeightKg: 60,
  setReps: 8,
  // Not a typed value: the activity form's own name field never reaches the
  // server (createExerciseEntryRequestSchema is `.strict()` and carries no
  // exercise_name, and the create path falls back to the exercise snapshot),
  // so an activity is always filed under its exercise's name. The flow does
  // not type one, and this is what the app actually stores.
  activityName: 'QA Harness Lift',
  activityDurationMinutes: 30,
  medicationName: 'QA Harness Tonic',
};

// The app dates a row by the device's calendar day, and the simulator shares
// this machine's timezone — so the expected day is the local one. Deriving it
// from `toISOString()` would be the very timezone bug this check exists to
// catch, in the checker.
const today = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const num = (v) => (v === null || v === undefined ? null : Number(v));

// --- the seed: a food, and a diary entry pointing at it ---------------------
const foods = query(`
  SELECT id, name, is_custom
  FROM foods
  WHERE user_id = ${lit(userId)} AND name = ${lit(EXPECTED.foodName)}
`);
if (
  !report.check(
    'food.created',
    foods.length === 1,
    `${foods.length} food row(s) named "${EXPECTED.foodName}" (expected 1)`,
    foods
  )
) {
  // Six of the fifteen screens hang off this row; without it the rest of the
  // report would be a cascade burying the one finding that matters.
  report.finish(runDir);
}
const food = foods[0];

const variants = query(`
  SELECT id, serving_size, calories
  FROM food_variants
  WHERE food_id = ${lit(food.id)}
`);
report.check(
  'food.variant-values',
  variants.length === 1 &&
    num(variants[0].serving_size) === EXPECTED.foodServingSize &&
    num(variants[0].calories) === EXPECTED.foodCalories,
  variants.length === 1
    ? `variant stores ${variants[0].serving_size} / ${variants[0].calories} cal (typed ${EXPECTED.foodServingSize} / ${EXPECTED.foodCalories})`
    : `${variants.length} variant(s) for the food (expected 1)`,
  variants
);

const entries = query(`
  SELECT id, food_id, variant_id, entry_date::text AS entry_date, meal_type_id
  FROM food_entries
  WHERE user_id = ${lit(userId)}
`);
report.check(
  'entry.created-and-linked',
  entries.length === 1 && entries[0].food_id === food.id,
  entries.length === 1
    ? 'one diary entry, pointing at the food this run created'
    : `${entries.length} diary entr(y/ies) for the QA user (expected 1)`,
  entries
);
if (entries.length === 1) {
  report.check(
    'entry.date-is-today',
    entries[0].entry_date === today,
    `logged on ${entries[0].entry_date} (today is ${today})`,
    { entryDate: entries[0].entry_date, expected: today }
  );
  // MealTypeDetail is opened from the meal tile the entry filed itself under,
  // so an entry with no meal type would have left that screen unreachable and
  // the flow would have failed earlier — this records which one it was.
  report.check(
    'entry.meal-type',
    Boolean(entries[0].meal_type_id),
    entries[0].meal_type_id
      ? 'entry carries the meal type its tile was opened from'
      : 'no meal type on the entry',
    entries[0]
  );
}

// --- the exercise -----------------------------------------------------------
const exercises = query(`
  SELECT id, name, category, modality, is_custom
  FROM exercises
  WHERE user_id = ${lit(userId)} AND name = ${lit(EXPECTED.exerciseName)}
`);
if (
  !report.check(
    'exercise.created',
    exercises.length === 1,
    `${exercises.length} exercise row(s) named "${EXPECTED.exerciseName}" (expected 1)`,
    exercises
  )
) {
  // The workout, the preset and the activity are all this exercise; nothing
  // below can be interpreted without it.
  report.finish(runDir);
}
const exercise = exercises[0];
report.check(
  'exercise.form-defaults',
  exercise.is_custom === true &&
    exercise.category === EXPECTED.exerciseCategory &&
    exercise.modality === EXPECTED.exerciseModality,
  `saved as is_custom=${exercise.is_custom}, category="${exercise.category}", modality="${exercise.modality}"`,
  exercise
);

// --- the live workout -------------------------------------------------------
// A session is one exercise_preset_entries row; the exercises inside it are
// exercise_entries pointing back at it, which is also what tells them apart
// from the standalone activity checked further down.
const sessions = query(`
  SELECT id, name, entry_date::text AS entry_date, source
  FROM exercise_preset_entries
  WHERE user_id = ${lit(userId)}
`);
if (
  !report.check(
    'workout.session-created',
    sessions.length === 1,
    `${sessions.length} workout session(s) for the QA user (expected 1)`,
    sessions
  )
) {
  report.finish(runDir);
}
const session = sessions[0];
report.check(
  'workout.session-date-is-today',
  session.entry_date === today,
  `session dated ${session.entry_date} (today is ${today})`,
  { entryDate: session.entry_date, expected: today }
);

const sessionExercises = query(`
  SELECT id, exercise_id, exercise_name
  FROM exercise_entries
  WHERE user_id = ${lit(userId)} AND exercise_preset_entry_id = ${lit(session.id)}
`);
if (
  !report.check(
    'workout.holds-the-exercise',
    sessionExercises.length === 1 && sessionExercises[0].exercise_id === exercise.id,
    sessionExercises.length === 1
      ? 'the session holds the exercise this run created'
      : `${sessionExercises.length} exercise(s) in the session (expected 1)`,
    { sessionExercises, exerciseId: exercise.id }
  )
) {
  report.finish(runDir);
}

// The set is the whole point of the ActiveWorkout screen, and the one row this
// flow types two numbers into. `completed_at` is what "Log set 1" writes: a
// session whose set exists but was never completed skips WorkoutComplete, so
// an uncompleted set here means the celebration screen was never really shown.
const sets = query(`
  SELECT set_number, weight, reps, completed_at IS NOT NULL AS completed
  FROM exercise_entry_sets
  WHERE exercise_entry_id = ${lit(sessionExercises[0].id)}
  ORDER BY set_number
`);
report.check(
  'workout.set-logged',
  sets.length === 1 && sets[0].completed === true,
  sets.length === 1
    ? `one set, completed=${sets[0].completed}`
    : `${sets.length} set(s) on the session's exercise (expected 1)`,
  sets
);
report.check(
  'workout.set-values',
  sets.length === 1 &&
    num(sets[0].weight) === EXPECTED.setWeightKg &&
    num(sets[0].reps) === EXPECTED.setReps,
  sets.length === 1
    ? `set stored as ${sets[0].weight} kg × ${sets[0].reps} reps (typed ${EXPECTED.setWeightKg} × ${EXPECTED.setReps})`
    : 'no single set to read values from',
  sets
);

// --- the preset saved from that workout -------------------------------------
const presets = query(`
  SELECT id, name
  FROM workout_presets
  WHERE user_id = ${lit(userId)}
`);
if (
  report.check(
    'preset.created',
    presets.length === 1,
    `${presets.length} workout preset(s) for the QA user (expected 1)`,
    presets
  )
) {
  const presetExercises = query(`
    SELECT exercise_id
    FROM workout_preset_exercises
    WHERE workout_preset_id = ${lit(presets[0].id)}
  `);
  report.check(
    'preset.holds-the-exercise',
    presetExercises.length === 1 && presetExercises[0].exercise_id === exercise.id,
    presetExercises.length === 1
      ? 'the preset carries the exercise the session was built from'
      : `${presetExercises.length} exercise(s) on the preset (expected 1)`,
    { presetExercises, exerciseId: exercise.id }
  );
}

// --- the logged activity ----------------------------------------------------
// Standalone: an activity is an exercise_entries row with no session behind it,
// which is exactly what routes ExerciseHome to ActivityDetail rather than to
// WorkoutDetail.
const activities = query(`
  SELECT id, exercise_id, exercise_name, duration_minutes, entry_date::text AS entry_date
  FROM exercise_entries
  WHERE user_id = ${lit(userId)} AND exercise_preset_entry_id IS NULL
`);
if (
  report.check(
    'activity.created',
    activities.length === 1,
    `${activities.length} standalone activit(y/ies) for the QA user (expected 1)`,
    activities
  )
) {
  const activity = activities[0];
  report.check(
    'activity.values',
    activity.exercise_id === exercise.id &&
      activity.exercise_name === EXPECTED.activityName &&
      num(activity.duration_minutes) === EXPECTED.activityDurationMinutes &&
      activity.entry_date === today,
    `"${activity.exercise_name}", ${activity.duration_minutes} min on ${activity.entry_date}` +
      ` (expected "${EXPECTED.activityName}", ${EXPECTED.activityDurationMinutes} min, today is ${today})`,
    { activity, exerciseId: exercise.id }
  );
}

// --- the medication ---------------------------------------------------------
const medications = query(`
  SELECT id, name, is_active, source
  FROM medications
  WHERE user_id = ${lit(userId)}
`);
report.check(
  'medication.created',
  medications.length === 1 &&
    medications[0].name === EXPECTED.medicationName &&
    medications[0].is_active === true,
  medications.length === 1
    ? `one medication, "${medications[0].name}", active=${medications[0].is_active}`
    : `${medications.length} medication(s) for the QA user (expected 1)`,
  medications
);

// The schedule editor was opened and closed without saving, so a schedule row
// here would mean the Close button committed one.
const schedules = query(`
  SELECT s.id
  FROM medication_schedules s
  JOIN medications m ON m.id = s.medication_id
  WHERE m.user_id = ${lit(userId)}
`);
report.check(
  'medication.no-schedule-saved',
  schedules.length === 0,
  `${schedules.length} schedule(s) written by a form that was closed, not saved (expected 0)`,
  schedules
);

report.finish(runDir);
