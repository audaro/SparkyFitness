/**
 * What a reconstituted medication remembers about how it was mixed, and how to get back from a
 * saved row to the number the user actually acts on.
 *
 * Applying the calculator writes a concentration into `strength` (`10` + `mg/mL`) and the dose
 * into `dose`. Those two are enough to compute the draw, but not enough to say where they came
 * from: a 30 mg vial in 3 mL and a 10 mg vial in 1 mL are the same strength and a different
 * bottle. `ReconstitutionRecord` is the missing half, stored under one key in the medication's
 * `custom_fields` so no migration is involved.
 *
 * THE RECORD IS NOT THE SOURCE OF THE DRAW. `concentrationDraw` derives from the medication's
 * own `strength` and `dose` columns, so a hand-edited strength can never disagree with the units
 * shown next to it. The record's job is to repopulate the calculator, nothing more.
 */

import {
  convertReconstitutionUnits,
  reconstitute,
  SYRINGE_UNITS_PER_ML,
  type ReconstitutionUnit,
  type SyringeStandard,
} from "./reconstitution.ts";

/** The `medications.custom_fields` key the record lives under. */
export const RECONSTITUTION_FIELD = "reconstitution";

/**
 * What the powder was dissolved in.
 *
 * This is the fact that decides the beyond-use window, and the record used to leave it out —
 * so the inventory form had to *assume* bacteriostatic water to offer a date at all. The
 * distinction that matters is whether the fluid carries a preservative: the benzyl alcohol in a
 * bacteriostatic diluent is what buys a multi-day window, and a preservative-free one has none.
 */
export type ReconstitutionDiluent =
  | "bacteriostatic_water"
  | "bacteriostatic_saline"
  | "sterile_water"
  | "sterile_saline";

const DILUENTS: readonly ReconstitutionDiluent[] = [
  "bacteriostatic_water",
  "bacteriostatic_saline",
  "sterile_water",
  "sterile_saline",
];

/** The diluents carrying a preservative, and so the only ones with a multi-day window. */
const PRESERVED_DILUENTS: readonly ReconstitutionDiluent[] = [
  "bacteriostatic_water",
  "bacteriostatic_saline",
];

/** The mix, as the user entered it. Snake_case because it is persisted JSON, not a view model. */
export interface ReconstitutionRecord {
  /** What the vial held before any diluent. */
  vial_amount: number;
  vial_unit: ReconstitutionUnit;
  /** Diluent added, in mL. */
  diluent_ml: number;
  /** The barrel the user measured with — 100 marks per mL reads very differently from 40. */
  syringe: SyringeStandard;
  /**
   * What the diluent was, or null when the record does not say.
   *
   * Null is a first-class answer here, not a parse failure. Records written before this field
   * existed have no diluent and are still perfectly good records — the field feeds the
   * beyond-use suggestion and *nothing* in the syringe math — so an absent or unrecognised
   * value reads as "not stated" rather than voiding the whole record. That is a deliberate
   * exception to the all-or-nothing rule below: refusing the record would silently break every
   * mix a user has already saved, in order to protect arithmetic this field is not part of.
   */
  diluent: ReconstitutionDiluent | null;
}

const UNITS: readonly ReconstitutionUnit[] = ["mg", "mcg", "iu"];
const SYRINGES: readonly SyringeStandard[] = ["U-100", "U-40"];

/** The suffix that makes a strength a concentration rather than a per-tablet amount. */
const PER_ML = "/mL";

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isUnit(value: unknown): value is ReconstitutionUnit {
  return UNITS.includes(value as ReconstitutionUnit);
}

function isSyringe(value: unknown): value is SyringeStandard {
  return SYRINGES.includes(value as SyringeStandard);
}

