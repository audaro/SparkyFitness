/**
 * Display formatting for the canonical exercise vocabulary — the
 * free-exercise-db muscle and equipment strings.
 *
 * These values are stored and matched lowercase: the catalog filters them with
 * `equipment::jsonb ?|` and `primary_muscles::jsonb ?|`, which are exact and
 * case-sensitive, so a title-cased value would not error — it would quietly
 * match nothing. Capitalization is therefore a render-time concern only, and
 * nothing here may be fed back onto the wire.
 *
 * They are catalog data rather than application copy, so they are deliberately
 * not translated; mobile renders them the same way.
 */

/**
 * Capitalize the first letter of each word, leaving the rest alone — which is
 * what keeps `e-z curl bar` and `body only` intact.
 */
export function titleCaseCanonical(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
