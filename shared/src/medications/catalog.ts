/**
 * The bundled medication catalog — the broad, offline list the medication search offers as
 * "Known drugs" (Tier 2). Shipped in code, so web, mobile and server all read this one copy
 * and it works with no network and no migration.
 *
 * WHY THIS IS NOT `GLP1_DRUG_PROFILES`
 * ------------------------------------
 * `glp1.ts` is a *pharmacokinetic registry*: a narrow set of drugs with published half-lives
 * that feed the serum-level model and the GLP-1 coach. This file is a *search catalog*: a wide
 * set of drugs a user might want to log, most of which have no published PK at all.
 *
 * Widening `GLP1_DRUG_PROFILES` to cover peptides would break two things at once — every entry
 * would appear in the "GLP-1 drug (for the PK model)" picker, and any entry without a real
 * half-life would inherit a default one and render a confident, fabricated serum curve. So the
 * two lists stay separate: a catalog entry either *references* published PK through `pk`, or
 * declares `pk: null` and gets no curve.
 *
 * THE NO-DOSE RULE
 * ----------------
 * The catalog originates no dose. `strengths` is populated only where an approved drug label
 * exists, and `source: 'label'` is the only permitted value — adding a community-sourced ladder
 * requires changing the type, which is the point. Everything investigational carries
 * `strengths: null`, and the reconstitution calculator (`reconstitution.ts`) does the arithmetic
 * on numbers the user supplies instead.
 */

import { GLP1_DRUG_PROFILES } from "./glp1.ts";

/** Ids from the `medication_route_types` seed table. */
export type MedicationRouteId =
  | "oral"
  | "subcutaneous"
  | "intramuscular"
  | "topical"
  | "inhaled"
  | "nasal"
  | "other";

/** Broad grouping, used for search result headers and filtering. */
export type CatalogCategory =
  | "incretin"
  | "repair"
  | "gh-secretagogue"
  | "melanocortin"
  | "metabolic"
  | "immune"
  | "androgen"
  | "other";

/** Amount units a vial can be labeled in. IU never converts to mass — see `reconstitution.ts`. */
export type CatalogAmountUnit = "mg" | "mcg" | "iu";

/**
 * A vial size commonly supplied for this drug. This is a *packaging hint* that pre-fills the
 * calculator, never a constraint: grey-market supply varies by vendor, so the vial field stays
 * a free input and an empty array simply means "no hints". It is not a dose.
 */
export interface CatalogVialSize {
  amount: number;
  unit: CatalogAmountUnit;
}

/**
 * Label-derived strength ladder. `source` is a single literal on purpose: there is no way to
 * express a strength that did not come off an approved label without editing this type.
 */
export interface CatalogStrengths {
  values: number[];
  unit: string;
  source: "label";
}

/** Published pharmacokinetics. Null disables the serum-level chart — it must never default. */
export interface CatalogPk {
  halfLifeDays: number;
  tMaxDays: number;
}

export interface CatalogDrug {
  /** Stable id, also written to `medications.custom_fields.catalog_id`. */
  id: string;
  displayName: string;
  /** Brands and community synonyms, for matching only (e.g. 'Reta' → retatrutide). */
  aliases: string[];
  category: CatalogCategory;
  routes: MedicationRouteId[];
  /** Suggested vial sizes. Always overridable; `[]` means no suggestion. */
  vialSizes: CatalogVialSize[];
  /** Label-derived strengths, or null when no approved label exists. */
  strengths: CatalogStrengths | null;
  /** Published PK, or null. Null must hide the serum-level chart, not default it. */
  pk: CatalogPk | null;
  /**
   * Matching id in `GLP1_DRUG_PROFILES`, when this drug is also in the PK registry. Present
   * exactly when `pk` is non-null; it is what gates the GLP-1 coach.
   */
  glp1ProfileId?: string;
  /**
   * Default schedule type, where a published dosing interval exists. Null means the user picks
   * — the catalog does not guess a frequency for a drug with no label.
   */
  cadence: "weekly" | "daily" | null;
}

/**
 * Pull PK from the registry so the numbers have exactly one home. Throws at module load on an
 * unknown id, which turns a typo into an immediate, total failure rather than a silently
 * PK-less catalog entry.
 */
function pkFromGlp1(profileId: string): CatalogPk {
  const profile = Object.hasOwn(GLP1_DRUG_PROFILES, profileId)
    ? GLP1_DRUG_PROFILES[profileId]
    : undefined;
  if (!profile) {
    throw new Error(
      `catalog.ts: no GLP1_DRUG_PROFILES entry for "${profileId}". ` +
        `A catalog entry may only claim PK that the registry publishes.`,
    );
  }
  return { halfLifeDays: profile.halfLifeDays, tMaxDays: profile.tMaxDays };
}

/**
 * The catalog.
 *
 * Phase 0 seeds it with the drugs already in the PK registry, so the shape is proven against
 * real entries before the content pass widens it. `strengths` and `vialSizes` are deliberately
 * unpopulated here: both are content that needs sourcing and review, and a wrong number on a
 * medication record is the worst thing this feature can produce. Until then `strengths: null`
 * routes the dosage step to the reconstitution calculator, which is a working answer rather
 * than a guessed one.
 */
