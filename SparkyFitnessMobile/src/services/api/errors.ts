import { TimeoutError } from '../../utils/concurrency';
import i18n from '../../localization/i18n';

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public body?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * True when `error` is an `ApiError` carrying exactly this HTTP status.
 *
 * The alternative callers reach for is `error.message.includes('409')`, which
 * reads the status out of the human-readable message `apiFetch` builds as
 * `Server error: ${status} - ${body}`. That also matches when the *body* merely
 * contains those digits — an id, a count, a quoted value — and an unrelated
 * failure is then reported to the user as the specific one it was screening
 * for. The status is a field on the error; read the field.
 */
export function hasApiStatus(error: unknown, statusCode: number): boolean {
  return error instanceof ApiError && error.statusCode === statusCode;
}

export function getApiErrorMessage(error: unknown): string | null {
  if (error instanceof TimeoutError) {
    return i18n.t('common.requestTimedOut', { defaultValue: 'Request timed out. Check your server connection.' });
  }
  if (!(error instanceof ApiError) || !error.body) return null;
  try {
    const parsed = JSON.parse(error.body);
    if (typeof parsed?.error === 'string') return parsed.error;
    if (typeof parsed?.message === 'string') return parsed.message;
  } catch {
    // body wasn't JSON — fall through
  }
  return null;
}