function isDiluent(value: unknown): value is ReconstitutionDiluent {
  return DILUENTS.includes(value as ReconstitutionDiluent);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Pull the record out of a medication's `custom_fields`.
 *
 * Returns null for anything that is not a complete, valid record. `custom_fields` is free-form
 * JSONB that older rows, other clients and hand edits all write into, so a half-populated record
 * has to read as "no record" — repopulating a syringe calculator from a partially trusted blob
 * is how a user ends up drawing to the wrong mark.
 */
export function readReconstitutionRecord(
  customFields: unknown,
): ReconstitutionRecord | null {
  if (typeof customFields !== "object" || customFields === null) return null;
  if (!Object.hasOwn(customFields, RECONSTITUTION_FIELD)) return null;

  const raw = (customFields as Record<string, unknown>)[RECONSTITUTION_FIELD];
  if (typeof raw !== "object" || raw === null) return null;

  const record = raw as Record<string, unknown>;
  if (!isPositiveFinite(record["vial_amount"])) return null;
  if (!isUnit(record["vial_unit"])) return null;
  if (!isPositiveFinite(record["diluent_ml"])) return null;
  if (!isSyringe(record["syringe"])) return null;

  const diluent = record["diluent"];

  return {
    vial_amount: record["vial_amount"],
    vial_unit: record["vial_unit"],
    diluent_ml: record["diluent_ml"],
    syringe: record["syringe"],
    // Absent, null, or a value this version does not know: all of them mean "not stated".
    diluent: isDiluent(diluent) ? diluent : null,
  };
}

/**
 * Days a vial reconstituted with a preserved diluent is conventionally given from first
 * puncture, refrigerated. This is the figure the inventory form has always used; what changes
 * with `diluent` on the record is that it is now *conditional* rather than assumed.
 */
export const PRESERVED_BUD_DAYS = 28;

export interface VialBudGuidance {
  /** Days from opening to suggest, or null when no multi-day window can honestly be offered. */
  days: number | null;
  /**
   * Why that is the answer, so a UI can say which of the three situations it is in rather than
   * showing a bare date. `unstated` is a record written before the diluent was captured.
   */
  reason: "preserved" | "preservative_free" | "unstated";
}

/**
 * What beyond-use window, if any, follows from the diluent.
 *
 * A preservative-free mix gets **no** suggestion. There is a real figure for one — it is
 * measured in hours, and it depends on how the vial was punctured and where — and putting a day
 * count on it here would be this module recommending rather than converting, which is the line
 * `reconstitute` already refuses to cross. An empty date the user fills in is the honest output;
 * the caller is expected to say why it is empty.
 */
export function vialBudGuidance(
  diluent: ReconstitutionDiluent | null,
): VialBudGuidance {
  if (diluent === null) {
    return { days: PRESERVED_BUD_DAYS, reason: "unstated" };
  }
  return PRESERVED_DILUENTS.includes(diluent)
    ? { days: PRESERVED_BUD_DAYS, reason: "preserved" }
    : { days: null, reason: "preservative_free" };
}

/** The strength unit for a vial measured in `unit` once it is in solution. */
export function concentrationUnitLabel(unit: ReconstitutionUnit): string {
  return `${unit}${PER_ML}`;
}

/**
 * The unit a `<unit>/mL` strength is measured in, or null when the strength is not a
 * concentration at all. A 10 mg tablet and a 10 mg/mL vial are different things, and only the
 * second one has a draw volume.
 */
export function parseConcentrationUnit(
  strengthUnit: string | null | undefined,
): ReconstitutionUnit | null {
  if (!strengthUnit) return null;
  const trimmed = strengthUnit.trim();
  // Tolerant on the reader, exact on the writer: users type "mg/ml" by hand.
  if (!trimmed.toLowerCase().endsWith(PER_ML.toLowerCase())) return null;
  const unit = trimmed.slice(0, -PER_ML.length).trim().toLowerCase();
  return isUnit(unit) ? unit : null;
}

export interface ConcentrationDraw {
  /** Volume to draw, in mL. */
  drawVolumeMl: number;
  /** Marks to draw to on the barrel. */
  syringeUnits: number;
  /** Echoed back so the number is never read against the wrong barrel. */
  syringe: SyringeStandard;
  syringeUnitsPerMl: number;
}

/**
 * How much to draw for one dose of a medication whose strength is a concentration.
 *
 * Derived from the medication's own columns rather than from a `ReconstitutionRecord`, so the
 * marks shown always agree with the strength shown — including for a vial whose strength was
 * typed in by hand and never went through the calculator.
 *
 * Returns null rather than a number whenever the answer is not knowable: no concentration, no
 * dose, units that cannot be converted (IU against mass), or a non-finite result. There is no
 * partial answer here for the same reason `reconstitute` has none — the user acts on it with a
 * syringe.
 */
export function concentrationDraw(input: {
  strengthValue: number | null | undefined;
  strengthUnit: string | null | undefined;
  doseAmount: number | null | undefined;
  doseUnit: string | null | undefined;
  /** Defaults to U-100, the common insulin syringe. */
  syringe?: SyringeStandard | null;
}): ConcentrationDraw | null {
  const concentrationUnit = parseConcentrationUnit(input.strengthUnit);
  if (concentrationUnit === null) return null;
  if (!isPositiveFinite(input.strengthValue)) return null;
  if (!isPositiveFinite(input.doseAmount)) return null;
  if (!isUnit(input.doseUnit)) return null;

  const syringe = input.syringe ?? "U-100";
  if (!isSyringe(syringe)) return null;

  const doseInConcentrationUnit = convertReconstitutionUnits(
    input.doseAmount,
    input.doseUnit,
    concentrationUnit,
  );
  // Null means IU against mass, which has no factor. Refuse rather than guess.
  if (doseInConcentrationUnit === null) return null;

  const unitsPerMl = SYRINGE_UNITS_PER_ML[syringe];
  const drawVolumeMl = doseInConcentrationUnit / input.strengthValue;
  const syringeUnits = drawVolumeMl * unitsPerMl;
  if (!Number.isFinite(drawVolumeMl) || !Number.isFinite(syringeUnits)) {
    return null;
  }

  return {
    drawVolumeMl: roundTo(drawVolumeMl, 4),
    syringeUnits: roundTo(syringeUnits, 2),
    syringe,
    syringeUnitsPerMl: unitsPerMl,
  };
}

/** A bare unit as a user may have typed it — `"MG "` is `mg`. Null for anything else. */
function normaliseUnit(
  value: string | null | undefined,
): ReconstitutionUnit | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return isUnit(trimmed) ? trimmed : null;
}

