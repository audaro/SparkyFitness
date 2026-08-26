import { z } from "zod";

/**
 * openFDA's NDC directory — who actually makes the drug on a medication record.
 *
 * WHAT THIS ANSWERS THAT RXTERMS DOES NOT
 *
 * Tier 3 of the search (`rxterms.ts`) names a *product and strength*: "Mounjaro 2.5 mg/0.5 mL
 * Pen Injector". That is what a user needs in order to pick the right row. It says nothing about
 * the thing they are holding — who labelled it, what form it takes, how it goes in. The FDA's
 * NDC directory does, keyed by the same RxCUI RxTerms already gave us.
 *
 * WHY THE RXCUI IS THE ONLY THING THAT LEAVES
 *
 * This is the whole reason the feature is shaped the way it is. RxTerms is a *name* search —
 * the query string is a medication name being typed, which is why that tier is proxied through
 * the user's own server and gated behind an opt-in. This lookup sends an RxCUI: a public
 * numeric code for a drug product, carrying no name, no user and no prescription. It is
 * strictly less than the tier the user already had to approve, which is why it rides the same
 * `medication_catalog_lookup_enabled` preference rather than asking a second question — see
 * `services/medicationLabelService.ts` for that argument in full.
 *
 * It also fixes when the lookup can happen: only for a medication whose `rxnorm_rxcui` is
 * already stored, which means only one the user picked from the catalog and committed. There is
 * no per-keystroke path here by construction.
 *
 * WHY NONE OF THIS IS WRITTEN TO THE MEDICATION ROW
 *
 * A labeler is a fact about the *drug*, not about the user's prescription. If the FDA relists a
 * product under a new labeler, the right outcome is that the panel shows the new one — not that
 * a row the user has never edited silently changes underneath them. So this is read-only
 * provenance, fetched and cached, and the `medications.ndc` column stays the user's to fill in.
 * That is also why phase 6 needs no migration: nothing here is persisted.
 *
 * This module is the pure half — the response shapes and the display rules. The network call,
 * the cache and the consent gate are the server's.
 */

/**
 * How many products one RxCUI is allowed to resolve to.
 *
 * A brand drug is usually one row. A generic can be thirty: the same molecule listed by every
 * manufacturer that packages it. Showing all of them would bury the answer, and showing one
 * would imply a specificity the data does not have — so a handful are shown and the total is
 * stated alongside, which is the honest version of both.
 */
export const OPENFDA_MAX_PRODUCTS = 5;

/** openFDA rejects an RxCUI that is not digits, and so does this before a request is built. */
export const OPENFDA_RXCUI_PATTERN = /^\d{1,12}$/;

/**
 * One labelled product, as this app shows it.
 *
 * Everything except `productNdc` is nullable because openFDA's own records are uneven — an
 * unfinished or discontinued listing can be missing a brand name, a route, or both. A null here
 * is "the FDA does not say", which is a real answer and is rendered as an absence rather than
 * as an empty string.
 */
export interface OpenFdaProduct {
  /** The FDA's product NDC, e.g. `0002-1434`. Stable, and what a pharmacy speaks. */
  productNdc: string;
  /** Whose name is on the box. `Eli Lilly and Company`, `Teva Pharmaceuticals USA, Inc.` */
  labelerName: string | null;
  brandName: string | null;
  genericName: string | null;
  /** `INJECTION, SOLUTION`, `TABLET, FILM COATED`. Shouted by the FDA; see `titleCaseFdaTerm`. */
  dosageForm: string | null;
  /** `SUBCUTANEOUS`, `ORAL`. A product can list more than one. */
  routes: string[];
}

/** Why a lookup came back with nothing. Null when it returned products. */
export type OpenFdaUnavailableReason =
  /** The owner has not opted into network drug lookups. No request was made. */
  | "lookup_disabled"
  /** The medication has no stored RxCUI, so there is nothing to look up. */
  | "no_rxcui"
  /** openFDA has no NDC listing for this RxCUI. Common for older or foreign products. */
  | "not_found"
  /** The request failed or openFDA was unreachable. Distinguished so the UI can say so. */
  | "lookup_failed";

export interface OpenFdaLookupResponse {
  products: OpenFdaProduct[];
  /**
   * How many products the FDA holds for this RxCUI, which can exceed `products.length`.
   * Rendered as "5 of 31 listings" so a truncated list never reads as a complete one.
   */
  totalMatches: number;
  unavailableReason: OpenFdaUnavailableReason | null;
}

