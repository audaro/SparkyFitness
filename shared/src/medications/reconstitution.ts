/**
 * Reconstitution calculator — converts a dose of lyophilized peptide into units on an insulin
 * syringe. Pure arithmetic on numbers the user supplies; no DB, no I/O, no recommendation.
 *
 * ```
 * concentration  = vialAmount / diluentMl        → amount per mL
 * drawVolumeMl   = doseAmount / concentration    → mL
 * syringeUnits   = drawVolumeMl × unitsPerMl     → marks on the syringe barrel
 * dosesPerVial   = floor(vialAmount / doseAmount)
 * vialLastsDays  = dosesPerVial × intervalDays
 * ```
 *
 * THIS IS DOSING MATH, SO IT FAILS LOUDLY.
 * Every function returns a discriminated result — `{ ok: true, … }` or `{ ok: false, reason }`
 * — and never a number it is not sure of. A plausible-but-wrong draw volume is far worse than
 * an error the UI can show, because the user acts on it with a syringe. There is no partial
 * result: a success carries every field, computed and finite, or it is not a success.
 *
 * Two conversions are the dangerous ones, and they are handled in opposite ways:
 *   - **mg ↔ mcg** is a fixed ×1000 and is converted explicitly, never implied.
 *   - **IU ↔ mass** is substance-specific and has no general factor, so it is *refused*. An IU
 *     vial must be dosed in IU. Guessing here is a silent, unbounded error.
 */

/** Units a vial or dose can be expressed in. */
export type ReconstitutionUnit = "mg" | "mcg" | "iu";

/**
 * Insulin syringe standard. The number of marks per mL differs by 2.5×, so which syringe is in
 * the user's hand is part of the input, and the answer always says which one it assumed.
 */
export type SyringeStandard = "U-100" | "U-40";

/** Marks per mL for each standard. U-100 is the common insulin syringe; U-40 is veterinary. */
export const SYRINGE_UNITS_PER_ML: Record<SyringeStandard, number> = {
  "U-100": 100,
  "U-40": 40,
};

/** Below this many marks, the volume is too small to measure reliably on a barrel. */
export const MIN_RELIABLE_SYRINGE_UNITS = 2;

/**
 * Default tMax-style fallback for syringe capacity: one full mL of whichever standard is in
 * use (100 marks on U-100, 40 on U-40). Drawing more than this needs a second draw regardless.
 */
function defaultCapacityUnits(syringe: SyringeStandard): number {
  return SYRINGE_UNITS_PER_ML[syringe];
}

export interface ReconstitutionAmount {
  amount: number;
  unit: ReconstitutionUnit;
}

export interface ReconstitutionInput {
  /** What the vial contains before any diluent is added. */
  vial: ReconstitutionAmount;
  /** Bacteriostatic water added, in mL. */
  diluentMl: number;
  /** One administration. Must share a unit *family* with the vial (mass with mass, IU with IU). */
  dose: ReconstitutionAmount;
  /** Which syringe the user is measuring with. Defaults to U-100. */
  syringe?: SyringeStandard;
  /** Barrel capacity in marks. Defaults to one full mL of the chosen standard. */
  syringeCapacityUnits?: number;
  /** Days between doses, for `vialLastsDays`. Omit or null to skip that output. */
  intervalDays?: number | null;
}

export type ReconstitutionErrorReason =
  | "invalid_vial_amount"
  | "invalid_diluent"
  | "invalid_dose"
  | "invalid_syringe"
  | "invalid_syringe_capacity"
  | "invalid_target_units"
  | "invalid_interval"
  | "unit_mismatch"
  | "dose_exceeds_vial"
  | "not_finite";

export type ReconstitutionWarningCode =
  | "exceeds_syringe_capacity"
  | "below_measurable_precision";

/**
 * The values interpolated into a message, handed over separately so a UI can render the same
 * sentence in the user's own language. Keys are stable per `reason` / `code` and are exactly
 * the placeholders the English `message` fills in.
 */
export type ReconstitutionMessageDetails = Record<string, string | number>;

