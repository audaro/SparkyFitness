import { z } from "zod";

/**
 * RxNav spelling suggestions — the typo fallback behind tier 3 of the medication search.
 *
 * WHAT THIS IS FOR
 *
 * RxTerms is a prefix search over product names, and it is good at prefixes: `semaglutid`
 * returns both semaglutide products. What it does nothing with is a transposition. `testoterone`,
 * `metfromin`, `lisinipril` and `wegvy` all return exactly zero rows, and a user who mistypes a
 * drug name gets the same empty tier 3 as a user who named a drug the US catalog does not carry.
 * This module is the second question asked in that case: *what did they probably mean?*
 *
 * WHY `spellingsuggestions` AND NOT `approximateTerm`
 *
 * The blueprint named RxNav's `approximateTerm`. Probing both against the live service on
 * 2026-08-25 chose the other one, and the reason is worth keeping because the failure it avoids
 * is not cosmetic.
 *
 * `approximateTerm` ranks by string distance over every concept in RxNorm, from every vocabulary
 * it indexes. For `metfromin` its top-ranked answer is **merbromin** — a mercury antiseptic — and
 * `metformin` does not appear among the first five distinct names at all; it surfaces at maxEntries
 * 20, interleaved with dose-form concepts (`merbromin Topical Solution`) that are not usable as a
 * search term. Candidates also repeat once per source vocabulary and carry `name` only on some of
 * them, so reading a term out of the response means de-duplicating a list where the field being
 * de-duplicated on is optional.
 *
 * `spellingsuggestions` answers the question actually being asked. It returns ingredient- and
 * brand-level names, already de-duplicated, already the right shape to hand back to RxTerms —
 * and for `metfromin` it returns `["merbromin", "metformin"]`, which is to say it *does* contain
 * the right answer. That both are returned is why the caller must be willing to search more than
 * one suggestion; see `RXNAV_MAX_SPELLING_SUGGESTIONS`.
 *
 * The whole point of this endpoint is a term to re-ask RxTerms with. It publishes no strengths,
 * no RxCUIs and nothing that reaches a medication record: a suggestion either produces real
 * RxTerms products or it produces nothing, and nothing here is ever stored.
 */

/**
 * How many suggestions are worth re-searching.
 *
 * Not one. RxNav's first suggestion for `metfromin` is `merbromin`, and taking only the first
 * would answer a diabetes-drug typo with a topical antiseptic and *nothing else* — a single
 * confident wrong row, which is the worst shape this feature could take. Taking two puts
 * metformin on screen beside it, under its own real name, and lets the user do what they were
 * always going to do: recognise their drug.
 *
 * Not more than two, because each suggestion is another upstream request, and the tail of a
 * spelling list is where the genuinely unrelated names live.
 */
export const RXNAV_MAX_SPELLING_SUGGESTIONS = 2;

/**
 * The shortest term worth spell-checking.
 *
 * Higher than `RXTERMS_MIN_TERM_LENGTH`, deliberately. Three or four characters with no RxTerms
 * hit is overwhelmingly someone mid-word, not someone who has misspelled anything, and
 * "correcting" a prefix produces a confident suggestion for a word the user had not finished
 * typing. At six characters an empty RxTerms result is a real signal.
 */
export const RXNAV_SPELLING_MIN_TERM_LENGTH = 6;

/**
 * The response envelope, validated rather than trusted — the same reasoning as RxTerms'.
 *
 * `suggestionList` is absent entirely when RxNav has no suggestion (it is `{}`, not a list with
 * no members), and `name` echoes back as null, so both are optional here. A shape change upstream
 * becomes a parse failure the caller treats as "no suggestions", which is a state this path
 * already handles on every ordinary miss.
 */
const rxNavSpellingResponseSchema = z.object({
  suggestionGroup: z
    .object({
      suggestionList: z
        .object({ suggestion: z.array(z.string()).optional() })
        .optional(),
    })
    .passthrough(),
});

/**
 * Read the suggested spellings out of an RxNav response, best first.
 *
 * Suggestions equal to the term already searched are dropped: RxNav echoes an exact match back as
 * its own suggestion, and re-asking RxTerms the same question would spend a request to get the
 * same empty answer. Blank entries and duplicates go the same way.
 *
 * Throws if the envelope is not the documented shape. Callers treat that as "no suggestions".
 */
export function parseRxNavSpellingSuggestions(
  payload: unknown,
  searchedTerm: string,
): string[] {
  const parsed = rxNavSpellingResponseSchema.parse(payload);
  const suggestions = parsed.suggestionGroup.suggestionList?.suggestion ?? [];

  const alreadySearched = searchedTerm.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of suggestions) {
    const suggestion = raw.trim();
    const key = suggestion.toLowerCase();
    if (!suggestion || key === alreadySearched || seen.has(key)) continue;
    seen.add(key);
    out.push(suggestion);
  }

  return out;
}
