import { describe, expect, it } from 'vitest';
import { reconcileEntryUnitToVariant } from '../utils/foodUtils.js';

describe('reconcileEntryUnitToVariant', () => {
  it('converts an implicit serving count against a gram variant into grams', () => {
    // "1 serving" of a 174 g wrap -> 174 g, so the diary math yields the full portion
    // instead of treating "1 serving" as "1 gram".
    expect(
      reconcileEntryUnitToVariant(1, undefined, {
        serving_size: 174,
        serving_unit: 'g',
      })
    ).toEqual({ quantity: 174, unit: 'g' });
  });

  it('converts an explicit "serving" unit against a gram variant', () => {
    // 3 pieces of a 40 g baklava -> 120 g.
    expect(
      reconcileEntryUnitToVariant(3, 'serving', {
        serving_size: 40,
        serving_unit: 'g',
      })
    ).toEqual({ quantity: 120, unit: 'g' });
  });

  it('treats plural/alias serving units as servings', () => {
    expect(
      reconcileEntryUnitToVariant(2, 'servings', {
        serving_size: 50,
        serving_unit: 'g',
      })
    ).toEqual({ quantity: 100, unit: 'g' });
  });

  it('leaves a matching concrete unit untouched', () => {
    expect(
      reconcileEntryUnitToVariant(174, 'g', {
        serving_size: 174,
        serving_unit: 'g',
      })
    ).toEqual({ quantity: 174, unit: 'g' });
  });

  it('leaves a serving count against a serving-denominated variant untouched', () => {
    expect(
      reconcileEntryUnitToVariant(2, 'serving', {
        serving_size: 1,
        serving_unit: 'serving',
      })
    ).toEqual({ quantity: 2, unit: 'serving' });
  });

  it('falls back to a factor of 1 when serving_size is missing or invalid', () => {
    expect(
      reconcileEntryUnitToVariant(2, 'serving', {
        serving_size: 0,
        serving_unit: 'ml',
      })
    ).toEqual({ quantity: 2, unit: 'ml' });
  });

  it('converts a same-dimension mass unit into the variant unit', () => {
    // 0.25 lb of brie against a 100 g variant -> 113.398 g, so the diary math
    // shows ~337 kcal instead of dividing 0.25 "pound" by a 100 g serving.
    expect(
      reconcileEntryUnitToVariant(0.25, 'pound', {
        serving_size: 100,
        serving_unit: 'g',
      })
    ).toEqual({ quantity: 113.398, unit: 'g' });
  });

  it('converts a same-dimension volume unit into the variant unit', () => {
    // Factors come from @workspace/shared servingSizeConversions
    // (US-customary cup = 236.588 ml), matching the web/mobile clients.
    expect(
      reconcileEntryUnitToVariant(2, 'cup', {
        serving_size: 250,
        serving_unit: 'ml',
      })
    ).toEqual({ quantity: 473.176, unit: 'ml' });
  });

  it('preserves tiny converted amounts instead of rounding them to zero', () => {
    expect(
      reconcileEntryUnitToVariant(1, 'mg', {
        serving_size: 100,
        serving_unit: 'g',
      })
    ).toEqual({ quantity: 0.001, unit: 'g' });
  });

  it('never converts across dimensions (volume vs mass)', () => {
    expect(
      reconcileEntryUnitToVariant(1, 'cup', {
        serving_size: 100,
        serving_unit: 'g',
      })
    ).toEqual({ quantity: 1, unit: 'cup', unresolved: true });
  });

  it('flags a non-convertible explicit unit as unresolved', () => {
    // A count unit against a gram variant has no deterministic conversion;
    // callers must refuse the log instead of persisting broken entry math.
    expect(
      reconcileEntryUnitToVariant(2, 'piece', {
        serving_size: 30,
        serving_unit: 'g',
      })
    ).toEqual({ quantity: 2, unit: 'piece', unresolved: true });
  });
});
