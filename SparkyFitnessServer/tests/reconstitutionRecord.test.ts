import { describe, expect, it } from 'vitest';
import {
  concentrationDraw,
  concentrationUnitLabel,
  parseConcentrationUnit,
  readReconstitutionRecord,
  RECONSTITUTION_FIELD,
  reconstitute,
  vialInventoryPrefill,
  vialBudGuidance,
  PRESERVED_BUD_DAYS,
  type ReconstitutionRecord,
} from '@workspace/shared';

const MIX: ReconstitutionRecord = {
  vial_amount: 30,
  vial_unit: 'mg',
  diluent_ml: 3,
  syringe: 'U-100',
  diluent: 'bacteriostatic_water',
};

const FIELDS = { catalog_id: 'retatrutide', [RECONSTITUTION_FIELD]: MIX };

describe('readReconstitutionRecord', () => {
  it('reads a complete record back off custom_fields', () => {
    expect(readReconstitutionRecord(FIELDS)).toEqual(MIX);
  });

  it('leaves the rest of custom_fields alone', () => {
    // The record is one key among others; reading it must not depend on what else is there.
    expect(readReconstitutionRecord({ [RECONSTITUTION_FIELD]: MIX })).toEqual(
      MIX
    );
  });

  it.each([
    ['no custom_fields at all', null],
    ['custom_fields without the key', { catalog_id: 'retatrutide' }],
    ['a null record', { [RECONSTITUTION_FIELD]: null }],
    ['a string where the record should be', { [RECONSTITUTION_FIELD]: 'yes' }],
    [
      'a missing vial amount',
      { [RECONSTITUTION_FIELD]: { ...MIX, vial_amount: undefined } },
    ],
    [
      'a zero vial amount',
      { [RECONSTITUTION_FIELD]: { ...MIX, vial_amount: 0 } },
    ],
    [
      'a negative diluent',
      { [RECONSTITUTION_FIELD]: { ...MIX, diluent_ml: -3 } },
    ],
    [
      'a NaN diluent',
      { [RECONSTITUTION_FIELD]: { ...MIX, diluent_ml: Number.NaN } },
    ],
    [
      'a numeric vial amount as a string',
      { [RECONSTITUTION_FIELD]: { ...MIX, vial_amount: '30' } },
    ],
    [
      'an unknown unit',
      { [RECONSTITUTION_FIELD]: { ...MIX, vial_unit: 'ml' } },
    ],
    [
      'an unknown syringe',
      { [RECONSTITUTION_FIELD]: { ...MIX, syringe: 'U-500' } },
    ],
  ])('reads %s as no record at all', (_label, customFields) => {
    // custom_fields is free-form JSONB that older rows and other clients write into. Half a
    // mix repopulating a syringe calculator is worse than an empty one.
    expect(readReconstitutionRecord(customFields)).toBeNull();
  });

  it('ignores a record inherited from the prototype chain', () => {
    const inherited = Object.create({ [RECONSTITUTION_FIELD]: MIX }) as object;

    expect(readReconstitutionRecord(inherited)).toBeNull();
  });
});

describe('parseConcentrationUnit', () => {
  it.each([
    ['mg/mL', 'mg'],
    ['mcg/mL', 'mcg'],
    ['iu/mL', 'iu'],
    // Tolerant on the reader: people type this by hand.
    ['mg/ml', 'mg'],
    [' mg/mL ', 'mg'],
    ['MG/ML', 'mg'],
  ])('reads %s as a concentration in %s', (strengthUnit, expected) => {
    expect(parseConcentrationUnit(strengthUnit)).toBe(expected);
  });

  it.each([['mg'], ['tablet'], ['mg/kg'], [''], [null], [undefined]])(
    'reads %s as not a concentration',
    (strengthUnit) => {
      // A 10 mg tablet and a 10 mg/mL vial are different things, and only one has a draw.
      expect(parseConcentrationUnit(strengthUnit)).toBeNull();
    }
  );

  it('round-trips the label it writes', () => {
    expect(parseConcentrationUnit(concentrationUnitLabel('mcg'))).toBe('mcg');
  });
});

