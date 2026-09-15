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
  capLoadKg,
  epley1RmKg,
  estimateRepMaxKg,
  incrementForEquipmentKg,
  IMPERIAL_EQUIPMENT_INCREMENT_KG,
  KG_PER_LB,
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
    expect(incrementForEquipmentKg('machine')).toBe(5 * KG_PER_LB);
    expect(incrementForEquipmentKg('cable')).toBe(5 * KG_PER_LB);
    expect(incrementForEquipmentKg('bands')).toBe(0);
    expect(incrementForEquipmentKg('body only')).toBe(0);
  });

  it('falls back to the default step for unknown or missing equipment', () => {
    expect(incrementForEquipmentKg('smith machine')).toBe(DEFAULT_INCREMENT_KG);
    expect(incrementForEquipmentKg(null)).toBe(DEFAULT_INCREMENT_KG);
    expect(incrementForEquipmentKg(undefined)).toBe(DEFAULT_INCREMENT_KG);
  });

  it("lets a profile's increment override beat the global table", () => {
    const limits = { dumbbell: { max_kg: 50, increment_kg: 2.27 } };
    expect(incrementForEquipmentKg('dumbbell', limits)).toBe(2.27);
    // Canonicalized on the way in, like the global lookup.
    expect(incrementForEquipmentKg('  Dumbbell ', limits)).toBe(2.27);
    // Other equipment, and a limit entry with no increment, fall through.
    expect(incrementForEquipmentKg('barbell', limits)).toBe(2.5);
    expect(
      incrementForEquipmentKg('dumbbell', { dumbbell: { max_kg: 50 } })
    ).toBe(2.0);
    expect(incrementForEquipmentKg('dumbbell', null)).toBe(2.0);
  });
});

describe('capLoadKg', () => {
  it('passes through with no limits, no matching entry, or a load within them', () => {
    expect(capLoadKg(24, 'dumbbell', null)).toBe(24);
    expect(capLoadKg(24, 'dumbbell', {})).toBe(24);
    expect(capLoadKg(24, 'dumbbell', { barbell: { max_kg: 20 } })).toBe(24);
    expect(capLoadKg(22, 'dumbbell', { dumbbell: { max_kg: 22.5 } })).toBe(22);
    expect(capLoadKg(22.5, 'dumbbell', { dumbbell: { max_kg: 22.5 } })).toBe(
      22.5
    );
  });

  it('floors a binding cap to the increment rather than rounding up through it', () => {
    // 22.5 on 2.0 kg dumbbell steps: nearest-rounding would say 22 or 24;
    // 24 exceeds what the gym stocks, so the cap must floor to 22.
    expect(capLoadKg(24, 'dumbbell', { dumbbell: { max_kg: 22.5 } })).toBe(22);
    // A max sitting exactly on a step keeps the whole step.
    expect(capLoadKg(30, 'dumbbell', { dumbbell: { max_kg: 22 } })).toBe(22);
    // The profile's own increment override drives the flooring:
    // floor(22.5 / 2.27) = 9 pins ⇒ 20.43 kg.
    expect(
      capLoadKg(30, 'dumbbell', {
        dumbbell: { max_kg: 22.5, increment_kg: 2.27 },
      })
    ).toBe(20.43);
  });

  it('returns the raw ceiling for zero-increment equipment and sub-step caps', () => {
    expect(capLoadKg(30, 'bands', { bands: { max_kg: 15 } })).toBe(15);
    // A cap below the first step is still the ceiling, not zero.
    expect(capLoadKg(5, 'dumbbell', { dumbbell: { max_kg: 1.5 } })).toBe(1.5);
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
    // 61.3 / 2.26796 = 27.03 pins ⇒ 27 × 5 lb = 61.235 ⇒ 61.23 kg.
    expect(quantizeLoadKg(61.3, 'machine')).toBe(61.23);
    expect(quantizeLoadKg(61.3, 'cable')).toBe(61.23);
    const quantized = quantizeLoadKg(83.7, 'machine');
    expect(Math.round(quantized * 100)).toBe(quantized * 100);
  });

  it('uses caller defaults under a profile override and over the global table', () => {
    // A pounds user's 20 lb (9.07 kg) dumbbell: metric table snaps to 10 kg,
    // the pounds defaults keep it at 9.07, and a profile increment wins.
    expect(quantizeLoadKg(9.07, 'dumbbell')).toBe(10);
    expect(
      quantizeLoadKg(9.07, 'dumbbell', null, IMPERIAL_EQUIPMENT_INCREMENT_KG)
    ).toBe(9.07);
    expect(
      quantizeLoadKg(
        9.07,
        'dumbbell',
        { dumbbell: { max_kg: 50, increment_kg: 2.5 } },
        IMPERIAL_EQUIPMENT_INCREMENT_KG
      )
    ).toBe(10);
    // Equipment the defaults do not mention keeps the global step.
    expect(
      incrementForEquipmentKg(
        'medicine ball',
        null,
        IMPERIAL_EQUIPMENT_INCREMENT_KG
      )
    ).toBe(1.0);
    // The cap floors to the effective step too: a 22.5 kg (49.6 lb) ceiling
    // on 5 lb dumbbells is 45 lb = 20.41 kg, not the metric 22.
    expect(
      capLoadKg(
        30,
        'dumbbell',
        { dumbbell: { max_kg: 22.5 } },
        IMPERIAL_EQUIPMENT_INCREMENT_KG
      )
    ).toBe(20.41);
  });

  it('hands a logged 5 lb multiple back as the same pounds, not a drifted decimal', () => {
    // 60 lb logged ⇒ stored 27.22 kg. 12 pins of a rounded 2.27 step would
    // come back as 27.24 kg = 60.05 lb, which a one-decimal display shows as
    // "60.1 lbs"; the exact step lands on 27.22 = 60.0 lb.
    const stored = Math.round(60 * KG_PER_LB * 100) / 100;
    expect(stored).toBe(27.22);
    expect(quantizeLoadKg(stored, 'machine')).toBe(27.22);
    expect(quantizeLoadKg(stored, 'cable') / KG_PER_LB).toBeCloseTo(60, 1);
    for (const lb of [80, 100, 125, 180]) {
      const kg = Math.round(lb * KG_PER_LB * 100) / 100;
      expect(
        Math.round((quantizeLoadKg(kg, 'machine') / KG_PER_LB) * 10) / 10
      ).toBe(lb);
    }
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
