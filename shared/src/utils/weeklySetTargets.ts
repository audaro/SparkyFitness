import {
  MUSCLE_GROUPS,
  muscleGroupOf,
  type MuscleGroup,
} from "../constants/exerciseTaxonomy.ts";
import type { ExperienceLevel } from "../constants/experience.ts";
import {
  MAX_PRIORITY_MUSCLE_GROUPS,
  type PhysiqueTarget,
  type PrimaryGoal,
} from "../constants/trainingPlan.ts";
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
   * Weekly working sets per group at {@link referenceTrainingDaysPerWeek},
   * before any goal, physique or priority adjustment.
   *
   * The dose-response meta-analyses (Schoenfeld 2017; Baz-Valle 2022) put ~10
   * sets per muscle per week at the floor for growth and 15-20 at a productive
   * ceiling for trained lifters, so experience sets the row rather than
   * nudging a flat number. Core is programmed lighter almost everywhere, and a
   * default that demands otherwise reads as broken.
   *
   * The intermediate row is 3.5 sets per group per training day and core 1.5,
   * which is exactly what this module derived before it read the profile at
   * all. That is deliberate: an unanswered profile has to keep deriving the
   * targets it derives today, so the only thing that moves a user's ring is
   * the user answering a question.
   */
  baseWeeklySetsByExperience: {
    beginner: { push: 10, pull: 10, legs: 10, core: 4 },
    intermediate: { push: 14, pull: 14, legs: 14, core: 6 },
    expert: { push: 18, pull: 18, legs: 18, core: 6 },
  } as Readonly<Record<ExperienceLevel, Readonly<Record<MuscleGroup, number>>>>,
  /**
   * Experience assumed when the profile does not say.
   *
   * The middle row, not the bottom one. "Not stated" is an unknown, and the
   * honest estimate of an unknown is the middle of the range; treating it as
   * "beginner" would also quietly cut the targets of every user who has had a
   * ring since before this field existed.
   */
  defaultExperienceLevel: "intermediate" as ExperienceLevel,
  /** The training frequency {@link baseWeeklySetsByExperience} is stated at. */
  referenceTrainingDaysPerWeek: 4,
  /**
   * Frequency is clamped to this range before it scales the base row.
   *
   * Volume does not track sessions linearly at either end: one session a week
   * still carries real weekly volume, and a seventh session is recovery
   * spread thinner rather than 75% more work than four.
   */
  minScalingDays: 2,
  maxScalingDays: 6,
  /**
   * Per-group multipliers for what the user is training for.
   *
   * `strength` trains heavier for fewer total sets; `lose_fat` pulls overall
   * volume back to what is recoverable in a deficit while leaning on core
   * work that stays productive there; `general_fitness` is a lighter
   * commitment by definition. `build_muscle` and `recomp` are the reference.
   */
  goalMultipliers: {
    build_muscle: { push: 1, pull: 1, legs: 1, core: 1 },
    recomp: { push: 1, pull: 1, legs: 1, core: 1 },
    lose_fat: { push: 0.9, pull: 0.9, legs: 0.9, core: 1.17 },
    strength: { push: 0.8, pull: 0.8, legs: 0.8, core: 0.8 },
    general_fitness: { push: 0.85, pull: 0.85, legs: 0.85, core: 0.85 },
  } as Readonly<Record<PrimaryGoal, Readonly<Record<MuscleGroup, number>>>>,
  /**
   * Per-group multipliers for the shape being trained toward. Small on
   * purpose: physique biases a plan, it does not replace the goal.
   */
  physiqueMultipliers: {
    lean: { push: 1, pull: 1, legs: 1, core: 1.3 },
    athletic: { push: 1, pull: 1, legs: 1, core: 1 },
    muscular: { push: 1.1, pull: 1.1, legs: 1, core: 1 },
    powerful: { push: 1, pull: 1.15, legs: 1.15, core: 1 },
    maintain: { push: 1, pull: 1, legs: 1, core: 1 },
  } as Readonly<Record<PhysiqueTarget, Readonly<Record<MuscleGroup, number>>>>,
  /** Applied to each group the user named as a priority, at most two of them. */
  priorityMultiplier: 1.2,
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
 * The training-plan answers that shape a derived target. Every field is
 * optional and null-tolerant because every one of them is a column the user
 * may simply not have answered, and an unanswered plan still has to produce a
 * sensible week.
 */
