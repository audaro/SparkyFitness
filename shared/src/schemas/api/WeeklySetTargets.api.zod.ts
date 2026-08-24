import { z } from "zod";
import { MUSCLE_GROUPS } from "../../constants/exerciseTaxonomy.ts";

/**
 * Weekly set targets: the per-group working-set goals a user sets, and their
 * progress against them for the current week plus recent history.
 *
 * Set counts are fractional by design — a secondary mover contributes half a
 * set — so every count field here is a plain number, not an integer. Targets
 * are integers: nobody means to perform 12.5 sets of pulling.
 */

export const muscleGroupSchema = z.enum(MUSCLE_GROUPS);

/**
 * A hand-set target. The ceiling is a guard against a fat-fingered entry
 * becoming a permanently unreachable ring, not a training opinion; 0 is
 * allowed and means "I am not training this group in this block".
 */
export const weeklySetTargetValueSchema = z.number().int().min(0).max(100);

/**
 * `partialRecord`, not `record`: with an enum key, `z.record` demands every
 * member be present, which would force a client changing one group to resend
 * all four and turn a partial edit into a full overwrite.
 */
export const weeklySetTargetsMapSchema = z.partialRecord(
  muscleGroupSchema,
  weeklySetTargetValueSchema,
);

// --- Response contracts ---

export const weeklySetGroupProgressSchema = z
  .object({
    group: muscleGroupSchema,
    completed: z.number(),
    target: z.number(),
    remaining: z.number(),
    /** 0..1, clamped. */
    percent: z.number(),
  })
  .strict();

export const weeklySetTargetSummarySchema = z
  .object({
    /** Sunday of the week, YYYY-MM-DD. */
    week_start: z.string(),
    /** Saturday of the week, YYYY-MM-DD. */
    week_end: z.string(),
    groups: z.array(weeklySetGroupProgressSchema),
    /** 0..1, clamped. Each group credited only up to its own target. */
    overall_percent: z.number(),
  })
  .strict();

export const weeklySetTargetsResponseSchema = z
  .object({
    current: weeklySetTargetSummarySchema,
    /**
     * Earlier weeks, oldest first, NOT including the current week. Empty when
     * the caller asks for no history.
     */
    history: z.array(weeklySetTargetSummarySchema),
    /**
     * True when the targets came from the user, false when the server derived
     * them from training days per week. The client says so, so a number nobody
     * chose does not read as a commitment they made.
     */
    targets_are_custom: z.boolean(),
  })
  .strict();

// --- Request contracts ---

/**
 * `.strict()` because no client spreads a response into this payload; an
 * unexpected key means a bug worth surfacing rather than silently dropping.
 *
 * A partial map is accepted: sending only `{"legs": 20}` changes legs and
 * leaves every other group as it was.
 */
export const updateWeeklySetTargetsRequestSchema = z
  .object({
    targets: weeklySetTargetsMapSchema,
  })
  .strict();

export type MuscleGroupValue = z.infer<typeof muscleGroupSchema>;
export type WeeklySetGroupProgressResponse = z.infer<
  typeof weeklySetGroupProgressSchema
>;
export type WeeklySetTargetSummaryResponse = z.infer<
  typeof weeklySetTargetSummarySchema
>;
export type WeeklySetTargetsResponse = z.infer<
  typeof weeklySetTargetsResponseSchema
>;
export type UpdateWeeklySetTargetsRequest = z.infer<
  typeof updateWeeklySetTargetsRequestSchema
>;
