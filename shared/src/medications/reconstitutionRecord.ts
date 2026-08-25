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
  SYRINGE_UNITS_PER_ML,
  type ReconstitutionUnit,
  type SyringeStandard,
} from "./reconstitution.ts";

/** The `medications.custom_fields` key the record lives under. */
export const RECONSTITUTION_FIELD = "reconstitution";

/** The mix, as the user entered it. Snake_case because it is persisted JSON, not a view model. */
export interface ReconstitutionRecord {
  /** What the vial held before any diluent. */
  vial_amount: number;
  vial_unit: ReconstitutionUnit;
  /** Bacteriostatic water added, in mL. */
  diluent_ml: number;
  /** The barrel the user measured with — 100 marks per mL reads very differently from 40. */
  syringe: SyringeStandard;
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

  return {
    vial_amount: record["vial_amount"],
    vial_unit: record["vial_unit"],
    diluent_ml: record["diluent_ml"],
    syringe: record["syringe"],
  };
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
