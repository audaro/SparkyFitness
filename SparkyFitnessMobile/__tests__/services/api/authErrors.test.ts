import {
  classifyLoginError,
  loginErrorMessage,
  LoginError,
  STALE_TWO_FACTOR_CODE,
  type LoginFailure,
} from '../../../src/services/api/authErrors';

/** Stands in for `t`, returning the English fallback the caller supplied. */
const t = ((_key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? '') as never;

describe('classifyLoginError', () => {
  test('429 is rate limiting, whatever the body says', () => {
    // Checked before anything reads the message: a rate-limit body is free to
    // mention an expired window without that meaning the cookie is stale.
    expect(classifyLoginError(new LoginError('too many requests; expired', 429))).toBe(
      'rate-limited',
    );
  });

  test('a bad verification code is called out specifically', () => {
    expect(classifyLoginError(new LoginError('Invalid code', 400))).toBe('invalid-code');
  });

  test('the code match is case-insensitive', () => {
    expect(classifyLoginError(new LoginError('INVALID CODE', 400))).toBe('invalid-code');
  });

  describe('a stale two-factor session', () => {
    test('is read from the code the server sent', () => {
      // The point of carrying `code`: no substring of the prose is involved.
      const error = new LoginError('Something went wrong', 401, STALE_TWO_FACTOR_CODE);

      expect(classifyLoginError(error)).toBe('stale-two-factor-session');
    });

    test('is still recognized from the message when no code field arrives', () => {
      // better-auth owns that response shape, not this repo's server, so nothing
      // here can promise `code` is populated on every variant of it.
      expect(classifyLoginError(new LoginError(STALE_TWO_FACTOR_CODE, 401))).toBe(
        'stale-two-factor-session',
      );
    });

    test('is recognized from the spelled-out message, case-insensitively', () => {
      expect(classifyLoginError(new LoginError('Invalid Two Factor Cookie', 401))).toBe(
        'stale-two-factor-session',
      );
    });

    test('is recognized from a message that only says the session expired', () => {
      expect(classifyLoginError(new LoginError('Session expired', 401))).toBe(
        'stale-two-factor-session',
      );
    });
  });

  describe('errors that never reached the server', () => {
    // A LoginError with no status is a local refusal — an HTTPS guard, a
    // cancelled passkey or SSO prompt, a 200 whose body was missing its token.
    // `OnboardingScreen` used to fall through to the prose match here, so a
    // local failure that happened to say "expired" would clear the user's
    // cookies and bounce them back a step. The other two screens guarded it.
    test('do not classify as a stale session even when the message says expired', () => {
      expect(classifyLoginError(new LoginError('Your passkey expired'))).toBe('auth-failed');
    });

    test('are still rate-limit-free and code-free — just an auth failure', () => {
      expect(
        classifyLoginError(new LoginError('A secure (HTTPS) server URL is required to sign in.')),
      ).toBe('auth-failed');
    });

    test('an invalid code is still named before the no-status guard', () => {
      // The guard sits below the invalid-code branch on purpose: that one reads
      // the message the user needs regardless of where the error came from.
      expect(classifyLoginError(new LoginError('invalid code'))).toBe('invalid-code');
    });
  });

  test('a LoginError nothing matches is a generic auth failure', () => {
    expect(classifyLoginError(new LoginError('Sign-in failed: 500 - boom', 500))).toBe(
      'auth-failed',
    );
  });

  test('anything that is not a LoginError is unknown, not an auth failure', () => {
    // The two get different messages: "Verification failed" for something that
    // never reached the auth service, "Authentication failed" for a rejection.
    expect(classifyLoginError(new Error('INVALID_TWO_FACTOR_COOKIE'))).toBe('unknown');
    expect(classifyLoginError(undefined)).toBe('unknown');
  });
});

describe('loginErrorMessage', () => {
  const cases: [LoginFailure, string][] = [
    ['rate-limited', 'Too many attempts. Please wait a moment and try again.'],
    ['invalid-code', 'Invalid verification code. Please try again.'],
    ['stale-two-factor-session', 'Your session has expired. Please sign in again.'],
    ['auth-failed', 'Authentication failed. Please try again.'],
    ['unknown', 'Verification failed. Please try again.'],
  ];

  test.each(cases)('%s reads as its own message', (failure, expected) => {
    expect(loginErrorMessage(failure, t)).toBe(expected);
  });

  test('every failure gets a distinct message', () => {
    // A collapsed pair would be invisible in the per-case assertions above.
    const messages = cases.map(([failure]) => loginErrorMessage(failure, t));

    expect(new Set(messages).size).toBe(cases.length);
  });
});
