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
 * requires changing the type, which is the point. Everything without a label carries
 * `strengths: null`, and the reconstitution calculator (`reconstitution.ts`) does the arithmetic
 * on numbers the user supplies instead. Most of this catalog is research peptides and
 * grey-market supply, so most of this catalog is `strengths: null` — that is the working state,
 * not a gap. `unlabelled()` below makes it structurally impossible for such an entry to carry a
 * ladder or a half-life at all.
 *
 * WHY BRANDS ARE THEIR OWN ENTRIES
 * --------------------------------
 * A strength ladder is a property of a *label*, and a label belongs to a brand, not a molecule.
 * Ozempic and Wegovy are both semaglutide and ladder differently (…1, 2 mg vs …1, 1.7, 2.4,
 * 7.2 mg); Mounjaro and Zepbound are both tirzepatide and differ in indication rather than
 * strengths. One `semaglutide` entry cannot hold both ladders, and picking either one for it
 * would put a strength on someone's medication record that their pen does not have.
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
 *
 * WHEN A BRAND GETS AN ENTRY AND WHEN IT IS JUST AN ALIAS
 * ------------------------------------------------------
 * A ladder is the *only* reason a brand needs its own entry, so: **a brand becomes an entry
 * when its label publishes a strength ladder; otherwise its name is an alias on the molecule.**
 * Egrifta is an alias on tesamorelin rather than an entry, because what its label publishes is
 * a vial size, and a vial size is the same fact whoever supplies it — the calculator wants it
 * either way. Splitting it would buy a duplicate row and nothing else.
 *
 * WHERE THE NUMBERS COME FROM
 * ---------------------------
 * Every entry carrying `strengths` or a non-empty `vialSizes` also carries `labelSource`: the
 * document the numbers were read off and the day they were last checked against it. This exists
 * because a label is revised and nothing here would otherwise notice — the 2026-08-25 pass
 * found Wegovy had gained a 7.2 mg dose and Novo had launched oral semaglutide under two more
 * brand names since the ladders were first written, three weeks earlier. `reviewed` is written
 * out per entry rather than pulled from a shared constant on purpose: a shared constant would
 * let one entry's re-check silently re-date every other entry in the file.
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

/**
 * Broad grouping, used for search result headers and filtering.
 *
 * `androgen` is the TRT-adjacent bucket rather than androgens strictly — the gonadotropins and
 * SERMs people track alongside testosterone live there, because that is the list they think of
 * them as belonging to.
 */
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

/**
 * Where an entry's label-derived numbers came from, and when they were last checked against it.
 *
 * Required by test on any entry carrying `strengths` or a non-empty `vialSizes`, because a
 * number with no provenance cannot be re-verified and a label that has moved on cannot be
 * noticed. Deliberately not a URL alone — a set id survives a site redesign.
 */
