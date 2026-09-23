import { z } from "zod";

/**
 * The contract for comparing two progress photos.
 *
 * Layer 1 only: everything here is measured or computed, never narrated. The
 * numbers come from the vision sidecar (`SparkyFitnessVision`, whose
 * `schemas.py` this mirrors field for field), and the comparability verdict is
 * computed here rather than there — the rule deciding whether two photos may
 * honestly be held against each other is a product judgement, and it belongs
 * in the language the rest of the app is tested in.
 */

// --- What the sidecar measured ---

/** The rows a silhouette is measured at, as fractions of ankle-to-eye height. */
export const BODY_WIDTH_STOPS = [
  "shoulder",
  "chest",
  "waist",
  "hip",
  "thigh",
] as const;

export const bodyWidthStopSchema = z.enum(BODY_WIDTH_STOPS);

export type BodyWidthStop = (typeof BODY_WIDTH_STOPS)[number];

/**
 * `record`, not `partialRecord` (contrast `WeeklySetTargets.api.zod.ts`): the
 * sidecar measures every stop on every photo, clamping the row into frame
 * rather than skipping it. A missing key means the two sides have drifted
 * apart, and that should fail here rather than surface as a silently absent
 * waist measurement.
 */
export const bodyWidthsSchema = z.record(bodyWidthStopSchema, z.number());

/**
 * Per stop: was an arm inside the row that was measured?
 *
 * A waist measured with the arms hanging against it tracks how someone stood
 * rather than their waist, and a silhouette cannot separate the two. Reported
 * so a report can decline to discuss that region instead of narrating sleeves.
 */
export const armsOverlapSchema = z.record(bodyWidthStopSchema, z.boolean());

/**
 * Scale-free shape. Every one is a ratio, so none of them change when the
 * camera moves closer or the photo is resized — which is the entire reason
 * these, and not the pixel widths, are what a comparison is built on.
 *
 * `null` where the denominator was zero; the sidecar declines rather than
 * dividing.
 */
export const bodyRatiosSchema = z.object({
  waist_shoulder: z.number().nullable(),
  waist_height: z.number().nullable(),
  hip_shoulder: z.number().nullable(),
  shoulder_height: z.number().nullable(),
  thigh_height: z.number().nullable(),
  mask_area_height2: z.number().nullable(),
});

export type BodyRatios = z.infer<typeof bodyRatiosSchema>;

export const BODY_RATIO_KEYS = Object.keys(
  bodyRatiosSchema.shape,
) as (keyof BodyRatios)[];

/** The anchor pairs the sidecar refuses to work without. */
export const landmarkVisibilitySchema = z.object({
  eyes: z.number(),
  shoulders: z.number(),
  hips: z.number(),
  ankles: z.number(),
});

/** Null when the body fills the frame and there is no room left to measure. */
export const backgroundSummarySchema = z.object({
  luminance: z.number().nullable(),
  chroma: z.number().nullable(),
});

export const photoMetricsSchema = z.object({
  height_px: z.number(),
  /** `[width, height]` of the frame the measurements are in. */
  image_size: z.tuple([z.number().int(), z.number().int()]),
  widths_px: bodyWidthsSchema,
  arms_overlap: armsOverlapSchema,
  ratios: bodyRatiosSchema,
  background: backgroundSummarySchema,
  visibility: landmarkVisibilitySchema,
});

export type PhotoMetrics = z.infer<typeof photoMetricsSchema>;

export const alignmentSummarySchema = z.object({
  residual_px: z.number(),
  /**
   * The residual over the before photo's body height. This is what the verdict
   * is built on; the pixel figure alone says nothing without knowing how big
   * the person was in frame.
   */
  residual_norm: z.number(),
  scale: z.number(),
});

export type AlignmentSummary = z.infer<typeof alignmentSummarySchema>;

export const exposureSummarySchema = z.object({
  /** After minus before, in OpenCV 8-bit CIELAB units (see `LAB_L_RANGE`). */
  luminance_delta: z.number().nullable(),
  chroma_delta: z.number().nullable(),
  /** False when the backgrounds were too small or too flat to fit on. */
  corrected: z.boolean(),
});

export type ExposureSummary = z.infer<typeof exposureSummarySchema>;

// --- The verdict ---

/**
 * How much two photos can be trusted against each other.
 *
 * This is the feature's honesty valve, and it is shown to the user *before*
 * any report exists. Without it the app would narrate a change of lighting or
 * a step towards the camera as a change in their body, which is the single
 * most common way a before/after comparison lies.
 */
