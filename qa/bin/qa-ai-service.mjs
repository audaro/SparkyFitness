#!/usr/bin/env node
/**
 * Point the QA account's AI provider at the local stub (qa/bin/qa-ai-stub.mjs).
 *
 * This is the one piece of the food-photo scenario that cannot be done through
 * the app: AI providers are configured in the web frontend, not on mobile, so
 * an account that has never opened a browser can never reach the photo flow at
 * all — the scan screen shows its "AI photo estimates aren't set up" gate and
 * the shutter is disabled. Seeding it here is the same move qa-seed.mjs makes
 * for the account itself: state the app cannot create, created the way a user
 * would have created it — through the API, with a real session, rather than by
 * writing rows behind the server's back. Doing it by hand would also have to
 * reproduce the api_key envelope encryption, which is the kind of detail that
 * rots silently.
 *
 * The result is verified out of the database rather than trusted from the
 * response, for the same reason qa-seed.mjs re-resolves the user id: a
 * confirmation from the API under test is not evidence about the API under
 * test.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const {
  QA_SERVER_URL,
  QA_ACCOUNT_FILE,
  QA_AI_STUB_URL,
  QA_DB_CONTAINER,
  QA_DB_USER,
  QA_DB_NAME,
  QA_DB_PASSWORD,
} = process.env;

for (const [key, value] of Object.entries({
  QA_SERVER_URL,
  QA_ACCOUNT_FILE,
  QA_AI_STUB_URL,
  QA_DB_CONTAINER,
})) {
  if (!value) {
    console.error(`!! ${key} is unset — run this through qa-run.sh, or source qa/bin/qa-env.sh first.`);
    process.exit(1);
  }
}

// The provider row this creates. `custom` is the only service type whose URL
// is posted to verbatim — every other OpenAI-compatible type appends
// /chat/completions to a base URL from the server's own map — so it is the one
// that can be aimed at a stub. See openAiFamilyUrl in ai/providerDispatch.ts.
const SERVICE = {
  service_name: 'QA Photo Stub',
  service_type: 'custom',
  custom_url: QA_AI_STUB_URL,
  model_name: 'qa-stub-vision',
  is_active: true,
};

function sql(query) {
  return execFileSync(
    'docker',
    ['exec', '-e', `PGPASSWORD=${QA_DB_PASSWORD}`, QA_DB_CONTAINER,
      'psql', '-U', QA_DB_USER, '-d', QA_DB_NAME, '-t', '-A', '-c', query],
    { encoding: 'utf8' }
  ).trim();
}

const { email, password, userId } = JSON.parse(readFileSync(QA_ACCOUNT_FILE, 'utf8'));

// Better Auth rejects a state-changing request with no Origin, and hands back
// the same bearer token the mobile app signs in with.
const signIn = await fetch(`${QA_SERVER_URL}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: QA_SERVER_URL },
  body: JSON.stringify({ email, password }),
});
if (!signIn.ok) {
  console.error(`!! sign-in failed (${signIn.status}): ${await signIn.text()}`);
  process.exit(1);
}
const { token } = await signIn.json();
if (!token) {
  console.error('!! sign-in returned no session token.');
  process.exit(1);
}

const saved = await fetch(`${QA_SERVER_URL}/api/chat`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: QA_SERVER_URL,
    authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ action: 'save_ai_service_settings', service_data: SERVICE }),
});
if (!saved.ok) {
  const body = await saved.text();
  console.error(`!! could not save the AI service setting (${saved.status}): ${body}`);
  // The one failure worth naming: the server refuses a private AI URL unless
  // the operator opted in, and the stub is on loopback by definition.
  if (saved.status === 403) {
    console.error('   403 usually means ALLOW_PRIVATE_NETWORK_AI is not set — qa-env.sh exports it.');
  }
  process.exit(1);
}

// --- verify, from the database ----------------------------------------------
const rows = sql(
  `SELECT ai.id || ' ' || ai.service_type || ' ' || ai.custom_url || ' ' || ai.is_active
   FROM ai_service_settings ai
   WHERE ai.user_id = '${userId}'`
)
  .split('\n')
  .filter(Boolean);

if (rows.length !== 1) {
  console.error(`!! expected exactly 1 AI service row for the QA user, found ${rows.length}:`);
  for (const row of rows) console.error(`   ${row}`);
  process.exit(1);
}
// `||` renders the boolean as 'true'/'false', not psql's aligned-output 't'.
const [id, serviceType, customUrl, isActive] = rows[0].split(' ');
if (serviceType !== SERVICE.service_type || customUrl !== SERVICE.custom_url || isActive !== 'true') {
  console.error(`!! the AI service row is not what was asked for: ${rows[0]}`);
  process.exit(1);
}

// The mobile photo gate and the estimate route both resolve the provider
// through user_preferences first, so a row nothing points at would leave the
// shutter disabled with a perfectly good provider sitting in the table.
const active = sql(
  `SELECT coalesce(active_ai_service_id::text, '') FROM user_preferences WHERE user_id = '${userId}'`
);
if (active !== id) {
  console.error(`!! user_preferences.active_ai_service_id is ${JSON.stringify(active)}, expected ${id}`);
  process.exit(1);
}

console.log(`==> AI provider ${id} (custom) -> ${SERVICE.custom_url}`);
