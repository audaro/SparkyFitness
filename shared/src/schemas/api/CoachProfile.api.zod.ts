import { z } from "zod";
import { EXPERIENCE_LEVELS } from "../../constants/experience.ts";

/**
 * The coach profile: the training constraints a user states once and every
 * planning surface reads — how long a session may run, how many days a week
 * they train, what they are working towards, and what their body will not do.
 *
 * These columns predate any REST route; they were written only by the AI chat.
 * This contract exposes the five a person edits directly. `equipment`,
 * `food_preferences`, `aliases` and `weekly_set_targets` are deliberately
 * absent: gym profiles own equipment, and weekly set targets have their own
 * endpoint whose partial-merge semantics a general PATCH would break.
 *
 * Every scalar is nullable because "not stated" is a real answer that changes
 * behaviour — `training_days_per_week` of null is what makes weekly set targets
 * report themselves as derived rather than chosen.
 */

/**
 * Zero is allowed: a deload week is a real answer. Seven is the ceiling
 * because a week has seven days.
 */
export const trainingDaysPerWeekSchema = z.number().int().min(0).max(7);

/**
 * A guard against a fat-fingered entry silently constraining every generated
 * workout, not a training opinion. Five minutes is the shortest session worth
 * planning around; five hours is past anything a session length should mean.
 */
export const sessionMinutesSchema = z.number().int().min(5).max(300);

/** Bounded so the column cannot become an unbounded free-text dump. */
export const coachGoalsSchema = z.string().trim().max(2000);

/**
 * The exercises.level vocabulary, not a synonym set — the generator compares
 * this value to candidate rows' levels with an exact string match, so
 * "advanced" or "Beginner" would silently match nothing. The enum is what
 * keeps that failure at the write side, as a 400.
 */
export const experienceLevelSchema = z.enum(EXPERIENCE_LEVELS);

/**
 * Injuries and constraints, free text by design — the catalog cannot enumerate
 * what a given shoulder will not tolerate. Bounded in both directions so one
 * profile cannot carry an unbounded jsonb blob.
 */
export const coachLimitationsSchema = z.array(z.string().trim().min(1).max(200)).max(50);

// --- Response contracts ---

export const coachProfileResponseSchema = z
  .object({
    /**
     * Null until the user states one. A row may not exist at all — the GET
     * answers with every field null rather than 404, because "no profile yet"
     * and "profile with nothing set" are the same thing to every reader.
     */
    goals: z.string().nullable(),
    training_days_per_week: z.number().int().nullable(),
    session_minutes: z.number().int().nullable(),
    experience_level: experienceLevelSchema.nullable(),
    limitations: z.array(z.string()),
  })
  .strict();

// --- Request contracts ---
//
// `.strict()`: no client spreads a response object into this payload, so an
// unknown key is a caller bug worth surfacing rather than silently dropping.

/**
 * Every field optional and separately nullable: null clears a stated value
 * back to "not stated", which is not the same as leaving it alone. Sending
 * `{}` is rejected rather than treated as a no-op write, so a client bug that
 * drops its payload fails loudly instead of touching `updated_at`.
 *
 * `limitations` takes `[]` to clear rather than null — the column is NOT NULL
 * with a `[]` default, so an empty list is how "no limitations" is stored.
 */
export const updateCoachProfileRequestSchema = z
  .object({
    goals: coachGoalsSchema.nullable().optional(),
    training_days_per_week: trainingDaysPerWeekSchema.nullable().optional(),
    session_minutes: sessionMinutesSchema.nullable().optional(),
    experience_level: experienceLevelSchema.nullable().optional(),
    limitations: coachLimitationsSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Provide at least one field to update",
  });

export type CoachProfileResponse = z.infer<typeof coachProfileResponseSchema>;
export type UpdateCoachProfileRequest = z.infer<
  typeof updateCoachProfileRequestSchema
>;