export interface ReconstitutionWarning {
  code: ReconstitutionWarningCode;
  /**
   * English text. A **fallback**, not the thing to render: this package has no translator, so
   * a localised UI must build its own sentence from `code` and `details`.
   */
  message: string;
  details: ReconstitutionMessageDetails;
}

export interface ReconstitutionSuccess {
  ok: true;
  /** Amount per mL after reconstitution, expressed in `concentrationUnit`. */
  concentration: number;
  /** The vial's unit — concentration is always `concentrationUnit` per mL. */
  concentrationUnit: ReconstitutionUnit;
  /** Volume to draw, in mL. */
  drawVolumeMl: number;
  /** Marks to draw to on the barrel. */
  syringeUnits: number;
  /** Echoed back so the number is never read against the wrong barrel. */
  syringe: SyringeStandard;
  syringeUnitsPerMl: number;
  /** Whole doses the vial yields. */
  dosesPerVial: number;
  /** `dosesPerVial × intervalDays`, or null when no interval was supplied. */
  vialLastsDays: number | null;
  /** Non-fatal cautions. A success with warnings is still a complete, checked answer. */
  warnings: ReconstitutionWarning[];
}

export interface ReconstitutionFailure {
  ok: false;
  reason: ReconstitutionErrorReason;
  /**
   * Plain-language English explanation. A **fallback**, not the thing to render: this package
   * has no translator, so a localised UI must build its own sentence from `reason` and
   * `details` and fall back to this only when it has no string for that reason.
   */
  message: string;
  /** Values the message interpolates, for a UI rendering its own translation. */
  details: ReconstitutionMessageDetails;
}

export type ReconstitutionResult =
  | ReconstitutionSuccess
  | ReconstitutionFailure;

/**
 * Floating-point slack. `0.3 / 0.1` is `2.9999999999999996` in IEEE 754, which would floor to
 * 2 doses instead of 3, and a dose exactly equal to the vial would read as exceeding it. This
 * is small enough never to mask a real difference at the magnitudes involved (mg and mcg).
 */
const EPSILON = 1e-9;

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function fail(
  reason: ReconstitutionErrorReason,
  message: string,
  details: ReconstitutionMessageDetails = {},
): ReconstitutionFailure {
  return { ok: false, reason, message, details };
}

/** True when two units measure the same thing. Mass converts; IU does not cross over. */
function sameUnitFamily(a: ReconstitutionUnit, b: ReconstitutionUnit): boolean {
  const isMass = (u: ReconstitutionUnit) => u === "mg" || u === "mcg";
  return (isMass(a) && isMass(b)) || (a === "iu" && b === "iu");
}

/**
 * Express `amount` of `from` in `to`, or null when the two units do not measure the same thing.
 *
 * The null is the whole point: IU has no general factor to mass, so a caller that wants a number
 * has to decide what to do about the ones that cannot exist rather than receive a guess.
 */
export function convertReconstitutionUnits(
  amount: number,
  from: ReconstitutionUnit,
  to: ReconstitutionUnit,
): number | null {
  if (!sameUnitFamily(from, to)) return null;
  return convert(amount, from, to);
}

/**
 * Express `amount` of `from` in `to`, for units in the same family. mg → mcg is ×1000, spelled
 * out rather than implied. Callers must have checked `sameUnitFamily` first.
 */
function convert(
  amount: number,
  from: ReconstitutionUnit,
  to: ReconstitutionUnit,
): number {
  if (from === to) return amount;
  if (from === "mg" && to === "mcg") return amount * 1000;
  if (from === "mcg" && to === "mg") return amount / 1000;
  // Unreachable once sameUnitFamily has passed; kept so a future unit cannot fall through
  // to a silent identity conversion.
  throw new Error(
    `reconstitution.ts: refusing to convert ${from} to ${to} — no defined factor.`,
  );
}

/**
 * Work out the draw for one dose from a reconstituted vial.
 *
 * Returns a complete answer or a reason, never a partial one.
 */
