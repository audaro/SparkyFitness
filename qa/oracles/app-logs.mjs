#!/usr/bin/env node
/**
 * The cheapest broad oracle in the harness: drain the app's own log and fail on
 * anything it recorded as ERROR.
 *
 * `services/LogService.ts` already writes structured entries at DEBUG / INFO /
 * WARNING / ERROR into AsyncStorage under `app_logs`, and most screens are
 * wrapped in error boundaries that log on the way down. So every scenario gets
 * crash-and-exception coverage for free, across features the flow never even
 * visited — no assertions to write, and it scales to all 73 screens on its own.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createReport } from './lib/report.mjs';

const report = createReport('app-logs');
const runDir = process.env.QA_RUN_DIR;
const bundleId = process.env.QA_APP_BUNDLE_ID;

const container = execFileSync(
  'xcrun',
  ['simctl', 'get_app_container', 'booted', bundleId, 'data'],
  { encoding: 'utf8' }
).trim();

// @react-native-async-storage/async-storage keeps its store under Application
// Support on current versions and under Documents on older ones. Both are
// checked because the difference is invisible from the app's side and would
// otherwise surface as "the app never launched" on a run that went fine.
const CANDIDATE_STORE_DIRS = [
  join(container, 'Library', 'Application Support', bundleId, 'RCTAsyncLocalStorage_V1'),
  join(container, 'Documents', 'RCTAsyncLocalStorage_V1'),
];
const storeDir = CANDIDATE_STORE_DIRS.find((dir) => existsSync(join(dir, 'manifest.json')));
if (!storeDir) {
  // The app never wrote a single AsyncStorage key, which means it never really
  // ran. That is a harness failure, not a clean result — say so rather than
  // reporting "0 errors" and looking green.
  report.check('app-logs.readable', false, 'app never wrote AsyncStorage; did it launch?', {
    searched: CANDIDATE_STORE_DIRS,
  });
  report.finish(runDir);
}
const manifestPath = join(storeDir, 'manifest.json');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const LOG_KEY = 'app_logs';

function readKey(key) {
  const inline = manifest[key];
  if (typeof inline === 'string') return inline;
  // AsyncStorage spills values over ~1 KB into a file named by the MD5 of the
  // key and leaves null in the manifest. The log is always in that shape; the
  // inline branch exists so a nearly-empty run still reads correctly.
  const spilled = join(storeDir, createHash('md5').update(key).digest('hex'));
  return existsSync(spilled) ? readFileSync(spilled, 'utf8') : null;
}

const raw = readKey(LOG_KEY);
const entries = raw ? JSON.parse(raw) : [];

// LogService migrates legacy `level`/`SUCCESS` values on read; the stored blob
// can still carry either shape, so normalize the same way before filtering.
const normalized = entries.map((e) => ({
  ...e,
  status: e.level === 'debug' ? 'DEBUG' : e.status === 'SUCCESS' ? 'INFO' : (e.status ?? 'INFO'),
}));

const errors = normalized.filter((e) => e.status === 'ERROR');
const warnings = normalized.filter((e) => e.status === 'WARNING');

report.check(
  'app-logs.no-errors',
  errors.length === 0,
  `${errors.length} ERROR entr${errors.length === 1 ? 'y' : 'ies'} in the app log`,
  errors.slice(0, 20).map((e) => ({ at: e.timestamp, message: e.message, details: e.details }))
);

// Warnings are real signal but far too noisy to gate on — a locked device or an
// unreachable optional provider logs one legitimately.
if (warnings.length > 0) {
  report.observe(
    'app-logs.warnings',
    `${warnings.length} WARNING entries`,
    warnings.slice(0, 20).map((e) => ({ at: e.timestamp, message: e.message }))
  );
}

report.finish(runDir);
