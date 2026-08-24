import { describe, it, expect } from 'vitest';
import {
  MUSCLES,
  MUSCLE_GROUPS,
  MUSCLE_GROUP_MEMBERS,
  computeGroupSetCounts,
  deriveDefaultWeeklySetTargets,
  muscleGroupOf,
  recentWeekStarts,
  summarizeWeeklySetTargets,
  weekEndFor,
  weekStartFor,
  type WeeklySetEntry,
} from '@workspace/shared';

function entry(overrides: Partial<WeeklySetEntry> = {}): WeeklySetEntry {
  return {
    entryDate: '2026-08-24',
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    workingSetCount: 3,
    ...overrides,
  };
}

// Every canonical muscle has to land in exactly one group. A muscle that falls
// through would silently drop the sets logged against it, which looks like a
// design decision rather than the bug it is.
describe('muscle group taxonomy', () => {
  it('covers every canonical muscle exactly once', () => {
    const assigned = MUSCLE_GROUPS.flatMap(
      (group) => MUSCLE_GROUP_MEMBERS[group]
    );
    expect([...assigned].sort()).toEqual([...MUSCLES].sort());
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it('normalizes casing and whitespace before matching', () => {
    expect(muscleGroupOf('  Quadriceps ')).toBe('legs');
    expect(muscleGroupOf('middle back')).toBe('pull');
    expect(muscleGroupOf('not a muscle')).toBeNull();
  });
});

describe('weekStartFor', () => {
  it('runs Sunday to Saturday', () => {
    // 2026-08-24 is a Monday.
    expect(weekStartFor('2026-08-24')).toBe('2026-08-23');
    expect(weekEndFor('2026-08-24')).toBe('2026-08-29');
    // A Sunday starts its own week rather than closing the previous one.
    expect(weekStartFor('2026-08-23')).toBe('2026-08-23');
    expect(weekStartFor('2026-08-29')).toBe('2026-08-23');
  });

  it('rejects a malformed day rather than guessing', () => {
    expect(() => weekStartFor('24-08-2026')).toThrow(/YYYY-MM-DD/);
  });

  it('walks back whole weeks, oldest first', () => {
    expect(recentWeekStarts('2026-08-24', 3)).toEqual([
      '2026-08-09',
      '2026-08-16',
      '2026-08-23',
    ]);
  });
});

describe('computeGroupSetCounts', () => {
  it('counts a compound lift once per group, not once per muscle', () => {
    // Bench press: chest and shoulders are both push. 3 sets is 3 push sets.
    const counts = computeGroupSetCounts([
      entry({ primaryMuscles: ['chest', 'shoulders'], workingSetCount: 3 }),
    ]);
    expect(counts.push).toBe(3);
  });

  it('counts a secondary mover as half a set', () => {
    const counts = computeGroupSetCounts([
      entry({
        primaryMuscles: ['chest'],
        secondaryMuscles: ['triceps', 'abdominals'],
        workingSetCount: 4,
      }),
    ]);
    // Triceps is push, already claimed at full weight by chest.
    expect(counts.push).toBe(4);
    expect(counts.core).toBe(2);
  });

  it('lets a primary claim outrank a secondary one in the same group', () => {
    const counts = computeGroupSetCounts([
      entry({
        primaryMuscles: ['triceps'],
        secondaryMuscles: ['chest'],
        workingSetCount: 5,
      }),
    ]);
    expect(counts.push).toBe(5);
  });

  it('ignores entries with no working sets', () => {
    const counts = computeGroupSetCounts([
      entry({ workingSetCount: 0 }),
      entry({ primaryMuscles: ['lats'], workingSetCount: 2 }),
    ]);
    expect(counts.push).toBe(0);
    expect(counts.pull).toBe(2);
  });

  it('ignores muscle strings outside the vocabulary', () => {
    const counts = computeGroupSetCounts([
      entry({ primaryMuscles: ['brachioradialis-ish'], workingSetCount: 3 }),
    ]);
    expect(counts).toEqual({ push: 0, pull: 0, legs: 0, core: 0 });
  });
});

describe('summarizeWeeklySetTargets', () => {
  const targets = { push: 10, pull: 10, legs: 10, core: 4 };

  it('reports per-group progress and what is still owed', () => {
    const summary = summarizeWeeklySetTargets({
      weekStart: '2026-08-23',
      entries: [entry({ primaryMuscles: ['chest'], workingSetCount: 4 })],
      targets,
    });
    const push = summary.groups.find((g) => g.group === 'push')!;
    expect(push).toMatchObject({ completed: 4, target: 10, remaining: 6 });
    expect(push.percent).toBeCloseTo(0.4);
    expect(summary.weekEnd).toBe('2026-08-29');
  });

  // The whole point of a per-group target: overshooting one group must not
  // disguise a group that was never trained.
  it('credits a group only up to its own target in the overall figure', () => {
    const summary = summarizeWeeklySetTargets({
      weekStart: '2026-08-23',
      entries: [entry({ primaryMuscles: ['chest'], workingSetCount: 60 })],
      targets,
    });
    // 10 of 34 targeted sets are credited, not 60.
    expect(summary.overallPercent).toBeCloseTo(10 / 34);
    expect(summary.groups.find((g) => g.group === 'push')!.remaining).toBe(0);
  });

  it('treats a zero target as met rather than dividing by zero', () => {
    const summary = summarizeWeeklySetTargets({
      weekStart: '2026-08-23',
      entries: [],
      targets: { push: 0, pull: 0, legs: 0, core: 0 },
    });
    expect(summary.overallPercent).toBe(1);
    expect(summary.groups.every((g) => g.percent === 1)).toBe(true);
  });

  it('reports an untrained week as zero rather than as missing data', () => {
    const summary = summarizeWeeklySetTargets({
      weekStart: '2026-08-23',
      entries: [],
      targets,
    });
    expect(summary.overallPercent).toBe(0);
    expect(summary.groups.map((g) => g.completed)).toEqual([0, 0, 0, 0]);
  });
});

describe('deriveDefaultWeeklySetTargets', () => {
  it('scales with training days', () => {
    const three = deriveDefaultWeeklySetTargets(3);
    const five = deriveDefaultWeeklySetTargets(5);
    expect(five.push).toBeGreaterThan(three.push);
    expect(three.core).toBeLessThan(three.push);
  });

  it('falls back to a sane default when the profile says nothing', () => {
    expect(deriveDefaultWeeklySetTargets(null)).toEqual(
      deriveDefaultWeeklySetTargets(3)
    );
  });

  it('clamps an implausible training frequency', () => {
    const targets = deriveDefaultWeeklySetTargets(400);
    for (const group of MUSCLE_GROUPS) {
      expect(targets[group]).toBeLessThanOrEqual(30);
      expect(targets[group]).toBeGreaterThanOrEqual(4);
    }
  });
});
