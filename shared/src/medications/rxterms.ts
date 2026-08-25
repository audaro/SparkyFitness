import { z } from "zod";
import { resolveCatalogDrug } from "./catalog.ts";

/**
 * RxTerms (NLM Clinical Table Search Service) — tier 3 of the medication search.
 *
 * WHAT THIS MODULE IS FOR
 *
 * The curated catalog (`catalog.ts`) is tier 2: the peptides and incretins this app is built
 * around, with label ladders and a known dosing cadence. It deliberately stops at drugs whose
 * numbers can be sourced. RxTerms is the ~20k prescribable US products it does not cover —
 * testosterone, levothyroxine, metformin, everything a user might also be taking.
 *
 * This module is the pure half: parsing what RxTerms publishes and deciding which of its rows
 * are worth showing. The network call, the cache and the opt-in gate live on the server
 * (`integrations/rxterms/RxTermsService.ts`) because the query is a medication name and must not
 * leave the user's own infrastructure.
 *
 * WHY THE RAW STRING IS THE AUTHORITY
 *
 * RxTerms states a strength as one human-readable string — `200 mg/ml Injection 1 ml`. The
 * medications table wants a number and a unit. That conversion is the one genuinely fiddly part
 * of tier 3, and getting it wrong writes a wrong number onto a medication record, which is the
 * worst thing this feature can do. So `raw` is always kept and always displayed, `value`/`unit`
 * are best-effort, and anything the parser does not fully understand comes back with null
 * numerics and a reason rather than a guess. A user correcting a blank field is a working day;
 * a user dosing off a silently mis-parsed one is not.
 *
 * The corpus behind the parser rules below was recorded from the live service on 2026-08-25
 * across testosterone, semaglutide, tirzepatide, levothyroxine, metformin, insulin and
 * albuterol — 41 distinct string shapes. The fixtures live in the server's test suite.
 */

/** Why a strength string yielded no number. Null when it parsed. */
export type RxTermsUnparsedReason =
  /** Two actives in one product: `1,000-50 mg Tab`. There is no single strength to store. */
  | "combination"
  /** A percentage rather than a mass: ` 1% Gel`. Real, but not a value/unit pair. */
  | "percent"
  /** A shape or unit the parser does not claim to understand. Deliberately the default. */
  | "unrecognised";

export interface RxTermsStrength {
  /** Exactly what RxTerms published, trimmed. Always shown, always stored, never guessed at. */
  raw: string;
  /** The RxCUI of this specific product-and-strength, or null if the response omitted it. */
  rxcui: string | null;
  /** The numeric strength, or null when `raw` states no single unambiguous one. */
  value: number | null;
  /**
   * The unit including any denominator, exactly as published: `mg`, `mg/ml`, `mg/5ml`,
   * `mcg/puff`, `unt/ml`. Null whenever `value` is.
   *
   * A denominator is never normalised away. `0.1 mg/5ml` is not `0.02 mg/ml` to this module:
   * dividing it through would be arithmetic the label did not state, and a mistake there is a
   * silent five-fold error. The string says what it says.
   */
  unit: string | null;
  /** Why `value` and `unit` are null. Null when they are populated. */
  unparsedReason: RxTermsUnparsedReason | null;
}

export interface RxTermsProduct {
  /** The name RxTerms publishes, e.g. `Testosterone (Injectable)`. */
  displayName: string;
  /** The drug name with the dose-form parenthetical removed, e.g. `Testosterone`. */
  baseName: string;
  /** The dose form from the parenthetical, e.g. `Injectable`. Null when there was none. */
  doseForm: string | null;
  /** Every strength RxTerms lists for this product, in its own order. */
  strengths: RxTermsStrength[];
}

/**
 * Why a tier 3 search returned nothing. Null means the search really ran and the catalog really
 * has no such drug — which is an answer, and a common one, since RxTerms carries no peptide.
 *
 * None of these may ever surface as an error the user has to dismiss. Tier 3 is an enhancement
 * over two local tiers that have already rendered; adding a medication cannot be made to depend
 * on the NIH being reachable. The reasons exist so the client can say something quiet and
 * accurate — an opt-in nudge for `lookup_disabled`, nothing at all for the rest.
 */
export type MedicationCatalogUnavailableReason =
  /** The user has not opted in. Tiers 1-2 answered; no request left the server. */
  | "lookup_disabled"
  /** Below the character threshold that makes a network round trip worth spending. */
  | "term_too_short"
  /** Reached for and could not be had: timeout, non-200, or an envelope that failed to parse. */
  | "upstream_unavailable";

