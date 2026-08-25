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
 *
 * WHY BRANDS ARE THEIR OWN ENTRIES
 * --------------------------------
 * A strength ladder is a property of a *label*, and a label belongs to a brand, not a molecule.
 * Ozempic and Wegovy are both semaglutide and ladder differently (…1, 2 mg vs …1, 1.7, 2.4 mg);
 * Mounjaro and Zepbound are both tirzepatide and differ in indication rather than strengths. One
 * `semaglutide` entry cannot hold both ladders, and picking either one for it would put a
 * strength on someone's medication record that their pen does not have.
 *
 * So each brand is its own entry, linked to its molecule by `genericId` and sharing the
 * molecule's `glp1ProfileId` — the PK model still sees one drug, because the pharmacokinetics
 * belong to the molecule even though the ladder does not. `brandOf` derives every shared field
 * from the generic rather than restating it, so a brand cannot drift from its molecule.
 *
 * The generic entries stay, with `strengths: null`. They are what a compounded or grey-market
 * vial is: the same molecule with no label behind it, which is exactly the case the
 * reconstitution calculator exists for. A brand's name is therefore removed from its generic's
 * aliases — leaving it would return two rows for one query, the brand and the molecule
 * pretending to be it.
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
   * The molecule this is a brand of, as another entry's id. Absent on a generic entry.
   *
   * A brand exists as its own entry because its strength ladder does; everything else about it
   * — PK, category, route, cadence — belongs to the molecule and is derived from that entry by
   * `brandOf`. This is also what lets the UI show "Wegovy" as the row and "Semaglutide" under
   * it, so two brands of one molecule do not read as unrelated drugs.
   */
  genericId?: string;
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
 * The molecules.
 *
 * `strengths` is null on every one of these and that is not a gap: a molecule has no label, so
 * it has no ladder. A user holding a compounded or grey-market vial of semaglutide picks this
 * entry and the reconstitution calculator does the arithmetic on the numbers they supply.
 * Someone holding a pen picks the brand below, which does have a label.
 *
 * `vialSizes` is still empty everywhere — packaging hints for grey-market supply have no
 * authoritative source, and the field is a suggestion rather than a constraint, so an empty
 * array is a working state rather than a missing one.
 */
const GENERIC_DRUGS = {
  semaglutide: {
    id: "semaglutide",
    displayName: "Semaglutide",
    // Community shorthand only. Brand names live on the brand entries below.
    aliases: ["Sema"],
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
    aliases: [],
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
    aliases: ["Tirz"],
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
    aliases: [],
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
    aliases: [],
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
    // Investigational: no approved label, so no strength ladder anywhere — there is no brand
    // entry for it either, because there is no brand. The calculator takes over.
    strengths: null,
    pk: pkFromGlp1("retatrutide"),
    glp1ProfileId: "retatrutide",
    cadence: "weekly",
  },
} satisfies Record<string, CatalogDrug>;

/**
 * Build a brand from its molecule, restating only what the label actually changes.
 *
 * Everything else — PK, `glp1ProfileId`, category, routes, cadence — is spread from the generic,
 * so a brand cannot claim a different half-life or route from the molecule it is. `vialSizes` is
 * deliberately cleared rather than inherited: these brands ship as pens and cartridges, and a
 * vial hint on one would prefill the reconstitution calculator for a drug nobody reconstitutes.
 */
function brandOf(
  generic: CatalogDrug,
  brand: {
    id: string;
    displayName: string;
    strengths: CatalogStrengths;
    /** Only where the brand itself has a synonym; the molecule's shorthand stays on the molecule. */
    aliases?: string[];
  },
): CatalogDrug {
  return {
    ...generic,
    id: brand.id,
    displayName: brand.displayName,
    aliases: brand.aliases ?? [],
    genericId: generic.id,
    strengths: brand.strengths,
    vialSizes: [],
  };
}

/** Every ladder below is the deliverable doses of the US label, in mg. */
const mgLadder = (values: number[]): CatalogStrengths => ({
  values,
  unit: "mg",
  source: "label",
});

