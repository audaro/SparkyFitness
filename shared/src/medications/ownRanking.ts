/**
 * Ranking for tier 1 of the medication name search — the user's own cabinet.
 *
 * The list arrives from the server ordered for the *medications page* (active first, then
 * alphabetically), which is the right order for a page someone reads top to bottom and the wrong
 * one for a dropdown that shows three or four rows. A user with a dozen medications typing "t"
 * was being offered the alphabetically first few rather than the ones they actually take.
 *
 * So the cap is applied to a list ordered by use: active first, then most recently taken, then
 * the never-taken alphabetically. Match *quality* is deliberately not a factor — a display-name
 * substring hit on a drug taken this morning is a better suggestion than a prefix hit on one that
 * has never been logged, and inventing a relevance score on top of recency would only get in the
 * way of that.
 *
 * Web and mobile both call this, so the input is structural rather than either package's
 * `Medication` type.
 */

export interface RankableMedication {
  name: string;
  display_name: string | null;
  is_active: boolean;
  /**
   * When a dose of this medication was last logged as taken, or null if none ever was.
   * Optional because only `listMedications` fills it in — a medication read on its own does not
   * carry it, and a caller with an unranked row should get alphabetical order, not a crash.
   */
  last_taken_at?: string | null;
}

/** Milliseconds since the epoch, or null for "never" and for anything unparseable. */
function takenAtMillis(medication: RankableMedication): number | null {
  const raw = medication.last_taken_at;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The cabinet rows matching `query`, best first, capped at `limit`.
 * Matching is a case-insensitive substring of the name or the display name, unchanged from what
 * the two clients were each doing inline.
 */
export function rankOwnMedications<T extends RankableMedication>(
  medications: readonly T[],
  query: string,
  limit: number,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  return medications
    .filter((med) =>
      `${med.name} ${med.display_name ?? ""}`.toLowerCase().includes(needle),
    )
    .slice()
    .sort((a, b) => {
      // A discontinued medication is never the better suggestion, however recently it was taken.
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;

      const aTaken = takenAtMillis(a);
      const bTaken = takenAtMillis(b);
      if (aTaken !== bTaken) {
        if (aTaken === null) return 1;
        if (bTaken === null) return -1;
        return bTaken - aTaken;
      }

      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}
