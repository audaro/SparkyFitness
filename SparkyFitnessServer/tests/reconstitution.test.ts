import { describe, expect, it } from 'vitest';
import {
  reconstitute,
  diluentForTargetUnits,
  SYRINGE_UNITS_PER_ML,
  MIN_RELIABLE_SYRINGE_UNITS,
  type ReconstitutionInput,
  type ReconstitutionResult,
} from '@workspace/shared';

/** The blueprint's worked example: 10 mg vial + 2 mL BAC = 5 mg/mL, 2 mg dose = 40 u. */
const RETATRUTIDE: ReconstitutionInput = {
  vial: { amount: 10, unit: 'mg' },
  diluentMl: 2,
  dose: { amount: 2, unit: 'mg' },
};

function expectOk(result: ReconstitutionResult) {
  if (!result.ok) {
    throw new Error(`expected ok, got failure: ${result.reason}`);
  }
  return result;
}

function expectFail(result: ReconstitutionResult) {
  if (result.ok) {
    throw new Error('expected failure, got a successful result');
  }
  return result;
}

describe('reconstitute — the arithmetic', () => {
  it('solves the worked example end to end', () => {
    const r = expectOk(reconstitute(RETATRUTIDE));

    expect(r.concentration).toBe(5);
    expect(r.concentrationUnit).toBe('mg');
    expect(r.drawVolumeMl).toBe(0.4);
    expect(r.syringeUnits).toBe(40);
    expect(r.dosesPerVial).toBe(5);
    expect(r.warnings).toEqual([]);
  });

  it('defaults to U-100 and echoes which barrel the number is for', () => {
    const r = expectOk(reconstitute(RETATRUTIDE));

    expect(r.syringe).toBe('U-100');
    expect(r.syringeUnitsPerMl).toBe(100);
  });

  it('reports 2.5x more marks on a U-40 barrel for the same volume', () => {
    const u100 = expectOk(reconstitute({ ...RETATRUTIDE, syringe: 'U-100' }));
    const u40 = expectOk(reconstitute({ ...RETATRUTIDE, syringe: 'U-40' }));

    // Same drug, same vial, same draw volume — only the barrel's graduations differ.
    expect(u40.drawVolumeMl).toBe(u100.drawVolumeMl);
    expect(u40.syringeUnits).toBe(16);
    expect(u40.syringe).toBe('U-40');
    expect(u100.syringeUnits / u40.syringeUnits).toBeCloseTo(2.5, 10);
  });

  it('multiplies doses by the schedule interval for vial life', () => {
    const r = expectOk(reconstitute({ ...RETATRUTIDE, intervalDays: 7 }));

    expect(r.dosesPerVial).toBe(5);
    expect(r.vialLastsDays).toBe(35);
  });

  it('leaves vial life null when no interval is supplied', () => {
    expect(expectOk(reconstitute(RETATRUTIDE)).vialLastsDays).toBeNull();
    expect(
      expectOk(reconstitute({ ...RETATRUTIDE, intervalDays: null }))
        .vialLastsDays
    ).toBeNull();
  });

  it('counts a dose equal to the whole vial as exactly one dose', () => {
    const r = expectOk(
      reconstitute({
        vial: { amount: 5, unit: 'mg' },
        diluentMl: 1,
        dose: { amount: 5, unit: 'mg' },
      })
    );

    expect(r.dosesPerVial).toBe(1);
    expect(r.drawVolumeMl).toBe(1);
  });

  it('does not lose a dose to floating-point error', () => {
    // 0.3 / 0.1 is 2.9999999999999996 in IEEE 754; a bare Math.floor yields 2.
    const r = expectOk(
      reconstitute({
        vial: { amount: 0.3, unit: 'mg' },
        diluentMl: 1,
        dose: { amount: 0.1, unit: 'mg' },
      })
    );

    expect(r.dosesPerVial).toBe(3);
  });
});

