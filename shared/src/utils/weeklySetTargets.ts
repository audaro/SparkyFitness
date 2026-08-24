import {
  MUSCLE_GROUPS,
  muscleGroupOf,
  type MuscleGroup,
} from "../constants/exerciseTaxonomy.ts";
import { addDays, dayOfWeek, isDayString } from "./timezone.ts";

/**
 * Weekly set targets: how many working sets the user means to perform per
 * training group in a week, and how many they actually have.
 *
 * The inputs are the same `exercise_entries` muscle **snapshots** joined to
 * their set counts that drive muscle recovery — so a set that counts here is a
 * set that counts there, by construction. Nothing in this module reads a clock,
 * a timezone, or the database: the caller passes `today` from `todayInZone(tz)`
 * and the entries from `getMuscleFatigueInputs`, exactly as the generation
 * engine does. That keeps the screen reproducible and this file testable.
 */

/** One logged exercise entry, reduced to what set accounting needs. */
export interface WeeklySetEntry {
  /** Calendar day the entry was logged against, YYYY-MM-DD. */
  entryDate: string;
  /** Canonical muscle strings — the entry's `primary_muscles` snapshot. */
  primaryMuscles: string[];
  /** Canonical muscle strings — the entry's `secondary_muscles` snapshot. */
  secondaryMuscles: string[];
  /** Sets that count toward volume: everything except warm-ups. */
  workingSetCount: number;
}

/** A group's progress against its target for one week. */
export interface WeeklySetGroupProgress {
  group: MuscleGroup;
  /** Sets performed. Fractional, because a secondary mover is half a set. */
  completed: number;
  target: number;
  /** Sets still owed. Never negative — overshoot is not a debt. */
  remaining: number;
  /** 0..1, clamped. 1 means the target was met or beaten. */
  percent: number;
}

/** Every group's progress for one week, plus the headline number. */
export interface WeeklySetTargetSummary {
  /** Sunday of the week, YYYY-MM-DD. */
  weekStart: string;
  /** Saturday of the week, YYYY-MM-DD. */
  weekEnd: string;
  groups: WeeklySetGroupProgress[];
  /** 0..1, clamped. The ring in the middle of the screen. */
  overallPercent: number;
}

export const WEEKLY_SET_TUNABLES = {
  /**
   * A secondary mover absorbs this fraction of a set: 3 sets of bench press
   * credit push with 3 sets from chest, and triceps ride along inside that
   * same 3 rather than adding more.
   *
   * Deliberately the same 0.5 as `RECOVERY_TUNABLES.secondaryWeight`, but kept
   * as its own constant: retuning how fast a muscle recovers should not
   * silently move the numbers on a target the user set by hand.
   */
  secondaryWeight: 0.5,
  /**
   * Sets per training day used to derive a target for someone who has not set
   * one. Push/pull/legs get a full share; core is programmed lighter almost
   * everywhere, and a default that demands otherwise reads as broken.
   */
  defaultSetsPerTrainingDay: {
    push: 3.5,
    pull: 3.5,
    legs: 3.5,
    core: 1.5,
  } as Readonly<Record<MuscleGroup, number>>,
  /** Assumed when the coach profile does not say. */
  defaultTrainingDaysPerWeek: 3,
  /** Derived defaults are clamped here. Hand-set targets are not. */
  minDerivedTarget: 4,
  maxDerivedTarget: 30,
} as const;

function assertDay(day: string, label: string): void {
  if (!isDayString(day)) {
    throw new Error(`${label} must be a YYYY-MM-DD day string, got "${day}"`);
  }
}

/**
 * The Sunday that starts the week containing `day`.
 *
 * Sunday rather than ISO Monday because that is what the surface this was
 * modelled on shows, and because a week boundary is a display convention
 * rather than a correctness one — every count here is derived from day strings,
 * so moving it is a one-line change with no stored data to migrate.
 */
export function weekStartFor(day: string): string {
  assertDay(day, "day");
  return addDays(day, -dayOfWeek(day));
}

/** The Saturday that ends the week containing `day`. */
export function weekEndFor(day: string): string {
  return addDays(weekStartFor(day), 6);
}

/**
 * The `weeks` most recent week-start days, oldest first, ending with the week
 * containing `day`.
 */
export function recentWeekStarts(day: string, weeks: number): string[] {
  if (!Number.isInteger(weeks) || weeks < 1) {
    throw new Error(`weeks must be a positive integer, got ${weeks}`);
  }
  const current = weekStartFor(day);
  return Array.from({ length: weeks }, (_, i) =>
    addDays(current, -7 * (weeks - 1 - i)),
  );
}

function emptyCounts(): Record<MuscleGroup, number> {
  return { push: 0, pull: 0, legs: 0, core: 0 };
}

