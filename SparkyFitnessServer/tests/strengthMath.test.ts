import { describe, it, expect } from 'vitest';
import {
  ALWAYS_AVAILABLE_EQUIPMENT,
  CANONICAL_SET_TYPES,
  DEFAULT_INCREMENT_KG,
  DEFAULT_SET_TYPE,
  EQUIPMENT,
  EQUIPMENT_INCREMENT_KG,
  LOWER_BODY_MUSCLES,
  MUSCLES,
  epley1RmKg,
  estimateRepMaxKg,
  incrementForEquipmentKg,
  isCanonicalSetType,
  isKnownEquipment,
  isKnownMuscle,
  isLowerBodyMuscle,
  isWarmupSetType,
  normalizeEquipmentName,
  normalizeMuscleName,
  quantizeLoadKg,
  toCanonicalEquipment,
  toCanonicalMuscle,
  weightForRepsKg,
} from '@workspace/shared';

describe('exercise taxonomy — pinned vocabulary', () => {
  it('pins the free-exercise-db muscle enum verbatim', () => {
    // Must stay byte-identical to schema.json's primaryMuscles enum: the
    // catalog filter is `primary_muscles::jsonb ?| ARRAY[...]`, an exact
    // case-sensitive element match (models/exercise.ts:372-398).
    expect(MUSCLES).toEqual([
      'abdominals',
      'abductors',
      'adductors',
      'biceps',
      'calves',
      'chest',
      'forearms',
      'glutes',
      'hamstrings',
      'lats',
      'lower back',
      'middle back',
      'neck',
      'quadriceps',
      'shoulders',
      'traps',
      'triceps',
    ]);
  });

  it('pins the free-exercise-db equipment enum (minus null)', () => {
    expect([...EQUIPMENT].sort()).toEqual([
      'bands',
      'barbell',
      'body only',
      'cable',
      'dumbbell',
      'e-z curl bar',
      'exercise ball',
      'foam roll',
      'kettlebells',
      'machine',
      'medicine ball',
      'other',
    ]);
  });

  it('keeps every canonical value lowercase and trimmed', () => {
    for (const value of [...MUSCLES, ...EQUIPMENT]) {
      expect(value).toBe(value.trim().toLowerCase());
    }
  });

  it('draws the derived lists from the pinned vocabularies', () => {
    for (const muscle of LOWER_BODY_MUSCLES) {
      expect(MUSCLES).toContain(muscle);
    }
    for (const item of ALWAYS_AVAILABLE_EQUIPMENT) {
      expect(EQUIPMENT).toContain(item);
    }
    expect(ALWAYS_AVAILABLE_EQUIPMENT).toContain('body only');
    // 'other' is NOT always available: free-exercise-db files Atlas Stones,
    // Car Deadlift and Battling Ropes under it, so auto-admitting it would
    // recommend a car deadlift to someone with dumbbells at home.
    expect(ALWAYS_AVAILABLE_EQUIPMENT).not.toContain('other');
  });
});

describe('exercise taxonomy — normalization and guards', () => {
  it('normalizes case and stray whitespace', () => {
    expect(normalizeMuscleName('  Lower Back ')).toBe('lower back');
    expect(normalizeEquipmentName('E-Z Curl Bar')).toBe('e-z curl bar');
  });

  it('matches membership exactly, refusing non-canonical casing', () => {
    expect(isKnownMuscle('quadriceps')).toBe(true);
    // 'Quadriceps' would match zero rows through `?|`, so it is not "known".
    expect(isKnownMuscle('Quadriceps')).toBe(false);
    expect(isKnownMuscle('quads')).toBe(false);
    expect(isKnownEquipment('body only')).toBe(true);
    expect(isKnownEquipment('Dumbbell')).toBe(false);
  });

  it('canonicalizes drifted strings, or reports them as unknown', () => {
    expect(toCanonicalMuscle('  Lats ')).toBe('lats');
    expect(toCanonicalMuscle('Middle Back')).toBe('middle back');
    expect(toCanonicalMuscle('rotator cuff')).toBeNull();
    expect(toCanonicalEquipment('MACHINE')).toBe('machine');
    expect(toCanonicalEquipment('smith machine')).toBeNull();
  });

  it('classifies lower-body muscles, normalizing first', () => {
    expect(isLowerBodyMuscle('quadriceps')).toBe(true);
    expect(isLowerBodyMuscle(' Glutes ')).toBe(true);
    expect(isLowerBodyMuscle('lower back')).toBe(false);
    expect(isLowerBodyMuscle('chest')).toBe(false);
  });
});

