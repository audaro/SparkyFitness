#!/usr/bin/env node
/**
 * The verdict for qa/flows/sequential-plan.yaml.
 *
 * The flow runs a three-session sequential plan from the Exercise tab's banner
 * twice: session one start-to-finish (one set completed, workout ended), then
 * whatever the banner offers next, started and abandoned with nothing logged.
 * Both halves are invisible on screen — the banner prints a position the server
 * computed, and a started session and a finished one render identically, because
 * a live workout writes every one of its exercise entries the instant it
 * starts, empty.
 *
 * So this reads the entries the two starts actually wrote, and asserts:
 *
 *   the TAG survived     — each start's entries carry the plan assignment they
 *                          came from. Nothing else in the app writes that
 *                          column, the whole progression is derived from it,
 *                          and in this fork the callback that sets it lives in
 *                          a hook of its own (useStartPlanAssignment) because
 *                          upstream defines it inside a Diary exercise list
 *                          this fork does not have. An untagged start is a plan
 *                          that can never advance;
 *   the PRESET expanded  — a session assignment names a preset, not an
 *                          exercise, and starting it has to expand to the
 *                          preset's exercises rather than to one row;
 *   the plan ADVANCED    — the second start is session 2. This is read off the
 *                          database rather than off the screen, and it is
 *                          evidence about the screen: the flow tapped whichever
 *                          session the banner offered, so the assignment its
 *                          entries carry IS what the banner said;
 *   the plan HELD        — and this is the one worth running the scenario for.
 *                          Session 2 was started and nothing in it was ever
 *                          completed, so the plan's position must still be
 *                          session 2. If the server reports session 3, a
 *                          workout that was merely opened counted as done: the
 *                          banner moves on while the user is still warming up,
 *                          and the session they were in the middle of can only
 *                          be found by scrolling back through the diary.
 *
 * The position is read through the same endpoint the banner reads
 * (GET /api/workout-plan-templates/active/:date) rather than recomputed here.
 * That is deliberate: the claim being tested is what the app is told, and a
 * reimplementation of computeSequentialPlanProgression in this file would agree
 * with itself instead of with the app. Every input to it — the entries, their
 * tags, which sets are completed — is asserted from the database first, so a
 * wrong answer cannot be blamed on a start state nobody checked.
 */
import { createReport } from './lib/report.mjs';
import { query, qaAccount, lit } from './lib/db.mjs';
import { qaSignIn } from '../bin/qa-session.mjs';
import {
  PLAN_NAME,
  SESSIONS,
  SETS_PER_EXERCISE,
  catalogExerciseName,
} from '../fixtures/sequential-plan.mjs';

const report = createReport('sequential-plan');
const runDir = process.env.QA_RUN_DIR;
const { userId } = qaAccount();

// The app dates a session by the device's calendar day and the simulator shares
// this machine's timezone, so the plan's active read is asked for the local day
// — the same one qa-sequential-plan.mjs started the plan on.
const today = new Date().toLocaleDateString('en-CA');

// --- the plan, as it was seeded ---------------------------------------------
const assignments = query(`
  SELECT a.id, a.session_index, a.session_name, a.day_of_week,
         a.workout_preset_id, t.id AS template_id, t.schedule_type, t.entry_mode
  FROM workout_plan_template_assignments a
  JOIN workout_plan_templates t ON t.id = a.template_id
  WHERE t.user_id = ${lit(userId)}
    AND t.plan_name = ${lit(PLAN_NAME)}
  ORDER BY a.session_index
`);

if (
  !report.check(
    'plan.three-sequential-sessions',
    assignments.length === SESSIONS.length &&
      assignments.every((a) => a.schedule_type === 'sequential') &&
      assignments.every((a, i) => a.session_index === SESSIONS[i].index),
    `the seeded plan has ${assignments.length} assignment(s) (expected ${SESSIONS.length}, sequential, indexed ${SESSIONS.map((s) => s.index).join('/')})`,
    assignments.map((a) => ({
      id: a.id,
      session_index: a.session_index,
      session_name: a.session_name,
      schedule_type: a.schedule_type,
    }))
  )
) {
  // Without the plan there is nothing the rest of this file can say, and every
  // later failure would be a restatement of this one.
  report.finish(runDir);
}

const assignmentById = new Map(assignments.map((a) => [String(a.id), a]));

