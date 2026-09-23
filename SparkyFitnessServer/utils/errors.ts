export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * True when `error` is a Postgres unique violation (23505) on a constraint
 * whose name contains "name" — a duplicate user-visible name. Callers turn
 * this into a user-correctable conflict (HTTP 409, chat validation message)
 * instead of a 500.
 */
export function isDuplicateNameError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505' &&
    String((error as { constraint?: string }).constraint ?? '').includes('name')
  );
}
// A thrown value only has to be renderable, not an Error, and `error.message`
// on its own is not always enough to diagnose one. Node's Happy Eyeballs
// connector rejects with an `AggregateError` whose `message` is the empty
// string and whose real causes sit in `errors[]`. axios already flattens that
// case into its own message, so the axios paths are covered without this; what
// is not covered is everything else that reaches a `${error.message}` log line
// -- native fetch/undici rejections, database errors, and values that are not
// Errors at all. Interpolating one of those can still produce a bare
// `Error exchanging Withings code for tokens:` with nothing after it, which is
// what issue #2285 reported before the axios upgrade. Unwrap the aggregate and
// the `cause` chain, fall back to the syscall `code`, and never return an
// empty string.
const MAX_CAUSE_DEPTH = 3;
const MAX_CAUSES_PER_LEVEL = 4;

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  errors?: unknown;
  cause?: unknown;
}

function collectCauses(candidate: ErrorLike, depth: number): unknown[] {
  if (depth >= MAX_CAUSE_DEPTH) {
    return [];
  }
  // AggregateError carries siblings in `errors`; everything else chains
  // through the single `cause` added in ES2022.
  if (Array.isArray(candidate.errors)) {
    return candidate.errors.slice(0, MAX_CAUSES_PER_LEVEL);
  }
  return candidate.cause === undefined || candidate.cause === null
    ? []
    : [candidate.cause];
}

function describeErrorAtDepth(error: unknown, depth: number): string {
  if (typeof error !== 'object' || error === null) {
    return String(error ?? '').trim() || 'unknown error';
  }
  const candidate = error as ErrorLike;
  const message =
    typeof candidate.message === 'string' ? candidate.message.trim() : '';
  const code = typeof candidate.code === 'string' ? candidate.code.trim() : '';
  const head = [message, code && !message.includes(code) ? `(${code})` : '']
    .filter(Boolean)
    .join(' ');

  const detail = collectCauses(candidate, depth)
    .map((cause) => describeErrorAtDepth(cause, depth + 1))
    .filter((text) => text && text !== 'unknown error')
    .join('; ');

  if (head && detail) {
    return `${head} [${detail}]`;
  }
  return (
    head || detail || (error instanceof Error && error.name) || 'unknown error'
  );
}

/**
 * Renders any thrown value as a log-safe, always non-empty string.
 * Prefer this over `error.message` when logging a failure that may have come
 * from an outbound network call.
 */
function describeError(error: unknown): string {
  return describeErrorAtDepth(error, 0);
}

export { describeError };