export const COMPARABILITY_VERDICTS = [
  "comparable",
  "marginal",
  "not_comparable",
  "unknown",
] as const;

export const comparabilityVerdictSchema = z.enum(COMPARABILITY_VERDICTS);

export type ComparabilityVerdict = (typeof COMPARABILITY_VERDICTS)[number];

/**
 * Why a pair is less than comparable — one entry per thing that is wrong.
 *
 * "Not comparable" on its own tells the user nothing they can act on, while
 * "the light changed" tells them what to do differently next time.
 */
export const COMPARABILITY_REASONS = [
  "alignment_residual",
  "lighting_changed",
  "camera_tilt",
  "arms_obscured",
  "pose_not_detected",
  "not_analyzed",
] as const;

export const comparabilityReasonSchema = z.enum(COMPARABILITY_REASONS);

export type ComparabilityReason = (typeof COMPARABILITY_REASONS)[number];

/**
 * Thresholds, tunable in one place.
 *
 * Starting values, not measured ones: they come from the blueprint rather than
 * from a corpus of real pairs, which does not exist yet. They live here, next
 * to the function that applies them, so tightening them later is one edit and
 * one test change.
 */
export const COMPARABILITY_THRESHOLDS = {
  /** Alignment residual as a fraction of body height. */
  residualComparable: 0.02,
  residualMarginal: 0.05,
  /** Background lightness change, as a fraction of the full L range. */
  luminanceComparable: 0.15,
  luminanceMarginal: 0.3,
  /** Degrees of camera tilt difference, when both photos recorded it. */
  tiltComparable: 3,
  tiltMarginal: 6,
} as const;

/**
 * OpenCV stores CIELAB lightness for an 8-bit image as 0..255, not the 0..100
 * of the colour space itself. The sidecar reads L straight out of
 * `cvtColor(..., COLOR_RGB2LAB)` on a `uint8` frame, so its luminance figures
 * are on this scale; dividing by 100 would make every threshold 2.55x tighter
 * than intended.
 */
export const LAB_L_RANGE = 255;

const VERDICT_RANK: Record<ComparabilityVerdict, number> = {
  comparable: 0,
  marginal: 1,
  not_comparable: 2,
  unknown: 3,
};

export interface ComparabilityInput {
  alignment: Pick<AlignmentSummary, "residual_norm">;
  exposure: Pick<ExposureSummary, "luminance_delta">;
  /**
   * Camera tilt difference in degrees, when both photos recorded one. Only
   * photos taken through guided capture carry it.
   */
  tilt_delta_deg?: number | null;
  /**
   * The shape ratios that were measured and are not arm-contaminated. Omit it
   * (or pass null) when there are no measurements to offer; an empty array
   * means there genuinely is nothing left to say.
   */
  trustworthy_ratios?: readonly string[] | null;
}

export interface ComparabilityOutcome {
  verdict: ComparabilityVerdict;
  reasons: ComparabilityReason[];
}

/**
 * Decide whether two analysed photos may be compared.
 *
 * Each term is graded on its own and the worst one wins: a pair that lines up
 * perfectly but was shot under different light is not comparable, and
 * averaging the terms would let a good one hide a bad one.
 *
 * A term the photos do not carry is skipped rather than assumed good. Tilt in
 * particular only exists for photos taken through guided capture, and treating
 * its absence as zero would silently promote every library import to
 * `comparable`.
 *
 * The two verdicts this cannot reach are the caller's: `not_comparable` with
 * `pose_not_detected` when the sidecar could not find a body, and `unknown`
 * with `not_analyzed` when a photo has never been measured — neither produces
 * the numbers this function grades.
 */
