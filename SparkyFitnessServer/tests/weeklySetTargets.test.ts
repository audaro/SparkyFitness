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
  WEEKLY_SET_TUNABLES,
  type MuscleGroup,
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
    const three = deriveDefaultWeeklySetTargets({ trainingDaysPerWeek: 3 });
    const five = deriveDefaultWeeklySetTargets({ trainingDaysPerWeek: 5 });
    expect(five.push).toBeGreaterThan(three.push);
    expect(three.core).toBeLessThan(three.push);
  });

  it('falls back to a sane default when the profile says nothing', () => {
    expect(deriveDefaultWeeklySetTargets()).toEqual(
      deriveDefaultWeeklySetTargets({ trainingDaysPerWeek: 3 })
    );
    expect(
      deriveDefaultWeeklySetTargets({ trainingDaysPerWeek: null })
    ).toEqual(deriveDefaultWeeklySetTargets({ trainingDaysPerWeek: 3 }));
  });

  it('clamps an implausible training frequency', () => {
    const targets = deriveDefaultWeeklySetTargets({
      trainingDaysPerWeek: 400,
    });
    for (const group of MUSCLE_GROUPS) {
      expect(targets[group]).toBeLessThanOrEqual(30);
      expect(targets[group]).toBeGreaterThanOrEqual(4);
    }
  });

  /**
   * The contract that lets this ship without moving anyone's ring: a profile
   * that answers none of the plan questions must derive exactly what the flat
   * 3.5-sets-per-training-day rule derived before the plan existed. The
   * intermediate base row is calibrated for it (14 / 4 = 3.5, 6 / 4 = 1.5).
   */
  it('reproduces the pre-plan numbers for an unanswered profile', () => {
    for (let days = 2; days <= 6; days += 1) {
      const targets = deriveDefaultWeeklySetTargets({
        trainingDaysPerWeek: days,
      });
      const legacy: Record<MuscleGroup, number> = {
        push: Math.round(3.5 * days),
        pull: Math.round(3.5 * days),
        legs: Math.round(3.5 * days),
        core: Math.max(4, Math.round(1.5 * days)),
      };
      expect(targets).toEqual(legacy);
    }
  });

  it('treats an unstated experience level as intermediate, not beginner', () => {
    const unstated = deriveDefaultWeeklySetTargets({ trainingDaysPerWeek: 4 });
    expect(unstated).toEqual(
      deriveDefaultWeeklySetTargets({
        trainingDaysPerWeek: 4,
        experienceLevel: 'intermediate',
      })
    );
    const beginner = deriveDefaultWeeklySetTargets({
      trainingDaysPerWeek: 4,
      experienceLevel: 'beginner',
    });
    expect(beginner.push).toBeLessThan(unstated.push);
  });

  it('raises volume with experience', () => {
    const at = (experienceLevel: 'beginner' | 'intermediate' | 'expert') =>
      deriveDefaultWeeklySetTargets({
        trainingDaysPerWeek: 4,
        experienceLevel,
      });
    expect(at('beginner').push).toBe(10);
    expect(at('intermediate').push).toBe(14);
    expect(at('expert').push).toBe(18);
    // Core does not climb with the pressing volume; the expert and
    // intermediate rows share it deliberately.
    expect(at('expert').core).toBe(at('intermediate').core);
  });

  it('pulls total volume back for a strength goal', () => {
    const base = deriveDefaultWeeklySetTargets({ trainingDaysPerWeek: 4 });
    const strength = deriveDefaultWeeklySetTargets({
      trainingDaysPerWeek: 4,
      primaryGoal: 'strength',
    });
    for (const group of MUSCLE_GROUPS) {
      expect(strength[group]).toBeLessThanOrEqual(base[group]);
    }
    expect(strength.push).toBeLessThan(base.push);
  });

  it('trims limbs but not core when the goal is fat loss', () => {
    const base = deriveDefaultWeeklySetTargets({ trainingDaysPerWeek: 4 });
    const cutting = deriveDefaultWeeklySetTargets({
      trainingDaysPerWeek: 4,
      primaryGoal: 'lose_fat',
    });
    expect(cutting.push).toBeLessThan(base.push);
    expect(cutting.core).toBeGreaterThan(base.core);
  });

  it('leaves build_muscle and recomp on the reference numbers', () => {
    const base = deriveDefaultWeeklySetTargets({ trainingDaysPerWeek: 4 });
    for (const primaryGoal of ['build_muscle', 'recomp'] as const) {
      expect(
        deriveDefaultWeeklySetTargets({ trainingDaysPerWeek: 4, primaryGoal })
      ).toEqual(base);
    }
  });

  it('biases the split by physique target', () => {
    const base = deriveDefaultWeeklySetTargets({ trainingDaysPerWeek: 4 });
    const lean = deriveDefaultWeeklySetTargets({
      trainingDaysPerWeek: 4,
      physiqueTarget: 'lean',
    });
    expect(lean.core).toBeGreaterThan(base.core);
    expect(lean.push).toBe(base.push);

    const muscular = deriveDefaultWeeklySetTargets({
      trainingDaysPerWeek: 4,
      physiqueTarget: 'muscular',
    });
    expect(muscular.push).toBeGreaterThan(base.push);
    expect(muscular.legs).toBe(base.legs);

    const powerful = deriveDefaultWeeklySetTargets({
      trainingDaysPerWeek: 4,
      physiqueTarget: 'powerful',
    });
    expect(powerful.legs).toBeGreaterThan(base.legs);
    expect(powerful.push).toBe(base.push);
  });

  it('adds volume to priority groups only', () => {
    const base = deriveDefaultWeeklySetTargets({ trainingDaysPerWeek: 4 });
    const withPriority = deriveDefaultWeeklySetTargets({
      trainingDaysPerWeek: 4,
      priorityGroups: ['pull'],
    });
    expect(withPriority.pull).toBeGreaterThan(base.pull);
    expect(withPriority.push).toBe(base.push);
    expect(withPriority.legs).toBe(base.legs);
    expect(withPriority.core).toBe(base.core);
  });

  // A row written before the two-group cap existed, or by a client that
  // ignored it, must not end up prioritising everything — which is the same as
  // prioritising nothing, at 20% more volume everywhere.
  it('honours the priority cap however many groups are stored', () => {
    const base = deriveDefaultWeeklySetTargets({ trainingDaysPerWeek: 4 });
    const overCapped = deriveDefaultWeeklySetTargets({
      trainingDaysPerWeek: 4,
      priorityGroups: ['push', 'pull', 'legs', 'core'],
    });
    const raised = MUSCLE_GROUPS.filter(
      (group) => overCapped[group] > base[group]
    );
    expect(raised).toHaveLength(2);
  });

  it('does not spend both priority slots on a repeated group', () => {
    const targets = deriveDefaultWeeklySetTargets({
      trainingDaysPerWeek: 4,
      priorityGroups: ['push', 'push', 'legs'],
    });
    const base = deriveDefaultWeeklySetTargets({ trainingDaysPerWeek: 4 });
    expect(targets.push).toBeGreaterThan(base.push);
    expect(targets.legs).toBeGreaterThan(base.legs);
    expect(targets.pull).toBe(base.pull);
  });

  /**
   * Every factor multiplies the same base and rounding happens once, so the
   * result cannot depend on the order they were applied in. Rounding between
   * factors would let a 1.1 move a target by a full 2 sets.
   */
  it('rounds once, at the end', () => {
    // intermediate 14 x (5/4) x 0.9 (lose_fat) x 1.1 (muscular) x 1.2
    // (priority) = 20.79 -> 21. Rounding after each step would give
    // 14 x 1.25 = 18 (17.5 rounds to 18), then 16, then 18, then 22.
    const targets = deriveDefaultWeeklySetTargets({
      trainingDaysPerWeek: 5,
      primaryGoal: 'lose_fat',
      physiqueTarget: 'muscular',
      priorityGroups: ['push'],
    });
    expect(targets.push).toBe(21);
  });

  it('clamps derived targets to the tunable floor and ceiling', () => {
    const tiny = deriveDefaultWeeklySetTargets({
      trainingDaysPerWeek: 1,
      experienceLevel: 'beginner',
      primaryGoal: 'strength',
    });
    const huge = deriveDefaultWeeklySetTargets({
      trainingDaysPerWeek: 7,
      experienceLevel: 'expert',
      physiqueTarget: 'muscular',
      priorityGroups: ['push', 'pull'],
    });
    for (const group of MUSCLE_GROUPS) {
      expect(tiny[group]).toBeGreaterThanOrEqual(
        WEEKLY_SET_TUNABLES.minDerivedTarget
      );
      expect(huge[group]).toBeLessThanOrEqual(
        WEEKLY_SET_TUNABLES.maxDerivedTarget
      );
    }
  });

  // None of these columns carries a CHECK constraint, so a token this module
  // has no row for is reachable from the database. It must degrade to the
  // neutral factor, not to NaN — a NaN target renders as an empty ring rather
  // than as anything anyone would report.
  it('ignores vocabulary tokens it does not recognise', () => {
    const base = deriveDefaultWeeklySetTargets({ trainingDaysPerWeek: 4 });
    const unknown = deriveDefaultWeeklySetTargets({
      trainingDaysPerWeek: 4,
      experienceLevel: 'grandmaster' as never,
      primaryGoal: 'become_a_bird' as never,
      physiqueTarget: 'triangular' as never,
      priorityGroups: ['neck' as never],
    });
    expect(unknown).toEqual(base);
    for (const group of MUSCLE_GROUPS) {
      expect(Number.isFinite(unknown[group])).toBe(true);
    }
  });
});