describe('reconstitute — unit handling', () => {
  it('converts mcg doses against an mg vial explicitly', () => {
    const r = expectOk(
      reconstitute({
        vial: { amount: 10, unit: 'mg' },
        diluentMl: 2,
        dose: { amount: 2000, unit: 'mcg' }, // 2 mg
      })
    );

    // Identical to the mg-for-mg worked example — the x1000 is applied, not implied.
    expect(r.drawVolumeMl).toBe(0.4);
    expect(r.syringeUnits).toBe(40);
    expect(r.dosesPerVial).toBe(5);
  });

  it('converts an mg dose against an mcg vial', () => {
    const r = expectOk(
      reconstitute({
        vial: { amount: 5000, unit: 'mcg' },
        diluentMl: 1,
        dose: { amount: 1, unit: 'mg' }, // 1000 mcg
      })
    );

    expect(r.concentration).toBe(5000);
    expect(r.concentrationUnit).toBe('mcg');
    expect(r.drawVolumeMl).toBe(0.2);
    expect(r.dosesPerVial).toBe(5);
  });

  it('reports concentration in the vial unit, not a normalized one', () => {
    const r = expectOk(
      reconstitute({
        vial: { amount: 2, unit: 'mg' },
        diluentMl: 1,
        dose: { amount: 500, unit: 'mcg' },
      })
    );

    expect(r.concentration).toBe(2);
    expect(r.concentrationUnit).toBe('mg');
  });

  it('stays in IU end to end for an IU vial', () => {
    // HCG: 5000 IU vial + 2 mL, 500 IU dose -> 2500 IU/mL, 0.2 mL, 20 u, 10 doses.
    const r = expectOk(
      reconstitute({
        vial: { amount: 5000, unit: 'iu' },
        diluentMl: 2,
        dose: { amount: 500, unit: 'iu' },
      })
    );

    expect(r.concentrationUnit).toBe('iu');
    expect(r.concentration).toBe(2500);
    expect(r.drawVolumeMl).toBe(0.2);
    expect(r.syringeUnits).toBe(20);
    expect(r.dosesPerVial).toBe(10);
  });

  it.each([
    ['iu vial, mg dose', 'iu', 'mg'],
    ['iu vial, mcg dose', 'iu', 'mcg'],
    ['mg vial, iu dose', 'mg', 'iu'],
    ['mcg vial, iu dose', 'mcg', 'iu'],
  ] as const)(
    'refuses to cross IU and mass (%s)',
    (_label, vialUnit, doseUnit) => {
      const r = expectFail(
        reconstitute({
          vial: { amount: 5000, unit: vialUnit },
          diluentMl: 2,
          dose: { amount: 1, unit: doseUnit },
        })
      );

      expect(r.reason).toBe('unit_mismatch');
      expect(r.message).toMatch(/not interchangeable/i);
    }
  );
});

describe('reconstitute — refusals', () => {
  it.each([
    ['zero diluent', { ...RETATRUTIDE, diluentMl: 0 }, 'invalid_diluent'],
    ['negative diluent', { ...RETATRUTIDE, diluentMl: -2 }, 'invalid_diluent'],
    [
      'zero vial',
      { ...RETATRUTIDE, vial: { amount: 0, unit: 'mg' as const } },
      'invalid_vial_amount',
    ],
    [
      'negative vial',
      { ...RETATRUTIDE, vial: { amount: -10, unit: 'mg' as const } },
      'invalid_vial_amount',
    ],
    [
      'zero dose',
      { ...RETATRUTIDE, dose: { amount: 0, unit: 'mg' as const } },
      'invalid_dose',
    ],
    [
      'negative dose',
      { ...RETATRUTIDE, dose: { amount: -2, unit: 'mg' as const } },
      'invalid_dose',
    ],
    [
      'NaN diluent',
      { ...RETATRUTIDE, diluentMl: Number.NaN },
      'invalid_diluent',
    ],
    [
      'Infinite vial',
      { ...RETATRUTIDE, vial: { amount: Infinity, unit: 'mg' as const } },
      'invalid_vial_amount',
    ],
    [
      'NaN dose',
      { ...RETATRUTIDE, dose: { amount: Number.NaN, unit: 'mg' as const } },
      'invalid_dose',
    ],
  ])('refuses %s', (_label, input, reason) => {
    expect(expectFail(reconstitute(input as ReconstitutionInput)).reason).toBe(
      reason
    );
  });

  it('refuses a dose larger than the vial holds', () => {
    const r = expectFail(
      reconstitute({ ...RETATRUTIDE, dose: { amount: 12, unit: 'mg' } })
    );

    expect(r.reason).toBe('dose_exceeds_vial');
  });

  it('refuses a dose larger than the vial across a unit conversion', () => {
    // 12000 mcg is 12 mg against a 10 mg vial — the check has to happen post-conversion.
    const r = expectFail(
      reconstitute({ ...RETATRUTIDE, dose: { amount: 12000, unit: 'mcg' } })
    );

    expect(r.reason).toBe('dose_exceeds_vial');
  });

  it('refuses an unknown syringe standard', () => {
    const r = expectFail(
      reconstitute({
        ...RETATRUTIDE,
        syringe: 'U-50' as unknown as 'U-100',
      })
    );

    expect(r.reason).toBe('invalid_syringe');
  });

  it.each([0, -10, Number.NaN])(
    'refuses a syringe capacity of %s',
    (capacity) => {
      const r = expectFail(
        reconstitute({ ...RETATRUTIDE, syringeCapacityUnits: capacity })
      );

      expect(r.reason).toBe('invalid_syringe_capacity');
    }
  );

  it.each([0, -7, Number.NaN])('refuses an interval of %s days', (interval) => {
    const r = expectFail(
      reconstitute({ ...RETATRUTIDE, intervalDays: interval })
    );

    expect(r.reason).toBe('invalid_interval');
  });

  it('carries a plain-language message on every refusal', () => {
    const r = expectFail(reconstitute({ ...RETATRUTIDE, diluentMl: 0 }));

    expect(typeof r.message).toBe('string');
    expect(r.message.length).toBeGreaterThan(0);
  });
});

