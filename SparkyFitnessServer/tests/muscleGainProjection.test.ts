import { describe, expect, it } from 'vitest';
import {
  PROJECTION_TUNABLES,
  doseResponseKgPer20Weeks,
  effectiveWeeklyDoseMg,
  projectMuscleGain,
  projectionSexFrom,
  trainingAgeYearsFor,
  type MuscleGainProjectionInput,
} from '@workspace/shared';

/**
 * The projection is the one part of the training plan that makes a claim about
 * the user's body rather than about their program, so these tests are written
 * against the **published figures** it is anchored on rather than against
 * whatever the implementation currently returns. If a refactor moves a number,
 * the test that fails should name the study the number came from.
 */

/**
 * Every figure the projection returns is rounded to a tenth of a kilogram, so
 * a relationship between two of them ("half of", "halves again") can only hold
 * to within one rounding step. Asserting it any tighter would be asserting the
 * rounding, not the model.
 */
function expectWithinRounding(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    PROJECTION_TUNABLES.roundToKg
  );
}

function input(
  overrides: Partial<MuscleGainProjectionInput> = {}
): MuscleGainProjectionInput {
  return {
    sex: 'male',
    experienceLevel: 'intermediate',
    bodyweightKg: 82,
    adherence: 1,
    enhancement: null,
    horizonWeeks: 12,
    ...overrides,
  };
}

