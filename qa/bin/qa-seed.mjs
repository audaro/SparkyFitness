#!/usr/bin/env node
/**
 * Create (or re-resolve) the throwaway account every QA flow runs as, and write
 * its identity to qa/run/qa-account.json for the oracles to read.
 *
 * The user id is resolved from the database rather than trusted from the
 * sign-up response: the oracles assert against rows keyed by user_id, and an id
 * that came from the same API being tested is not independent evidence.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const {
  QA_SERVER_URL,
  QA_ACCOUNT_EMAIL,
  QA_ACCOUNT_PASSWORD,
  QA_ACCOUNT_NAME,
  QA_ACCOUNT_FILE,
  QA_DB_CONTAINER,
  QA_DB_USER,
  QA_DB_NAME,
  QA_DB_PASSWORD,
} = process.env;

for (const [key, value] of Object.entries({
  QA_SERVER_URL,
  QA_ACCOUNT_EMAIL,
  QA_ACCOUNT_PASSWORD,
  QA_ACCOUNT_FILE,
  QA_DB_CONTAINER,
})) {
  if (!value) {
    console.error(`!! ${key} is unset — run this through qa-run.sh, or source qa/bin/qa-env.sh first.`);
    process.exit(1);
  }
}

function sql(query) {
  return execFileSync(
    'docker',
    ['exec', '-e', `PGPASSWORD=${QA_DB_PASSWORD}`, QA_DB_CONTAINER,
      'psql', '-U', QA_DB_USER, '-d', QA_DB_NAME, '-t', '-A', '-c', query],
    { encoding: 'utf8' }
  ).trim();
}

const signUp = await fetch(`${QA_SERVER_URL}/api/auth/sign-up/email`, {
  method: 'POST',
  // Better Auth rejects a state-changing request with no Origin
  // (MISSING_OR_NULL_ORIGIN); qa-env.sh puts this exact value in
  // SPARKY_FITNESS_EXTRA_TRUSTED_ORIGINS, so the two must stay in step.
  headers: { 'content-type': 'application/json', origin: QA_SERVER_URL },
  body: JSON.stringify({
    email: QA_ACCOUNT_EMAIL,
    password: QA_ACCOUNT_PASSWORD,
    name: QA_ACCOUNT_NAME,
  }),
});

if (signUp.ok) {
  console.log(`==> created QA account ${QA_ACCOUNT_EMAIL}`);
} else {
  // A re-run against a warm volume is the normal case, not an error — but a
  // genuine failure (signup disabled, server misconfigured) must not be
  // swallowed, so confirm the account actually exists before continuing.
  const body = await signUp.text();
  const existing = sql(
    `SELECT count(*) FROM public."user" WHERE email = '${QA_ACCOUNT_EMAIL.replace(/'/g, "''")}'`
  );
  if (existing !== '1') {
    console.error(`!! sign-up failed (${signUp.status}) and no such account exists: ${body}`);
    process.exit(1);
  }
  console.log(`==> QA account ${QA_ACCOUNT_EMAIL} already exists`);
}

const userId = sql(
  `SELECT id FROM public."user" WHERE email = '${QA_ACCOUNT_EMAIL.replace(/'/g, "''")}'`
);
if (!/^[0-9a-f-]{36}$/.test(userId)) {
  console.error(`!! could not resolve a user id for ${QA_ACCOUNT_EMAIL} (got: ${JSON.stringify(userId)})`);
  process.exit(1);
}

mkdirSync(dirname(QA_ACCOUNT_FILE), { recursive: true });
writeFileSync(
  QA_ACCOUNT_FILE,
  `${JSON.stringify({ email: QA_ACCOUNT_EMAIL, password: QA_ACCOUNT_PASSWORD, userId }, null, 2)}\n`
);
console.log(`==> QA user id ${userId} -> ${QA_ACCOUNT_FILE}`);