describe('reconstitute — warnings (computed, but flagged)', () => {
  it('warns above the barrel capacity but still returns the number', () => {
    // 5 mg vial in 5 mL is 1 mg/mL; a 2 mg dose is 2 mL = 200 u on a 100 u barrel.
    const r = expectOk(
      reconstitute({
        vial: { amount: 5, unit: 'mg' },
        diluentMl: 5,
        dose: { amount: 2, unit: 'mg' },
      })
    );

    expect(r.syringeUnits).toBe(200);
    expect(r.warnings.map((w) => w.code)).toContain('exceeds_syringe_capacity');
  });

  it('applies the U-40 barrel capacity, not the U-100 one', () => {
    // 0.5 mL is 50 u on U-100 (fine) but 20 u on a 40 u U-40 barrel (also fine);
    // 1.5 mL is 60 u on U-40, which overflows it.
    const r = expectOk(
      reconstitute({
        vial: { amount: 2, unit: 'mg' },
        diluentMl: 3,
        dose: { amount: 1, unit: 'mg' },
        syringe: 'U-40',
      })
    );

    expect(r.drawVolumeMl).toBe(1.5);
    expect(r.syringeUnits).toBe(60);
    expect(r.warnings.map((w) => w.code)).toContain('exceeds_syringe_capacity');
  });

  it('honours an explicit smaller barrel', () => {
    // 40 u fits a 100 u barrel but not a 30 u one.
    const roomy = expectOk(reconstitute(RETATRUTIDE));
    const small = expectOk(
      reconstitute({ ...RETATRUTIDE, syringeCapacityUnits: 30 })
    );

    expect(roomy.warnings).toEqual([]);
    expect(small.warnings.map((w) => w.code)).toContain(
      'exceeds_syringe_capacity'
    );
  });

  it('warns below reliable measurement precision but still returns the number', () => {
    // 10 mg in 0.5 mL is 20 mg/mL; a 0.2 mg dose is 0.01 mL = 1 u.
    const r = expectOk(
      reconstitute({
        vial: { amount: 10, unit: 'mg' },
        diluentMl: 0.5,
        dose: { amount: 0.2, unit: 'mg' },
      })
    );

    expect(r.syringeUnits).toBeLessThan(MIN_RELIABLE_SYRINGE_UNITS);
    expect(r.warnings.map((w) => w.code)).toContain(
      'below_measurable_precision'
    );
  });

  it('does not warn on a comfortable draw', () => {
    expect(expectOk(reconstitute(RETATRUTIDE)).warnings).toEqual([]);
  });
});