export function reconstitute(input: ReconstitutionInput): ReconstitutionResult {
  const {
    vial,
    diluentMl,
    dose,
    syringe = "U-100",
    syringeCapacityUnits,
    intervalDays,
  } = input;

  // --- Validate every input before any arithmetic runs. -------------------------------
  if (!vial || !isPositiveFinite(vial.amount)) {
    return fail(
      "invalid_vial_amount",
      "Enter how much the vial contains, as a number greater than zero.",
    );
  }
  if (!isPositiveFinite(diluentMl)) {
    return fail(
      "invalid_diluent",
      "Enter how much diluent you added, in mL, as a number greater than zero.",
    );
  }
  if (!dose || !isPositiveFinite(dose.amount)) {
    return fail(
      "invalid_dose",
      "Enter your dose as a number greater than zero.",
    );
  }

  const unitsPerMl = SYRINGE_UNITS_PER_ML[syringe];
  if (!isPositiveFinite(unitsPerMl)) {
    return fail(
      "invalid_syringe",
      `Unknown syringe standard "${String(syringe)}". Supported: U-100, U-40.`,
      { syringe: String(syringe) },
    );
  }

  if (
    syringeCapacityUnits !== undefined &&
    !isPositiveFinite(syringeCapacityUnits)
  ) {
    return fail(
      "invalid_syringe_capacity",
      "Syringe capacity must be a number of units greater than zero.",
    );
  }
  const capacityUnits = syringeCapacityUnits ?? defaultCapacityUnits(syringe);

  if (
    intervalDays !== undefined &&
    intervalDays !== null &&
    !isPositiveFinite(intervalDays)
  ) {
    return fail(
      "invalid_interval",
      "Days between doses must be a number greater than zero.",
    );
  }

  // IU is substance-specific: there is no general IU↔mg factor, so refuse rather than guess.
  if (!sameUnitFamily(vial.unit, dose.unit)) {
    return fail(
      "unit_mismatch",
      `A vial measured in ${vial.unit} cannot be dosed in ${dose.unit}. ` +
        `IU and mg are not interchangeable — the factor depends on the substance.`,
      { vialUnit: vial.unit, doseUnit: dose.unit },
    );
  }

  // --- Arithmetic, all of it in the vial's unit. ---------------------------------------
  const doseInVialUnit = convert(dose.amount, dose.unit, vial.unit);

  if (doseInVialUnit > vial.amount * (1 + EPSILON)) {
    return fail(
      "dose_exceeds_vial",
      `A ${dose.amount} ${dose.unit} dose is more than the vial holds ` +
        `(${vial.amount} ${vial.unit}).`,
      {
        doseAmount: dose.amount,
        doseUnit: dose.unit,
        vialAmount: vial.amount,
        vialUnit: vial.unit,
      },
    );
  }

  const concentration = vial.amount / diluentMl;
  const drawVolumeMl = doseInVialUnit / concentration;
  const syringeUnitsRaw = drawVolumeMl * unitsPerMl;
  const dosesPerVial = Math.floor(vial.amount / doseInVialUnit + EPSILON);

  // Round before the warnings so the caution the user reads matches the number they read.
  const roundedConcentration = roundTo(concentration, 4);
  const roundedDrawVolumeMl = roundTo(drawVolumeMl, 4);
  const roundedSyringeUnits = roundTo(syringeUnitsRaw, 2);
  const vialLastsDays =
    intervalDays !== undefined && intervalDays !== null
      ? roundTo(dosesPerVial * intervalDays, 2)
      : null;

  // --- Nothing leaves here unless every number is real. --------------------------------
  const computed = [
    roundedConcentration,
    roundedDrawVolumeMl,
    roundedSyringeUnits,
    dosesPerVial,
    ...(vialLastsDays === null ? [] : [vialLastsDays]),
  ];
  if (!computed.every((n) => Number.isFinite(n)) || dosesPerVial < 1) {
    return fail(
      "not_finite",
      "Could not compute a reliable result from those numbers. Check the vial, diluent and dose.",
    );
  }

  const warnings: ReconstitutionWarning[] = [];
  if (roundedSyringeUnits > capacityUnits) {
    warnings.push({
      code: "exceeds_syringe_capacity",
      message:
        `${roundedSyringeUnits} units is more than a ${capacityUnits}-unit ${syringe} syringe holds. ` +
        `Use a larger syringe, split the draw, or add less diluent.`,
      details: { units: roundedSyringeUnits, capacityUnits, syringe },
    });
  }
  if (roundedSyringeUnits < MIN_RELIABLE_SYRINGE_UNITS) {
    warnings.push({
      code: "below_measurable_precision",
      message:
        `${roundedSyringeUnits} units is below what a syringe barrel measures reliably. ` +
        `Add more diluent so the same dose draws to a larger volume.`,
      details: { units: roundedSyringeUnits },
    });
  }

  return {
    ok: true,
    concentration: roundedConcentration,
    concentrationUnit: vial.unit,
    drawVolumeMl: roundedDrawVolumeMl,
    syringeUnits: roundedSyringeUnits,
    syringe,
    syringeUnitsPerMl: unitsPerMl,
    dosesPerVial,
    vialLastsDays,
    warnings,
  };
}

