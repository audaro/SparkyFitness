/**
 * The local calendar day an instant falls on, worked out from `Date` directly
 * rather than through whatever helper is under test.
 *
 * Health records are dated by their **device-local** day, so an expected date
 * can only be written as a literal when the instant lands on the same day in
 * every zone — and no instant does: UTC-11 and UTC+14 are 25 hours apart.
 * Picking a "safe-looking" time only moves which machines the test fails on.
 * The assertions using this were all literals that passed in UTC, where CI
 * runs, and failed on a developer machine outside it.
 *
 * Not exported from `src/`: this is the independent second implementation that
 * makes the assertion worth something. Importing the production helper would
 * only assert it agrees with itself.
 */
export const localDay = (iso: string): string => {
  const at = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};
