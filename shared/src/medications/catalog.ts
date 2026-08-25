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