/**
 * The brands.
 *
 * Each is one approved label's deliverable doses. Where two brands of a molecule share a ladder
 * (Mounjaro and Zepbound) they are still separate entries, because they are separate labels and
 * a user picks the one printed on their box — and because nothing guarantees the ladders stay
 * identical the next time either label is revised.
 */
const BRAND_DRUGS: Record<string, CatalogDrug> = {
  ozempic: brandOf(GENERIC_DRUGS.semaglutide, {
    id: "ozempic",
    displayName: "Ozempic",
    strengths: mgLadder([0.25, 0.5, 1, 2]),
  }),
  wegovy: brandOf(GENERIC_DRUGS.semaglutide, {
    id: "wegovy",
    displayName: "Wegovy",
    strengths: mgLadder([0.25, 0.5, 1, 1.7, 2.4]),
  }),
  rybelsus: brandOf(GENERIC_DRUGS.oral_semaglutide, {
    id: "rybelsus",
    displayName: "Rybelsus",
    strengths: mgLadder([3, 7, 14]),
  }),
  mounjaro: brandOf(GENERIC_DRUGS.tirzepatide, {
    id: "mounjaro",
    displayName: "Mounjaro",
    strengths: mgLadder([2.5, 5, 7.5, 10, 12.5, 15]),
  }),
  zepbound: brandOf(GENERIC_DRUGS.tirzepatide, {
    id: "zepbound",
    displayName: "Zepbound",
    strengths: mgLadder([2.5, 5, 7.5, 10, 12.5, 15]),
  }),
  trulicity: brandOf(GENERIC_DRUGS.dulaglutide, {
    id: "trulicity",
    displayName: "Trulicity",
    strengths: mgLadder([0.75, 1.5, 3, 4.5]),
  }),
  victoza: brandOf(GENERIC_DRUGS.liraglutide, {
    id: "victoza",
    displayName: "Victoza",
    strengths: mgLadder([0.6, 1.2, 1.8]),
  }),
  saxenda: brandOf(GENERIC_DRUGS.liraglutide, {
    id: "saxenda",
    displayName: "Saxenda",
    strengths: mgLadder([0.6, 1.2, 1.8, 2.4, 3]),
  }),
};

/**
 * The catalog: molecules and the brands of them.
 *
 * Widening this beyond the incretins is the remaining content work. The shape is now proven
 * against both cases it has to carry — a labelled brand with a ladder, and a molecule with none.
 */
export const MEDICATION_CATALOG: Record<string, CatalogDrug> = {
  ...GENERIC_DRUGS,
  ...BRAND_DRUGS,
};

/**
 * The molecule a brand belongs to, or null when the drug is itself a molecule.
 *
 * Throws on a `genericId` naming no entry, for the same reason `pkFromGlp1` does: a dangling
 * link should be a total failure at module load, not a brand that silently reads as its own
 * unrelated drug.
 */
export function catalogGenericOf(drug: CatalogDrug): CatalogDrug | null {
  if (!drug.genericId) return null;
  const generic = Object.hasOwn(MEDICATION_CATALOG, drug.genericId)
    ? MEDICATION_CATALOG[drug.genericId]
    : undefined;
  if (!generic) {
    throw new Error(
      `catalog.ts: "${drug.id}" names generic "${drug.genericId}", which is not in the catalog.`,
    );
  }
  return generic;
}

/**
 * The line under a search row.
 *
 * A brand names its molecule, so Mounjaro and Zepbound do not read as unrelated drugs and a user
 * who knows they are on tirzepatide can recognise the box in front of them. A molecule matched on
 * a synonym names itself, so typing "Sema" does not leave the row unexplained. Null when the row
 * title already says everything there is to say.
 */
export function catalogRowSubtitle(
  drug: CatalogDrug,
  viaAlias: boolean,
): string | null {
  const generic = catalogGenericOf(drug);
  if (generic) return generic.displayName;
  return viaAlias ? drug.displayName : null;
}

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