// --- what the two starts wrote ----------------------------------------------
// Grouped by the session (exercise_preset_entries) each entry belongs to, in
// creation order, so "the first start" and "the second start" are the flow's
// two taps rather than an assumption about ids.
const entries = query(`
  SELECT ee.id, ee.exercise_preset_entry_id, ee.exercise_name,
         ee.workout_plan_assignment_id, ee.entry_date::text AS entry_date,
         ee.created_at::text AS created_at,
         count(s.id) AS set_count,
         count(s.completed_at) AS completed_sets
  FROM exercise_entries ee
  LEFT JOIN exercise_entry_sets s ON s.exercise_entry_id = ee.id
  WHERE ee.user_id = ${lit(userId)}
  GROUP BY ee.id, ee.exercise_preset_entry_id, ee.exercise_name,
           ee.workout_plan_assignment_id, ee.entry_date, ee.created_at
  ORDER BY ee.created_at, ee.id
`);

const startOrder = [];
const startsBySessionRow = new Map();
for (const entry of entries) {
  const key = String(entry.exercise_preset_entry_id);
  if (!startsBySessionRow.has(key)) {
    startsBySessionRow.set(key, []);
    startOrder.push(key);
  }
  startsBySessionRow.get(key).push(entry);
}
const starts = startOrder.map((key) => startsBySessionRow.get(key));

if (
  !report.check(
    'starts.two-sessions-were-started',
    starts.length === 2,
    `${starts.length} live session(s) were created (the flow starts the banner twice)`,
    starts.map((group, i) => ({
      start: i + 1,
      entries: group.map((e) => e.exercise_name),
    }))
  )
) {
  report.finish(runDir);
}

const [first, second] = starts;
const setsPerSession = SETS_PER_EXERCISE * SESSIONS[0].muscles.length;

/** The distinct plan assignment a start's entries are tagged with, or null. */
function taggedAssignment(group) {
  const ids = new Set(group.map((e) => String(e.workout_plan_assignment_id)));
  if (ids.size !== 1) return null;
  return assignmentById.get([...ids][0]) ?? null;
}

const firstTag = taggedAssignment(first);
const secondTag = taggedAssignment(second);

// The column the entire feature hangs on. An untagged start is a workout that
// looks right in the diary and leaves the plan frozen on session one forever.
report.check(
  'start.tagged-with-its-plan-assignment',
  firstTag !== null && secondTag !== null,
  firstTag !== null && secondTag !== null
    ? 'both starts tagged every entry with a single assignment of this plan'
    : 'a start wrote entries that carry no assignment of this plan (or more than one)',
  {
    first: first.map((e) => e.workout_plan_assignment_id),
    second: second.map((e) => e.workout_plan_assignment_id),
  }
);

// A session assignment names a PRESET. Expanding it is the hook's job, and a
// start that wrote one entry would be a session missing half its exercises.
const expectedFirstExercises = SESSIONS[0].muscles.map(catalogExerciseName);
report.check(
  'start.preset-expanded-to-its-exercises',
  first.length === expectedFirstExercises.length &&
    expectedFirstExercises.every((name) =>
      first.some((e) => e.exercise_name === name)
    ),
  `session 1 started as ${first.length} entr(ies): ${first.map((e) => e.exercise_name).join(', ')}`,
  { expected: expectedFirstExercises }
);

report.check(
  'start.first-is-session-1',
  firstTag?.session_index === 1,
  `the first start ran session ${JSON.stringify(firstTag?.session_index ?? null)} "${firstTag?.session_name ?? '?'}" (a plan with nothing logged against it is at its first)`,
  { session_index: firstTag?.session_index ?? null }
);

// Everything the plan is told about session 1: four sets laid out empty at
// start, one of them completed by the flow. Stated as a check rather than
// assumed, because the advancement claim below means nothing if the set never
// registered — a session with no completed set is the same state phase 2 is in.
const firstCompleted = first.reduce((n, e) => n + Number(e.completed_sets), 0);
const firstSets = first.reduce((n, e) => n + Number(e.set_count), 0);
report.check(
  'finish.session-1-had-exactly-one-completed-set',
  firstCompleted === 1 && firstSets === setsPerSession,
  `session 1 ended with ${firstCompleted} of ${firstSets} sets completed (the flow completes exactly 1 of ${setsPerSession})`,
  { completed: firstCompleted, total: firstSets }
);