describe('concentrationDraw', () => {
  it('gives the same answer the calculator gave for the same mix', () => {
    // 30 mg in 3 mL is 10 mg/mL; a 2 mg dose is 0.2 mL, 20 marks on a U-100.
    const fromCalculator = reconstitute({
      vial: { amount: MIX.vial_amount, unit: MIX.vial_unit },
      diluentMl: MIX.diluent_ml,
      dose: { amount: 2, unit: 'mg' },
      syringe: MIX.syringe,
    });
    const fromSavedRow = concentrationDraw({
      strengthValue: 10,
      strengthUnit: 'mg/mL',
      doseAmount: 2,
      doseUnit: 'mg',
      syringe: MIX.syringe,
    });

    expect(fromCalculator.ok).toBe(true);
    if (!fromCalculator.ok) return;
    expect(fromSavedRow).toEqual({
      drawVolumeMl: fromCalculator.drawVolumeMl,
      syringeUnits: fromCalculator.syringeUnits,
      syringe: 'U-100',
      syringeUnitsPerMl: 100,
    });
  });

  it('reads the same volume against a different barrel', () => {
    const u40 = concentrationDraw({
      strengthValue: 10,
      strengthUnit: 'mg/mL',
      doseAmount: 2,
      doseUnit: 'mg',
      syringe: 'U-40',
    });

    expect(u40?.drawVolumeMl).toBe(0.2);
    expect(u40?.syringeUnits).toBe(8);
    expect(u40?.syringe).toBe('U-40');
  });

  it('defaults to U-100 when no syringe was recorded', () => {
    const draw = concentrationDraw({
      strengthValue: 10,
      strengthUnit: 'mg/mL',
      doseAmount: 2,
      doseUnit: 'mg',
      syringe: null,
    });

    expect(draw?.syringe).toBe('U-100');
    expect(draw?.syringeUnits).toBe(20);
  });

  it('converts a mcg dose against an mg/mL vial', () => {
    const draw = concentrationDraw({
      strengthValue: 10,
      strengthUnit: 'mg/mL',
      doseAmount: 2000, // 2 mg
      doseUnit: 'mcg',
    });

    expect(draw?.syringeUnits).toBe(20);
  });

  it('allows a dose larger than one mL', () => {
    // Nothing caps a draw at the concentration: 20 mg at 10 mg/mL is 2 mL, which is a real
    // instruction (a second draw), not a refusal.
    const draw = concentrationDraw({
      strengthValue: 10,
      strengthUnit: 'mg/mL',
      doseAmount: 20,
      doseUnit: 'mg',
    });

    expect(draw?.drawVolumeMl).toBe(2);
    expect(draw?.syringeUnits).toBe(200);
  });

  it.each([
    ['a per-tablet strength', { strengthUnit: 'mg' }],
    ['no strength', { strengthValue: null }],
    ['a zero strength', { strengthValue: 0 }],
    ['no dose', { doseAmount: null }],
    ['a zero dose', { doseAmount: 0 }],
    ['a dose in tablets', { doseUnit: 'tablet' }],
    // IU has no general factor to mass — refuse rather than guess.
    ['an IU dose against an mg vial', { doseUnit: 'iu' }],
  ])('refuses to guess a draw for %s', (_label, override) => {
    const draw = concentrationDraw({
      strengthValue: 10,
      strengthUnit: 'mg/mL',
      doseAmount: 2,
      doseUnit: 'mg',
      ...override,
    });

    expect(draw).toBeNull();
  });

  it('follows the strength rather than the mix it was derived from', () => {
    // The whole reason the draw is computed from the columns: a hand-edited strength has to
    // move the marks with it, or the number shown is for a vial the user no longer has.
    const before = concentrationDraw({
      strengthValue: 10,
      strengthUnit: 'mg/mL',
      doseAmount: 2,
      doseUnit: 'mg',
    });
    const after = concentrationDraw({
      strengthValue: 12,
      strengthUnit: 'mg/mL',
      doseAmount: 2,
      doseUnit: 'mg',
    });

    expect(before?.syringeUnits).toBe(20);
    expect(after?.syringeUnits).toBeCloseTo(16.67, 2);
  });
});

