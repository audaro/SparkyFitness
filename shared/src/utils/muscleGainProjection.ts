import type { ExperienceLevel } from "../constants/experience.ts";
import {
  TESTOSTERONE_ESTERS,
  type TestosteroneEster,
} from "../constants/trainingPlan.ts";
import type { CoachProfileEnhancement } from "../schemas/database/CoachProfiles.zod.ts";

/**
 * Lean mass a user could expect to gain over a horizon, from training and —
 * when they have stated one — from exogenous testosterone.
 *
 * WHAT THIS IS
 * ------------
 * An estimate with a range, assembled from published trials, not a prediction
 * and not advice. Every number it rests on lives in {@link
 * PROJECTION_TUNABLES} with the study it came from named next to it, so the
 * model can be argued with rather than reverse-engineered. Nothing here reads
 * a clock, a database, or a user id: the caller assembles the inputs and this
 * function turns them into kilograms.
 *
 * The output is **lean mass**, not scale weight. A user in a deficit can gain
 * every kilogram this projects and weigh less at the end of it, and the copy
 * on the card has to say so.
 *
 * WHY A RANGE, ALWAYS
 * -------------------
 * The trial figures are group means. Individual response to both training and
 * testosterone varies enough that a single number would be wrong for almost
 * everyone who read it, and would read as a promise. Every output is a low and
 * a high, and a component that cannot be estimated at all comes back null with
 * a reason in {@link MuscleGainProjection.unmodelled} rather than as a zero
 * that looks like an answer.
 */

/** A low and a high estimate, in kilograms, low first. */
export interface ProjectionRange {
  lowKg: number;
  highKg: number;
}

/** Why a component of the projection could not be estimated. */
export type ProjectionGap =
  /** No bodyweight on file; the natural model is a percentage of it. */
  | "bodyweight_unknown"
  /** Nothing to model: the profile states no dose, or states `natural`. */
  | "no_stated_dose"
  /** A dose is stated, but there is no trial data to estimate it from. */
  | "dose_not_modelled_for_sex";

export interface MuscleGainProjectionInput {
  /**
   * `profiles.gender`, normalized. Anything that is not recognisably male or
   * female is `null`, which is treated as "unknown" rather than as a default:
   * the natural rates differ by roughly a factor of two and guessing is worse
   * than widening the range.
   */
  sex: "male" | "female" | null;
  /** `coach_profiles.experience_level`. Sets the training-age band. */
  experienceLevel?: ExperienceLevel | null;
  /**
   * Years training, when something better than the experience level is known
   * (the first logged strength entry, say). Overrides {@link experienceLevel}.
   */
  trainingAgeYears?: number | null;
  /** Latest `check_in_measurements.weight`, which is stored in kilograms. */
  bodyweightKg: number | null;
  /**
   * Mean weekly-target completion over the recent past, 0..1. Clamped here,
   * because it arrives as an average of `overall_percent` values and a single
   * week over target would otherwise push it above 1.
   */
  adherence: number;
  /** `coach_profiles.enhancement`. Null is treated exactly as `natural`. */
  enhancement?: CoachProfileEnhancement | null;
  /** How far ahead to project. Weeks, because the targets are weekly. */
  horizonWeeks: number;
}

export interface MuscleGainProjection {
  /** How far ahead this was projected, after clamping. */
  horizonWeeks: number;
  /** Lean mass from training alone, at the stated adherence. */
  naturalKg: ProjectionRange | null;
  /** Lean mass attributable to the stated dose, on top of the above. */
  enhancedKg: ProjectionRange | null;
  /** The two above added. Null only when neither could be estimated. */
  totalKg: ProjectionRange | null;
  /** {@link totalKg} restated per month, for copy that reads more naturally. */
  perMonthKg: ProjectionRange | null;
  /**
   * What the same inputs project at adherence 1.0.
   *
   * The point of the card: the difference between this and {@link totalKg} is
   * what hitting the weekly targets is worth, which is the question the user
   * actually asked.
   */
  atFullAdherenceKg: ProjectionRange | null;
  /** Reasons a component above is null, in the order they were found. */
  unmodelled: ProjectionGap[];
  /** The studies behind the numbers, for the card to cite. */
  sources: string[];
}

