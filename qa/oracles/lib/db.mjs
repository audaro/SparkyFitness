/**
 * The database oracle: the reason this harness is worth building.
 *
 * A screenshot tells you the app rendered something. A row tells you what it
 * actually persisted — in which unit, on which calendar day, under which user.
 * Every class of bug this codebase has historically shipped (unit drift, a
 * day-string shifted by a timezone, a wholesale-replace clobbering keys it did
 * not write) is invisible on screen and obvious here.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const container = process.env.QA_DB_CONTAINER;
const dbUser = process.env.QA_DB_USER;
const dbName = process.env.QA_DB_NAME;
const dbPassword = process.env.QA_DB_PASSWORD;

/** Runs SQL against the QA database and returns parsed JSON rows. */
export function query(sql) {
  // json_agg round-trips types honestly (numerics stay numbers, dates stay
  // ISO strings); psql's aligned text output would force every assertion to
  // re-parse formatted text and quietly turn 0.5 into "0.5".
  const wrapped = `SELECT coalesce(json_agg(t), '[]'::json) FROM (${sql}) t`;
  const out = execFileSync(
    'docker',
    ['exec', '-e', `PGPASSWORD=${dbPassword}`, container,
      'psql', '-U', dbUser, '-d', dbName, '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', wrapped],
    { encoding: 'utf8' }
  );
  return JSON.parse(out.trim() || '[]');
}

/** The throwaway account, as written by qa-seed.mjs. */
export function qaAccount() {
  const file = process.env.QA_ACCOUNT_FILE;
  if (!file) throw new Error('QA_ACCOUNT_FILE is unset — source qa/bin/qa-env.sh');
  const account = JSON.parse(readFileSync(file, 'utf8'));
  if (!account.userId) throw new Error(`no userId in ${file} — run qa-seed.mjs`);
  return account;
}

/**
 * A literal for interpolation into a QA-only query. The harness builds SQL by
 * hand because it runs `psql` in a container rather than holding a driver
 * connection; this keeps a stray quote from turning a failed assertion into a
 * confusing syntax error.
 */
export function lit(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}
