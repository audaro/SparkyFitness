import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const ENV_KEYS = [
  'SPARKY_FITNESS_DB_HOST',
  'SPARKY_FITNESS_DB_NAME',
  'SPARKY_FITNESS_DB_USER',
  'SPARKY_FITNESS_DB_PASSWORD',
  'SPARKY_FITNESS_APP_DB_USER',
  'SPARKY_FITNESS_APP_DB_PASSWORD',
  'SPARKY_FITNESS_FRONTEND_URL',
  'SPARKY_FITNESS_API_ENCRYPTION_KEY',
  'BETTER_AUTH_SECRET',
] as const;

/**
 * Fixture values are minted per run rather than written as literals. Nothing
 * here is a credential — they only need to be non-empty so preflight proceeds
 * to the checks under test — and generating them keeps password-shaped strings
 * out of the source entirely, which is what secret scanners match on.
 */
const fixture = (label: string) =>
  `${label}-${crypto.randomBytes(8).toString('hex')}`;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  // the hard requirements, so only the app credentials are under test
  process.env.SPARKY_FITNESS_DB_HOST = 'localhost';
  process.env.SPARKY_FITNESS_DB_NAME = 'sparkyfitness_db';
  process.env.SPARKY_FITNESS_DB_USER = 'sparky';
  process.env.SPARKY_FITNESS_DB_PASSWORD = fixture('db');
  process.env.SPARKY_FITNESS_FRONTEND_URL = 'http://localhost:3004';
  process.env.SPARKY_FITNESS_API_ENCRYPTION_KEY = crypto
    .randomBytes(32)
    .toString('hex');
  process.env.BETTER_AUTH_SECRET = fixture('auth');
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('app database credentials are soft requirements', () => {
  it('starts without them and fills in a default user and a generated password', async () => {
    const { runPreflightChecks } = (await import('../utils/preflightChecks.js'))
      .default;
    expect(() => runPreflightChecks()).not.toThrow();
    expect(process.env.SPARKY_FITNESS_APP_DB_USER).toBe('sparky_app');
    expect(process.env.SPARKY_FITNESS_APP_DB_PASSWORD).toMatch(
      /^[0-9a-f]{64}$/
    );
  });

  it('treats the empty string from docker-compose as absent', async () => {
    // compose passes `${SPARKY_FITNESS_APP_DB_PASSWORD:-}`, so the variable
    // arrives defined but empty rather than missing. This is the common path.
    process.env.SPARKY_FITNESS_APP_DB_USER = '';
    process.env.SPARKY_FITNESS_APP_DB_PASSWORD = '';
    const { runPreflightChecks } = (await import('../utils/preflightChecks.js'))
      .default;
    expect(() => runPreflightChecks()).not.toThrow();
    expect(process.env.SPARKY_FITNESS_APP_DB_USER).toBe('sparky_app');
    expect(process.env.SPARKY_FITNESS_APP_DB_PASSWORD).toMatch(
      /^[0-9a-f]{64}$/
    );
  });

  it('leaves supplied values untouched', async () => {
    const suppliedPassword = fixture('app');
    process.env.SPARKY_FITNESS_APP_DB_USER = 'my_app_role';
    process.env.SPARKY_FITNESS_APP_DB_PASSWORD = suppliedPassword;
    const { runPreflightChecks } = (await import('../utils/preflightChecks.js'))
      .default;
    runPreflightChecks();
    expect(process.env.SPARKY_FITNESS_APP_DB_USER).toBe('my_app_role');
    expect(process.env.SPARKY_FITNESS_APP_DB_PASSWORD).toBe(suppliedPassword);
  });

  it('generates a different password on each run', async () => {
    const { runPreflightChecks } = (await import('../utils/preflightChecks.js'))
      .default;
    runPreflightChecks();
    const first = process.env.SPARKY_FITNESS_APP_DB_PASSWORD;
    delete process.env.SPARKY_FITNESS_APP_DB_PASSWORD;
    runPreflightChecks();
    expect(process.env.SPARKY_FITNESS_APP_DB_PASSWORD).not.toBe(first);
  });

  it('defaults the connection details docker-compose normally supplies', async () => {
    for (const k of [
      'SPARKY_FITNESS_DB_HOST',
      'SPARKY_FITNESS_DB_NAME',
      'SPARKY_FITNESS_DB_USER',
    ]) {
      delete process.env[k];
    }
    const { runPreflightChecks } = (await import('../utils/preflightChecks.js'))
      .default;
    expect(() => runPreflightChecks()).not.toThrow();
    expect(process.env.SPARKY_FITNESS_DB_HOST).toBe('sparkyfitness-db');
    expect(process.env.SPARKY_FITNESS_DB_NAME).toBe('sparkyfitness_db');
    expect(process.env.SPARKY_FITNESS_DB_USER).toBe('sparky');
  });

  it('never overrides connection details that were supplied', async () => {
    process.env.SPARKY_FITNESS_DB_HOST = 'db.internal';
    process.env.SPARKY_FITNESS_DB_NAME = 'custom_db';
    process.env.SPARKY_FITNESS_DB_USER = 'custom_user';
    const { runPreflightChecks } = (await import('../utils/preflightChecks.js'))
      .default;
    runPreflightChecks();
    expect(process.env.SPARKY_FITNESS_DB_HOST).toBe('db.internal');
    expect(process.env.SPARKY_FITNESS_DB_NAME).toBe('custom_db');
    expect(process.env.SPARKY_FITNESS_DB_USER).toBe('custom_user');
  });

  it('still refuses to start without a genuinely mandatory variable', async () => {
    delete process.env.SPARKY_FITNESS_API_ENCRYPTION_KEY;
    const { runPreflightChecks } = (await import('../utils/preflightChecks.js'))
      .default;
    expect(() => runPreflightChecks()).toThrow(/mandatory environment/i);
  });

  it('refuses to start without BETTER_AUTH_SECRET rather than inventing one', async () => {
    // It signs session cookies and encrypts stored 2FA secrets. Generating a
    // fresh one each boot logs everyone out and locks out 2FA users for good,
    // so an absent value has to stop the server instead.
    delete process.env.BETTER_AUTH_SECRET;
    const { runPreflightChecks } = (await import('../utils/preflightChecks.js'))
      .default;
    expect(() => runPreflightChecks()).toThrow(/mandatory environment/i);
    expect(process.env.BETTER_AUTH_SECRET).toBeUndefined();
  });
});