export interface WeeklySetTargetInput {
  /** `coach_profiles.training_days_per_week`. */
  trainingDaysPerWeek?: number | null;
  /** `coach_profiles.primary_goal`. */
  primaryGoal?: PrimaryGoal | null;
  /** `coach_profiles.physique_target`. */
  physiqueTarget?: PhysiqueTarget | null;
  /** `coach_profiles.experience_level`. */
  experienceLevel?: ExperienceLevel | null;
  /** `coach_profiles.priority_muscle_groups`. */
  priorityGroups?: readonly MuscleGroup[] | null;
}

/**
 * Look a key up in a tunables table, falling back when it is absent.
 *
 * None of these columns carries a CHECK constraint — the vocabularies are
 * enforced by Zod at the write paths — so a row written before an enum existed,
 * or by a future version, can hold a token this table has no row for. Indexing
 * it blindly would yield `undefined` and turn every target into `NaN`, which
 * renders as an empty ring rather than as an error anyone would notice.
 */
function fromTable<K extends string, V>(
  table: Readonly<Record<K, V>>,
  key: string | null | undefined,
  fallback: V,
): V {
  if (key == null) return fallback;
  return Object.prototype.hasOwnProperty.call(table, key)
    ? table[key as K]
    : fallback;
}

/**
 * A starting target for someone who has not set one, from whatever the
 * training plan states.
 *
 * The shape is: an experience-scaled base row, scaled by training frequency,
 * then multiplied by the goal, the physique target and any priority groups.
 * Every factor is a multiplier on the same base rather than its own additive
 * rule, which is what keeps them composable — a `strength` goal and a
 * `powerful` physique pull in opposite directions on legs and the result is
 * still a number, not a special case.
 *
 * Rounding happens **once**, at the end. Rounding between factors would let a
 * 1.1 multiplier move a target by 2 sets, and would make the order the factors
 * are applied in observable.
 *
 * Deliberately modest overall: a target that is unreachable in week one
 * teaches the user to ignore the screen.
 */
export function deriveDefaultWeeklySetTargets(
  input: WeeklySetTargetInput = {},
): Record<MuscleGroup, number> {
  const stated = input.trainingDaysPerWeek;
  const days =
    typeof stated === "number" && Number.isFinite(stated) && stated > 0
      ? stated
      : WEEKLY_SET_TUNABLES.defaultTrainingDaysPerWeek;
  const scalingDays = Math.min(
    WEEKLY_SET_TUNABLES.maxScalingDays,
    Math.max(WEEKLY_SET_TUNABLES.minScalingDays, days),
  );
  const frequencyScale =
    scalingDays / WEEKLY_SET_TUNABLES.referenceTrainingDaysPerWeek;

  const base = fromTable(
    WEEKLY_SET_TUNABLES.baseWeeklySetsByExperience,
    input.experienceLevel,
    WEEKLY_SET_TUNABLES.baseWeeklySetsByExperience[
      WEEKLY_SET_TUNABLES.defaultExperienceLevel
    ],
  );
  const neutral: Readonly<Record<MuscleGroup, number>> = {
    push: 1,
    pull: 1,
    legs: 1,
    core: 1,
  };
  const goal = fromTable(
    WEEKLY_SET_TUNABLES.goalMultipliers,
    input.primaryGoal,
    neutral,
  );
  const physique = fromTable(
    WEEKLY_SET_TUNABLES.physiqueMultipliers,
    input.physiqueTarget,
    neutral,
  );

  // Deduped before the cap so ["push", "push", "legs"] prioritises push and
  // legs rather than spending both slots on push, and capped here rather than
  // trusted from the caller: the contract enforces the limit at the write
  // path, but a row stored before the limit existed must not multiply every
  // group by 1.2.
  const priorities = new Set<MuscleGroup>();
  for (const group of input.priorityGroups ?? []) {
    if (priorities.size >= MAX_PRIORITY_MUSCLE_GROUPS) break;
    if (MUSCLE_GROUPS.includes(group)) priorities.add(group);
  }

  const targets = emptyCounts();
  for (const group of MUSCLE_GROUPS) {
    let raw = base[group] * frequencyScale * goal[group] * physique[group];
    if (priorities.has(group)) raw *= WEEKLY_SET_TUNABLES.priorityMultiplier;
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

/**
 * A set count as a user reads it.
 *
 * Counts here are fractional by design — an exercise that trains a group as a
 * secondary mover contributes half a set — so a whole number must not render as
 * "12.0" and a fractional one must not be rounded away to "8" when the user
 * performed 7.5. Shared rather than per-client because the mobile week card and
 * the web one show the same number and would otherwise be free to disagree
 * about it.
 */
export function formatSetCount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
