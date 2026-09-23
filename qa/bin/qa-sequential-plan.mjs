#!/usr/bin/env node
/**
 * Give the QA account a three-session SEQUENTIAL workout plan to run.
 *
 * A sequential plan is the one workout-plan shape a UI flow cannot produce on
 * this app: the mobile client can start a plan's session and can see the
 * banner, but the plan itself is authored on the web frontend, so a scenario
 * that needed one had nothing to drive. Everything here is what a person would
 * have built there — three presets and a plan pointing at them, in that order,
 * because an assignment naming a preset that does not exist is rejected
 * server-side (validateAndNormalizeAssignments).
 *
 * Created through the real API with a real session, like qa-exercise-catalog.mjs
 * and for the same reason: rows written behind the server's back stop
 * resembling rows the app makes the moment the endpoint gains a column — and
 * `schedule_type`/`entry_mode`/`session_index` are new columns on exactly these
 * tables. Verified out of the database afterwards, because a 201 from the API
 * under test is not evidence about the API under test.
 *
 * It assumes qa-exercise-catalog.mjs has already run; the presets are built out
 * of that catalog and this fails loudly rather than inventing exercises of its
 * own.
 */
import { execFileSync } from 'node:child_process';
import { qaSignIn } from './qa-session.mjs';
import {
  PLAN_NAME,
  SESSIONS,
  SETS_PER_EXERCISE,
  catalogExerciseName,
  presetName,
} from '../fixtures/sequential-plan.mjs';

const { QA_SERVER_URL, QA_DB_CONTAINER, QA_DB_USER, QA_DB_NAME, QA_DB_PASSWORD } =
  process.env;
if (!QA_DB_CONTAINER) {
  console.error('!! QA_DB_CONTAINER is unset — run this through qa-run.sh, or source qa/bin/qa-env.sh first.');
  process.exit(1);
}

function sql(queryText) {
  return execFileSync(
    'docker',
    ['exec', '-e', `PGPASSWORD=${QA_DB_PASSWORD}`, QA_DB_CONTAINER,
      'psql', '-U', QA_DB_USER, '-d', QA_DB_NAME, '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', queryText],
    { encoding: 'utf8' }
  ).trim();
}

const { token } = await qaSignIn();

async function api(path, body) {
  const res = await fetch(`${QA_SERVER_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: QA_SERVER_URL,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`!! POST ${path} failed (${res.status}): ${await res.text()}`);
    process.exit(1);
  }
  return res.json();
}

// --- the exercises the presets are built from -------------------------------
// Looked up by name out of the database rather than taken from a create
// response, because the catalog is seeded by a different script and a plan
// built on ids this run happened to mint would hide a reset that did not empty
// the table.
const wanted = [...new Set(SESSIONS.flatMap((s) => s.muscles.map(catalogExerciseName)))];
const rows = sql(
  `SELECT name || '=' || id FROM exercises WHERE name IN (${wanted.map((n) => `'${n.replace(/'/g, "''")}'`).join(', ')})`
)
  .split('\n')
  .filter(Boolean);
const exerciseIdByName = new Map(rows.map((row) => row.split('=')));
for (const name of wanted) {
  if (!exerciseIdByName.has(name)) {
    console.error(`!! no seeded exercise named "${name}" — run qa-exercise-catalog.mjs first.`);
    process.exit(1);
  }
}

// --- one preset per session -------------------------------------------------
// The sets carry reps and a weight so the session the plan starts has a
// prescription to render as placeholders; the oracle's claim about which of
// those numbers got STORED is only meaningful if there were numbers to store.
const presetIdBySession = new Map();
for (const session of SESSIONS) {
  const preset = await api('/api/workout-presets', {
    name: presetName(session),
    description: `QA sequential plan session ${session.index}`,
    exercises: session.muscles.map((muscle, i) => ({
      exercise_id: exerciseIdByName.get(catalogExerciseName(muscle)),
      sort_order: i,
      sets: Array.from({ length: SETS_PER_EXERCISE }, (_unused, setIndex) => ({
        set_number: setIndex + 1,
        set_type: 'normal',
        reps: 10,
        weight: 20,
        rest_time: 60,
      })),
    })),
  });
  presetIdBySession.set(session.index, preset.id);
}

// --- the plan ---------------------------------------------------------------
// The device's calendar day, because the app dates everything by it and the
// simulator shares this machine's timezone. A plan whose start_date is in the
// future is filtered out of the active read and the banner never appears.
const today = new Date().toLocaleDateString('en-CA');

const plan = await api('/api/workout-plan-templates', {
  plan_name: PLAN_NAME,
  description: 'QA sequential rotation',
  start_date: today,
  end_date: null,
  is_active: true,
  // The two columns this scenario exists for. `prompt` is the default entry
  // mode and the one the mobile banner drives: the session is started as a live
  // workout rather than pre-written into the diary.
  schedule_type: 'sequential',
  entry_mode: 'prompt',
  assignments: SESSIONS.map((session) => ({
    session_index: session.index,
    session_name: session.name,
    workout_preset_id: presetIdBySession.get(session.index),
    sort_order: 0,
  })),
  currentClientDate: today,
});

// --- verify, from the database ----------------------------------------------
const stored = sql(
  `SELECT t.schedule_type || ' ' || t.entry_mode || ' ' || t.is_active::text || ' ' || count(a.id)::text || ' ' || count(a.day_of_week)::text || ' ' || count(a.workout_preset_id)::text
     FROM workout_plan_templates t
     LEFT JOIN workout_plan_template_assignments a ON a.template_id = t.id
    WHERE t.id = ${Number(plan.id)}
    GROUP BY t.id, t.schedule_type, t.entry_mode, t.is_active`
);
// day_of_week is counted rather than compared: count() skips NULLs, so 0 here
// is the assertion that the sequential path really nulled every day — a
// sequential plan that kept a weekday would be resolved as a weekly one on
// whichever day that was, and as nothing at all on the other six.
const expected = `sequential prompt true ${SESSIONS.length} 0 ${SESSIONS.length}`;
if (stored !== expected) {
  console.error(`!! stored plan is "${stored}", expected "${expected}".`);
  console.error('   (schedule_type entry_mode is_active assignments non-null-days preset-backed)');
  process.exit(1);
}

const sessionIndices = sql(
  `SELECT string_agg(session_index::text, ',' ORDER BY session_index) FROM workout_plan_template_assignments WHERE template_id = ${Number(plan.id)}`
);
if (sessionIndices !== SESSIONS.map((s) => s.index).join(',')) {
  console.error(`!! assignments carry session indices "${sessionIndices}", expected "${SESSIONS.map((s) => s.index).join(',')}".`);
  process.exit(1);
}

console.log(
  `==> seeded sequential plan ${plan.id} "${PLAN_NAME}" — ${SESSIONS.length} sessions (${SESSIONS.map((s) => s.name).join(' -> ')}), starting ${today}`
);
