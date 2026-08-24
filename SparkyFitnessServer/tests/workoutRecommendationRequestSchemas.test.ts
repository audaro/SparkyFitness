import { describe, it, expect } from 'vitest';
import {
  MUSCLES,
  MUSCLE_SPLIT_MEMBERS,
  generateWorkoutRecommendationRequestSchema,
} from '@workspace/shared';

describe('generateWorkoutRecommendationRequestSchema target_muscles', () => {
  it('still parses a request that names no muscles', () => {
    const parsed = generateWorkoutRecommendationRequestSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.target_muscles).toBeUndefined();

    const withOtherFields =
      generateWorkoutRecommendationRequestSchema.safeParse({
        duration_minutes: 45,
        swap: true,
      });
    expect(withOtherFields.success).toBe(true);
  });

  it('accepts canonical muscles', () => {
    const parsed = generateWorkoutRecommendationRequestSchema.safeParse({
      target_muscles: ['quadriceps', 'hamstrings'],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.target_muscles).toEqual([
      'quadriceps',
      'hamstrings',
    ]);
  });

  // Downstream matching is `::jsonb ?|` — exact and case-sensitive. A muscle
  // that is merely mis-cased has to be a 400 here, because further down it is
  // not an error at all: it matches nothing and the user gets a workout built
  // around whatever else was in the list.
  it('rejects a muscle outside the canonical vocabulary', () => {
    for (const bad of ['Quadriceps', 'quads', 'legs', 'lower_back', '']) {
      const parsed = generateWorkoutRecommendationRequestSchema.safeParse({
        target_muscles: [bad],
      });
      expect(parsed.success, `expected "${bad}" to be rejected`).toBe(false);
    }
  });

  it('rejects an empty list rather than reading it as "no preference"', () => {
    const parsed = generateWorkoutRecommendationRequestSchema.safeParse({
      target_muscles: [],
    });
    expect(parsed.success).toBe(false);
  });

  // The client resolves a split to muscles and sends the muscles (never the
  // split name), so the widest split has to fit through the contract. Upper
  // body is 11 muscles and Full body is all 17; a smaller cap would make them
  // unrepresentable.
  it('accepts every split resolved to its muscles', () => {
    for (const [split, members] of Object.entries(MUSCLE_SPLIT_MEMBERS)) {
      const parsed = generateWorkoutRecommendationRequestSchema.safeParse({
        target_muscles: [...members],
      });
      expect(parsed.success, `expected "${split}" to be accepted`).toBe(true);
    }
  });

  it('rejects a list longer than the vocabulary', () => {
    const parsed = generateWorkoutRecommendationRequestSchema.safeParse({
      target_muscles: [...MUSCLES, 'chest'],
    });
    expect(parsed.success).toBe(false);
  });

  it('stays strict about unknown keys', () => {
    const parsed = generateWorkoutRecommendationRequestSchema.safeParse({
      target_muscles: ['chest'],
      target_muscle: 'chest',
    });
    expect(parsed.success).toBe(false);
  });
});