export const PROJECTION_TUNABLES = {
  /**
   * Natural lean-mass gain as a percentage of bodyweight per month, by years
   * of training.
   *
   * The Aragon/Helms rate model, which is the figure the evidence-based
   * coaching literature converged on: a first year that will never come again,
   * then roughly half that, then half again. Bands are the *minimum* training
   * age they apply from, highest first.
   */
  naturalRateByTrainingAge: [
    { fromYears: 3, pctBodyweightPerMonth: { low: 0.25, high: 0.5 } },
    { fromYears: 1, pctBodyweightPerMonth: { low: 0.5, high: 1.0 } },
    { fromYears: 0, pctBodyweightPerMonth: { low: 1.0, high: 1.5 } },
  ] as readonly {
    fromYears: number;
    pctBodyweightPerMonth: { low: number; high: number };
  }[],
  /**
   * Training age assumed from the stated experience level.
   *
   * Unstated resolves to the intermediate figure, matching
   * `deriveDefaultWeeklySetTargets`: "not stated" is an unknown, and the
   * middle of the range is the honest estimate of one.
   */
  trainingAgeYearsByExperience: {
    beginner: 0.5,
    intermediate: 2,
    expert: 5,
  } as Readonly<Record<ExperienceLevel, number>>,
  /** Used when neither a training age nor an experience level is stated. */
  defaultExperienceLevel: "intermediate" as ExperienceLevel,
  /**
   * Women gain lean mass at roughly half the rate in absolute terms, which is
   * most of what the lower total muscle mass and the far lower testosterone
   * produce. Applied to the natural component only.
   */
  femaleNaturalRateFactor: 0.5,
  /** Weeks in a month, for converting the monthly natural rates to weekly. */
  weeksPerMonth: 4.345,

  /**
   * Fat-free-mass change after 20 weeks of testosterone enanthate at a fixed
   * weekly dose, with endogenous production suppressed and **no training**.
   *
   * Bhasin et al. 2001 (Am J Physiol Endocrinol Metab 281:E1172). The 25 and
   * 50 mg/wk arms lost mass — they are below replacement for a man whose own
   * production is suppressed — which is why the curve below tapers to zero
   * rather than starting at the lowest arm.
   */
  doseAnchors: [
    { mgPerWeek: 125, kgPer20Weeks: 3.4 },
    { mgPerWeek: 300, kgPer20Weeks: 5.2 },
    { mgPerWeek: 600, kgPer20Weeks: 7.9 },
  ] as readonly { mgPerWeek: number; kgPer20Weeks: number }[],
  /**
   * Below the lowest anchor the estimate tapers linearly to zero here.
   *
   * A eugonadal man on a low replacement dose is near his own baseline, and
   * the trial has nothing to say about him: its subjects had their own
   * production shut off first, so its low arms measure a deficit this user is
   * not in.
   */
  doseFloorMgPerWeek: 75,
  /**
   * Weeks each anchor covers, and the length of one block of the decay below.
   */
  anchorWeeks: 20,
  /**
   * What each further 20-week block is worth relative to the one before.
   *
   * The trial is a single 20-week cycle, so everything past week 20 is an
   * assumption rather than a measurement: pharmacological gains plateau, and
   * halving each block is a conservative way to say so. A card projecting past
   * 20 weeks should say it is extrapolating.
   */
  laterBlockDecay: 0.5,
  /**
   * Spread applied either side of the dose anchors to produce a range.
   *
   * Not a study figure: the anchors are group means, and Bhasin 2001 reports
   * standard deviations wide enough that a single number would be wrong for
   * most individuals. A flat ±25% is an honest admission of that rather than a
   * derived confidence interval, and it is labelled as an estimate everywhere
   * it surfaces.
   */
  doseResponseSpread: 0.25,
  /**
   * Weekly dose scaled to its enanthate equivalent, by how much of an injected
   * milligram is testosterone rather than ester.
   *
   * Testosterone is 288.4 g/mol; the esters take it to 400.6 (enanthate,
   * 72.0% testosterone), 412.6 (cypionate, 69.9%), 344.5 (propionate, 83.7%)
   * and 456.7 (undecanoate, 63.2%). Each factor is that fraction over
   * enanthate's, because the anchors were dosed as enanthate.
   *
   * `other` is 1.0: an unnamed ester is most likely one of the common ones,
   * and inventing a penalty for not knowing would be worse than assuming the
   * reference.
   */
  esterFactors: {
    enanthate: 1.0,
    cypionate: 0.971,
    propionate: 1.163,
    undecanoate: 0.877,
    other: 1.0,
  } as Readonly<Record<TestosteroneEster, number>>,
  /**
   * How much of the drug component survives zero adherence.
   *
   * Bhasin et al. 1996 (NEJM 335:1) ran 600 mg/wk for 10 weeks with and
   * without training: placebo plus training +2.0 kg, testosterone with no
   * training +3.2 kg, testosterone plus training +6.1 kg. The untrained drug
   * arm still gained about half of what the trained one did, so adherence
   * scales this component by `floor + (1 - floor) x adherence` rather than
   * zeroing it. Training scales fully, because training is the whole mechanism
   * of the natural component.
   */
  doseAdherenceFloor: 0.5,

  /** Horizon bounds. A week is the shortest thing the targets can measure. */
  minHorizonWeeks: 1,
  maxHorizonWeeks: 104,
  /** Everything is reported to this many decimal places, in kilograms. */
  roundToKg: 0.1,
} as const;