describe('reconstitute — no silent partial results', () => {
  const CASES: ReconstitutionInput[] = [
    RETATRUTIDE,
    { ...RETATRUTIDE, syringe: 'U-40' },
    { ...RETATRUTIDE, intervalDays: 7 },
    { ...RETATRUTIDE, dose: { amount: 2000, unit: 'mcg' } },
    {
      vial: { amount: 5000, unit: 'iu' },
      diluentMl: 2,
      dose: { amount: 500, unit: 'iu' },
    },
    {
      vial: { amount: 5, unit: 'mg' },
      diluentMl: 5,
      dose: { amount: 2, unit: 'mg' },
    },
    {
      vial: { amount: 10, unit: 'mg' },
      diluentMl: 0.5,
      dose: { amount: 0.2, unit: 'mg' },
    },
    {
      vial: { amount: 0.3, unit: 'mg' },
      diluentMl: 1,
      dose: { amount: 0.1, unit: 'mg' },
    },
  ];

  it('returns either a complete, finite answer or an error — never a half-filled one', () => {
    for (const input of CASES) {
      const result = reconstitute(input);

      if (!result.ok) {
        expect(typeof result.reason).toBe('string');
        expect(result.message.length).toBeGreaterThan(0);
        continue;
      }

      // Every numeric field present, finite, and positive. A NaN or undefined reaching a
      // syringe is the failure mode this whole module exists to prevent.
      for (const field of [
        'concentration',
        'drawVolumeMl',
        'syringeUnits',
        'syringeUnitsPerMl',
        'dosesPerVial',
      ] as const) {
        expect(Number.isFinite(result[field])).toBe(true);
        expect(result[field]).toBeGreaterThan(0);
      }
      expect(result.concentrationUnit).toBe(input.vial.unit);
      expect(result.syringe).toBe(input.syringe ?? 'U-100');
      expect(result.syringeUnitsPerMl).toBe(
        SYRINGE_UNITS_PER_ML[input.syringe ?? 'U-100']
      );
      expect(Number.isInteger(result.dosesPerVial)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
      if (result.vialLastsDays !== null) {
        expect(Number.isFinite(result.vialLastsDays)).toBe(true);
      }
    }
  });

  it('keeps the reported units and volume internally consistent', () => {
    for (const input of CASES) {
      const result = reconstitute(input);
      if (!result.ok) continue;

      // syringeUnits must be drawVolumeMl expressed on the stated barrel, to rounding.
      expect(result.syringeUnits).toBeCloseTo(
        result.drawVolumeMl * result.syringeUnitsPerMl,
        2
      );
      // The vial must actually hold the doses claimed. Tolerance is 3dp, not more:
      // `concentration` is rounded to 4dp for display, so a non-terminating ratio
      // (10 mg / 3 mL) cannot reproduce the vial amount exactly.
      expect(result.concentration * input.diluentMl).toBeCloseTo(
        input.vial.amount,
        3
      );
    }
  });
});

describe('diluentForTargetUnits', () => {
  it('is the inverse of reconstitute', () => {
    const target = 20;
    const solved = diluentForTargetUnits({
      vial: { amount: 10, unit: 'mg' },
      dose: { amount: 2, unit: 'mg' },
      targetSyringeUnits: target,
    });

    if (!solved.ok) throw new Error(`expected ok, got ${solved.reason}`);
    expect(solved.diluentMl).toBe(1);

    const roundTrip = expectOk(
      reconstitute({
        vial: { amount: 10, unit: 'mg' },
        diluentMl: solved.diluentMl,
        dose: { amount: 2, unit: 'mg' },
      })
    );
    expect(roundTrip.syringeUnits).toBe(target);
  });

  it('solves against the U-40 barrel when asked', () => {
    const solved = diluentForTargetUnits({
      vial: { amount: 10, unit: 'mg' },
      dose: { amount: 2, unit: 'mg' },
      targetSyringeUnits: 20,
      syringe: 'U-40',
    });

    if (!solved.ok) throw new Error(`expected ok, got ${solved.reason}`);
    // 20 marks on U-40 is 0.5 mL, so the vial needs 2.5 mL to make a 2 mg dose that big.
    expect(solved.diluentMl).toBe(2.5);
  });

  it('refuses the same conditions reconstitute refuses', () => {
    const base = {
      vial: { amount: 10, unit: 'mg' as const },
      dose: { amount: 2, unit: 'mg' as const },
      targetSyringeUnits: 20,
    };

    expect(
      diluentForTargetUnits({ ...base, targetSyringeUnits: 0 })
    ).toMatchObject({ ok: false });
    expect(
      diluentForTargetUnits({ ...base, vial: { amount: 0, unit: 'mg' } })
    ).toMatchObject({ ok: false, reason: 'invalid_vial_amount' });
    expect(
      diluentForTargetUnits({ ...base, dose: { amount: 20, unit: 'mg' } })
    ).toMatchObject({ ok: false, reason: 'dose_exceeds_vial' });
    expect(
      diluentForTargetUnits({ ...base, dose: { amount: 500, unit: 'iu' } })
    ).toMatchObject({ ok: false, reason: 'unit_mismatch' });
  });
});
