import { describe, it, expect } from 'vitest';
import {
  MUSCLES,
  MUSCLE_GROUPS,
  MUSCLE_GROUP_MEMBERS,
  MUSCLE_SPLITS,
  MUSCLE_SPLIT_MEMBERS,
  isKnownMuscle,
  isKnownMuscleSplit,
  isLowerBodyMuscle,
  musclesForSplit,
} from '@workspace/shared';

// Splits resolve to muscles on the client and the wire carries the muscles, so
// a member outside the canonical vocabulary is not a type error anywhere — it
// is a filter that matches nothing, silently. `::jsonb ?|` is exact and
// case-sensitive, so a typo returns an empty workout rather than an error.
describe('muscle split vocabulary', () => {
  it('resolves every split to canonical muscles only', () => {
    for (const split of MUSCLE_SPLITS) {
      const members = MUSCLE_SPLIT_MEMBERS[split];
      expect(members.length).toBeGreaterThan(0);
      for (const muscle of members) {
        expect(isKnownMuscle(muscle)).toBe(true);
      }
      expect(new Set(members).size).toBe(members.length);
    }
  });

  it('covers every canonical muscle across upper and lower body', () => {
    const upper = MUSCLE_SPLIT_MEMBERS['upper body'];
    const lower = MUSCLE_SPLIT_MEMBERS['lower body'];
    expect([...upper, ...lower].sort()).toEqual([...MUSCLES].sort());
    expect(upper.some((muscle) => lower.includes(muscle))).toBe(false);
  });

  it('keeps upper and lower body backed by the one lower-body list', () => {
    expect(MUSCLE_SPLIT_MEMBERS['lower body'].every(isLowerBodyMuscle)).toBe(
      true
    );
    expect(MUSCLE_SPLIT_MEMBERS['upper body'].some(isLowerBodyMuscle)).toBe(
      false
    );
  });

  it('offers full body as the whole vocabulary', () => {
    expect([...MUSCLE_SPLIT_MEMBERS['full body']].sort()).toEqual(
      [...MUSCLES].sort()
    );
  });

  // Splits overlap by design; the weekly-set-target groups are a partition and
  // must stay one. Conflating them would break the ring, so assert they are
  // still two separate vocabularies rather than one that drifted.
  it('leaves the weekly set target partition alone', () => {
    const assigned = MUSCLE_GROUPS.flatMap(
      (group) => MUSCLE_GROUP_MEMBERS[group]
    );
    expect(new Set(assigned).size).toBe(MUSCLES.length);

    const acrossSplits = MUSCLE_SPLITS.flatMap(
      (split) => MUSCLE_SPLIT_MEMBERS[split]
    );
    expect(acrossSplits.length).toBeGreaterThan(new Set(acrossSplits).size);
  });

  it('does not enumerate the no-constraint default as a split', () => {
    expect(isKnownMuscleSplit('recovered muscles')).toBe(false);
    expect(musclesForSplit('recovered muscles')).toBeNull();
  });

  it('normalizes a display label before matching', () => {
    expect(musclesForSplit('  Upper Body ')).toEqual(
      MUSCLE_SPLIT_MEMBERS['upper body']
    );
    expect(isKnownMuscleSplit('Upper Body')).toBe(false);
    expect(musclesForSplit('legs')).toBeNull();
  });
});
