import { ApiError } from '../../src/services/api/errors';

/**
 * What `apiFetch` actually throws, message text included.
 *
 * The message deliberately embeds the status the way `apiClient` builds it
 * (`Server error: ${status} - ${body}`), because that is the ambiguity the
 * error classifiers must not depend on: a hook that goes back to matching the
 * digits in the text would still pass its happy-path case, and only a fixture
 * carrying the real message can catch it.
 *
 * Pass a `body` containing a status-shaped number to exercise the false
 * positive directly — see the misclassification cases in the hook suites.
 */
export const apiError = (statusCode: number, body = 'nope'): ApiError =>
  new ApiError(`Server error: ${statusCode} - ${body}`, statusCode, body);

/**
 * The same, with the JSON body the server sends when it wants a specific
 * message shown — the shape `getApiErrorMessage` knows how to read.
 */
export const apiErrorWithMessage = (statusCode: number, message: string): ApiError =>
  apiError(statusCode, JSON.stringify({ error: message }));