/**
 * Inverse helper: how much diluent to add so one dose lands on a chosen number of marks.
 * Useful for "I want my 2 mg dose to be exactly 20 units". Same fail-loudly contract.
 */
export function diluentForTargetUnits(input: {
  vial: ReconstitutionAmount;
  dose: ReconstitutionAmount;
  targetSyringeUnits: number;
  syringe?: SyringeStandard;
}): { ok: true; diluentMl: number } | ReconstitutionFailure {
  const { vial, dose, targetSyringeUnits, syringe = "U-100" } = input;

  if (!vial || !isPositiveFinite(vial.amount)) {
    return fail(
      "invalid_vial_amount",
      "Enter how much the vial contains, as a number greater than zero.",
    );
  }
  if (!dose || !isPositiveFinite(dose.amount)) {
    return fail(
      "invalid_dose",
      "Enter your dose as a number greater than zero.",
    );
  }
  const unitsPerMl = SYRINGE_UNITS_PER_ML[syringe];
  if (!isPositiveFinite(unitsPerMl)) {
    return fail(
      "invalid_syringe",
      `Unknown syringe standard "${String(syringe)}". Supported: U-100, U-40.`,
      { syringe: String(syringe) },
    );
  }
  if (!isPositiveFinite(targetSyringeUnits)) {
    return fail(
      "invalid_target_units",
      "Enter the number of units you want to draw, greater than zero.",
    );
  }
  if (!sameUnitFamily(vial.unit, dose.unit)) {
    return fail(
      "unit_mismatch",
      `A vial measured in ${vial.unit} cannot be dosed in ${dose.unit}. ` +
        `IU and mg are not interchangeable — the factor depends on the substance.`,
      { vialUnit: vial.unit, doseUnit: dose.unit },
    );
  }

  const doseInVialUnit = convert(dose.amount, dose.unit, vial.unit);
  if (doseInVialUnit > vial.amount * (1 + EPSILON)) {
    return fail(
      "dose_exceeds_vial",
      `A ${dose.amount} ${dose.unit} dose is more than the vial holds ` +
        `(${vial.amount} ${vial.unit}).`,
      {
        doseAmount: dose.amount,
        doseUnit: dose.unit,
        vialAmount: vial.amount,
        vialUnit: vial.unit,
      },
    );
  }

  // targetUnits / unitsPerMl = drawMl; concentration = dose / drawMl; diluent = vial / conc.
  const drawVolumeMl = targetSyringeUnits / unitsPerMl;
  const diluentMl = roundTo((vial.amount * drawVolumeMl) / doseInVialUnit, 4);

  if (!isPositiveFinite(diluentMl)) {
    return fail(
      "not_finite",
      "Could not compute a diluent volume from those numbers.",
    );
  }
  return { ok: true, diluentMl };
}
