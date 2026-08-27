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