describe('set types', () => {
  it('matches the server AI tool enum', () => {
    // ai/tools/schemas/common.ts:59-61 — writers share this exact list.
    expect(CANONICAL_SET_TYPES).toEqual([
      'Working Set',
      'Warmup',
      'Drop Set',
      'Failure',
    ]);
    expect(DEFAULT_SET_TYPE).toBe('Working Set');
    expect(isCanonicalSetType('Working Set')).toBe(true);
    expect(isCanonicalSetType('Warm-up')).toBe(false);
  });

  it('detects every warmup spelling the repo has stored', () => {
    for (const variant of [
      'Warmup',
      'warmup',
      'WARMUP',
      'Warm-up',
      'warm up',
      'WARM UP',
      'Warm-up Set',
      'warmup set',
    ]) {
      expect(isWarmupSetType(variant)).toBe(true);
    }
  });

  it('treats working sets and missing types as non-warmup', () => {
    for (const variant of [
      'Working Set',
      'normal',
      'Drop Set',
      'Failure',
      'cool down',
      '',
    ]) {
      expect(isWarmupSetType(variant)).toBe(false);
    }
    expect(isWarmupSetType(null)).toBe(false);
    expect(isWarmupSetType(undefined)).toBe(false);
  });
});

describe('epley1RmKg', () => {
  it('returns the lifted weight for a single', () => {
    expect(epley1RmKg(100, 1)).toBe(100);
  });

  it('applies w × (1 + reps/30)', () => {
    expect(epley1RmKg(100, 5)).toBeCloseTo(116.667, 3);
    expect(epley1RmKg(60, 10)).toBeCloseTo(80, 10);
  });

  it('returns 0 — "no estimate" — for missing or non-positive input', () => {
    expect(epley1RmKg(null, 5)).toBe(0);
    expect(epley1RmKg(100, null)).toBe(0);
    expect(epley1RmKg(undefined, 5)).toBe(0);
    expect(epley1RmKg(0, 5)).toBe(0);
    expect(epley1RmKg(100, 0)).toBe(0);
    expect(epley1RmKg(-100, 5)).toBe(0);
  });
});

describe('weightForRepsKg / estimateRepMaxKg', () => {
  it('inverts Epley — a rep target round-trips to its own weight', () => {
    const oneRm = epley1RmKg(60, 10);
    expect(weightForRepsKg(oneRm, 10)).toBeCloseTo(60, 10);
    expect(estimateRepMaxKg(60, 10, 10)).toBeCloseTo(60, 10);
    expect(estimateRepMaxKg(100, 5, 5)).toBeCloseTo(100, 10);
  });

  it('converts between rep targets', () => {
    // 100 × 5 ⇒ 116.67 1RM ⇒ 116.67 / (1 + 10/30) = 87.5 for a 10-rep target.
    expect(estimateRepMaxKg(100, 5, 10)).toBeCloseTo(87.5, 3);
  });

  it('has no single-rep short-circuit, unlike epley1RmKg', () => {
    // Deliberate: preserves the behaviour mobile's set row has always shown.
    expect(weightForRepsKg(100, 1)).toBeCloseTo(96.774, 3);
  });

  it('returns 0 for an unknown 1RM or a non-positive target', () => {
    expect(weightForRepsKg(0, 10)).toBe(0);
    expect(weightForRepsKg(-100, 10)).toBe(0);
    expect(weightForRepsKg(Number.NaN, 10)).toBe(0);
    expect(weightForRepsKg(100, 0)).toBe(0);
    expect(estimateRepMaxKg(null, null, 10)).toBe(0);
    expect(estimateRepMaxKg(100, 5, -1)).toBe(0);
  });
});