// The banner's answer after a FINISHED session, read out of the database: the
// flow tapped whatever it offered, so the assignment the second start carries
// is what it said.
report.check(
  'advance.finished-session-moved-the-plan-on',
  secondTag?.session_index === 2,
  `after session 1 was finished the banner offered session ${JSON.stringify(secondTag?.session_index ?? null)} "${secondTag?.session_name ?? '?'}" (expected 2 "${SESSIONS[1].name}")`,
  { session_index: secondTag?.session_index ?? null }
);

// The precondition for the check after it: phase 2 logged nothing at all.
const secondCompleted = second.reduce((n, e) => n + Number(e.completed_sets), 0);
report.check(
  'hold.started-session-logged-nothing',
  secondCompleted === 0,
  `the second session carries ${secondCompleted} completed set(s) (the flow leaves it untouched)`,
  { completed: secondCompleted, entries: second.length }
);

const sessionThree = assignments.find((a) => a.session_index === 3);
const touchedThree = entries.filter(
  (e) => String(e.workout_plan_assignment_id) === String(sessionThree?.id)
);
report.check(
  'hold.session-3-was-never-started',
  touchedThree.length === 0,
  `${touchedThree.length} entr(ies) are tagged to session 3, which the flow never started`,
  touchedThree.map((e) => e.exercise_name)
);

// --- the position the banner is being handed --------------------------------
// Read for TWO days, because the flow reads the banner on two. Today is the
// canonical question — it is the day both sessions were logged on, since a live
// workout is always dated getTodayDate() whatever day the tab is showing — and
// tomorrow is the day phase 3's screenshot was taken on, because the client
// hides a plan's banner for any day that already has an entry of that plan.
// The progression query bounds logged entries at `entry_date <= <date>`, so
// both reads see the same two sessions and must agree; asserting both is what
// keeps the verdict and the screenshot answering the same question.
const { token, serverUrl } = await qaSignIn();
const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA');

/** The active read's position for one day, as the banner on that day gets it. */
async function positionOn(date) {
  const res = await fetch(
    `${serverUrl}/api/workout-plan-templates/active/${date}`,
    { headers: { origin: serverUrl, authorization: `Bearer ${token}` } }
  );
  const plans = res.ok ? await res.json() : null;
  const plan = Array.isArray(plans)
    ? plans.find((p) => p.plan_name === PLAN_NAME)
    : null;
  return { status: res.status, position: plan?.sequence_position ?? null };
}

const todayRead = await positionOn(today);
const tomorrowRead = await positionOn(tomorrow);

if (
  !report.check(
    'banner.plan-is-still-active-on-both-days',
    todayRead.position !== null && tomorrowRead.position !== null,
    todayRead.position === null || tomorrowRead.position === null
      ? `the plan is absent from an active read (${today}: HTTP ${todayRead.status}, ${tomorrow}: HTTP ${tomorrowRead.status})`
      : 'the plan is active on both days and carries a sequence position on each',
    { [today]: todayRead, [tomorrow]: tomorrowRead }
  )
) {
  report.finish(runDir);
}

/** Whether a read still sits on session 2, which is the whole question. */
const holds = (read) =>
  read.position.current === 2 && read.position.session_name === SESSIONS[1].name;
const describe = (date, read) =>
  `${date} ${read.position.current}/${read.position.total} "${read.position.session_name}"`;

// THE CHECK. Session 2 was started and nothing in it was completed, so the
// plan's position must still be session 2. A plan that has moved to session 3
// counted an opened workout as a finished one: the banner advances while the
// user is still warming up, and the session they are actually in the middle of
// is no longer offered anywhere.
report.check(
  'progression.a-started-session-is-not-a-finished-one',
  holds(todayRead) && holds(tomorrowRead),
  `with session 2 started and nothing logged, the banner is being told ${describe(today, todayRead)} and ${describe(tomorrow, tomorrowRead)} (expected 2/${SESSIONS.length} "${SESSIONS[1].name}" on both)`,
  {
    [today]: todayRead.position,
    [tomorrow]: tomorrowRead.position,
    completedSetsInStartedSession: secondCompleted,
    startedAssignment: secondTag?.id ?? null,
  }
);

report.finish(runDir);