export const PROJECTION_SOURCES = [
  "Bhasin S et al. Testosterone dose-response relationships in healthy young men. Am J Physiol Endocrinol Metab. 2001;281(6):E1172-81.",
  "Bhasin S et al. The effects of supraphysiologic doses of testosterone on muscle size and strength in normal men. N Engl J Med. 1996;335(1):1-7.",
  "Aragon AA, Helms E. Rates of lean mass gain by training age, as summarised in the evidence-based coaching literature.",
] as const;

function roundKg(value: number): number {
  const step = PROJECTION_TUNABLES.roundToKg;
  return Math.round(value / step) * step;
}

function range(lowKg: number, highKg: number): ProjectionRange {
  // Rounded on the way out, never mid-computation: rounding a weekly rate and
  // then multiplying by a horizon multiplies the rounding error with it.
  return { lowKg: roundKg(lowKg), highKg: roundKg(highKg) };
}

function addRanges(
  a: ProjectionRange | null,
  b: ProjectionRange | null,
): ProjectionRange | null {
  if (a === null) return b;
  if (b === null) return a;
  return range(a.lowKg + b.lowKg, a.highKg + b.highKg);
}

function scaleRange(value: ProjectionRange, factor: number): ProjectionRange {
  return range(value.lowKg * factor, value.highKg * factor);
}

/** The training age a set of inputs implies, in years. */
export function trainingAgeYearsFor(input: {
  trainingAgeYears?: number | null;
  experienceLevel?: ExperienceLevel | null;
}): number {
  const stated = input.trainingAgeYears;
  if (typeof stated === "number" && Number.isFinite(stated) && stated >= 0) {
    return stated;
  }
  const table = PROJECTION_TUNABLES.trainingAgeYearsByExperience;
  const level = input.experienceLevel;
  if (
    level != null &&
    Object.prototype.hasOwnProperty.call(table, level) === true
  ) {
    return table[level];
  }
  return table[PROJECTION_TUNABLES.defaultExperienceLevel];
}

/**
 * Fat-free mass a 20-week course at this weekly dose produced in trial, with
 * no training, in kilograms.
 *
 * Interpolated in **log dose** between the anchors, because that is the shape
 * the dose-response data has: the step from 125 to 300 mg buys far more than
 * the step from 300 to 600. Linear interpolation would overstate the middle of
 * the range, which is where most stated doses fall.
 *
 * Held flat above the highest anchor. There is no trial data past 600 mg/wk to
 * extrapolate from, and a model that keeps climbing would be inventing a
 * reward for a dose nobody measured.
 */
