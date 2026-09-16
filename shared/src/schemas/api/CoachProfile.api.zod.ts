import { z } from "zod";
import { EXPERIENCE_LEVELS } from "../../constants/experience.ts";
import { MUSCLE_GROUPS } from "../../constants/exerciseTaxonomy.ts";
import {
  ENHANCEMENT_STATUSES,
  MAX_PRIORITY_MUSCLE_GROUPS,
  MAX_DOSE_INTERVAL_WEEKS,
  MAX_TESTOSTERONE_MG_PER_DOSE,
  MAX_TESTOSTERONE_MG_PER_WEEK,
  MIN_DOSE_INTERVAL_WEEKS,
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
 *
 * The dose is an amount plus an interval, not a weekly average, so that what
 * comes back out of the questionnaire is what the user typed into it — see
 * `coachProfileEnhancementSchema`. The per-dose ceiling is therefore higher
 * than the weekly one; the weekly figure the two imply is bounded by the
 * refinement below, which is the check that actually catches a typo.
 */
const coachEnhancementShape = z
  .object({
    status: z.enum(ENHANCEMENT_STATUSES),
    testosterone_mg_per_dose: z
      .number()
      .min(0)
      .max(MAX_TESTOSTERONE_MG_PER_DOSE)
      .optional(),
    dose_interval_weeks: z
      .number()
      .min(MIN_DOSE_INTERVAL_WEEKS)
      .max(MAX_DOSE_INTERVAL_WEEKS)
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
export const coachEnhancementSchema = coachEnhancementShape
  .refine(
    (value) =>
      value.status !== "natural" ||
      (value.testosterone_mg_per_dose === undefined &&
        value.dose_interval_weeks === undefined &&
        value.ester === undefined),
    {
      message:
        "A natural status carries no dose or ester; omit them or state a different status",
    },
  )
  // An interval on its own says nothing: "every 10 weeks" without an amount is
  // not a dose, and storing it would make the questionnaire reopen on a field
  // the projection cannot use.
  .refine(
    (value) =>
      value.dose_interval_weeks === undefined ||
      value.testosterone_mg_per_dose !== undefined,
    {
      message: "State a dose alongside the interval between doses",
    },
  )
  // The bound that catches a fat-fingered entry. It is on the weekly figure
  // rather than on the per-dose field because that is the number the
  // projection reads, and 1000 mg is an ordinary dose at a 10-week interval
  // and an implausible one at a weekly interval.
  .refine(
    (value) => {
      const dose = value.testosterone_mg_per_dose;
      if (dose === undefined) return true;
      const weeks = value.dose_interval_weeks ?? 1;
      return dose / weeks <= MAX_TESTOSTERONE_MG_PER_WEEK;
    },
    {
      message: `That dose and interval work out above ${MAX_TESTOSTERONE_MG_PER_WEEK} mg per week`,
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

/**
 * `GET /api/coach-profile/projection`.
 *
 * A projection of lean-mass gain over a horizon, plus the inputs it was built
 * from, so the card can say what it based the estimate on rather than
 * presenting a number from nowhere.
 *
 * The stated dose is deliberately **not** echoed here. The owner's own client
 * can read it from `GET /api/coach-profile` when it needs to pre-fill the
 * questionnaire; a projection only needs to say whether a dose was part of the
 * estimate, and a payload that carries the value is a payload that can end up
 * in a log or a crash report for no benefit.
 */
const projectionRangeSchema = z
  .object({
    low_kg: z.number(),
    high_kg: z.number(),
  })
  .strict();

export const muscleGainProjectionResponseSchema = z
  .object({
    horizon_weeks: z.number().int().positive(),
    projection: z
      .object({
        /** From training alone. Null when no bodyweight is on file. */
        natural_kg: projectionRangeSchema.nullable(),
        /** Attributable to a stated dose, on top of the above. */
        enhanced_kg: projectionRangeSchema.nullable(),
        total_kg: projectionRangeSchema.nullable(),
        per_month_kg: projectionRangeSchema.nullable(),
        at_full_adherence_kg: projectionRangeSchema.nullable(),
        /** Why a component above is null, for copy that explains the gap. */
        unmodelled: z.array(z.string()),
        sources: z.array(z.string()),
      })
      .strict(),
    inputs: z
      .object({
        sex: z.enum(["male", "female"]).nullable(),
        experience_level: experienceLevelSchema.nullable(),
        bodyweight_kg: z.number().nullable(),
        adherence: z.number().min(0).max(1),
        /**
         * `measured` means the adherence above is the mean of completed weeks
         * with something logged in them. `no_history` means there was nothing
         * to measure and the projection assumes the targets are met — a new
         * user has not failed, they have not started, and showing them +0.0 kg
         * would be both discouraging and wrong.
         */
        adherence_basis: z.enum(["measured", "no_history"]),
        /** Completed weeks the adherence was averaged over. */
        adherence_weeks: z.number().int().min(0),
        /** Whether a stated dose was part of the estimate. Never the dose. */
        enhancement_stated: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type MuscleGainProjectionResponse = z.infer<
  typeof muscleGainProjectionResponseSchema
>;

export type CoachProfileResponse = z.infer<typeof coachProfileResponseSchema>;
export type CoachEnhancement = z.infer<typeof coachEnhancementSchema>;
export type UpdateCoachProfileRequest = z.infer<
  typeof updateCoachProfileRequestSchema
>;