/** What the medication catalog search endpoint returns. Consumed by web and mobile alike. */
export interface MedicationCatalogSearchResponse {
  products: RxTermsProduct[];
  unavailableReason: MedicationCatalogUnavailableReason | null;
}

/**
 * The response envelope, validated rather than trusted.
 *
 * RxTerms answers with a positional tuple, not an object: `[total, names, extras, displays]`.
 * Positional formats fail quietly when they change — a renamed key gives `undefined` that reads
 * as "no strengths" rather than as an error — so the shape is asserted up front and a surprise
 * becomes a loud, catchable failure instead of an autocomplete that silently stops offering
 * doses.
 */
const rxTermsResponseSchema = z.tuple([
  z.number(),
  z.array(z.string()),
  z
    .object({
      STRENGTHS_AND_FORMS: z.array(z.array(z.string())).optional(),
      RXCUIS: z.array(z.array(z.string())).optional(),
    })
    // The service asks for two extra fields; tolerate a response carrying others.
    .passthrough(),
  z.array(z.array(z.string())).optional(),
]);

export type RxTermsResponse = z.infer<typeof rxTermsResponseSchema>;

/**
 * Units this module is willing to put in `strength_unit`, as RxTerms spells them.
 *
 * An allowlist rather than "whatever letters follow the number", because the cost is asymmetric:
 * refusing a real unit leaves the user a raw string and a blank field they can fill in, while
 * accepting a misread one writes a number onto a medication record under a unit nobody checked.
 * `unt` is RxTerms' spelling of insulin units and is passed through unchanged rather than
 * rewritten to `iu` — the chip should read the way the product does.
 */
const NUMERATOR_UNITS = new Set(["mg", "mcg", "g", "ml", "unt", "meq", "iu"]);

/** Denominators seen in the corpus: per volume, per actuation, per spray. */
const DENOMINATOR_UNITS = new Set(["ml", "l", "puff", "spray", "actuat"]);

/**
 * `1,000` is one thousand milligrams, and `parseFloat` reads it as 1. A three-orders-of-magnitude
 * error on a dose is exactly the failure this module exists to prevent, so grouped thousands are
 * matched explicitly and stripped before any number is read.
 */
const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;

/**
 * Anchored at the start, because the strength is always the leading token and later numbers are
 * something else entirely: the `24` in `500 mg 24 HR XR Tab` is a release duration and the `1` in
 * `200 mg/ml Injection 1 ml` is the container volume. A parser that searched for "a number near a
 * unit" would find those.
 */
const STRENGTH_AT_START = new RegExp(
  String.raw`^(${NUMBER})` +
    // A second dashed number means a combination product; captured so it can be reported
    // rather than ignored.
    String.raw`(\s*-\s*(?:${NUMBER}))?` +
    String.raw`\s*(%|[A-Za-z]+(?:/\d*[A-Za-z]+)?)`,
);