export function doseResponseKgPer20Weeks(mgPerWeek: number): number {
  const anchors = PROJECTION_TUNABLES.doseAnchors;
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (first === undefined || last === undefined) return 0;
  if (!Number.isFinite(mgPerWeek) || mgPerWeek <= 0) return 0;

  const floor = PROJECTION_TUNABLES.doseFloorMgPerWeek;
  if (mgPerWeek <= floor) return 0;
  if (mgPerWeek < first.mgPerWeek) {
    // Linear, not logarithmic, on the taper: this segment is an assumption
    // about a region the trial deliberately does not cover, and a straight
    // line is the least it can claim.
    const t = (mgPerWeek - floor) / (first.mgPerWeek - floor);
    return first.kgPer20Weeks * t;
  }
  if (mgPerWeek >= last.mgPerWeek) return last.kgPer20Weeks;

  for (let i = 0; i < anchors.length - 1; i += 1) {
    const low = anchors[i];
    const high = anchors[i + 1];
    if (low === undefined || high === undefined) continue;
    if (mgPerWeek >= low.mgPerWeek && mgPerWeek <= high.mgPerWeek) {
      const t =
        (Math.log(mgPerWeek) - Math.log(low.mgPerWeek)) /
        (Math.log(high.mgPerWeek) - Math.log(low.mgPerWeek));
      return low.kgPer20Weeks + t * (high.kgPer20Weeks - low.kgPer20Weeks);
    }
  }
  return last.kgPer20Weeks;
}

/**
 * The 20-week trial figure spread across a horizon, with each further block
 * worth less than the one before.
 */
function doseGainOverHorizon(
  kgPer20Weeks: number,
  horizonWeeks: number,
): number {
  const blockWeeks = PROJECTION_TUNABLES.anchorWeeks;
  const perWeek = kgPer20Weeks / blockWeeks;
  let remaining = horizonWeeks;
  let total = 0;
  let blockFactor = 1;
  while (remaining > 0) {
    const weeks = Math.min(remaining, blockWeeks);
    total += weeks * perWeek * blockFactor;
    remaining -= weeks;
    blockFactor *= PROJECTION_TUNABLES.laterBlockDecay;
  }
  return total;
}

/**
 * The enanthate-equivalent weekly dose a stated enhancement implies, in mg.
 *
 * Two conversions, in this order. First the stated amount is spread over the
 * interval it is taken at — the profile records "1000 mg every 10 weeks" as
 * the user said it, so that the questionnaire can show it back to them
 * unchanged, and the averaging happens here where it is visible. An absent
 * interval means weekly. Second the weekly figure is scaled to its enanthate
 * equivalent, because that is the ester the dose anchors were measured on and
 * a milligram of undecanoate carries noticeably less testosterone.
 *
 * Deliberately total: anything unstated, zero, negative or not a number is a
 * dose of zero, which the projection reports as `no_stated_dose` rather than
 * as an estimate of nothing.
 */
export function effectiveWeeklyDoseMg(
  enhancement: CoachProfileEnhancement | null | undefined,
): number {
  if (!enhancement || enhancement.status === "natural") return 0;
  const perDose = enhancement.testosterone_mg_per_dose;
  if (
    typeof perDose !== "number" ||
    !Number.isFinite(perDose) ||
    perDose <= 0
  ) {
    return 0;
  }
  const interval = enhancement.dose_interval_weeks;
  const intervalWeeks =
    typeof interval === "number" && Number.isFinite(interval) && interval > 0
      ? interval
      : 1;
  const dose = perDose / intervalWeeks;
  const ester = enhancement.ester;
  const factor =
    ester !== undefined && TESTOSTERONE_ESTERS.includes(ester)
      ? PROJECTION_TUNABLES.esterFactors[ester]
      : PROJECTION_TUNABLES.esterFactors.enanthate;
  return dose * factor;
}