/**
 * The subset of openFDA's NDC record this app reads.
 *
 * Deliberately `.loose()` and almost entirely optional: openFDA adds fields without notice, and
 * a strict schema would turn a new key into an outage. Everything is validated on the way *out*
 * of this parser instead, into `OpenFdaProduct`.
 */
const openFdaNdcResultSchema = z
  .object({
    product_ndc: z.string().optional(),
    labeler_name: z.string().optional(),
    brand_name: z.string().optional(),
    generic_name: z.string().optional(),
    dosage_form: z.string().optional(),
    route: z.array(z.string()).optional(),
  })
  .loose();

const openFdaNdcResponseSchema = z
  .object({
    meta: z
      .object({
        results: z.object({ total: z.number() }).loose().optional(),
      })
      .loose()
      .optional(),
    results: z.array(openFdaNdcResultSchema).optional(),
  })
  .loose();

/** Empty string and whitespace both mean "the FDA does not say", not "the answer is blank". */
function nullIfBlank(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse an openFDA `/drug/ndc.json` body into the products this app displays.
 *
 * A record with no `product_ndc` is dropped rather than shown with a blank identifier: the NDC
 * is the one field that makes a row mean a specific product, and a row without it is not one.
 * Duplicates are dropped too — the same product NDC can appear more than once across package
 * configurations, and the panel is about the product, not its box sizes.
 *
 * `totalMatches` prefers the FDA's own `meta.results.total`, because the response is paginated
 * and the array length is only ever the page. It falls back to the number of usable rows.
 */
export function parseOpenFdaNdcResponse(body: unknown): {
  products: OpenFdaProduct[];
  totalMatches: number;
} {
  const parsed = openFdaNdcResponseSchema.safeParse(body);
  if (!parsed.success) return { products: [], totalMatches: 0 };

  const seen = new Set<string>();
  const products: OpenFdaProduct[] = [];
  for (const result of parsed.data.results ?? []) {
    const productNdc = nullIfBlank(result.product_ndc);
    if (productNdc === null || seen.has(productNdc)) continue;
    seen.add(productNdc);
    products.push({
      productNdc,
      labelerName: nullIfBlank(result.labeler_name),
      brandName: nullIfBlank(result.brand_name),
      genericName: nullIfBlank(result.generic_name),
      dosageForm: nullIfBlank(result.dosage_form),
      routes: (result.route ?? [])
        .map((route) => nullIfBlank(route))
        .filter((route): route is string => route !== null),
    });
    if (products.length >= OPENFDA_MAX_PRODUCTS) break;
  }

  const reportedTotal = parsed.data.meta?.results?.total;
  const totalMatches =
    typeof reportedTotal === "number" && reportedTotal >= products.length
      ? reportedTotal
      : products.length;

  return { products, totalMatches };
}

/**
 * Turn an FDA term into something readable next to ordinary sentence-cased UI.
 *
 * openFDA publishes controlled vocabulary in block capitals — `INJECTION, SOLUTION`,
 * `SUBCUTANEOUS`. Rendered raw, a form label shouts louder than the medication's own name. The
 * mapping is presentational only: nothing is stored or sent in this shape, so a term this does
 * not improve is simply returned lower-cased with its first letters capitalised.
 *
 * A word already containing a lower-case letter is left exactly as it is. FDA records mix in
 * proper names and unit strings (`mL`, `IU`, `McNeil`), and title-casing those damages them.
 */
export function titleCaseFdaTerm(term: string): string {
  return term
    .split(/(\s+|,|\/|-)/)
    .map((part) => {
      if (/[a-z]/.test(part)) return part;
      if (!/[A-Z]/.test(part)) return part;
      return part.charAt(0) + part.slice(1).toLowerCase();
    })
    .join("");
}

/**
 * The one-line description of a product, or null when the FDA gave nothing to describe it with.
 *
 * Form and route together are what distinguishes two listings of the same molecule — an oral
 * tablet from a subcutaneous solution — so they are joined rather than shown as separate
 * labelled fields. Null rather than an empty string, so the caller renders nothing rather than a
 * stray separator.
 */
export function formatOpenFdaProductDetail(product: OpenFdaProduct): string | null {
  const parts: string[] = [];
  if (product.dosageForm !== null) parts.push(titleCaseFdaTerm(product.dosageForm));
  if (product.routes.length > 0) {
    parts.push(product.routes.map(titleCaseFdaTerm).join(", "));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