function toNumber(raw: string): number | null {
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function unparsed(
  raw: string,
  rxcui: string | null,
  reason: RxTermsUnparsedReason,
): RxTermsStrength {
  return { raw, rxcui, value: null, unit: null, unparsedReason: reason };
}

/**
 * Read one RxTerms strength string into a number and a unit, or explain why it cannot be.
 *
 * Exported on its own because it is the part worth testing exhaustively: the server calls it
 * through `parseRxTermsResponse`, but its behaviour on the awkward shapes is the contract.
 */
export function parseRxTermsStrength(
  raw: string,
  rxcui: string | null = null,
): RxTermsStrength {
  // Leading whitespace is not an anomaly here — RxTerms pads strings so that they sort
  // numerically in a fixed-width column, so `  500 mg Tab` and ` 4.17 mg/ml Sol` are ordinary.
  const text = raw.trim();
  if (!text) return unparsed(raw, rxcui, "unrecognised");

  const match = STRENGTH_AT_START.exec(text);
  if (!match) return unparsed(text, rxcui, "unrecognised");

  const [, firstNumber, secondNumber, unitToken] = match;
  // Both groups are non-optional in the pattern, so a match guarantees them. Checked anyway
  // rather than asserted: this file's whole contract is that an unreadable string produces no
  // number, and a `!` here would trade that for a crash the first time the pattern is edited.
  if (firstNumber === undefined || unitToken === undefined) {
    return unparsed(text, rxcui, "unrecognised");
  }

  // `1,000-50 mg Tab` is two actives at two strengths sharing one unit. Storing either number
  // alone would describe a different drug than the one on the shelf.
  if (secondNumber) return unparsed(text, rxcui, "combination");

  if (unitToken === "%") return unparsed(text, rxcui, "percent");

  const value = toNumber(firstNumber);
  if (value === null) return unparsed(text, rxcui, "unrecognised");

  const [numerator, denominator] = unitToken.split("/");
  if (numerator === undefined || !NUMERATOR_UNITS.has(numerator.toLowerCase())) {
    return unparsed(text, rxcui, "unrecognised");
  }
  if (denominator !== undefined) {
    // `mg/5ml` — the count is part of the denominator and stays in the unit string.
    const denominatorUnit = denominator.replace(/^\d+/, "").toLowerCase();
    if (!DENOMINATOR_UNITS.has(denominatorUnit)) {
      return unparsed(text, rxcui, "unrecognised");
    }
  }

  return {
    raw: text,
    rxcui,
    value,
    unit: unitToken.toLowerCase(),
    unparsedReason: null,
  };
}

/** `Testosterone (Injectable)` → `{ baseName: 'Testosterone', doseForm: 'Injectable' }`. */
function splitDisplayName(displayName: string): {
  baseName: string;
  doseForm: string | null;
} {
  const trimmed = displayName.trim();
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(trimmed);
  const baseName = match?.[1]?.trim();
  // No parenthetical, or one that somehow left nothing in front of it: the whole string is the
  // name. Falling back rather than returning an empty base matters — an empty name would resolve
  // against nothing in the catalog and quietly disable the suppression rule.
  if (baseName === undefined || baseName === "") {
    return { baseName: trimmed, doseForm: null };
  }
  return { baseName, doseForm: match?.[2]?.trim() || null };
}

/**
 * True when the curated catalog already describes this RxTerms product.
 *
 * WHY TIER 3 HIDES WHAT TIER 2 COVERS
 *
 * The two sources overlap on precisely the drugs this app is built around, and RxTerms describes
 * them worse. It lists semaglutide as `0.68 mg/ml … Dose Pen Injector 3 ml` and tirzepatide as
 * `4.17 mg/ml Pen Injector 2.4 ml` — the concentration of the liquid in the pen. The catalog
 * lists Ozempic as 0.25 / 0.5 / 1 / 2 mg, which is what the pen's dial says and what the user
 * logs. Both are true statements about the same product; only one is the number a person takes.
 *
 * Offered side by side in one dropdown, the two rows are indistinguishable to anyone who does
 * not already know the difference, and picking the wrong one writes a concentration into a dose
 * field. So a tier 3 row is dropped when the catalog resolves its base name. Tier 3's job is the
 * drugs tier 2 does not have.
 *
 * Matching is exact against catalog names and aliases (`resolveCatalogDrug`), never substring: a
 * loose match here suppresses a real drug the user is looking for, and a missing tier 3 row is
 * invisible in a way a wrong one is not.
 */
export function catalogCoversRxTermsProduct(displayName: string): boolean {
  const { baseName } = splitDisplayName(displayName);
  return resolveCatalogDrug(baseName) !== undefined;
}

/**
 * Turn one RxTerms response into products, dropping those the curated catalog already covers.
 *
 * Throws if the envelope is not the documented shape — see `rxTermsResponseSchema`. Callers
 * treat that as "tier 3 is unavailable", which is a state the search already has to handle for
 * offline and opt-out anyway.
 */
export function parseRxTermsResponse(payload: unknown): RxTermsProduct[] {
  const [, names, extras] = rxTermsResponseSchema.parse(payload);

  const strengthLists = extras.STRENGTHS_AND_FORMS ?? [];
  const rxcuiLists = extras.RXCUIS ?? [];

  const products: RxTermsProduct[] = [];
  names.forEach((displayName, index) => {
    if (catalogCoversRxTermsProduct(displayName)) return;

    const rawStrengths = strengthLists[index] ?? [];
    const rxcuis = rxcuiLists[index] ?? [];
    const { baseName, doseForm } = splitDisplayName(displayName);

    products.push({
      displayName,
      baseName,
      doseForm,
      // The two arrays are parallel by position. Where one is shorter — which the envelope
      // permits and the service has no way to repair — the missing RxCUI is null rather than
      // borrowed from a neighbouring strength.
      strengths: rawStrengths.map((raw, i) =>
        parseRxTermsStrength(raw, rxcuis[i] ?? null),
      ),
    });
  });

  return products;
}
