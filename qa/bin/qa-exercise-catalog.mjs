#!/usr/bin/env node
/**
 * Give the QA account an exercise catalog to build workouts out of.
 *
 * A fresh QA database has no exercises at all, and the workout generator does
 * not degrade gracefully when a target muscle has no candidate — it imports one
 * from free-exercise-db over the network. So an unseeded run of the
 * suggested-workout scenario would be online, non-deterministic, and slower
 * than the thing it is testing. qa/fixtures/exercise-catalog.mjs explains the
 * shape; this puts it there.
 *
 * Created through the real API with a real session, like qa-ai-service.mjs, and
 * for the same reason: rows written behind the server's back stop resembling
 * rows the app makes the moment the endpoint gains a column. Verified out of
 * the database afterwards, because a 200 from the API under test is not
 * evidence about the API under test.
 */
import { execFileSync } from 'node:child_process';
import { qaSignIn } from './qa-session.mjs';
import { CATALOG, CATALOG_PREFIX } from '../fixtures/exercise-catalog.mjs';
import { MUSCLES } from '../../shared/src/constants/exerciseTaxonomy.ts';

// QA_SERVER_URL and QA_ACCOUNT_FILE are checked by qaSignIn; these are the ones
// this script reads for itself.
const { QA_SERVER_URL, QA_DB_CONTAINER, QA_DB_USER, QA_DB_NAME, QA_DB_PASSWORD } =
  process.env;
if (!QA_DB_CONTAINER) {
  console.error('!! QA_DB_CONTAINER is unset — run this through qa-run.sh, or source qa/bin/qa-env.sh first.');
  process.exit(1);
}

function sql(query) {
  return execFileSync(
    'docker',
    ['exec', '-e', `PGPASSWORD=${QA_DB_PASSWORD}`, QA_DB_CONTAINER,
      'psql', '-U', QA_DB_USER, '-d', QA_DB_NAME, '-t', '-A', '-c', query],
    { encoding: 'utf8' }
  ).trim();
}

const { token } = await qaSignIn();

// POST /api/exercises is multipart-only — it takes an image alongside the row,
// so the JSON goes in an `exerciseData` part rather than as the body. That is
// what SparkyFitnessMobile/src/services/api/exerciseApi.ts sends, minus the
// image nothing here has.
for (const { qaMuscle, ...exercise } of CATALOG) {
  const form = new FormData();
  form.append(
    'exerciseData',
    JSON.stringify({ ...exercise, source: 'custom', is_custom: true, shared_with_public: false })
  );
  const created = await fetch(`${QA_SERVER_URL}/api/exercises/`, {
    method: 'POST',
    headers: { origin: QA_SERVER_URL, authorization: `Bearer ${token}` },
    body: form,
  });
  if (!created.ok) {
    console.error(`!! could not create "${exercise.name}" (${created.status}): ${await created.text()}`);
    process.exit(1);
  }
}

// --- verify, from the database ----------------------------------------------
// The count is over the WHOLE table, not just the seeded prefix. That is the
// point: the oracle's "no exercise was imported from the network" check reads
// the same number afterwards, and it can only mean anything if the table held
// nothing else to begin with.
const total = Number(sql('SELECT count(*) FROM exercises'));
if (total !== CATALOG.length) {
  console.error(`!! expected exactly ${CATALOG.length} exercises after seeding, found ${total}.`);
  console.error('   Anything extra means the reset did not empty the table.');
  process.exit(1);
}

// Every canonical muscle needs a primary mover the planner will accept, or the
// generator falls back to the network for the ones that do not — silently, and
// only for the target sets that happen to include them, which is the worst way
// to find out. Counted out of the database rather than off the fixture: the
// column is text holding a JSON array, so "the array the API stored" and "the
// array the fixture sent" are not the same claim.
const covered = Number(
  sql(`SELECT count(DISTINCT lower(btrim(value)))
         FROM exercises e, jsonb_array_elements_text(e.primary_muscles::jsonb) AS t(value)
        WHERE e.name LIKE '${CATALOG_PREFIX}%'`)
);
if (covered !== MUSCLES.length) {
  console.error(`!! seeded rows cover ${covered} primary muscles, expected ${MUSCLES.length}.`);
  process.exit(1);
}

console.log(`==> seeded ${total} exercises covering all ${covered} canonical muscles as primary movers`);