describe('vialInventoryPrefill', () => {
  it('derives the whole vial row from the mix already on record', () => {
    // The blueprint's worked case, one step on: a 10 mg vial in 2 mL at a 2 mg dose is 5 mg/mL
    // and five doses in the bottle — not the ten the form used to open on.
    const prefill = vialInventoryPrefill({
      customFields: {
        [RECONSTITUTION_FIELD]: {
          vial_amount: 10,
          vial_unit: 'mg',
          diluent_ml: 2,
          syringe: 'U-100',
        },
      },
      doseAmount: 2,
      doseUnit: 'mg',
    });

    expect(prefill).toEqual({
      concentrationMgMl: 5,
      volumeMl: 2,
      dosesTotal: 5,
      // No diluent on these fixtures, so the window is the assumed one.
      bud: { days: PRESERVED_BUD_DAYS, reason: 'unstated' },
    });
  });

  it('converts a microgram vial to the mg/mL the inventory column is in', () => {
    // 5000 mcg in 2 mL is 2.5 mg/mL. Writing 2500 into a column labelled mg/mL is the
    // factor-of-1000 error this whole module exists to prevent.
    const prefill = vialInventoryPrefill({
      customFields: {
        [RECONSTITUTION_FIELD]: {
          vial_amount: 5000,
          vial_unit: 'mcg',
          diluent_ml: 2,
          syringe: 'U-100',
        },
      },
      doseAmount: 500,
      doseUnit: 'mcg',
    });

    expect(prefill?.concentrationMgMl).toBe(2.5);
    expect(prefill?.dosesTotal).toBe(10);
  });

  it('leaves the concentration blank for an IU vial', () => {
    // HCG is measured in IU and there is no factor from IU to mass. The doses still divide.
    const prefill = vialInventoryPrefill({
      customFields: {
        [RECONSTITUTION_FIELD]: {
          vial_amount: 5000,
          vial_unit: 'iu',
          diluent_ml: 2,
          syringe: 'U-100',
        },
      },
      doseAmount: 500,
      doseUnit: 'iu',
    });

    expect(prefill).toEqual({
      concentrationMgMl: null,
      volumeMl: 2,
      dosesTotal: 10,
      // No diluent on these fixtures, so the window is the assumed one.
      bud: { days: PRESERVED_BUD_DAYS, reason: 'unstated' },
    });
  });

  it('still gives the vial its size when the dose is unknown', () => {
    // Concentration and volume are facts about the bottle; only the dose count needs a dose.
    const prefill = vialInventoryPrefill({
      customFields: { [RECONSTITUTION_FIELD]: MIX },
      doseAmount: null,
      doseUnit: null,
    });

    expect(prefill).toEqual({
      concentrationMgMl: 10,
      volumeMl: 3,
      dosesTotal: null,
      // MIX states a preserved diluent, so the window is derived even though the dose is not.
      bud: { days: PRESERVED_BUD_DAYS, reason: 'preserved' },
    });
  });

  it('refuses a dose count for a dose the vial cannot hold', () => {
    const prefill = vialInventoryPrefill({
      customFields: { [RECONSTITUTION_FIELD]: MIX },
      doseAmount: 50,
      doseUnit: 'mg',
    });

    // `reconstitute` refuses this outright, and a form that filled in "0 doses" or "1 dose"
    // anyway would be inventing the number the calculator declined to give.
    expect(prefill?.dosesTotal).toBeNull();
    expect(prefill?.concentrationMgMl).toBe(10);
  });

  it('refuses a dose count across unit families', () => {
    const prefill = vialInventoryPrefill({
      customFields: {
        [RECONSTITUTION_FIELD]: {
          vial_amount: 5000,
          vial_unit: 'iu',
          diluent_ml: 2,
          syringe: 'U-100',
        },
      },
      doseAmount: 1,
      doseUnit: 'mg',
    });

    expect(prefill?.dosesTotal).toBeNull();
  });

  it('reads a unit the user typed in their own case', () => {
    const prefill = vialInventoryPrefill({
      customFields: { [RECONSTITUTION_FIELD]: MIX },
      doseAmount: 5,
      doseUnit: ' MG ',
    });

    expect(prefill?.dosesTotal).toBe(6);
  });

  it('says nothing at all when the medication has no mix on record', () => {
    // Null is the signal to leave the form on its own defaults, distinct from a record that
    // produced no usable numbers.
    expect(
      vialInventoryPrefill({
        customFields: { catalog_id: 'retatrutide' },
        doseAmount: 2,
        doseUnit: 'mg',
      })
    ).toBeNull();
    expect(
      vialInventoryPrefill({
        customFields: null,
        doseAmount: 2,
        doseUnit: 'mg',
      })
    ).toBeNull();
  });

  it('says nothing for a half-written record', () => {
    // Same rule `readReconstitutionRecord` is under: custom_fields is free-form JSONB, and a
    // partial blob must read as "no record" rather than as a vial of unknown size.
    expect(
      vialInventoryPrefill({
        customFields: {
          [RECONSTITUTION_FIELD]: { vial_amount: 10, vial_unit: 'mg' },
        },
        doseAmount: 2,
        doseUnit: 'mg',
      })
    ).toBeNull();
  });
});

