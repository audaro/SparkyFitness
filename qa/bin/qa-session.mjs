/**
 * A signed-in session for the QA account, and the account it belongs to.
 *
 * Three setup scripts need a bearer token to write through the real API rather
 * than behind the server's back (qa-ai-service.mjs, qa-exercise-catalog.mjs and
 * qa-gym-profile.mjs), and they were signing in with the same fifteen lines
 * each. The third copy is what made this a module: the repo's rule is to
 * extract on the second duplication, and a sign-in that drifts between callers
 * is the kind of thing that produces one scenario seeded as the QA user and
 * another seeded as nobody.
 */
import { readFileSync } from 'node:fs';

/**
 * Sign in as the QA account and return its token alongside the account record.
 *
 * Exits the process on failure rather than throwing. Every caller is a setup
 * script whose only sensible response to "the QA account cannot sign in" is to
 * stop the run before it seeds half a fixture — and a seeded-but-wrong database
 * is the failure mode this harness exists to avoid.
 */
export async function qaSignIn() {
  const { QA_SERVER_URL, QA_ACCOUNT_FILE } = process.env;
  if (!QA_SERVER_URL || !QA_ACCOUNT_FILE) {
    console.error(
      '!! QA_SERVER_URL and QA_ACCOUNT_FILE must be set — run this through qa-run.sh, or source qa/bin/qa-env.sh first.'
    );
    process.exit(1);
  }

  const account = JSON.parse(readFileSync(QA_ACCOUNT_FILE, 'utf8'));

  // Better Auth rejects a state-changing request with no Origin, and hands back
  // the same bearer token the mobile app signs in with.
  const signIn = await fetch(`${QA_SERVER_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: QA_SERVER_URL },
    body: JSON.stringify({ email: account.email, password: account.password }),
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
  return { token, account, serverUrl: QA_SERVER_URL };
}