function naturalGain(
  input: MuscleGainProjectionInput,
  horizonWeeks: number,
  adherence: number,
): ProjectionRange | null {
  const bodyweight = input.bodyweightKg;
  if (
    typeof bodyweight !== "number" ||
    !Number.isFinite(bodyweight) ||
    bodyweight <= 0
  ) {
    return null;
  }
  const years = trainingAgeYearsFor(input);
  const band =
    PROJECTION_TUNABLES.naturalRateByTrainingAge.find(
      (entry) => years >= entry.fromYears,
    ) ??
    PROJECTION_TUNABLES.naturalRateByTrainingAge[
      PROJECTION_TUNABLES.naturalRateByTrainingAge.length - 1
    ];
  if (band === undefined) return null;

  const sexFactor =
    input.sex === "female" ? PROJECTION_TUNABLES.femaleNaturalRateFactor : 1;
  const months = horizonWeeks / PROJECTION_TUNABLES.weeksPerMonth;
  const perMonth = (pct: number) => (bodyweight * pct) / 100;

  // Adherence scales this component in full: the training *is* the mechanism,
  // so a week of no training is a week of no natural gain.
  return range(
    perMonth(band.pctBodyweightPerMonth.low) * months * sexFactor * adherence,
    perMonth(band.pctBodyweightPerMonth.high) * months * sexFactor * adherence,
  );
}

function drugGain(
  input: MuscleGainProjectionInput,
  horizonWeeks: number,
  adherence: number,
  gaps: ProjectionGap[],
): ProjectionRange | null {
  const doseMg = effectiveWeeklyDoseMg(input.enhancement);
  if (doseMg <= 0) {
    gaps.push("no_stated_dose");
    return null;
  }
  if (input.sex === "female") {
    // The anchors come from trials in men. There is no comparable dose-response
    // data in women, and scaling a male curve by a factor someone invented
    // would be a made-up number wearing a citation.
    gaps.push("dose_not_modelled_for_sex");
    return null;
  }

  const kg = doseGainOverHorizon(
    doseResponseKgPer20Weeks(doseMg),
    horizonWeeks,
  );
  const floor = PROJECTION_TUNABLES.doseAdherenceFloor;
  const adherenceFactor = floor + (1 - floor) * adherence;
  const spread = PROJECTION_TUNABLES.doseResponseSpread;
  const mid = kg * adherenceFactor;
  return range(mid * (1 - spread), mid * (1 + spread));
}

/**
 * Project lean-mass gain over a horizon.
 *
 * Pure and total: every input that could be missing has a documented answer,
 * and nothing here throws. A card that cannot render one component still has
 * the other and a reason for the gap.
 */
export function projectMuscleGain(
  input: MuscleGainProjectionInput,
): MuscleGainProjection {
  const horizonWeeks = Math.min(
    PROJECTION_TUNABLES.maxHorizonWeeks,
    Math.max(
      PROJECTION_TUNABLES.minHorizonWeeks,
      Number.isFinite(input.horizonWeeks) ? Math.round(input.horizonWeeks) : 0,
    ),
  );
  const adherence = Number.isFinite(input.adherence)
    ? Math.min(1, Math.max(0, input.adherence))
    : 0;

  const gaps: ProjectionGap[] = [];
  const natural = naturalGain(input, horizonWeeks, adherence);
  if (natural === null) gaps.push("bodyweight_unknown");
  const enhanced = drugGain(input, horizonWeeks, adherence, gaps);
  const total = addRanges(natural, enhanced);

  const fullNatural = naturalGain(input, horizonWeeks, 1);
  const fullEnhanced = drugGain(input, horizonWeeks, 1, []);
  const atFullAdherence = addRanges(fullNatural, fullEnhanced);

  const months = horizonWeeks / PROJECTION_TUNABLES.weeksPerMonth;
  const perMonth = total === null ? null : scaleRange(total, 1 / months);

  return {
    horizonWeeks,
    naturalKg: natural,
    enhancedKg: enhanced,
    totalKg: total,
    perMonthKg: perMonth,
    atFullAdherenceKg: atFullAdherence,
    unmodelled: gaps,
    sources: [...PROJECTION_SOURCES],
  };
}

/**
 * `profiles.gender` reduced to what the model can use.
 *
 * Anything else — unset, "other", a free-text answer — is `null`, which the
 * projection treats as unknown rather than as male. Defaulting to male would
 * roughly double a woman's natural estimate without telling her, and defaulting
 * to female would do the reverse.
 */
export function projectionSexFrom(
  gender: string | null | undefined,
): "male" | "female" | null {
  const value = (gender ?? "").trim().toLowerCase();
  if (value === "male" || value === "m") return "male";
  if (value === "female" || value === "f") return "female";
  return null;
}