/**
 * Sets performed per group across `entries`.
 *
 * An entry contributes to a group **once**, at its strongest claim: bench press
 * lists chest and shoulders as primary movers and both are push, so 3 sets of
 * it is 3 push sets, not 6. Counting per muscle instead would make a compound
 * lift look like twice the work it was, and the number the user is checking
 * against their target would drift further from reality the more compounds
 * they programmed.
 *
 * Muscle strings outside the canonical vocabulary are ignored rather than
 * bucketed somewhere arbitrary; `muscleGroupOf` normalizes first, so casing and
 * stray whitespace from hand-entered rows still land correctly.
 */
export function computeGroupSetCounts(
  entries: readonly WeeklySetEntry[],
): Record<MuscleGroup, number> {
  const counts = emptyCounts();
  for (const entry of entries) {
    if (entry.workingSetCount <= 0) continue;
    const weights = new Map<MuscleGroup, number>();
    for (const muscle of entry.primaryMuscles) {
      const group = muscleGroupOf(muscle);
      if (group) weights.set(group, 1);
    }
    for (const muscle of entry.secondaryMuscles) {
      const group = muscleGroupOf(muscle);
      if (group && !weights.has(group)) {
        weights.set(group, WEEKLY_SET_TUNABLES.secondaryWeight);
      }
    }
    for (const [group, weight] of weights) {
      counts[group] += weight * entry.workingSetCount;
    }
  }
  for (const group of MUSCLE_GROUPS) {
    // Half-set weighting lands on clean halves; this only clears float dust.
    counts[group] = Math.round(counts[group] * 2) / 2;
  }
  return counts;
}

/**
 * A starting target for someone who has not set one, scaled by how often they
 * train. Deliberately modest: a target that is unreachable in week one teaches
 * the user to ignore the screen.
 */
export function deriveDefaultWeeklySetTargets(
  trainingDaysPerWeek: number | null | undefined,
): Record<MuscleGroup, number> {
  const days =
    typeof trainingDaysPerWeek === "number" && trainingDaysPerWeek > 0
      ? Math.min(trainingDaysPerWeek, 7)
      : WEEKLY_SET_TUNABLES.defaultTrainingDaysPerWeek;
  const targets = emptyCounts();
  for (const group of MUSCLE_GROUPS) {
    const raw = WEEKLY_SET_TUNABLES.defaultSetsPerTrainingDay[group] * days;
    targets[group] = Math.min(
      WEEKLY_SET_TUNABLES.maxDerivedTarget,
      Math.max(WEEKLY_SET_TUNABLES.minDerivedTarget, Math.round(raw)),
    );
  }
  return targets;
}

/**
 * Fold one week's entries and targets into what the screen renders.
 *
 * `overallPercent` credits each group only up to its own target, so 60 push
 * sets cannot paper over a week with no legs. That is the whole point of a
 * per-group target: the headline has to fall when one group is neglected, and
 * an uncapped total would rise instead.
 *
 * A group whose target is 0 is treated as met rather than as a divide-by-zero:
 * the user is saying they do not train it this block, and the ring should not
 * sit at 0% forever because of a group they switched off.
 */
export function summarizeWeeklySetTargets(params: {
  weekStart: string;
  entries: readonly WeeklySetEntry[];
  targets: Record<MuscleGroup, number>;
}): WeeklySetTargetSummary {
  const { weekStart, entries, targets } = params;
  assertDay(weekStart, "weekStart");
  const counts = computeGroupSetCounts(entries);

  let creditedTotal = 0;
  let targetTotal = 0;
  const groups = MUSCLE_GROUPS.map((group) => {
    const target = Math.max(0, targets[group] ?? 0);
    const completed = counts[group];
    targetTotal += target;
    creditedTotal += Math.min(completed, target);
    return {
      group,
      completed,
      target,
      remaining: Math.max(0, Math.round((target - completed) * 2) / 2),
      percent: target === 0 ? 1 : Math.min(1, completed / target),
    };
  });

  return {
    weekStart,
    weekEnd: addDays(weekStart, 6),
    groups,
    overallPercent: targetTotal === 0 ? 1 : creditedTotal / targetTotal,
  };
}

/**
 * Bucket a multi-week span of entries by the week they fall in, so the history
 * strip costs one query rather than one per week.
 */
export function bucketEntriesByWeek(
  entries: readonly WeeklySetEntry[],
): Map<string, WeeklySetEntry[]> {
  const byWeek = new Map<string, WeeklySetEntry[]>();
  for (const entry of entries) {
    const start = weekStartFor(entry.entryDate);
    const bucket = byWeek.get(start);
    if (bucket) bucket.push(entry);
    else byWeek.set(start, [entry]);
  }
  return byWeek;
}
