import crypto from 'crypto';
import { log } from '../config/logging.js';

/**
 * Defaults shared with docker-compose and the tracked .env templates. Keep the
 * three in step: a value that differs between them silently points the server
 * at a database other than the one Compose created.
 */
export const DEFAULT_APP_DB_USER = 'sparky_app';
const DEFAULTED_VARS: Record<string, string> = {
  SPARKY_FITNESS_DB_HOST: 'sparkyfitness-db',
  SPARKY_FITNESS_DB_NAME: 'sparkyfitness_db',
  SPARKY_FITNESS_DB_USER: 'sparky',
};

function runPreflightChecks() {
  // Connection details that docker-compose already supplies, so they only ever
  // fall back here on a bare-metal or external-database install. Defaulting
  // rather than refusing keeps a Compose deployment working with nothing but
  // the secrets set, which is what the .env templates and the generator assume.
  for (const [varName, fallback] of Object.entries(DEFAULTED_VARS)) {
    if (!process.env[varName]) {
      process.env[varName] = fallback;
      log(
        'info',
        `${varName} was not set; using "${fallback}". Set it explicitly for a bare-metal or external database.`
      );
    }
  }
  const mandatoryVars = {
    SPARKY_FITNESS_DB_PASSWORD: 'Required for database connection.',
    SPARKY_FITNESS_FRONTEND_URL:
      'Required for CORS security. E.g. https://sparkyfitness.domain.com  or http://localhost:8080 for development.',
    SPARKY_FITNESS_API_ENCRYPTION_KEY:
      "Must be persistent to decrypt database data. Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    BETTER_AUTH_SECRET:
      'Signs session cookies and encrypts stored 2FA/TOTP secrets, so it must be persistent. A value that changes between restarts logs every user out and permanently locks out anyone with 2FA enabled. Generate with: openssl rand -base64 32',
  };
  const missingMandatory = Object.keys(mandatoryVars).filter(
    (varName) => !process.env[varName]
  );
  if (missingMandatory.length > 0) {
    console.error(
      '\x1b[31m%s\x1b[0m',
      'FATAL: Missing required environment variables!'
    );
    console.error('The server cannot start without the following settings:\n');
    missingMandatory.forEach((varName) => {
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      console.error(`\x1b[33m${varName}\x1b[0m: ${mandatoryVars[varName]}`);
    });
    console.error('\nUpdate your .env file and restart the server.\n');
    log(
      'error',
      `FATAL: Missing mandatory env vars: ${missingMandatory.join(', ')}`
    );
    throw new Error(
      'Preflight checks failed: Missing mandatory environment variables.'
    );
  }
  // The application database role is provisioned by the server itself, so both
  // of these are soft requirements: when absent we pick a default name and mint
  // a password, and `applyMigrations` creates or updates the role to match.
  //
  // This must happen here, before `db/poolManager.ts` is ever imported, because
  // that module builds both pools at module load and freezes whatever it reads.
  // `tests/bootOrder.test.ts` guards the ordering that makes this safe.
  if (!process.env.SPARKY_FITNESS_APP_DB_USER) {
    process.env.SPARKY_FITNESS_APP_DB_USER = DEFAULT_APP_DB_USER;
    log(
      'info',
      `SPARKY_FITNESS_APP_DB_USER was not set; using "${DEFAULT_APP_DB_USER}".`
    );
  }
  if (!process.env.SPARKY_FITNESS_APP_DB_PASSWORD) {
    process.env.SPARKY_FITNESS_APP_DB_PASSWORD = crypto
      .randomBytes(32)
      .toString('hex');
    log(
      'info',
      'SPARKY_FITNESS_APP_DB_PASSWORD was not set; generated one for this run ' +
        'and the application role will be updated to match. Set it explicitly ' +
        'if more than one server shares this database.'
    );
  }
  log('info', 'Environment variable pre-flight checks passed successfully.');
}
export { runPreflightChecks };
export default {
  runPreflightChecks,
};