/** What the inventory form can fill in for itself once a vial's mix is on record. */
export interface VialInventoryPrefill {
  /**
   * Concentration in **mg per mL**, or null when the vial is measured in IU — the inventory
   * column is mg/mL and there is no factor from IU to mass, so an HCG vial leaves it blank
   * rather than carrying a number that means nothing.
   */
  concentrationMgMl: number | null;
  /** The volume the vial holds in solution, in mL: the diluent that was added. */
  volumeMl: number;
  /**
   * Whole doses the vial yields, or null when that is not knowable — no dose on the medication,
   * a dose in a unit family the vial does not share, or a dose larger than the vial holds.
   * Null means "ask the user", never "assume the default".
   */
  dosesTotal: number | null;
  /**
   * The beyond-use window this mix's diluent implies. Carried here so the inventory form reads
   * the record once, and so a `days: null` refusal arrives with the reason attached.
   */
  bud: VialBudGuidance;
}

/**
 * Seed a vial's inventory row from the mix already recorded on the medication.
 *
 * The inventory form used to open on constants — a blank concentration, a blank volume and a
 * doses-per-vial of 10 — for a medication that already knew all three. A user reconstituting a
 * 10 mg vial in 2 mL for a 2 mg dose has five doses in that bottle, and the run-out date the
 * inventory card draws from `doses_total` was wrong by a factor of two for as long as nobody
 * corrected the default by hand.
 *
 * Returns null when the medication carries no valid reconstitution record, which is the signal
 * to leave the form on its own defaults. Every field it does return is derived, never guessed:
 * `dosesTotal` comes from `reconstitute`, so the same refusals that stop the calculator from
 * showing a draw also stop it from filling in a dose count here.
 */
export function vialInventoryPrefill(input: {
  /** The medication's `custom_fields`, as stored. */
  customFields: unknown;
  doseAmount: number | null | undefined;
  doseUnit: string | null | undefined;
}): VialInventoryPrefill | null {
  const record = readReconstitutionRecord(input.customFields);
  if (record === null) return null;

  const concentration = record.vial_amount / record.diluent_ml;
  const concentrationMgMl = Number.isFinite(concentration)
    ? convertReconstitutionUnits(concentration, record.vial_unit, "mg")
    : null;

  const doseUnit = normaliseUnit(input.doseUnit);
  const dose =
    doseUnit !== null && isPositiveFinite(input.doseAmount)
      ? reconstitute({
          vial: { amount: record.vial_amount, unit: record.vial_unit },
          diluentMl: record.diluent_ml,
          dose: { amount: input.doseAmount, unit: doseUnit },
          syringe: record.syringe,
        })
      : null;

  return {
    concentrationMgMl:
      concentrationMgMl === null ? null : roundTo(concentrationMgMl, 4),
    volumeMl: record.diluent_ml,
    dosesTotal: dose?.ok ? dose.dosesPerVial : null,
    bud: vialBudGuidance(record.diluent),
  };
}