export function assessComparability(
  input: ComparabilityInput,
): ComparabilityOutcome {
  const reasons: ComparabilityReason[] = [];
  let verdict: ComparabilityVerdict = "comparable";

  const degrade = (
    level: ComparabilityVerdict,
    reason: ComparabilityReason,
  ): void => {
    reasons.push(reason);
    if (VERDICT_RANK[level] > VERDICT_RANK[verdict]) verdict = level;
  };

  const residual = input.alignment.residual_norm;
  if (
    !Number.isFinite(residual) ||
    residual > COMPARABILITY_THRESHOLDS.residualMarginal
  ) {
    degrade("not_comparable", "alignment_residual");
  } else if (residual > COMPARABILITY_THRESHOLDS.residualComparable) {
    degrade("marginal", "alignment_residual");
  }

  const luminanceDelta = input.exposure.luminance_delta;
  if (luminanceDelta != null && Number.isFinite(luminanceDelta)) {
    const relative = Math.abs(luminanceDelta) / LAB_L_RANGE;
    if (relative > COMPARABILITY_THRESHOLDS.luminanceMarginal) {
      degrade("not_comparable", "lighting_changed");
    } else if (relative > COMPARABILITY_THRESHOLDS.luminanceComparable) {
      degrade("marginal", "lighting_changed");
    }
  }

  const tilt = input.tilt_delta_deg;
  if (tilt != null && Number.isFinite(tilt)) {
    const magnitude = Math.abs(tilt);
    if (magnitude > COMPARABILITY_THRESHOLDS.tiltMarginal) {
      degrade("not_comparable", "camera_tilt");
    } else if (magnitude > COMPARABILITY_THRESHOLDS.tiltComparable) {
      degrade("marginal", "camera_tilt");
    }
  }

  // Arm contamination is a caveat on individual numbers, not a fault in the
  // pair, so it does not degrade a verdict on its own: two well-framed photos
  // of someone who always stands with their arms down really are comparable,
  // and saying otherwise would punish exactly the consistency the feature
  // wants. But a verdict of "comparable" is a promise that something can be
  // compared. When every shape number has been struck out there is nothing
  // behind the promise, and the honest answer is no.
  const trustworthy = input.trustworthy_ratios;
  if (trustworthy != null && trustworthy.length === 0) {
    degrade("not_comparable", "arms_obscured");
  }

  return { verdict, reasons };
}

/**
 * Which width stops each ratio is built from.
 *
 * `mask_area_height2` has none: it integrates the whole silhouette instead of
 * reading one row, which is why it is governed by the separate rule below
 * rather than by any single stop.
 */
export const RATIO_STOPS: Record<keyof BodyRatios, BodyWidthStop[]> = {
  waist_shoulder: ["waist", "shoulder"],
  waist_height: ["waist"],
  hip_shoulder: ["hip", "shoulder"],
  shoulder_height: ["shoulder"],
  thigh_height: ["thigh"],
  mask_area_height2: [],
};

/**
 * The ratios that were measured but must not be read as body change.
 *
 * A silhouette cannot tell an arm from the torso it is resting against, so a
 * row an arm falls inside measures the pair of them. That is not a small
 * effect: on a real photograph moved and relit but otherwise identical, the
 * arm-free stops held to within 2% while the arm-crossed waist and hip drifted
 * 5-6% in opposite directions — enough to read as visible progress in a report
 * where nothing whatsoever had changed.
 *
 * Named rather than dropped, because "measured, but it moves with how you
 * stood" and "not measured" are different claims. A ratio is unreliable if
 * either photo had an arm in any stop it is built from: the delta is a
 * difference, so contaminating one end is enough.
 */
export function unreliableRatios(
  before: Pick<PhotoMetrics, "arms_overlap">,
  after: Pick<PhotoMetrics, "arms_overlap">,
): (keyof BodyRatios)[] {
  const unreliable: (keyof BodyRatios)[] = [];
  for (const key of BODY_RATIO_KEYS) {
    const stops = RATIO_STOPS[key];
    if (stops.length === 0) {
      if (armPostureChanged(before, after)) unreliable.push(key);
      continue;
    }
    const touched = stops.some(
      (stop) => before.arms_overlap[stop] || after.arms_overlap[stop],
    );
    if (touched) unreliable.push(key);
  }
  return unreliable;
}

/**
 * Did the arms sit differently in the two photos?
 *
 * Silhouette *area* is not indifferent to the arms. An arm held clear adds its
 * own outline; an arm pressed to the torso hides behind it, and the union is
 * smaller than the sum. So the area measure is safe only while the posture
 * holds — an arms-out photo against an arms-down one compares two different
 * outlines of the same body.
 *
 * Which is a weaker condition than the one the row-based stops need, and
 * deliberately so. A row is sensitive to a couple of degrees of roll (measured:
 * 5-6% on the waist and hip between a photograph and a rolled copy of itself),
 * because roll changes how much arm falls in that one line. Area integrates
 * over the whole body, and moved 0.25% across the same pair. Marking it
 * unreliable whenever an arm touches anything would throw away the one shape
 * number that survives an arms-down habit, which is the common case.
 */
function armPostureChanged(
  before: Pick<PhotoMetrics, "arms_overlap">,
  after: Pick<PhotoMetrics, "arms_overlap">,
): boolean {
  return BODY_WIDTH_STOPS.some(
    (stop) => before.arms_overlap[stop] !== after.arms_overlap[stop],
  );
}