describe('equipment load increments', () => {
  it('assigns an increment to every canonical equipment value', () => {
    for (const item of EQUIPMENT) {
      expect(EQUIPMENT_INCREMENT_KG[item]).toBeTypeOf('number');
      expect(EQUIPMENT_INCREMENT_KG[item]).toBeGreaterThanOrEqual(0);
    }
  });

  it('reads the table through canonicalized lookups', () => {
    expect(incrementForEquipmentKg('barbell')).toBe(2.5);
    expect(incrementForEquipmentKg('  Barbell ')).toBe(2.5);
    expect(incrementForEquipmentKg('dumbbell')).toBe(2.0);
    expect(incrementForEquipmentKg('kettlebells')).toBe(4.0);
    expect(incrementForEquipmentKg('machine')).toBe(2.27);
    expect(incrementForEquipmentKg('cable')).toBe(2.27);
    expect(incrementForEquipmentKg('bands')).toBe(0);
    expect(incrementForEquipmentKg('body only')).toBe(0);
  });

  it('falls back to the default step for unknown or missing equipment', () => {
    expect(incrementForEquipmentKg('smith machine')).toBe(DEFAULT_INCREMENT_KG);
    expect(incrementForEquipmentKg(null)).toBe(DEFAULT_INCREMENT_KG);
    expect(incrementForEquipmentKg(undefined)).toBe(DEFAULT_INCREMENT_KG);
  });
});

describe('quantizeLoadKg', () => {
  it('snaps barbell loads to the nearest 2.5 kg', () => {
    expect(quantizeLoadKg(61.3, 'barbell')).toBe(62.5);
    expect(quantizeLoadKg(61.2, 'barbell')).toBe(60);
    expect(quantizeLoadKg(100, 'barbell')).toBe(100);
    expect(quantizeLoadKg(20.1, 'e-z curl bar')).toBe(20);
  });

  it('snaps dumbbells and kettlebells to their own steps', () => {
    expect(quantizeLoadKg(13.2, 'dumbbell')).toBe(14);
    expect(quantizeLoadKg(12.9, 'dumbbell')).toBe(12);
    expect(quantizeLoadKg(17.5, 'kettlebells')).toBe(16);
    expect(quantizeLoadKg(18.5, 'kettlebells')).toBe(20);
  });

  it('snaps stack machines to 5 lb pins and stays at 2 dp', () => {
    // 61.3 / 2.27 = 27.0 pins ⇒ 61.29 kg, not 61.290000000000006.
    expect(quantizeLoadKg(61.3, 'machine')).toBe(61.29);
    expect(quantizeLoadKg(61.3, 'cable')).toBe(61.29);
    const quantized = quantizeLoadKg(83.7, 'machine');
    expect(Math.round(quantized * 100)).toBe(quantized * 100);
  });

  it('passes zero-increment equipment through untouched', () => {
    expect(quantizeLoadKg(12.5, 'bands')).toBe(12.5);
    expect(quantizeLoadKg(12.5, 'body only')).toBe(12.5);
  });

  it('uses the 1 kg default for unknown or missing equipment', () => {
    expect(quantizeLoadKg(12.4, 'smith machine')).toBe(12);
    expect(quantizeLoadKg(12.6, null)).toBe(13);
    expect(quantizeLoadKg(12.6, undefined)).toBe(13);
  });

  it('returns 0 for a non-positive or non-finite load', () => {
    expect(quantizeLoadKg(0, 'barbell')).toBe(0);
    expect(quantizeLoadKg(-20, 'barbell')).toBe(0);
    expect(quantizeLoadKg(Number.NaN, 'barbell')).toBe(0);
    expect(quantizeLoadKg(Number.POSITIVE_INFINITY, 'barbell')).toBe(0);
  });

  it('is idempotent — quantizing a quantized load is a no-op', () => {
    for (const equipment of EQUIPMENT) {
      const once = quantizeLoadKg(61.3, equipment);
      expect(quantizeLoadKg(once, equipment)).toBe(once);
    }
  });
});
