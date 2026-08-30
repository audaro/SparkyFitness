#!/usr/bin/env node
/**
 * The verdict for qa/flows/suggested-workout.yaml.
 *
 * The flow taps one row — Push — switches the workout it gets to the seeded
 * gym, shortens it to 45 minutes, refreshes it, starts what comes back,
 * completes one set and ends the workout. Those three adjustments are every
 * regenerate path the screen has, so the muscles, length and gym asserted below
 * are on a payload that survived three server-side rebuilds. Everything worth checking about that is invisible. The
 * screen shows exercise names, a muscle header and a duration; it does not show
 * which muscle each exercise was slotted against, how many sets were
 * prescribed, how long the rest is, where the exercise came from, or which of
 * the numbers on a set row are stored and which are placeholders. A generator
 * that quietly reached free-exercise-db to fill a slot, prescribed a single
 * set, or built the Push day around whatever the catalog query happened to
 * return first would render exactly like a correct one.
 *
 * So this reads the row the generator wrote, then the session it became, and
 * asserts four separate things:
 *
 *   the REQUEST survived  — the muscles in the payload are the three the Push
 *                           row resolves to on the client, which is the only
 *                           evidence that the tap reached the wire intact (the
 *                           server has no split vocabulary to reconstruct them
 *                           from) — and they are still those three after TWO
 *                           further regenerates, the gym chip and then the
 *                           length chip. That is a separate claim about the
 *                           client, because an omitted `target_muscles` asks
 *                           for the freshest muscles rather than for the same
 *                           ones. The gym makes the same claim in the other
 *                           direction: it is set by the first of those two
 *                           chips and has to still be on the row after the
 *                           second;
 *   the PLAN is coherent  — every prescribed exercise trains a muscle that was
 *                           asked for, every asked-for muscle got one, compounds
 *                           come first, the 45-minute budget forced a trim, the
 *                           trim took an isolation rather than a compound, and
 *                           the denormalized catalog detail in the payload
 *                           matches the row it names;
 *   the run stayed LOCAL  — nothing was imported, said in two independent ways,
 *                           because it is the one failure that would make every
 *                           other number here non-reproducible;
 *   the PLAN was RUN      — the session mirrors the workout exercise for
 *                           exercise, its sets are created empty, and the one
 *                           set the flow completed committed the prescribed
 *                           reps that were never typed while the other
 *                           seventeen stayed null.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createReport } from './lib/report.mjs';
import { query, qaAccount, lit } from './lib/db.mjs';
import {
  CATALOG,
  CATALOG_PREFIX,
  COMPOUND_SUFFIX,
  VARIANTS_PER_MUSCLE,
} from '../fixtures/exercise-catalog.mjs';

const report = createReport('suggested-workout');
const runDir = process.env.QA_RUN_DIR;
const { userId } = qaAccount();

// What the flow tapped, resolved the way the client resolves it. Written out
// rather than imported from MUSCLE_SPLIT_MEMBERS on purpose: importing the
// constant would make this check agree with the app by construction, and the
// claim being made is that the split the *user* picked is the split that got
// built — not that two copies of one array are equal.
const EXPECTED_MUSCLES = ['chest', 'shoulders', 'triceps'];
// What the flow's length chip asked for. NOT the server's 60-minute default —
// the flow picks 45 on purpose, because that is the length at which this
// catalog's six-exercise Push day does not fit and the fitter has to do
// something. A default-length workout would leave every duration check below
// passing without the fitter ever having run.
const EXPECTED_TARGET_MINUTES = 45;
// The name UpNextScreen's Start button gives the session it creates.
const SESSION_NAME = 'Up Next workout';

// The app dates a session by the device's calendar day and the simulator shares
// this machine's timezone, so the expected day is the local one. Deriving it
// from toISOString() would reproduce, in the checker, the timezone bug the check
// exists to catch.
const today = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

// ---------------------------------------------------------------------------
// The workout the generator wrote
// ---------------------------------------------------------------------------

const rows = query(`
  SELECT id, user_id, gym_profile_id, target_duration_minutes, payload, status,
         generated_at::text AS generated_at
  FROM workout_recommendations
  WHERE user_id = ${lit(userId)}
`);

if (
  !report.check(
    'recommendation.one-row',
    rows.length === 1,
    `${rows.length} workout recommendation(s) for the QA user (expected 1)`,
    rows.map((entry) => ({ id: entry.id, status: entry.status }))
  )
) {
  report.finish(runDir);
}

const row = rows[0];
const payload = row.payload ?? {};
const exercises = Array.isArray(payload.exercises) ? payload.exercises : [];

// Started, not completed: `handleStart` marks the row when the user taps Start
// and nothing marks it again. Finishing a workout deliberately leaves it alone
// — the marker exists so a client can tell a fresh suggestion from one already
// acted on, and nothing server-side branches on it. Asserted as the code
// actually behaves rather than as it reads: a 'completed' here would mean
// somebody added a write nobody asked for.
report.check(
  'recommendation.status-started',
  row.status === 'started',
  `stored with status "${row.status}" (Start marks it, and finishing deliberately does not)`,
  { status: row.status }
);
report.check(
  'recommendation.target-duration',
  row.target_duration_minutes === EXPECTED_TARGET_MINUTES,
  `built for ${row.target_duration_minutes} minutes; the length chip asked for ${EXPECTED_TARGET_MINUTES}`,
  { targetDurationMinutes: row.target_duration_minutes }
);
// The gym the flow picked, still on the row two regenerates later.
//
// This check used to read "gym_profile_id is null", which the QA account
// satisfied by never having had a gym profile — it could not fail, whatever the
// client sent. Now a profile is seeded, the flow switches to it BEFORE changing
// the length, and the id has to survive that second regenerate to be here: a
// length chip that sent nothing but the new duration would drop the gym back to
// null and leave the workout built for equipment the user had just said they
// did not have.
const gymProfiles = query(`
  SELECT id, name, is_active
  FROM gym_equipment_profiles
  WHERE user_id = ${lit(userId)}
`);
report.check(
  'recommendation.one-gym-profile',
  gymProfiles.length === 1,
  `${gymProfiles.length} gym profile(s) for the QA user (the setup seeds exactly 1)`,
  { profiles: gymProfiles.map((profile) => profile.name) }
);
const seededGym = gymProfiles[0] ?? null;
report.check(
  'recommendation.gym-is-the-one-picked',
  seededGym !== null && row.gym_profile_id === seededGym.id,
  seededGym === null
    ? 'there is no seeded gym profile to have been picked'
    : `built for gym profile ${JSON.stringify(row.gym_profile_id)}; the chip picked "${seededGym.name}" (${seededGym.id})`,
  { gymProfileId: row.gym_profile_id, seededGymId: seededGym?.id ?? null }
);
// Switching the chip activates the profile as well as regenerating against it.
// Seeded inactive, so this is evidence the tap did both halves — and the half
// that outlives the workout is the one no other check would notice.
report.check(
  'recommendation.gym-was-activated',
  seededGym !== null && seededGym.is_active === true,
  seededGym === null
    ? 'there is no seeded gym profile to have been activated'
    : `the seeded profile is ${seededGym.is_active ? 'active' : 'still inactive'} (the chip activates the one it selects)`,
  { isActive: seededGym?.is_active ?? null }
);

// --- the request survived the trip -------------------------------------------
// This runs against the payload as it stands AFTER the length change, which is
// the whole reason the flow changes the length before starting. Every
// regenerate from Up Next is a fresh `POST /generate`, and an omitted
// `target_muscles` there does not mean "keep what you had" — it means "pick the
// freshest muscles". So a client that sent the new duration on its own would
// hand back a lower-body workout under a Push heading, with nothing on screen
// to say so. The split surviving the chip is the evidence that the screen
// restates the workout it is adjusting.
const muscleGroups = Array.isArray(payload.muscle_groups) ? payload.muscle_groups : [];
report.check(
  'payload.muscles-are-the-split',
  muscleGroups.length === EXPECTED_MUSCLES.length &&
    EXPECTED_MUSCLES.every((muscle) => muscleGroups.includes(muscle)),
  `built around [${muscleGroups.join(', ')}]; the Push row means [${EXPECTED_MUSCLES.join(', ')}]`,
  { muscleGroups }
);

// --- the plan is coherent -----------------------------------------------------
if (
  !report.check(
    'payload.has-exercises',
    exercises.length > 0,
    `${exercises.length} exercise(s) prescribed`,
    { count: exercises.length }
  )
) {
  report.finish(runDir);
}

// The seeded catalog, read back out of the database rather than off the
// fixture: the ids are assigned by the server, and the names are what it
// actually stored.
const catalogRows = query(`
  SELECT id, name, modality, primary_muscles::text AS primary_muscles
  FROM exercises
  WHERE name LIKE ${lit(`${CATALOG_PREFIX}%`)}
`);
const catalogById = new Map(catalogRows.map((entry) => [entry.id, entry]));

// Every exercise in the workout is one this run seeded. This is the first of
// the two "nothing came from the network" checks, and the sharper one: an
// imported exercise would be a perfectly valid local row by the time it was
// prescribed, and only its absence from the catalog gives it away.
const foreign = exercises.filter((exercise) => !catalogById.has(exercise.exercise_id));
report.check(
  'payload.every-exercise-is-seeded',
  foreign.length === 0,
  foreign.length === 0
    ? 'every prescribed exercise is one of the seeded catalog rows'
    : `${foreign.length} prescribed exercise(s) are not in the seeded catalog`,
  foreign.map((exercise) => ({ id: exercise.exercise_id, name: exercise.exercise_name }))
);

// Denormalization drift: the payload carries the name, modality and muscles so
// a client can render a card without a second round trip, and nothing on screen
// would look wrong if they had gone stale against the row they name.
const drifted = [];
for (const exercise of exercises) {
  const catalogRow = catalogById.get(exercise.exercise_id);
  if (!catalogRow) continue;
  if (exercise.exercise_name !== catalogRow.name) {
    drifted.push({
      id: exercise.exercise_id,
      field: 'exercise_name',
      payload: exercise.exercise_name,
      stored: catalogRow.name,
    });
  }
  if (exercise.modality !== catalogRow.modality) {
    drifted.push({
      id: exercise.exercise_id,
      field: 'modality',
      payload: exercise.modality,
      stored: catalogRow.modality,
    });
  }
  const storedMuscles = JSON.parse(catalogRow.primary_muscles ?? '[]');
  if (JSON.stringify(exercise.primary_muscles) !== JSON.stringify(storedMuscles)) {
    drifted.push({
      id: exercise.exercise_id,
      field: 'primary_muscles',
      payload: exercise.primary_muscles,
      stored: storedMuscles,
    });
  }
}
report.check(
  'payload.denormalized-detail-matches-the-catalog',
  drifted.length === 0,
  drifted.length === 0
    ? 'the name, modality and muscles on each card match the exercise row they point at'
    : `${drifted.length} denormalized field(s) disagree with the catalog`,
  drifted
);

// Nothing in the workout trains a muscle that was not asked for. The planner
// slots on the primary mover, and each seeded row has exactly one, so this is
// unambiguous.
const offTarget = exercises.filter(
  (exercise) => !(exercise.primary_muscles ?? []).some((muscle) => muscleGroups.includes(muscle))
);
report.check(
  'plan.every-exercise-serves-a-target-muscle',
  offTarget.length === 0,
  offTarget.length === 0
    ? 'every exercise trains one of the muscles the workout was built around'
    : `${offTarget.length} exercise(s) train nothing that was asked for`,
  offTarget.map((exercise) => ({ name: exercise.exercise_name, primary: exercise.primary_muscles }))
);

// And every muscle that was asked for got something. The duration fitter trims
// isolation work when a workout runs long, but it never removes a compound and
// never removes the last exercise standing for a muscle — a Push day that came
// back without a chest movement is a different workout, not a shorter one.
const served = new Set(exercises.flatMap((exercise) => exercise.primary_muscles ?? []));
const unserved = muscleGroups.filter((muscle) => !served.has(muscle));
report.check(
  'plan.every-target-muscle-is-served',
  unserved.length === 0,
  unserved.length === 0
    ? 'each of the muscles asked for has at least one exercise'
    : `no exercise trains [${unserved.join(', ')}]`,
  { unserved, served: [...served] }
);

const duplicated = exercises
  .map((exercise) => exercise.exercise_id)
  .filter((id, index, all) => all.indexOf(id) !== index);
report.check(
  'plan.no-exercise-twice',
  duplicated.length === 0,
  duplicated.length === 0
    ? 'no exercise is prescribed twice'
    : `${duplicated.length} exercise(s) appear more than once`,
  duplicated
);

// `sort_order` is what the client draws the list in. Contiguous from zero, in
// array order: a gap or a repeat would reorder or collapse rows on screen.
const misordered = exercises.filter((exercise, index) => exercise.sort_order !== index);
report.check(
  'plan.sort-order-is-contiguous',
  misordered.length === 0,
  misordered.length === 0
    ? `sort_order runs 0..${exercises.length - 1} in payload order`
    : `${misordered.length} exercise(s) carry a sort_order that is not their position`,
  exercises.map((exercise) => ({ name: exercise.exercise_name, sort_order: exercise.sort_order }))
);

// Compounds before isolations. The planner sorts on slot first, and the order
// is programming rather than presentation: the heavy multi-joint work belongs
// at the front of a session, while there is something left to do it with. A
// list rendered the other way round looks completely normal.
//
// Which seeded row is which is known from the fixture — every muscle gets one
// of each, and the suffix says so.
const isCompound = (exercise) => exercise.exercise_name.endsWith(` ${COMPOUND_SUFFIX}`);
const firstIsolation = exercises.findIndex((exercise) => !isCompound(exercise));
const lateCompound = exercises.findIndex(
  (exercise, index) => isCompound(exercise) && firstIsolation >= 0 && index > firstIsolation
);
report.check(
  'plan.compounds-come-first',
  lateCompound === -1,
  lateCompound === -1
    ? 'every compound is ordered ahead of every isolation'
    : `a compound sits at position ${lateCompound}, after the first isolation at ${firstIsolation}`,
  exercises.map((exercise) => ({ name: exercise.exercise_name, compound: isCompound(exercise) }))
);

// --- the fitter actually ran --------------------------------------------------
// The catalog holds exactly VARIANTS_PER_MUSCLE candidates per muscle, so a
// Push day with nothing in its way is three muscles' worth of everything — and
// that workout runs long. The flow asks for 45 minutes, so a plan that still
// carries every candidate means the target reached the row and the planner
// then built past it. Stated against the fixture rather than as a literal 6: a
// third variant per muscle must not silently turn this into a check that
// passes on an untrimmed workout.
const untrimmedSize = muscleGroups.length * VARIANTS_PER_MUSCLE;
report.check(
  'plan.trimmed-to-fit',
  exercises.length < untrimmedSize,
  `${exercises.length} exercise(s) against the ${untrimmedSize} this catalog could have offered for ${muscleGroups.length} muscles`,
  { prescribed: exercises.length, untrimmedSize, targetMinutes: row.target_duration_minutes }
);

// And it trimmed the right thing. Fitting to a budget removes accessory work;
// it must never remove a compound, and it must never leave a target muscle
// with nothing at all — a 45-minute Push day that dropped the chest compound
// is shorter and wrong, and renders exactly as well as a correct one.
const missingCompounds = EXPECTED_MUSCLES.filter(
  (muscle) =>
    !exercises.some(
      (exercise) => exercise.exercise_name === `${CATALOG_PREFIX}${muscle} ${COMPOUND_SUFFIX}`
    )
);
report.check(
  'plan.no-compound-was-trimmed',
  missingCompounds.length === 0,
  missingCompounds.length === 0
    ? 'every target muscle kept its compound through the trim'
    : `the trim dropped the compound for [${missingCompounds.join(', ')}]`,
  { missingCompounds, prescribed: exercises.map((exercise) => exercise.exercise_name) }
);

// --- the sets ----------------------------------------------------------------
// The programming itself. Every seeded row is `weight_reps`, so every working
// set must name a rep count; rest has to be a real number of seconds or the
// timer on the logging screen has nothing to count down; and the set numbers
// are what the logger writes its entries against.
const setProblems = [];
for (const exercise of exercises) {
  const sets = Array.isArray(exercise.sets) ? exercise.sets : [];
  if (sets.length === 0) {
    setProblems.push({ exercise: exercise.exercise_name, problem: 'no sets prescribed' });
    continue;
  }
  sets.forEach((set, index) => {
    if (set.set_number !== index + 1) {
      setProblems.push({
        exercise: exercise.exercise_name,
        problem: `set_number ${set.set_number} at position ${index + 1}`,
      });
    }
    if (!Number.isInteger(set.reps) || set.reps <= 0) {
      setProblems.push({
        exercise: exercise.exercise_name,
        problem: `set ${set.set_number} prescribes reps ${JSON.stringify(set.reps)} on a weight_reps exercise`,
      });
    }
    if (!Number.isInteger(set.rest_time) || set.rest_time <= 0) {
      setProblems.push({
        exercise: exercise.exercise_name,
        problem: `set ${set.set_number} rests ${JSON.stringify(set.rest_time)}s`,
      });
    }
  });
  if (!Number.isInteger(exercise.rest_seconds) || exercise.rest_seconds <= 0) {
    setProblems.push({
      exercise: exercise.exercise_name,
      problem: `rest_seconds is ${JSON.stringify(exercise.rest_seconds)}`,
    });
  }
}
report.check(
  'sets.programmed',
  setProblems.length === 0,
  setProblems.length === 0
    ? `${exercises.reduce((total, exercise) => total + exercise.sets.length, 0)} sets across ${exercises.length} exercises, each with reps and rest`
    : `${setProblems.length} problem(s) in the prescribed sets`,
  setProblems.slice(0, 10)
);

report.check(
  'payload.duration-estimated',
  Number.isInteger(payload.estimated_duration_minutes) && payload.estimated_duration_minutes > 0,
  `estimated at ${JSON.stringify(payload.estimated_duration_minutes)} minutes against a ${row.target_duration_minutes}-minute target`,
  { estimated: payload.estimated_duration_minutes, target: row.target_duration_minutes }
);

// The budget, conditioned on the fitter having had a choice. It is allowed to
// come in over target when everything left is the last exercise standing for
// its muscle — a workout is never trimmed below one movement per muscle — so
// the assertion only applies while some muscle still holds more than one
// exercise, which is precisely the state in which the fitter should have kept
// going. Stated that way rather than as a flat `estimated <= target` so a
// future change to set counts or rest lengths cannot turn a correct trim into
// a red run.
const perMuscle = new Map();
for (const exercise of exercises) {
  for (const muscle of exercise.primary_muscles ?? []) {
    perMuscle.set(muscle, (perMuscle.get(muscle) ?? 0) + 1);
  }
}
const hadSomethingToTrim = [...perMuscle.values()].some((count) => count > 1);
report.check(
  'payload.duration-fits-the-target',
  !hadSomethingToTrim || payload.estimated_duration_minutes <= row.target_duration_minutes,
  hadSomethingToTrim
    ? `${payload.estimated_duration_minutes} of ${row.target_duration_minutes} minutes, with ${exercises.length} exercises still on the plan`
    : 'every exercise is the last one standing for its muscle, so the target does not bind',
  {
    estimated: payload.estimated_duration_minutes,
    target: row.target_duration_minutes,
    perMuscle: Object.fromEntries(perMuscle),
  }
);

// --- the run stayed local ------------------------------------------------------
// Second, independent evidence for the same claim as
// `payload.every-exercise-is-seeded`, and it catches the case that one cannot:
// an import that happened and was then NOT prescribed still means this run
// went to the network, and the next one would produce a different workout.
const catalogTotal = query('SELECT count(*)::int AS total FROM exercises')[0].total;
report.check(
  'catalog.unchanged',
  catalogTotal === CATALOG.length,
  `${catalogTotal} exercises in the catalog after generating (${CATALOG.length} were seeded)`,
  { total: catalogTotal, seeded: CATALOG.length }
);

// And the server's own account of itself. Every branch of the free-exercise-db
// fallback logs — the import, the "no primary mover upstream", and the failure
// — so the absence of the phrase covers all three. Read from the offset the
// setup script recorded, because server.log outlives the run.
let fallbackLines = [];
let scanned = true;
try {
  const offset = Number(readFileSync(join(runDir, 'server-log-offset'), 'utf8').trim());
  const serverLog = readFileSync(join(runDir, 'server.log'), 'utf8').slice(offset);
  fallbackLines = serverLog.split('\n').filter((line) => line.includes('free-exercise-db'));
} catch (error) {
  scanned = false;
  fallbackLines = [String(error && error.message)];
}
report.check(
  'catalog.no-network-fallback-logged',
  scanned && fallbackLines.length === 0,
  scanned
    ? fallbackLines.length === 0
      ? 'the server logged nothing about free-exercise-db during this run'
      : `${fallbackLines.length} free-exercise-db line(s) in this run's server log`
    : "this run's server log could not be read, so the fallback cannot be ruled out",
  fallbackLines.slice(0, 5)
);

// ---------------------------------------------------------------------------
// The session the workout became
// ---------------------------------------------------------------------------
// Starting creates the whole plan server-side in one write: a session row, an
// entry per exercise, and a set row per prescribed set. Nothing about that is
// visible — the screen shows the same six cards it showed a moment ago.

const sessions = query(`
  SELECT id, name, entry_date::text AS entry_date, source
  FROM exercise_preset_entries
  WHERE user_id = ${lit(userId)}
`);

if (
  !report.check(
    'session.one-row',
    sessions.length === 1,
    `${sessions.length} session(s) for the QA user (expected 1)`,
    sessions
  )
) {
  report.finish(runDir);
}

const session = sessions[0];
// Split from the count rather than folded into it: a session under the wrong
// name is still a session, and stopping here would hide everything below —
// which is where the interesting failures are.
report.check(
  'session.named-by-the-start-button',
  session.name === SESSION_NAME,
  `the session is called "${session.name}" (Start names it "${SESSION_NAME}")`,
  { name: session.name }
);
report.check(
  'session.dated-today',
  session.entry_date === today,
  `filed on ${session.entry_date} (today is ${today})`,
  { entryDate: session.entry_date, expected: today }
);

const entries = query(`
  SELECT id, exercise_id, exercise_name, sort_order
  FROM exercise_entries
  WHERE exercise_preset_entry_id = ${lit(session.id)}
  ORDER BY sort_order, id
`);

// The session is the workout, exercise for exercise, in the same order. A start
// that dropped one, reordered them, or pointed an entry at the wrong catalog row
// would produce a session that looks like a workout and is not the one that was
// on screen.
const plannedIds = exercises.map((exercise) => exercise.exercise_id);
const startedIds = entries.map((entry) => entry.exercise_id);
const firstDivergence = plannedIds.findIndex((id, index) => startedIds[index] !== id);
report.check(
  'session.mirrors-the-plan',
  startedIds.length === plannedIds.length && firstDivergence === -1,
  startedIds.length !== plannedIds.length
    ? `the session holds ${startedIds.length} exercise(s) where the workout prescribed ${plannedIds.length}`
    : firstDivergence === -1
      ? `all ${startedIds.length} exercises started in the order they were prescribed`
      : `position ${firstDivergence} started "${entries[firstDivergence]?.exercise_name}" where the workout prescribed "${exercises[firstDivergence].exercise_name}"`,
  { planned: exercises.map((e) => e.exercise_name), started: entries.map((e) => e.exercise_name) }
);

const sets = query(`
  SELECT s.exercise_entry_id, s.set_number, s.set_type, s.reps, s.weight,
         s.rest_time, s.completed_at IS NOT NULL AS completed
  FROM exercise_entry_sets s
  JOIN exercise_entries e ON e.id = s.exercise_entry_id
  WHERE e.exercise_preset_entry_id = ${lit(session.id)}
  ORDER BY e.sort_order, s.set_number
`);

const plannedSetCount = exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
report.check(
  'session.every-set-created',
  sets.length === plannedSetCount,
  `${sets.length} set row(s) created for ${plannedSetCount} prescribed set(s)`,
  { created: sets.length, prescribed: plannedSetCount }
);

// The rest is programming, not a placeholder — it drives the timer that starts
// the moment a set is completed, so it has to be written up front.
const plannedRest = exercises.flatMap((exercise) =>
  exercise.sets.map((set) => ({
    exercise: exercise.exercise_name,
    setNumber: set.set_number,
    rest: set.rest_time,
  }))
);
const restMismatches = [];
sets.forEach((storedSet, index) => {
  const planned = plannedRest[index];
  if (planned && storedSet.rest_time !== planned.rest) {
    restMismatches.push({
      exercise: planned.exercise,
      setNumber: planned.setNumber,
      stored: storedSet.rest_time,
      prescribed: planned.rest,
    });
  }
});
report.check(
  'session.rest-carried-over',
  restMismatches.length === 0,
  restMismatches.length === 0
    ? 'every set row carries the rest the generator prescribed for it'
    : `${restMismatches.length} set row(s) rest for a different length than prescribed`,
  restMismatches.slice(0, 5)
);

// --- the one set that was logged ----------------------------------------------
// The whole reason this scenario runs the workout instead of stopping at the
// plan. Sets are created EMPTY and the prescribed numbers live only as gray
// placeholders on the client; completing a set is what commits them. So the 10
// below was never typed — it can only have come from the generator, through the
// placeholder, into the diary — and the untouched rows prove the placeholder is
// not being written for sets nobody did.
const completed = sets.filter((storedSet) => storedSet.completed);
const untouched = sets.filter((storedSet) => !storedSet.completed);

if (
  !report.check(
    'log.exactly-one-set-completed',
    completed.length === 1,
    `${completed.length} set(s) marked complete (the flow logged 1)`,
    completed
  )
) {
  report.finish(runDir);
}

const loggedSet = completed[0];
const prescribedReps = exercises[0].sets[0]?.reps ?? null;
report.check(
  'log.completed-set-is-the-first-one',
  loggedSet.exercise_entry_id === entries[0]?.id && loggedSet.set_number === 1,
  `logged set ${loggedSet.set_number} of "${entries.find((entry) => entry.id === loggedSet.exercise_entry_id)?.exercise_name}" (the flow completed set 1 of the first exercise)`,
  loggedSet
);
report.check(
  'log.prescribed-reps-were-committed',
  Number(loggedSet.reps) === prescribedReps,
  `the logged set stored ${JSON.stringify(loggedSet.reps)} reps; the generator prescribed ${prescribedReps} and the flow typed nothing`,
  { stored: loggedSet.reps, prescribed: prescribedReps }
);
// Nothing was typed, and the generator had no history to price the first-ever
// session from — so the weight has to be absent rather than zero. A 0 here would
// render as "0 kg" and count as a logged load.
report.check(
  'log.untyped-weight-stays-null',
  loggedSet.weight === null,
  `the logged set stored weight ${JSON.stringify(loggedSet.weight)} (nothing was typed and nothing was prescribed)`,
  { weight: loggedSet.weight }
);

const leaked = untouched.filter(
  (storedSet) => storedSet.reps !== null || storedSet.weight !== null
);
report.check(
  'log.uncompleted-sets-stay-empty',
  leaked.length === 0,
  leaked.length === 0
    ? `all ${untouched.length} uncompleted sets are still empty — the prescription is a placeholder until a set is done`
    : `${leaked.length} uncompleted set(s) already carry values nobody logged`,
  leaked.slice(0, 5)
);

report.finish(runDir);