/**
 * After minus before, for every ratio both photos actually have.
 *
 * A ratio either side declined to compute is left out rather than treated as
 * zero: "no change" and "could not be measured" are different claims, and only
 * one of them belongs in a report.
 */
export function ratioDeltas(
  before: BodyRatios,
  after: BodyRatios,
): Partial<Record<keyof BodyRatios, number>> {
  const deltas: Partial<Record<keyof BodyRatios, number>> = {};
  for (const key of BODY_RATIO_KEYS) {
    const b = before[key];
    const a = after[key];
    if (b === null || a === null) continue;
    deltas[key] = a - b;
  }
  return deltas;
}

// --- Stored comparison ---

/** Layer 1 in full: what was measured, and what it is worth. */
export const comparisonDeterministicSchema = z.object({
  before: photoMetricsSchema,
  after: photoMetricsSchema,
  alignment: alignmentSummarySchema,
  exposure: exposureSummarySchema,
  ratio_deltas: z.partialRecord(
    z.enum(BODY_RATIO_KEYS as [keyof BodyRatios, ...(keyof BodyRatios)[]]),
    z.number(),
  ),
  /**
   * Ratios present in `ratio_deltas` that a report must not attribute to the
   * body. See `unreliableRatios`. Kept alongside the deltas rather than
   * subtracted from them so the caller can show the number and the caveat
   * together instead of silently having neither.
   */
  unreliable_ratios: z.array(
    z.enum(BODY_RATIO_KEYS as [keyof BodyRatios, ...(keyof BodyRatios)[]]),
  ),
  engine: z.string(),
});

export type ComparisonDeterministic = z.infer<
  typeof comparisonDeterministicSchema
>;

/**
 * What actually goes into the database.
 *
 * `unreliable_ratios` is left out on purpose. It is a judgement derived from
 * `arms_overlap`, which is stored inside `before` and `after`, and judgements
 * here follow the same rule as the verdict: recompute them on read so that
 * changing how they are decided reaches rows measured months earlier, instead
 * of a stored answer that keeps replying with last month's rule.
 */
export const storedDeterministicSchema = comparisonDeterministicSchema.omit({
  unreliable_ratios: true,
});

export type StoredDeterministic = z.infer<typeof storedDeterministicSchema>;

export const comparisonResponseSchema = z.object({
  id: z.string().uuid(),
  before_photo_id: z.string().uuid(),
  after_photo_id: z.string().uuid(),
  /** Whole days between the two photos' entry dates. */
  days_between: z.number().int(),
  verdict: comparabilityVerdictSchema,
  reasons: z.array(comparabilityReasonSchema),
  /** Null whenever the verdict is `unknown` or the pose was never found. */
  deterministic: comparisonDeterministicSchema.nullable(),
  created_at: z.string(),
});

export type ComparisonResponse = z.infer<typeof comparisonResponseSchema>;

export const createComparisonRequestSchema = z.object({
  before_photo_id: z.string().uuid(),
  after_photo_id: z.string().uuid(),
});

export type CreateComparisonRequest = z.infer<
  typeof createComparisonRequestSchema
>;

// --- The aligned pair ---

/**
 * Both photos warped into one frame, for a before/after slider.
 *
 * Base64 JPEG rather than two image URLs, because the two frames are produced
 * by a single pass over the pair: the similarity transform that registers them
 * and the exposure correction that relights the after photo both fall out of
 * the same fit, and asking for one frame at a time would run that fit twice to
 * hand back two halves of one answer.
 *
 * Nothing here is stored. These bytes are derived from the two originals and
 * the alignment, all three of which the server already has, and keeping a copy
 * would double what a comparison costs on disk while freezing today's warp
 * into a file that outlives it. The trade is a sidecar round trip per viewing,
 * paid on an explicit request to see the pair rather than on every photo list.
 *
 * Both frames are re-encoded by the same encoder at the same quality even
 * though the before photo is returned geometrically untouched — a slider
 * crossfading between a pristine original and a re-encoded warp would show an
 * encoder artefact in exactly the place the user is looking for a change.
 */
export const alignedPairSchema = z.object({
  /** The before photo, unwarped: it is the frame the other is fitted to. */
  before_jpeg: z.string(),
  /** The after photo, warped onto the before frame and exposure-matched. */
  after_jpeg: z.string(),
  /** Pixel size of both frames, `[width, height]`. */
  frame: z.tuple([z.number().int(), z.number().int()]),
  engine: z.string(),
});

export type AlignedPair = z.infer<typeof alignedPairSchema>;
