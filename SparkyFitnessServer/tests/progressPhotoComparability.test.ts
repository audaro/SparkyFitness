import { describe, expect, it } from 'vitest';
import {
  assessComparability,
  ratioDeltas,
  unreliableRatios,
  RATIO_STOPS,
  BODY_RATIO_KEYS,
  photoMetricsSchema,
  COMPARABILITY_THRESHOLDS,
  LAB_L_RANGE,
  BODY_WIDTH_STOPS,
  type BodyRatios,
} from '@workspace/shared';

const aligned = (residual_norm: number) => ({ residual_norm });
const lit = (luminance_delta: number | null) => ({ luminance_delta });

const good = {
  alignment: aligned(0.005),
  exposure: lit(2),
};

describe('assessComparability', () => {
  it('passes a pair shot the same way twice', () => {
    expect(assessComparability(good)).toEqual({
      verdict: 'comparable',
      reasons: [],
    });
  });

  it('names the term that failed, not just the failure', () => {
    // "Not comparable" alone tells the user nothing to do differently; the
    // reason is what turns the verdict into advice.
    const result = assessComparability({
      ...good,
      alignment: aligned(0.09),
    });

    expect(result.verdict).toBe('not_comparable');
    expect(result.reasons).toEqual(['alignment_residual']);
  });

  it('lets the worst term decide, and does not let a good one hide it', () => {
    // Perfect geometry, completely different light. Averaging the terms would
    // call this pair fine and the report would narrate the lamp.
    const result = assessComparability({
      alignment: aligned(0),
      exposure: lit(LAB_L_RANGE * 0.5),
    });

    expect(result.verdict).toBe('not_comparable');
    expect(result.reasons).toEqual(['lighting_changed']);
  });

  it('collects every term that is wrong', () => {
    const result = assessComparability({
      alignment: aligned(0.03),
      exposure: lit(LAB_L_RANGE * 0.2),
      tilt_delta_deg: 4,
    });

    expect(result.verdict).toBe('marginal');
    expect(result.reasons).toEqual([
      'alignment_residual',
      'lighting_changed',
      'camera_tilt',
    ]);
  });

  it('treats a darker room the same as a brighter one', () => {
    const brighter = assessComparability({
      ...good,
      exposure: lit(LAB_L_RANGE * 0.2),
    });
    const darker = assessComparability({
      ...good,
      exposure: lit(-LAB_L_RANGE * 0.2),
    });

    expect(darker).toEqual(brighter);
  });

  it('reads luminance on the 0-255 scale OpenCV actually uses', () => {
    // CIELAB's own L runs 0..100, but cv2 packs it into a byte, so the
    // sidecar's figures are 2.55x larger than the colour space's. A delta of
    // 20 is a mild change on the real scale and a room-changing one on the
    // wrong scale.
    expect(LAB_L_RANGE).toBe(255);
    expect(assessComparability({ ...good, exposure: lit(20) }).verdict).toBe(
      'comparable'
    );
  });

  it('skips a term the photos do not carry rather than assuming it is fine', () => {
    // Tilt only exists for photos taken through guided capture. Defaulting it
    // to zero would quietly promote every imported photo to `comparable`.
    expect(assessComparability({ ...good }).reasons).toEqual([]);
    expect(
      assessComparability({ ...good, tilt_delta_deg: null }).reasons
    ).toEqual([]);
    expect(
      assessComparability({ ...good, exposure: lit(null) }).reasons
    ).toEqual([]);
  });

  it('refuses a residual it cannot read', () => {
    // A NaN residual means the fit did not converge. Comparing it against a
    // threshold is always false, which would silently pass the pair.
    expect(
      assessComparability({ ...good, alignment: aligned(Number.NaN) }).verdict
    ).toBe('not_comparable');
  });

  it('puts the threshold boundary on the good side', () => {
    const at = COMPARABILITY_THRESHOLDS.residualComparable;
    expect(
      assessComparability({ ...good, alignment: aligned(at) }).verdict
    ).toBe('comparable');
    expect(
      assessComparability({ ...good, alignment: aligned(at * 1.001) }).verdict
    ).toBe('marginal');
  });
});

describe('ratioDeltas', () => {
  const ratios = (overrides: Partial<BodyRatios> = {}): BodyRatios => ({
    waist_shoulder: 0.7,
    waist_height: 0.16,
    hip_shoulder: 0.9,
    shoulder_height: 0.23,
    thigh_height: 0.12,
    mask_area_height2: 0.2,
    ...overrides,
  });

  it('reports the change after minus before', () => {
    const deltas = ratioDeltas(ratios(), ratios({ waist_shoulder: 0.63 }));

    expect(deltas.waist_shoulder).toBeCloseTo(-0.07, 10);
    expect(deltas.waist_height).toBe(0);
  });

  it('omits a ratio either photo could not measure', () => {
    // "No change" and "could not be measured" are different claims, and only
    // one of them belongs in a report. A zero here would become "your
    // shoulders held steady" about a number that never existed.
    const deltas = ratioDeltas(ratios({ hip_shoulder: null }), ratios());

    expect('hip_shoulder' in deltas).toBe(false);
    expect('waist_shoulder' in deltas).toBe(true);
  });
});

