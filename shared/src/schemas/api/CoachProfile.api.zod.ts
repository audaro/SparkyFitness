import { z } from "zod";
import { EXPERIENCE_LEVELS } from "../../constants/experience.ts";
import { MUSCLE_GROUPS } from "../../constants/exerciseTaxonomy.ts";
import {
  ENHANCEMENT_STATUSES,
  MAX_PRIORITY_MUSCLE_GROUPS,
  MAX_TESTOSTERONE_MG_PER_WEEK,
  PHYSIQUE_TARGETS,
  PRIMARY_GOALS,
  TESTOSTERONE_ESTERS,
} from "../../constants/trainingPlan.ts";

/**
 * The coach profile: the training constraints a user states once and every
 * planning surface reads — how long a session may run, how many days a week
 * they train, what they are working towards, and what their body will not do.
 *
 * These columns predate any REST route; they were written only by the AI chat.
 * This contract exposes the ten a person edits directly — the original five
 * plus the training-plan questionnaire's answers. `equipment`,
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
export const coachLimitationsSchema = z
  .array(z.string().trim().min(1).max(200))
  .max(50);

/**
 * What the user trains for, and the shape they train toward. Two questions
 * rather than one, because "build muscle" and "look lean" are different
 * instructions and a single field would answer neither well.
 */
export const primaryGoalSchema = z.enum(PRIMARY_GOALS);
export const physiqueTargetSchema = z.enum(PHYSIQUE_TARGETS);

/**
 * Groups that take extra weekly volume. Capped because each priority takes
 * share from the others, so past two the plan stops differing from an even
 * split. Deduplicated on the way in: the same group listed twice would
 * otherwise compound its own bonus.
 */
export const priorityMuscleGroupsSchema = z
  .array(z.enum(MUSCLE_GROUPS))
  .max(MAX_PRIORITY_MUSCLE_GROUPS)
  .refine((groups) => new Set(groups).size === groups.length, {
    message: "Priority muscle groups must be distinct",
  });

/**
 * Exogenous testosterone, behind the lean-mass projection.
 *
 * SENSITIVE: readable by the user's own client and never by the chat model.
 *
 * `.strict()` so a client cannot smuggle an extra key into a jsonb column, and
 * the dose is bounded to stop a fat-fingered entry driving an absurd estimate.
 * Dose and ester are rejected for `status: 'natural'` rather than ignored: a
 * payload that states both is a client bug, and silently dropping half of it
 * would leave the user looking at an answer they did not give.
 */
const coachEnhancementShape = z
  .object({
    status: z.enum(ENHANCEMENT_STATUSES),
    testosterone_mg_per_week: z
      .number()
      .min(0)
      .max(MAX_TESTOSTERONE_MG_PER_WEEK)
      .optional(),
    ester: z.enum(TESTOSTERONE_ESTERS).optional(),
  })
  .strict();

/**
 * The write contract: the shape plus a consistency rule.
 *
 * The rule lives only here, and deliberately not on the response. A response
 * schema that can reject stored data turns one inconsistent row into a GET that
 * 500s, locking the user out of the profile they need to load in order to fix
 * it. Validating what a client sends is the right place to be strict; reporting
 * what is stored is the right place to be faithful.
 */
export const coachEnhancementSchema = coachEnhancementShape.refine(
  (value) =>
    value.status !== "natural" ||
    (value.testosterone_mg_per_week === undefined && value.ester === undefined),
  {
    message:
      "A natural status carries no dose or ester; omit them or state a different status",
  },
);

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
    primary_goal: primaryGoalSchema.nullable(),
    physique_target: physiqueTargetSchema.nullable(),
    priority_muscle_groups: z.array(z.enum(MUSCLE_GROUPS)).nullable(),
    enhancement: coachEnhancementShape.nullable(),
    /** ISO 8601 instant, or null while the questionnaire is unfinished. */
    plan_completed_at: z.string().nullable(),
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
    primary_goal: primaryGoalSchema.nullable().optional(),
    physique_target: physiqueTargetSchema.nullable().optional(),
    // Nullable as well as optional: null clears the stated priorities back to
    // "not answered", which an empty array does not — `[]` is the real answer
    // "I prioritise nothing in particular".
    priority_muscle_groups: priorityMuscleGroupsSchema.nullable().optional(),
    enhancement: coachEnhancementSchema.nullable().optional(),
    // Write-only as a completion stamp: the client sends an ISO instant when
    // the last step saves, or null to reopen the questionnaire.
    plan_completed_at: z.string().datetime().nullable().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Provide at least one field to update",
  });

export type CoachProfileResponse = z.infer<typeof coachProfileResponseSchema>;
export type CoachEnhancement = z.infer<typeof coachEnhancementSchema>;
export type UpdateCoachProfileRequest = z.infer<
  typeof updateCoachProfileRequestSchema
>;
