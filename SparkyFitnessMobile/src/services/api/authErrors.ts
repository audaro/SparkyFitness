/**
 * Auth error types, kept in their own module (free of `better-auth` and other
 * heavy imports) so consumers — and especially tests that only need the error
 * class — can import it without pulling the whole auth service into their
 * module graph.
 */
import type { TFunction } from 'i18next';

export class LoginError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    /**
     * The server's machine-readable error code, when the response carried one.
     * `parseAuthError` folds the code into the human-readable message for
     * display; keeping it here as well is what lets callers classify a failure
     * by what the server said rather than by searching its prose.
     */
    public code?: string
  ) {
    super(message);
    this.name = 'LoginError';
  }
}

/** better-auth's code for a two-factor cookie that is missing or no longer valid. */
export const STALE_TWO_FACTOR_CODE = 'INVALID_TWO_FACTOR_COOKIE';

/**
 * What went wrong signing in, as the three MFA screens need to act on it.
 *
 * `auth-failed` and `unknown` differ only in what the user is told: the first
 * is a `LoginError` we could not place, the second is something that never
 * reached the auth service at all.
 */
export type LoginFailure =
  | 'rate-limited'
  | 'invalid-code'
  | 'stale-two-factor-session'
  | 'auth-failed'
  | 'unknown';

/**
 * Classifies a sign-in / MFA-verification failure.
 *
 * `OnboardingScreen`, `ReauthModal` and `ServerConfigModal` each carried their
 * own copy of this ladder. They had already drifted: two guarded the stale-cookie
 * branch on the error having come from a server response and one did not.
 */
export function classifyLoginError(error: unknown): LoginFailure {
  if (!(error instanceof LoginError)) {
    return 'unknown';
  }

  if (error.statusCode === 429) {
    return 'rate-limited';
  }

  if (error.message.toLowerCase().includes('invalid code')) {
    return 'invalid-code';
  }

  // A `LoginError` with no status never came from a server response — an HTTPS
  // refusal, a cancelled passkey or SSO prompt, a 200 whose body was missing its
  // token. There is no server code to read, and the prose match below would let
  // one of those clear the user's cookies for saying "expired".
  if (error.statusCode === undefined) {
    return 'auth-failed';
  }

  if (
    error.code === STALE_TWO_FACTOR_CODE ||
    // The message fallbacks stay because the code arrives from better-auth, not
    // from this repo's server, so nothing here can promise the `code` field is
    // populated on every shape of that response.
    error.message.includes(STALE_TWO_FACTOR_CODE) ||
    error.message.toLowerCase().includes('invalid two factor cookie') ||
    error.message.includes('expired')
  ) {
    return 'stale-two-factor-session';
  }

  return 'auth-failed';
}

/** The user-facing message for a `LoginFailure`, identical across the three screens. */
export function loginErrorMessage(failure: LoginFailure, t: TFunction): string {
  switch (failure) {
    case 'rate-limited':
      return t('auth.errors.tooManyAttempts', {
        defaultValue: 'Too many attempts. Please wait a moment and try again.',
      });
    case 'invalid-code':
      return t('auth.errors.invalidVerificationCode', {
        defaultValue: 'Invalid verification code. Please try again.',
      });
    case 'stale-two-factor-session':
      return t('auth.errors.sessionExpired', {
        defaultValue: 'Your session has expired. Please sign in again.',
      });
    case 'auth-failed':
      return t('auth.errors.generic', {
        defaultValue: 'Authentication failed. Please try again.',
      });
    case 'unknown':
      return t('auth.errors.verificationFailed', {
        defaultValue: 'Verification failed. Please try again.',
      });
  }
}