export const MEDICATION_CATALOG: Record<string, CatalogDrug> = {
  semaglutide: {
    id: "semaglutide",
    displayName: "Semaglutide",
    aliases: ["Ozempic", "Wegovy", "Sema"],
    category: "incretin",
    routes: ["subcutaneous"],
    vialSizes: [],
    strengths: null,
    pk: pkFromGlp1("semaglutide"),
    glp1ProfileId: "semaglutide",
    cadence: "weekly",
  },
  oral_semaglutide: {
    id: "oral_semaglutide",
    displayName: "Semaglutide (oral)",
    aliases: ["Rybelsus"],
    category: "incretin",
    routes: ["oral"],
    vialSizes: [],
    strengths: null,
    pk: pkFromGlp1("oral_semaglutide"),
    glp1ProfileId: "oral_semaglutide",
    cadence: "daily",
  },
  tirzepatide: {
    id: "tirzepatide",
    displayName: "Tirzepatide",
    aliases: ["Mounjaro", "Zepbound", "Tirz"],
    category: "incretin",
    routes: ["subcutaneous"],
    vialSizes: [],
    strengths: null,
    pk: pkFromGlp1("tirzepatide"),
    glp1ProfileId: "tirzepatide",
    cadence: "weekly",
  },
  dulaglutide: {
    id: "dulaglutide",
    displayName: "Dulaglutide",
    aliases: ["Trulicity"],
    category: "incretin",
    routes: ["subcutaneous"],
    vialSizes: [],
    strengths: null,
    pk: pkFromGlp1("dulaglutide"),
    glp1ProfileId: "dulaglutide",
    cadence: "weekly",
  },
  liraglutide: {
    id: "liraglutide",
    displayName: "Liraglutide",
    aliases: ["Saxenda", "Victoza"],
    category: "incretin",
    routes: ["subcutaneous"],
    vialSizes: [],
    strengths: null,
    pk: pkFromGlp1("liraglutide"),
    glp1ProfileId: "liraglutide",
    cadence: "daily",
  },
  retatrutide: {
    id: "retatrutide",
    displayName: "Retatrutide",
    aliases: ["Reta"],
    category: "incretin",
    routes: ["subcutaneous"],
    vialSizes: [],
    // Investigational: no approved label, so no strength ladder. The calculator takes over.
    strengths: null,
    pk: pkFromGlp1("retatrutide"),
    glp1ProfileId: "retatrutide",
    cadence: "weekly",
  },
};

/** Resolve a catalog drug by id, display name, or (case-insensitive) alias. */
export function resolveCatalogDrug(
  idOrAlias: string,
): CatalogDrug | undefined {
  const key = idOrAlias.trim().toLowerCase();
  if (!key) return undefined;
  // `hasOwn`, not a bare index: a plain object inherits `constructor`, `toString` and friends,
  // so indexing with an arbitrary search term returns a truthy Function for those keys and
  // hands the caller a "drug" whose every field is undefined.
  const byId = Object.hasOwn(MEDICATION_CATALOG, key)
    ? MEDICATION_CATALOG[key]
    : undefined;
  if (byId) return byId;
  return Object.values(MEDICATION_CATALOG).find(
    (drug) =>
      drug.id.toLowerCase() === key ||
      drug.displayName.toLowerCase() === key ||
      drug.aliases.some((alias) => alias.toLowerCase() === key),
  );
}

export interface CatalogSearchResult {
  drug: CatalogDrug;
  /**
   * The text that actually matched — the display name, or the alias the user typed. Lets the
   * UI show "Wegovy" as the row and "Semaglutide" as its subtitle, rather than silently
   * replacing what they typed with a generic name they may not recognise.
   */
  matchedOn: string;
  /** True when `matchedOn` is a brand or synonym rather than the drug's own name. */
  viaAlias: boolean;
}

/** Lower is better. Exact beats prefix beats substring; name beats alias at each tier. */
function matchRank(candidate: string, query: string): number | null {
  const value = candidate.toLowerCase();
  if (value === query) return 0;
  if (value.startsWith(query)) return 2;
  if (value.includes(query)) return 4;
  return null;
}

/**
 * Rank the catalog against what the user has typed. Pure and synchronous — this is the local
 * tier of the medication search, so it runs on every keystroke with no network and no debounce
 * of its own.
 *
 * Matching is substring, not fuzzy: the catalog is small and the terms are drug names, where a
 * near-miss suggestion is worse than none. Typo tolerance is a deliberate later step.
 */
export function searchCatalog(
  query: string,
  limit = 8,
): CatalogSearchResult[] {
  const key = query.trim().toLowerCase();
  if (!key || limit <= 0) return [];

  const scored: { result: CatalogSearchResult; rank: number }[] = [];

  for (const drug of Object.values(MEDICATION_CATALOG)) {
    let best: { rank: number; matchedOn: string; viaAlias: boolean } | null =
      null;

    const nameRank = matchRank(drug.displayName, key);
    if (nameRank !== null) {
      best = { rank: nameRank, matchedOn: drug.displayName, viaAlias: false };
    }

    for (const alias of drug.aliases) {
      const aliasRank = matchRank(alias, key);
      // +1 so a name match always outranks an alias match at the same tier.
      if (aliasRank === null) continue;
      if (best === null || aliasRank + 1 < best.rank) {
        best = { rank: aliasRank + 1, matchedOn: alias, viaAlias: true };
      }
    }

    if (best) {
      scored.push({
        rank: best.rank,
        result: {
          drug,
          matchedOn: best.matchedOn,
          viaAlias: best.viaAlias,
        },
      });
    }
  }

  // Alphabetical within a rank, so the list is stable across keystrokes that do not change
  // the ranking — a row must not move out from under a finger already on its way down.
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.result.drug.displayName.localeCompare(b.result.drug.displayName),
  );

  return scored.slice(0, limit).map((entry) => entry.result);
}
