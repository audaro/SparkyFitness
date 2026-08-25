import { describe, expect, it } from 'vitest';
import {
  concentrationDraw,
  concentrationUnitLabel,
  parseConcentrationUnit,
  readReconstitutionRecord,
  RECONSTITUTION_FIELD,
  reconstitute,
  type ReconstitutionRecord,
} from '@workspace/shared';

const MIX: ReconstitutionRecord = {
  vial_amount: 30,
  vial_unit: 'mg',
  diluent_ml: 3,
  syringe: 'U-100',
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