describe('reconstitution diluent', () => {
  it('reads a diluent off a record that states one', () => {
    expect(readReconstitutionRecord(FIELDS)?.diluent).toBe(
      'bacteriostatic_water'
    );
  });

  it.each([
    'bacteriostatic_water',
    'bacteriostatic_saline',
    'sterile_water',
    'sterile_saline',
  ])('accepts %s', (diluent) => {
    const record = readReconstitutionRecord({
      [RECONSTITUTION_FIELD]: { ...MIX, diluent },
    });
    expect(record?.diluent).toBe(diluent);
  });

  it.each([
    ['a record written before the field existed', undefined],
    ['an explicit null', null],
    ['a fluid this version does not know', 'tap_water'],
    ['a non-string', 7],
  ])('reads %s as not stated, keeping the record valid', (_label, diluent) => {
    // The deliberate exception to the all-or-nothing rule: the diluent feeds the beyond-use
    // suggestion and nothing in the syringe math, so voiding the record over it would break
    // every mix already saved in order to protect arithmetic it is not part of.
    const record = readReconstitutionRecord({
      [RECONSTITUTION_FIELD]: { ...MIX, diluent },
    });
    expect(record).not.toBeNull();
    expect(record?.vial_amount).toBe(30);
    expect(record?.diluent).toBeNull();
  });
});

describe('vialBudGuidance', () => {
  it.each(['bacteriostatic_water', 'bacteriostatic_saline'] as const)(
    'gives %s the preserved window',
    (diluent) => {
      expect(vialBudGuidance(diluent)).toEqual({
        days: PRESERVED_BUD_DAYS,
        reason: 'preserved',
      });
    }
  );

  it.each(['sterile_water', 'sterile_saline'] as const)(
    'refuses a window for %s',
    (diluent) => {
      // There is a real figure for a preservative-free mix and it is measured in hours,
      // depending on how and where the vial was punctured. Naming a day count here would be
      // this module recommending rather than converting.
      expect(vialBudGuidance(diluent)).toEqual({
        days: null,
        reason: 'preservative_free',
      });
    }
  );

  it('falls back to the preserved window, flagged as an assumption, when unstated', () => {
    expect(vialBudGuidance(null)).toEqual({
      days: PRESERVED_BUD_DAYS,
      reason: 'unstated',
    });
  });

  it('is 28 days, and changing that should be deliberate', () => {
    expect(PRESERVED_BUD_DAYS).toBe(28);
  });
});

describe('vialInventoryPrefill beyond-use guidance', () => {
  it('carries the window derived from the mix', () => {
    const prefill = vialInventoryPrefill({
      customFields: { [RECONSTITUTION_FIELD]: MIX },
      doseAmount: 2,
      doseUnit: 'mg',
    });
    expect(prefill?.bud).toEqual({
      days: PRESERVED_BUD_DAYS,
      reason: 'preserved',
    });
  });

  it('carries the refusal for a preservative-free mix, with the numbers still filled', () => {
    const prefill = vialInventoryPrefill({
      customFields: {
        [RECONSTITUTION_FIELD]: { ...MIX, diluent: 'sterile_water' },
      },
      doseAmount: 2,
      doseUnit: 'mg',
    });
    // The diluent decides the window, not the arithmetic: concentration and dose count stand.
    expect(prefill?.concentrationMgMl).toBe(10);
    expect(prefill?.dosesTotal).toBe(15);
    expect(prefill?.bud).toEqual({ days: null, reason: 'preservative_free' });
  });

  it('reports an unstated diluent as an assumption rather than a derivation', () => {
    const prefill = vialInventoryPrefill({
      customFields: {
        [RECONSTITUTION_FIELD]: { ...MIX, diluent: undefined },
      },
      doseAmount: 2,
      doseUnit: 'mg',
    });
    expect(prefill?.bud).toEqual({
      days: PRESERVED_BUD_DAYS,
      reason: 'unstated',
    });
  });
});