export interface CatalogLabelSource {
  /** The document, named precisely enough to find again. */
  document: string;
  /** ISO day (`YYYY-MM-DD`) this entry was last checked against `document`. */
  reviewed: string;
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
   * Provenance for `strengths` and `vialSizes`. Present exactly when one of them carries data.
   */
  labelSource?: CatalogLabelSource;
  /**
   * Default schedule type, where a published dosing interval exists. Null means the user picks
   * — the catalog does not guess a frequency for a drug with no label, and it does not round an
   * interval it cannot express (twice daily, twice weekly, as needed) to the nearest one it can.
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
 * A DailyMed-hosted US prescribing information document. The set id is the stable handle:
 * `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=<setId>`.
 *
 * `reviewed` has no default. Every caller states the day it actually checked, because a shared
 * default would re-date the whole file the moment one entry was re-checked.
 */
const dailyMed = (
  document: string,
  setId: string,
  reviewed: string,
): CatalogLabelSource => ({
  document: `${document} — US prescribing information, DailyMed set id ${setId}`,
  reviewed,
});

/**
 * The bulk of this catalog: a drug with no label data this catalog can source.
 *
 * Research peptides, grey-market supply, and products approved only where we have not read the
 * label. Every one of the no-dose rule's consequences is applied here rather than restated 25
 * times — `strengths`, `pk` and `cadence` are null and `vialSizes` is empty, and none of them
 * is a parameter, so an entry built this way *cannot* acquire a fabricated ladder or a
 * defaulted half-life. Anything that does have label data is written out longhand below, which
 * is what makes it visible in review.
 *
 * Note this is about *label data*, not about approval or evidence: retatrutide is
 * investigational and still carries PK, because the registry publishes it, so it is written out
 * longhand with the other incretins rather than built here.
 */
function unlabelled(entry: {
  id: string;
  displayName: string;
  aliases?: string[];
  category: CatalogCategory;
  routes: MedicationRouteId[];
}): CatalogDrug {
  return {
    id: entry.id,
    displayName: entry.displayName,
    aliases: entry.aliases ?? [],
    category: entry.category,
    routes: entry.routes,
    vialSizes: [],
    strengths: null,
    pk: null,
    cadence: null,
  };
}

/**
 * Incretins: the GLP-1 family and its cousins.
 *
 * The six with `pk` are the PK registry's drugs, and only they get the serum-level chart and
 * the GLP-1 coach. The rest are investigational — a user on cagrilintide can log it and see it
 * in their cabinet; what they cannot see is a serum curve drawn from a half-life nobody has
 * published.
 */
const INCRETINS = {
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
  cagrilintide: unlabelled({
    id: "cagrilintide",
    displayName: "Cagrilintide",
    aliases: ["Cagri"],
    category: "incretin",
    routes: ["subcutaneous"],
  }),
  survodutide: unlabelled({
    id: "survodutide",
    displayName: "Survodutide",
    aliases: ["BI 456906"],
    category: "incretin",
    routes: ["subcutaneous"],
  }),
  mazdutide: unlabelled({
    id: "mazdutide",
    displayName: "Mazdutide",
    aliases: ["IBI362"],
    category: "incretin",
    routes: ["subcutaneous"],
  }),
} satisfies Record<string, CatalogDrug>;

/**
 * Growth hormone secretagogues.
 *
 * Tesamorelin is the only one with a live approved label, and what that label publishes is a
 * vial size — the drug ships as a lyophilized powder the user reconstitutes, which is the
 * calculator's exact case. Sermorelin had a US label (Geref) but it was discontinued, so there
 * is no current document to cite and nothing is claimed for it.
 */
const GH_SECRETAGOGUES = {
  tesamorelin: {
    id: "tesamorelin",
    displayName: "Tesamorelin",
    // Egrifta is an alias rather than its own entry: what its label adds is a vial size, and a
    // vial size is the same fact whoever supplied the powder. No ladder, so no split.
    aliases: ["Egrifta"],
    category: "gh-secretagogue",
    routes: ["subcutaneous"],
    // Both currently marketed presentations. EGRIFTA SV is a 2 mg single-dose vial reconstituted
    // with 0.5 mL; EGRIFTA WR is an 11.6 mg single-patient-use vial reconstituted with 1.3 mL.
    vialSizes: [
      { amount: 2, unit: "mg" },
      { amount: 11.6, unit: "mg" },
    ],
    // The label prescribes a daily dose (1.4 mg SV, 1.28 mg WR), but that is a *dose*, not a
    // product strength — the vial is one strength and the syringe makes the dose. Originating
    // it here would be the catalog handing someone a number, which is exactly the rule.
    strengths: null,
    pk: null,
    // Two documents, so this one is written out rather than built by `dailyMed`.
    labelSource: {
      document:
        "EGRIFTA SV (tesamorelin) and EGRIFTA WR (tesamorelin) — US prescribing information, " +
        "DailyMed set ids 3d783378-b02d-4f19-99dd-0fc91a042224 and " +
        "839334d3-8c1d-4c26-9036-2ab524a6ea75",
      reviewed: "2026-08-25",
    },
    cadence: "daily",
  },
  sermorelin: unlabelled({
    id: "sermorelin",
    displayName: "Sermorelin",
    category: "gh-secretagogue",
    routes: ["subcutaneous"],
  }),
  ipamorelin: unlabelled({
    id: "ipamorelin",
    displayName: "Ipamorelin",
    category: "gh-secretagogue",
    routes: ["subcutaneous"],
  }),
  // Two entries, not one with an aliased variant: the DAC and no-DAC forms are different
  // molecules with materially different durations of action, and a user who logs "CJC-1295"
  // meaning one of them should not have the other's name on their record.
  cjc_1295_dac: unlabelled({
    id: "cjc_1295_dac",
    displayName: "CJC-1295 with DAC",
    aliases: ["CJC-1295 DAC", "CJC1295 DAC"],
    category: "gh-secretagogue",
    routes: ["subcutaneous"],
  }),
  cjc_1295_no_dac: unlabelled({
    id: "cjc_1295_no_dac",
    displayName: "CJC-1295 without DAC",
    aliases: ["Mod GRF 1-29", "Modified GRF 1-29", "CJC1295 no DAC"],
    category: "gh-secretagogue",
    routes: ["subcutaneous"],
  }),
  hexarelin: unlabelled({
    id: "hexarelin",
    displayName: "Hexarelin",
    category: "gh-secretagogue",
    routes: ["subcutaneous"],
  }),
  ghrp_2: unlabelled({
    id: "ghrp_2",
    displayName: "GHRP-2",
    aliases: ["GHRP2", "Pralmorelin"],
    category: "gh-secretagogue",
    routes: ["subcutaneous"],
  }),
  ghrp_6: unlabelled({
    id: "ghrp_6",
    displayName: "GHRP-6",
    aliases: ["GHRP6"],
    category: "gh-secretagogue",
    routes: ["subcutaneous"],
  }),
  ibutamoren: unlabelled({
    id: "ibutamoren",
    displayName: "Ibutamoren (MK-677)",
    aliases: ["MK-677", "MK677", "Nutrobal"],
    category: "gh-secretagogue",
    routes: ["oral"],
  }),
} satisfies Record<string, CatalogDrug>;

/** Repair and recovery peptides. No approved label for any of them, anywhere. */
const REPAIR = {
  bpc_157: unlabelled({
    id: "bpc_157",
    displayName: "BPC-157",
    aliases: ["BPC157"],
    category: "repair",
    routes: ["subcutaneous", "oral"],
  }),
  tb_500: unlabelled({
    id: "tb_500",
    displayName: "TB-500",
    // Not aliased to "Thymosin Beta-4": TB-500 is a fragment of it, not the same peptide, and
    // resolving one name to the other would put the wrong molecule on a medication record.
    aliases: ["TB500"],
    category: "repair",
    routes: ["subcutaneous"],
  }),
  ghk_cu: unlabelled({
    id: "ghk_cu",
    displayName: "GHK-Cu",
    aliases: ["GHK", "Copper peptide"],
    category: "repair",
    routes: ["subcutaneous", "topical"],
  }),
} satisfies Record<string, CatalogDrug>;

/** Melanocortin agonists. */
const MELANOCORTINS = {
  bremelanotide: unlabelled({
    id: "bremelanotide",
    displayName: "Bremelanotide (PT-141)",
    aliases: ["PT-141", "PT141"],
    category: "melanocortin",
    routes: ["subcutaneous"],
  }),
  melanotan_ii: unlabelled({
    id: "melanotan_ii",
    displayName: "Melanotan II",
    aliases: ["MT-2", "MT2", "Melanotan 2"],
    category: "melanocortin",
    routes: ["subcutaneous"],
  }),
} satisfies Record<string, CatalogDrug>;

/** Metabolic peptides and small molecules. */
const METABOLIC = {
  aod_9604: unlabelled({
    id: "aod_9604",
    displayName: "AOD-9604",
    aliases: ["AOD9604"],
    category: "metabolic",
    routes: ["subcutaneous"],
  }),
  amino_1mq: unlabelled({
    id: "amino_1mq",
    displayName: "5-Amino-1MQ",
    aliases: ["5-Amino 1MQ", "5A1MQ"],
    category: "metabolic",
    routes: ["oral"],
  }),
  mots_c: unlabelled({
    id: "mots_c",
    displayName: "MOTS-c",
    aliases: ["MOTSc"],
    category: "metabolic",
    routes: ["subcutaneous"],
  }),
} satisfies Record<string, CatalogDrug>;

/** Immune-modulating peptides. */
const IMMUNE = {
  thymosin_alpha_1: {
    id: "thymosin_alpha_1",
    displayName: "Thymosin Alpha-1",
    aliases: ["Thymalfasin", "Zadaxin", "Ta1"],
    category: "immune",
    routes: ["subcutaneous"],
    // 1.6 mg lyophilized vial, reconstituted with 1 mL of the supplied sterile water.
    vialSizes: [{ amount: 1.6, unit: "mg" }],
    strengths: null,
    pk: null,
    // The one label here that is not FDA's: thymalfasin has no US approval, so there is no
    // DailyMed record and the manufacturer's monograph is the source. Named as such rather than
    // dressed up as an FDA document.
    labelSource: {
      document:
        "ZADAXIN (thymalfasin) manufacturer product monograph, SciClone — no FDA approval; not a DailyMed record",
      reviewed: "2026-08-25",
    },
    // The monograph doses it twice weekly, which this field cannot express, so it says nothing.
    cadence: null,
  },
  kpv: unlabelled({
    id: "kpv",
    displayName: "KPV",
    category: "immune",
    routes: ["subcutaneous", "oral", "topical"],
  }),
  ll_37: unlabelled({
    id: "ll_37",
    displayName: "LL-37",
    aliases: ["Cathelicidin"],
    category: "immune",
    routes: ["subcutaneous"],
  }),
} satisfies Record<string, CatalogDrug>;

/**
 * The TRT-adjacent list.
 *
 * Testosterone itself is deliberately absent. Its labels are concentrations in oil (100 and
 * 200 mg/mL), not a deliverable-dose ladder, and the esters and their pack sizes are exactly
 * what the RxTerms lookup is for — the blueprint puts testosterone in that phase, so the
 * bundled catalog does not half-answer it here.
 */
const ANDROGEN_ADJACENT = {
  hcg: {
    id: "hcg",
    displayName: "Chorionic gonadotropin (hCG)",
    aliases: ["hCG", "Pregnyl", "Novarel"],
    category: "androgen",
    // The label is intramuscular; subcutaneous is the common off-label route and is offered
    // because a route the user cannot pick is a route they will record wrongly.
    routes: ["intramuscular", "subcutaneous"],
    // Supplied as a lyophilized powder in a 10,000 USP unit vial with bacteriostatic water —
    // the reconstitution case the calculator exists for, and the reason IU never converts to
    // mass anywhere in `reconstitution.ts`.
    vialSizes: [{ amount: 10000, unit: "iu" }],
    strengths: null,
    pk: null,
    labelSource: dailyMed(
      "PREGNYL (chorionic gonadotropin for injection, USP)",
      "dc604794-6dd6-43a7-85fa-2f04ed325c33",
      "2026-08-25",
    ),
    // The label doses by protocol, not by interval.
    cadence: null,
  },
  menotropins: {
    id: "menotropins",
    displayName: "Menotropins (hMG)",
    aliases: ["hMG", "Menopur"],
    category: "androgen",
    routes: ["subcutaneous"],
    // 75 IU of FSH activity and 75 IU of LH activity per lyophilized vial.
    vialSizes: [{ amount: 75, unit: "iu" }],
    strengths: null,
    pk: null,
    labelSource: dailyMed(
      "MENOPUR (menotropins for injection, USP)",
      "22c8db95-c3db-1770-8086-31356fbabe35",
      "2026-08-25",
    ),
    cadence: "daily",
  },
  enclomiphene: unlabelled({
    id: "enclomiphene",
    displayName: "Enclomiphene",
    aliases: ["Enclomiphene citrate"],
    category: "androgen",
    routes: ["oral"],
  }),
} satisfies Record<string, CatalogDrug>;

/**
 * The molecules.
 *
 * `strengths` is null on every one of these and that is not a gap. For most of them there is no
 * label at all: a user holding a compounded or grey-market vial of semaglutide picks this entry
 * and the reconstitution calculator does the arithmetic on the numbers they supply, and someone
 * holding a pen picks the brand below, which does have one. For the four that *are* approved
 * products under their generic name — tesamorelin, thymosin alpha-1, hCG, menotropins — the
 * label publishes a vial and a dosing protocol rather than a ladder of deliverable strengths,
 * so there is still no ladder to state. Either way the entry answers the question the same way,
 * with the calculator.
 *
 * Those same four are the only entries carrying `vialSizes`, because their product ships as a
 * lyophilized vial the user reconstitutes and the label says how much is in it. Everywhere else
 * it is empty and stays empty: grey-market packaging has no authoritative source, and the field
 * is a suggestion rather than a constraint, so an empty array is a working state rather than a
 * missing one.
 */
const GENERIC_DRUGS = {
  ...INCRETINS,
  ...GH_SECRETAGOGUES,
  ...REPAIR,
  ...MELANOCORTINS,
  ...METABOLIC,
  ...IMMUNE,
  ...ANDROGEN_ADJACENT,
} satisfies Record<string, CatalogDrug>;

/**
 * Build a brand from its molecule, restating only what the label actually changes.
 *
 * Everything else — PK, `glp1ProfileId`, category, routes, cadence — is spread from the generic,
 * so a brand cannot claim a different half-life or route from the molecule it is. `vialSizes` is
 * deliberately cleared rather than inherited: every brand here ships as a pen, a tablet or an
 * autoinjector, and a vial hint on one would prefill the reconstitution calculator for a drug
 * nobody reconstitutes.
 *
 * `labelSource` is a required parameter, not an optional one: a brand exists *because* its label
 * publishes a ladder, so a brand with no citable label is a contradiction the type refuses.
 */
function brandOf(
  generic: CatalogDrug,
  brand: {
    id: string;
    displayName: string;
    strengths: CatalogStrengths;
    labelSource: CatalogLabelSource;
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
    labelSource: brand.labelSource,
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
 *
 * Semaglutide now carries five brands across two molecules, and two pairs of them share a name:
 * Ozempic and Wegovy each label both an injection and a tablet, on one FDA document apiece. They
 * are different products with different ladders and different routes, so they are different
 * entries — a user typing "Wegovy" is offered both and picks the one they hold. That is the
 * split doing its job, not the duplicate-row bug it was built to prevent.
 */
const BRAND_DRUGS: Record<string, CatalogDrug> = {
  ozempic: brandOf(INCRETINS.semaglutide, {
    id: "ozempic",
    displayName: "Ozempic",
    strengths: mgLadder([0.25, 0.5, 1, 2]),
    labelSource: dailyMed(
      "OZEMPIC (semaglutide) injection",
      "adec4fd2-6858-4c99-91d4-531f5f2a2d79",
      "2026-08-25",
    ),
  }),
  ozempic_tablets: brandOf(INCRETINS.oral_semaglutide, {
    id: "ozempic_tablets",
    displayName: "Ozempic tablets",
    strengths: mgLadder([1.5, 4, 9]),
    labelSource: dailyMed(
      "OZEMPIC (oral semaglutide) tablets / RYBELSUS (oral semaglutide) tablets",
      "27f15fac-7d98-4114-a2ec-92494a91da98",
      "2026-08-25",
    ),
  }),
  wegovy: brandOf(INCRETINS.semaglutide, {
    id: "wegovy",
    displayName: "Wegovy",
    // 7.2 mg was added to this label after the ladder was first written here, which is the
    // whole argument for `labelSource.reviewed` existing.
    strengths: mgLadder([0.25, 0.5, 1, 1.7, 2.4, 7.2]),
    labelSource: dailyMed(
      "WEGOVY (semaglutide) injection / WEGOVY (semaglutide) tablets",
      "ee06186f-2aa3-4990-a760-757579d8f77b",
      "2026-08-25",
    ),
  }),
  wegovy_tablets: brandOf(INCRETINS.oral_semaglutide, {
    id: "wegovy_tablets",
    displayName: "Wegovy tablets",
    strengths: mgLadder([1.5, 4, 9, 25]),
    labelSource: dailyMed(
      "WEGOVY (semaglutide) injection / WEGOVY (semaglutide) tablets",
      "ee06186f-2aa3-4990-a760-757579d8f77b",
      "2026-08-25",
    ),
  }),
  rybelsus: brandOf(INCRETINS.oral_semaglutide, {
    id: "rybelsus",
    displayName: "Rybelsus",
    strengths: mgLadder([3, 7, 14]),
    labelSource: dailyMed(
      "OZEMPIC (oral semaglutide) tablets / RYBELSUS (oral semaglutide) tablets",
      "27f15fac-7d98-4114-a2ec-92494a91da98",
      "2026-08-25",
    ),
  }),
  mounjaro: brandOf(INCRETINS.tirzepatide, {
    id: "mounjaro",
    displayName: "Mounjaro",
    strengths: mgLadder([2.5, 5, 7.5, 10, 12.5, 15]),
    labelSource: dailyMed(
      "MOUNJARO (tirzepatide) injection",
      "d2d7da5d-ad07-4228-955f-cf7e355c8cc0",
      "2026-08-25",
    ),
  }),
  zepbound: brandOf(INCRETINS.tirzepatide, {
    id: "zepbound",
    displayName: "Zepbound",
    strengths: mgLadder([2.5, 5, 7.5, 10, 12.5, 15]),
    labelSource: dailyMed(
      "ZEPBOUND (tirzepatide) injection",
      "487cd7e7-434c-4925-99fa-aa80b1cc776b",
      "2026-08-25",
    ),
  }),
  trulicity: brandOf(INCRETINS.dulaglutide, {
    id: "trulicity",
    displayName: "Trulicity",
    strengths: mgLadder([0.75, 1.5, 3, 4.5]),
    labelSource: dailyMed(
      "TRULICITY (dulaglutide) injection",
      "463050bd-2b1c-40f5-b3c3-0a04bb433309",
      "2026-08-25",
    ),
  }),
  victoza: brandOf(INCRETINS.liraglutide, {
    id: "victoza",
    displayName: "Victoza",
    strengths: mgLadder([0.6, 1.2, 1.8]),
    labelSource: dailyMed(
      "VICTOZA (liraglutide) injection",
      "5a9ef4ea-c76a-4d34-a604-27c5b505f5a4",
      "2026-08-25",
    ),
  }),
  saxenda: brandOf(INCRETINS.liraglutide, {
    id: "saxenda",
    displayName: "Saxenda",
    strengths: mgLadder([0.6, 1.2, 1.8, 2.4, 3]),
    labelSource: dailyMed(
      "SAXENDA (liraglutide) injection",
      "3946d389-0926-4f77-a708-0acb8153b143",
      "2026-08-25",
    ),
  }),
  vyleesi: brandOf(MELANOCORTINS.bremelanotide, {
    id: "vyleesi",
    displayName: "Vyleesi",
    // One value is still a ladder: the autoinjector delivers 1.75 mg and nothing else, so the
    // chip row offers exactly that and the calculator stays shut. Someone holding a grey-market
    // PT-141 vial picks the molecule instead and gets the calculator, which is the split working
    // on a drug that has nothing to do with GLP-1s.
    strengths: mgLadder([1.75]),
    labelSource: dailyMed(
      "VYLEESI (bremelanotide) injection",
      "8c9607a2-5b57-4a59-b159-cf196deebdd9",
      "2026-08-25",
    ),
  }),
};

/**
 * The catalog: molecules and the brands of them.
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
 * Whether picking this drug should open the reconstitution calculator on the dosage step.
 *
 * No label means no ladder, so the only honest source for a dose is the vial the user is
 * holding — *if* there is a vial. Before the phase 3 content pass every ladder-less entry was
 * injectable and `strengths === null` was the whole test; the catalog now carries oral entries
 * with no label (ibutamoren, 5-Amino-1MQ, enclomiphene), and offering someone a syringe-unit
 * calculator for a capsule is an answer to a question they did not ask.
 *
 * It only decides what opens *by default*. The "Reconstituting a vial?" link is still there for
 * anyone whose supply does not match the route the catalog expects, so this can be wrong about
 * an edge case without stranding them. It lives here rather than in each form because both
 * platforms make the same decision at the same moment.
 */
export function catalogOpensCalculator(drug: CatalogDrug): boolean {
  if (drug.strengths !== null) return false;
  return drug.routes.some(
    (route) => route === "subcutaneous" || route === "intramuscular",
  );
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
export function resolveCatalogDrug(idOrAlias: string): CatalogDrug | undefined {
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
export function searchCatalog(query: string, limit = 8): CatalogSearchResult[] {
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
