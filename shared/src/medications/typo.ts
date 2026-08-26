/**
 * Typo tolerance for medication name search.
 *
 * WHY THIS IS NARROW ON PURPOSE
 *
 * Every tier of the medication search matched by substring until this module existed, and the
 * comment on `searchCatalog` said why: "a near-miss suggestion is worse than none". That is still
 * true. A dropdown of medication names is not a web search — the rows are things the user may be
 * about to record as a drug they take, and an approximate row that reads like a real one is a
 * worse outcome than an empty list, which at least sends them to the custom row.
 *
 * So the rule here is not "rank by similarity". It is: **when an exact-or-substring pass has
 * already returned nothing, offer names that are within a small, length-scaled edit distance of
 * what was typed, and make the caller say that is what happened.** Fuzzy matching never competes
 * with a real match, never reorders one, and never appears without the UI labelling it.
 *
 * The distance is Damerau-Levenshtein — Levenshtein plus adjacent transposition — because the
 * dominant typo in a typed drug name is two letters swapped (`metfromin`, `testoterone`,
 * `lisinipril`). Plain Levenshtein charges a transposition two edits, which pushes exactly the
 * commonest mistake past a threshold tight enough to be safe.
 */

/**
 * Edits allowed, by the length of the name being matched against.
 *
 * Scaled rather than fixed because one edit means something different in a four-letter name than
 * in a fourteen-letter one: at distance 2, `HCG` is within reach of half the alphabet, while
 * `tesamorelin` is still unmistakably itself. The floor of 4 characters is where any tolerance
 * starts at all — below it the query is a prefix someone is still typing, not a misspelling.
 */
const MIN_FUZZY_LENGTH = 4;
const ONE_EDIT_MAX_LENGTH = 7;
const MAX_EDITS = 2;

/**
 * Damerau-Levenshtein distance, abandoned as soon as it is known to exceed `max`.
 *
 * Returns null rather than the true distance once the bound is passed. Callers only ever ask
 * "is this within k edits", and the early exit is what keeps a per-keystroke pass over the whole
 * catalog from being a per-keystroke pass over the whole catalog's character pairs.
 */
export function boundedEditDistance(
  a: string,
  b: string,
  max: number,
): number | null {
  if (a === b) return 0;
  if (max < 0) return null;
  // Length alone can rule a pair out before any matrix is allocated, and for a search over
  // hundreds of names most pairs are ruled out exactly here.
  if (Math.abs(a.length - b.length) > max) return null;
  if (a.length === 0) return b.length <= max ? b.length : null;
  if (b.length === 0) return a.length <= max ? a.length : null;

  // Three rolling rows: the previous two are all a transposition can reach back to.
  let twoBack: number[] = [];
  let oneBack: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current: number[] = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowBest = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      // Non-null assertions are avoided throughout this file; the rows are dense arrays indexed
      // inside their own bounds, but `noUncheckedIndexedAccess` cannot see that, so the reads go
      // through a default that is never actually taken.
      const deletion = (oneBack[j] ?? Infinity) + 1;
      const insertion = (current[j - 1] ?? Infinity) + 1;
      const substitution = (oneBack[j - 1] ?? Infinity) + substitutionCost;
      let best = Math.min(deletion, insertion, substitution);

      // The transposition case: `ab` against `ba` costs one edit, not two.
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1] &&
        twoBack.length > 0
      ) {
        best = Math.min(best, (twoBack[j - 2] ?? Infinity) + 1);
      }

      current[j] = best;
      if (best < rowBest) rowBest = best;
    }

    // Every remaining cell is at least the best in this row, so once the whole row is over
    // budget the final answer is too.
    if (rowBest > max) return null;

    twoBack = oneBack;
    oneBack = current;
    current = new Array<number>(b.length + 1);
  }

  const distance = oneBack[b.length];
  if (distance === undefined || distance > max) return null;
  return distance;
}

/** How many edits a candidate of this length is allowed to be away from the query. */
function allowedEdits(candidateLength: number): number {
  if (candidateLength < MIN_FUZZY_LENGTH) return 0;
  return candidateLength <= ONE_EDIT_MAX_LENGTH ? 1 : MAX_EDITS;
}

/**
 * How close `query` is to `candidate` as a misspelling of it, or null if it is not one.
 *
 * Lower is better, and the number is an edit count — comparable across candidates, which is what
 * lets a caller rank `metformin` above `merbromin` for `metfromin` rather than showing both in
 * whatever order the source list happened to be in.
 *
 * Both arguments are compared case-insensitively and trimmed. A query shorter than the fuzzy
 * floor, or shorter than the candidate by more than the allowance, matches nothing: someone four
 * characters into a twelve-character drug name is typing, not misspelling, and the substring pass
 * is already showing them what they want.
 */
export function typoDistance(candidate: string, query: string): number | null {
  const name = candidate.trim().toLowerCase();
  const term = query.trim().toLowerCase();
  if (term.length < MIN_FUZZY_LENGTH || name.length < MIN_FUZZY_LENGTH) {
    return null;
  }
  const budget = allowedEdits(name.length);
  if (budget === 0) return null;
  return boundedEditDistance(name, term, budget);
}

/**
 * The best typo distance between `query` and any of `candidates`, with the candidate that
 * achieved it.
 *
 * Ties break on the earlier candidate, so a caller listing a drug's own name before its aliases
 * gets the name back rather than a synonym that is the same distance away.
 */
export function bestTypoMatch(
  candidates: readonly string[],
  query: string,
): { candidate: string; distance: number } | null {
  let best: { candidate: string; distance: number } | null = null;
  for (const candidate of candidates) {
    const distance = typoDistance(candidate, query);
    if (distance === null) continue;
    if (best === null || distance < best.distance) {
      best = { candidate, distance };
    }
  }
  return best;
}