describe('doseResponseKgPer20Weeks', () => {
  // Bhasin 2001: 125 mg/wk +3.4 kg, 300 +5.2, 600 +7.9 fat-free mass over 20
  // weeks with no training. The curve has to pass through its own anchors.
  it('reproduces the trial anchors exactly', () => {
    for (const anchor of PROJECTION_TUNABLES.doseAnchors) {
      expect(doseResponseKgPer20Weeks(anchor.mgPerWeek)).toBeCloseTo(
        anchor.kgPer20Weeks,
        6
      );
    }
  });

  // The step from 125 to 300 buys far more than the step from 300 to 600, so
  // the midpoint of a segment must sit above the arithmetic mean of its ends.
  it('interpolates in log dose, not linearly', () => {
    const at200 = doseResponseKgPer20Weeks(200);
    expect(at200).toBeGreaterThan(3.4);
    expect(at200).toBeLessThan(5.2);
    // log interpolation between 125 and 300 puts 200 at ~4.37 kg; straight
    // linear interpolation would put it at ~4.17.
    expect(at200).toBeCloseTo(4.37, 1);
    const linearAt200 = 3.4 + ((200 - 125) / (300 - 125)) * (5.2 - 3.4);
    expect(at200).toBeGreaterThan(linearAt200);
  });

  it('tapers to zero below the lowest anchor', () => {
    expect(
      doseResponseKgPer20Weeks(PROJECTION_TUNABLES.doseFloorMgPerWeek)
    ).toBe(0);
    expect(doseResponseKgPer20Weeks(50)).toBe(0);
    expect(doseResponseKgPer20Weeks(0)).toBe(0);
    const at100 = doseResponseKgPer20Weeks(100);
    expect(at100).toBeGreaterThan(0);
    expect(at100).toBeLessThan(3.4);
  });

  // No trial data past 600 mg/wk, so the model does not get to keep climbing
  // into a region nobody measured.
  it('holds flat above the highest anchor', () => {
    expect(doseResponseKgPer20Weeks(600)).toBeCloseTo(7.9, 6);
    expect(doseResponseKgPer20Weeks(1200)).toBeCloseTo(7.9, 6);
    expect(doseResponseKgPer20Weeks(3000)).toBeCloseTo(7.9, 6);
  });

  it('rises monotonically across the whole range', () => {
    let previous = -1;
    for (let mg = 0; mg <= 1000; mg += 5) {
      const value = doseResponseKgPer20Weeks(mg);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('effectiveWeeklyDoseMg', () => {
  it('is zero for anything that states no dose', () => {
    expect(effectiveWeeklyDoseMg(null)).toBe(0);
    expect(effectiveWeeklyDoseMg(undefined)).toBe(0);
    expect(effectiveWeeklyDoseMg({ status: 'natural' })).toBe(0);
    expect(effectiveWeeklyDoseMg({ status: 'trt' })).toBe(0);
    expect(
      effectiveWeeklyDoseMg({ status: 'trt', testosterone_mg_per_dose: 0 })
    ).toBe(0);
    // An interval with no amount is not a dose.
    expect(
      effectiveWeeklyDoseMg({ status: 'trt', dose_interval_weeks: 10 })
    ).toBe(0);
  });

  // The anchors were dosed as enanthate, so every other ester is converted to
  // its enanthate equivalent by testosterone mass fraction.
  it('scales the dose to its enanthate equivalent', () => {
    const at = (ester: 'enanthate' | 'cypionate' | 'propionate') =>
      effectiveWeeklyDoseMg({
        status: 'enhanced',
        testosterone_mg_per_dose: 200,
        ester,
      });
    expect(at('enanthate')).toBe(200);
    // Propionate carries more testosterone per milligram, cypionate slightly
    // less.
    expect(at('propionate')).toBeGreaterThan(200);
    expect(at('cypionate')).toBeLessThan(200);
    expect(at('cypionate')).toBeGreaterThan(190);
  });

  // The case the stored shape exists for. Nebido is 1000 mg every 10 weeks;
  // stored as a weekly average it would reopen the questionnaire as
  // "100 mg/week", a number the user never typed.
  it('spreads a stated dose over the interval between doses', () => {
    expect(
      effectiveWeeklyDoseMg({
        status: 'trt',
        testosterone_mg_per_dose: 1000,
        dose_interval_weeks: 10,
        ester: 'enanthate',
      })
    ).toBeCloseTo(100, 6);
    // Splitting a weekly dose across two injections is the same weekly dose.
    expect(
      effectiveWeeklyDoseMg({
        status: 'trt',
        testosterone_mg_per_dose: 60,
        dose_interval_weeks: 0.5,
        ester: 'enanthate',
      })
    ).toBeCloseTo(120, 6);
  });

  it('reads an absent or unusable interval as weekly', () => {
    const weekly = effectiveWeeklyDoseMg({
      status: 'trt',
      testosterone_mg_per_dose: 120,
      ester: 'enanthate',
    });
    expect(weekly).toBe(120);
    for (const interval of [0, -2, Number.NaN, undefined]) {
      expect(
        effectiveWeeklyDoseMg({
          status: 'trt',
          testosterone_mg_per_dose: 120,
          dose_interval_weeks: interval as never,
          ester: 'enanthate',
        })
      ).toBe(weekly);
    }
  });

  // Both conversions apply, in the documented order: the interval first, then
  // the ester. Undecanoate is the ester long intervals actually use, so the
  // two would otherwise only ever be tested apart.
  it('applies the interval and the ester conversion together', () => {
    const mg = effectiveWeeklyDoseMg({
      status: 'trt',
      testosterone_mg_per_dose: 1000,
      dose_interval_weeks: 10,
      ester: 'undecanoate',
    });
    expect(mg).toBeCloseTo(
      100 * PROJECTION_TUNABLES.esterFactors.undecanoate,
      6
    );
    expect(mg).toBeLessThan(100);
  });

  it('treats an unstated or unknown ester as the reference', () => {
    const base = effectiveWeeklyDoseMg({
      status: 'trt',
      testosterone_mg_per_dose: 120,
    });
    expect(base).toBe(120);
    expect(
      effectiveWeeklyDoseMg({
        status: 'trt',
        testosterone_mg_per_dose: 120,
        ester: 'sublingual' as never,
      })
    ).toBe(120);
  });
});

describe('trainingAgeYearsFor', () => {
  it('reads the experience level when no training age is stated', () => {
    expect(trainingAgeYearsFor({ experienceLevel: 'beginner' })).toBe(0.5);
    expect(trainingAgeYearsFor({ experienceLevel: 'expert' })).toBe(5);
  });

  it('treats an unstated level as intermediate, like the set targets do', () => {
    expect(trainingAgeYearsFor({})).toBe(
      trainingAgeYearsFor({ experienceLevel: 'intermediate' })
    );
    expect(trainingAgeYearsFor({ experienceLevel: null })).toBe(2);
    expect(
      trainingAgeYearsFor({ experienceLevel: 'grandmaster' as never })
    ).toBe(2);
  });

  it('prefers a stated training age over the level', () => {
    expect(
      trainingAgeYearsFor({ experienceLevel: 'beginner', trainingAgeYears: 8 })
    ).toBe(8);
    expect(
      trainingAgeYearsFor({ experienceLevel: 'expert', trainingAgeYears: -1 })
    ).toBe(5);
  });
});

describe('projectMuscleGain — the natural component', () => {
  // Aragon/Helms: an intermediate gains 0.5-1.0% of bodyweight per month. At
  // 82 kg over 12 weeks (2.76 months) that is 1.13 to 2.27 kg.
  it('reproduces the rate model for an intermediate lifter', () => {
    const result = projectMuscleGain(input());
    expect(result.naturalKg?.lowKg).toBeCloseTo(1.1, 1);
    expect(result.naturalKg?.highKg).toBeCloseTo(2.3, 1);
    expect(result.enhancedKg).toBeNull();
    expect(result.unmodelled).toEqual(['no_stated_dose']);
  });

  it('gives a beginner more and an expert less', () => {
    const beginner = projectMuscleGain(input({ experienceLevel: 'beginner' }));
    const intermediate = projectMuscleGain(input());
    const expert = projectMuscleGain(input({ experienceLevel: 'expert' }));

    expect(beginner.naturalKg!.highKg).toBeGreaterThan(
      intermediate.naturalKg!.highKg
    );
    expect(expert.naturalKg!.highKg).toBeLessThan(
      intermediate.naturalKg!.highKg
    );
  });

  it('halves the rate for women', () => {
    const male = projectMuscleGain(input());
    const female = projectMuscleGain(input({ sex: 'female' }));
    expectWithinRounding(female.naturalKg!.highKg, male.naturalKg!.highKg / 2);
  });

  // Unknown sex is not male. Defaulting would roughly double a woman's
  // estimate without telling her.
  it('treats an unknown sex as the unscaled rate and says nothing about it', () => {
    expect(projectMuscleGain(input({ sex: null })).naturalKg).toEqual(
      projectMuscleGain(input()).naturalKg
    );
  });

  it('scales in full with adherence', () => {
    const half = projectMuscleGain(input({ adherence: 0.5 }));
    const full = projectMuscleGain(input({ adherence: 1 }));
    const none = projectMuscleGain(input({ adherence: 0 }));

    expectWithinRounding(half.naturalKg!.highKg, full.naturalKg!.highKg / 2);
    expect(none.naturalKg!.highKg).toBe(0);
  });

  it('cannot estimate without a bodyweight, and says so', () => {
    const result = projectMuscleGain(input({ bodyweightKg: null }));
    expect(result.naturalKg).toBeNull();
    expect(result.unmodelled).toContain('bodyweight_unknown');
    // Nothing else could be estimated either, so there is no total to show.
    expect(result.totalKg).toBeNull();
    expect(result.perMonthKg).toBeNull();
  });

  it('rejects a nonsense bodyweight rather than projecting from it', () => {
    expect(projectMuscleGain(input({ bodyweightKg: 0 })).naturalKg).toBeNull();
    expect(projectMuscleGain(input({ bodyweightKg: -5 })).naturalKg).toBeNull();
    expect(
      projectMuscleGain(input({ bodyweightKg: Number.NaN })).naturalKg
    ).toBeNull();
  });
});

describe('projectMuscleGain — the testosterone component', () => {
  const onTrt = (
    mg: number,
    overrides: Partial<MuscleGainProjectionInput> = {}
  ) =>
    projectMuscleGain(
      input({
        enhancement: {
          status: 'trt',
          testosterone_mg_per_dose: mg,
          ester: 'enanthate',
        },
        ...overrides,
      })
    );

  // 125 mg/wk is +3.4 kg over 20 weeks, so 12 weeks of it is 12/20 of that:
  // 2.04 kg at full adherence, before the +/-25% spread.
  it('prorates the 20-week trial figure across a shorter horizon', () => {
    const result = onTrt(125);
    const mid = (result.enhancedKg!.lowKg + result.enhancedKg!.highKg) / 2;
    expect(mid).toBeCloseTo(2.04, 1);
  });

  it('brackets the estimate with the stated spread', () => {
    const result = onTrt(300);
    const mid = (result.enhancedKg!.lowKg + result.enhancedKg!.highKg) / 2;
    const spread = PROJECTION_TUNABLES.doseResponseSpread;
    expect(result.enhancedKg!.lowKg).toBeCloseTo(mid * (1 - spread), 1);
    expect(result.enhancedKg!.highKg).toBeCloseTo(mid * (1 + spread), 1);
  });

  // Bhasin 1996: the untrained testosterone arm still gained about half of
  // what the trained arm did, so the drug component cannot fall to zero when
  // the user stops training.
  it('keeps half the drug effect at zero adherence', () => {
    const none = onTrt(300, { adherence: 0 });
    const full = onTrt(300, { adherence: 1 });
    expectWithinRounding(
      none.enhancedKg!.highKg,
      full.enhancedKg!.highKg * PROJECTION_TUNABLES.doseAdherenceFloor
    );
    expect(none.naturalKg!.highKg).toBe(0);
  });

  // The trial is one 20-week cycle. Everything past it is an assumption, and
  // the assumption is that gains plateau rather than repeat.
  it('decays each further 20-week block', () => {
    const twentyWeeks = onTrt(300, { horizonWeeks: 20 });
    const fortyWeeks = onTrt(300, { horizonWeeks: 40 });
    const first = twentyWeeks.enhancedKg!.highKg;
    const second = fortyWeeks.enhancedKg!.highKg - first;
    expectWithinRounding(second, first * PROJECTION_TUNABLES.laterBlockDecay);
    expect(fortyWeeks.enhancedKg!.highKg).toBeLessThan(first * 2);
  });

  it('adds the drug component on top of the natural one', () => {
    const natural = projectMuscleGain(input());
    const enhanced = onTrt(150);
    expect(enhanced.naturalKg).toEqual(natural.naturalKg);
    expect(enhanced.totalKg!.highKg).toBeGreaterThan(natural.totalKg!.highKg);
    expect(enhanced.totalKg!.lowKg).toBeCloseTo(
      enhanced.naturalKg!.lowKg + enhanced.enhancedKg!.lowKg,
      1
    );
  });

  // There is no comparable dose-response data in women. Scaling a male curve
  // by an invented factor would be a made-up number wearing a citation.
  it('does not estimate a dose effect for women', () => {
    const result = onTrt(100, { sex: 'female' });
    expect(result.enhancedKg).toBeNull();
    expect(result.unmodelled).toContain('dose_not_modelled_for_sex');
    // The natural half still projects.
    expect(result.naturalKg).not.toBeNull();
    expect(result.totalKg).toEqual(result.naturalKg);
  });

  it('treats a natural profile and a missing one identically', () => {
    const stated = projectMuscleGain(
      input({ enhancement: { status: 'natural' } })
    );
    const absent = projectMuscleGain(input({ enhancement: null }));
    expect(stated).toEqual(absent);
  });
});

describe('projectMuscleGain — the output as the card reads it', () => {
  it('shows what full adherence would be worth', () => {
    const result = projectMuscleGain(input({ adherence: 0.6 }));
    expect(result.atFullAdherenceKg!.highKg).toBeGreaterThan(
      result.totalKg!.highKg
    );
    expect(result.atFullAdherenceKg).toEqual(
      projectMuscleGain(input({ adherence: 1 })).totalKg
    );
  });

  it('restates the total per month', () => {
    const result = projectMuscleGain(input({ horizonWeeks: 12 }));
    const months = 12 / PROJECTION_TUNABLES.weeksPerMonth;
    expect(result.perMonthKg!.highKg).toBeCloseTo(
      result.totalKg!.highKg / months,
      1
    );
  });

  it('clamps the horizon and reports the one it used', () => {
    expect(projectMuscleGain(input({ horizonWeeks: 0 })).horizonWeeks).toBe(
      PROJECTION_TUNABLES.minHorizonWeeks
    );
    expect(projectMuscleGain(input({ horizonWeeks: 9999 })).horizonWeeks).toBe(
      PROJECTION_TUNABLES.maxHorizonWeeks
    );
    expect(
      projectMuscleGain(input({ horizonWeeks: Number.NaN })).horizonWeeks
    ).toBe(PROJECTION_TUNABLES.minHorizonWeeks);
  });

  it('clamps adherence that arrives outside 0..1', () => {
    // It is a mean of `overall_percent` values, and a week over target would
    // otherwise push the whole projection above what the model can claim.
    expect(projectMuscleGain(input({ adherence: 1.4 })).totalKg).toEqual(
      projectMuscleGain(input({ adherence: 1 })).totalKg
    );
    expect(projectMuscleGain(input({ adherence: -2 })).totalKg).toEqual(
      projectMuscleGain(input({ adherence: 0 })).totalKg
    );
  });

  it('rounds every figure to a tenth of a kilogram', () => {
    const result = projectMuscleGain(
      input({
        bodyweightKg: 83.7,
        adherence: 0.73,
        enhancement: {
          status: 'enhanced',
          testosterone_mg_per_dose: 237,
          ester: 'cypionate',
        },
      })
    );
    for (const value of [
      result.naturalKg,
      result.enhancedKg,
      result.totalKg,
      result.perMonthKg,
      result.atFullAdherenceKg,
    ]) {
      expect(value).not.toBeNull();
      for (const kg of [value!.lowKg, value!.highKg]) {
        expect(Math.round(kg * 10) / 10).toBeCloseTo(kg, 10);
      }
    }
  });

  it('always carries its sources', () => {
    const result = projectMuscleGain(input());
    expect(result.sources.length).toBeGreaterThanOrEqual(3);
    expect(result.sources.join(' ')).toContain('Bhasin');
  });

  it('is pure: the same input gives the same answer', () => {
    const args = input({
      adherence: 0.82,
      enhancement: { status: 'trt', testosterone_mg_per_dose: 140 },
    });
    expect(projectMuscleGain(args)).toEqual(projectMuscleGain(args));
  });
});

describe('projectionSexFrom', () => {
  it('reads the two values the model has data for', () => {
    expect(projectionSexFrom('Male')).toBe('male');
    expect(projectionSexFrom('  female ')).toBe('female');
    expect(projectionSexFrom('F')).toBe('female');
  });

  it('treats anything else as unknown rather than as a default', () => {
    expect(projectionSexFrom(null)).toBeNull();
    expect(projectionSexFrom(undefined)).toBeNull();
    expect(projectionSexFrom('')).toBeNull();
    expect(projectionSexFrom('other')).toBeNull();
    expect(projectionSexFrom('prefer not to say')).toBeNull();
  });
});