describe('photoMetricsSchema', () => {
  const metrics = {
    height_px: 1000,
    image_size: [900, 1600],
    widths_px: { shoulder: 300, chest: 280, waist: 220, hip: 260, thigh: 150 },
    arms_overlap: {
      shoulder: true,
      chest: false,
      waist: false,
      hip: false,
      thigh: false,
    },
    ratios: {
      waist_shoulder: 0.73,
      waist_height: 0.22,
      hip_shoulder: 0.86,
      shoulder_height: 0.3,
      thigh_height: 0.15,
      mask_area_height2: 0.2,
    },
    background: { luminance: 180.5, chroma: 4.2 },
    visibility: { eyes: 0.99, shoulders: 0.98, hips: 0.95, ankles: 0.9 },
  };

  it('accepts what the sidecar sends', () => {
    expect(photoMetricsSchema.parse(metrics)).toMatchObject({
      height_px: 1000,
    });
  });

  it('rejects a silhouette missing a stop', () => {
    // The sidecar clamps every row into frame rather than skipping it, so a
    // missing stop means the two sides have drifted apart. Better to fail here
    // than to serve a comparison with a silently absent waist.
    const { waist: _waist, ...partial } = metrics.widths_px;

    expect(() =>
      photoMetricsSchema.parse({ ...metrics, widths_px: partial })
    ).toThrow();
    expect(BODY_WIDTH_STOPS).toContain('waist');
  });

  it('keeps a ratio the sidecar declined to compute', () => {
    const parsed = photoMetricsSchema.parse({
      ...metrics,
      ratios: { ...metrics.ratios, waist_shoulder: null },
    });

    expect(parsed.ratios.waist_shoulder).toBeNull();
  });
});

describe('unreliableRatios', () => {
  const clear = {
    shoulder: false,
    chest: false,
    waist: false,
    hip: false,
    thigh: false,
  };

  it('finds nothing wrong when the arms were clear of the body', () => {
    expect(
      unreliableRatios({ arms_overlap: clear }, { arms_overlap: clear })
    ).toEqual([]);
  });

  it('names every ratio built on a stop an arm was inside', () => {
    // Measured on a real photograph moved and relit but otherwise identical:
    // the arm-free shoulder held to 0.1% while the arm-crossed hip drifted
    // 6.2%. A report reading that as progress would be describing an elbow.
    const result = unreliableRatios(
      { arms_overlap: { ...clear, hip: true } },
      { arms_overlap: clear }
    );

    expect(result).toEqual(['hip_shoulder']);
  });

  it('is contaminated by either end of the pair', () => {
    // The delta is a difference, so one bad end is enough to poison it.
    const before = unreliableRatios(
      { arms_overlap: { ...clear, waist: true } },
      { arms_overlap: clear }
    );
    const after = unreliableRatios(
      { arms_overlap: clear },
      { arms_overlap: { ...clear, waist: true } }
    );

    expect(before).toEqual(['waist_shoulder', 'waist_height']);
    expect(after).toEqual(before);
  });

  it('spreads from a shared stop to everything built on it', () => {
    // The shoulder is the denominator of two ratios and the numerator of a
    // third; an arm across it takes all three down.
    expect(
      unreliableRatios(
        { arms_overlap: { ...clear, shoulder: true } },
        { arms_overlap: clear }
      )
    ).toEqual(['waist_shoulder', 'hip_shoulder', 'shoulder_height']);
  });

  it('leaves the whole-silhouette ratio alone', () => {
    // An arm against the body is inside the mask either way, so mask area is
    // not made worse by it - and claiming otherwise would throw away the one
    // measurement that survives a bad stance.
    const everything = {
      shoulder: true,
      chest: true,
      waist: true,
      hip: true,
      thigh: true,
    };

    expect(
      unreliableRatios(
        { arms_overlap: everything },
        { arms_overlap: everything }
      )
    ).not.toContain('mask_area_height2');
    expect(RATIO_STOPS.mask_area_height2).toEqual([]);
  });

  it('has a stop list for every ratio', () => {
    // A ratio missing from RATIO_STOPS would silently never be marked
    // unreliable, which is the failure that stays invisible.
    for (const key of BODY_RATIO_KEYS) {
      expect(RATIO_STOPS[key]).toBeDefined();
    }
  });
});
