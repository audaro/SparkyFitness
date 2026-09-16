/**
 * The training-plan questionnaire's vocabularies.
 *
 * These four enums are the structured replacement for reading intent out of
 * free text. `coach_profiles.goals` stays as the "anything else" note, but the
 * generator stops regex-matching it once `primary_goal` is stated: a keyword
 * scan cannot tell "I want to get strong enough to stop hurting my back" from
 * "strength", and it silently picks a program either way.
 *
 * Stored and compared lowercase; display copy owns capitalization and
 * translation, exactly as {@link EXPERIENCE_LEVELS} does.
 */

/**
 * What the user is training for. Drives set volume and rep targets.
 *
 * `recomp` is kept distinct from `build_muscle` and `lose_fat` rather than
 * being derived from the pair, because the user means something specific by
 * it and the volume prescription differs from either one alone.
 */
export const PRIMARY_GOALS = [
  "build_muscle",
  "lose_fat",
  "recomp",
  "strength",
  "general_fitness",
] as const;

export type PrimaryGoal = (typeof PRIMARY_GOALS)[number];

/**
 * The shape the user is training toward. Biases the push/pull/legs ratio and
 * the core allowance.
 *
 * Deliberately separate from {@link PRIMARY_GOALS}: "build muscle" and "look
 * lean" are not the same instruction, and a single field would force the
 * questionnaire to ask one question that answers neither well.
 */
export const PHYSIQUE_TARGETS = [
  "lean",
  "athletic",
  "muscular",
  "powerful",
  "maintain",
] as const;

export type PhysiqueTarget = (typeof PHYSIQUE_TARGETS)[number];

/**
 * Whether the user is training naturally or on exogenous testosterone.
 *
 * `natural` is the default the lean-mass projection assumes when the column is
 * null, so "not answered" and "natural" produce the same projection. Only the
 * presence of a dose changes the estimate.
 */
export const ENHANCEMENT_STATUSES = ["natural", "trt", "enhanced"] as const;

export type EnhancementStatus = (typeof ENHANCEMENT_STATUSES)[number];

/**
 * Testosterone esters, which differ in how much of an injected milligram is
 * testosterone rather than the attached ester chain. The projection's dose
 * anchors are measured on enanthate, so every other ester is scaled against
 * it rather than treated as interchangeable.
 */
export const TESTOSTERONE_ESTERS = [
  "enanthate",
  "cypionate",
  "propionate",
  "undecanoate",
  "other",
] as const;

export type TestosteroneEster = (typeof TESTOSTERONE_ESTERS)[number];

/**
 * Upper bound on the *derived* weekly dose, in milligrams.
 *
 * A bound, not a training opinion: it stops a fat-fingered entry from driving
 * an absurd projection. The projection itself holds its estimate flat above
 * the highest dose it has trial data for, which is well below this ceiling.
 */
export const MAX_TESTOSTERONE_MG_PER_WEEK = 3000;

/**
 * Upper bound on a single stated dose, in milligrams.
 *
 * Higher than the weekly ceiling would suggest, because a dose is not a week:
 * undecanoate is normally 1000 mg at a time and long-interval protocols are
 * the reason the questionnaire asks for a dose and an interval at all. The
 * weekly figure those two produce is bounded separately.
 */
export const MAX_TESTOSTERONE_MG_PER_DOSE = 3000;

/**
 * Bounds on the interval between doses, in weeks.
 *
 * The floor is half a week rather than one because splitting a weekly dose
 * across two injections is ordinary practice, and a user who states it that
 * way should not have to do the multiplication themselves. The ceiling clears
 * the longest protocol in common use (undecanoate at 10-14 weeks) with room
 * to spare, and is deliberately not a whole-number-only field.
 */
export const MIN_DOSE_INTERVAL_WEEKS = 0.5;
export const MAX_DOSE_INTERVAL_WEEKS = 16;

/**
 * How many muscle groups the user may prioritise at once.
 *
 * Two, because prioritising everything is prioritising nothing: each priority
 * group takes volume share from the others, and past two the plan stops
 * differing from an even split.
 */
export const MAX_PRIORITY_MUSCLE_GROUPS = 2;
