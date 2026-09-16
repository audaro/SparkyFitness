import { z } from "zod";
import { EXPERIENCE_LEVELS } from "../../constants/experience.ts";
import { MUSCLE_GROUPS } from "../../constants/exerciseTaxonomy.ts";
import {
  ENHANCEMENT_STATUSES,
  PHYSIQUE_TARGETS,
  PRIMARY_GOALS,
  TESTOSTERONE_ESTERS,
} from "../../constants/trainingPlan.ts";

// Branded so a public.coach_profiles id cannot be passed where another
// table's id belongs.
export const coachProfilesIdSchema = z
  .string()
  .uuid()
  .brand<"public.coach_profiles">();

const userIdSchema = z.string().uuid();

// An alias maps a personal phrase ("my usual walk") to a concrete record.
// workout_presets.id is SERIAL, so its alias id is an integer; the other
// target tables use UUID primary keys.
export const coachProfileAliasSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["exercise", "food", "meal"]),
    id: z.string().uuid(),
  }),
  z.object({
    kind: z.literal("workout_preset"),
    id: z.number().int().positive(),
  }),
]);

/**
 * Exogenous testosterone, behind the lean-mass projection.
 *
 * SENSITIVE: this value must never be sent to the chat model. It is stored so
 * the projection can be computed on the server and rendered by the user's own
 * app, and for no other reader.
 *
 * Dose and ester are optional because `status: 'natural'` has neither, and a
 * user may state that they are on testosterone without stating how much.
 *
 * The dose is stored **as the user stated it** — an amount and the interval
 * between amounts — rather than as a weekly average. Undecanoate is the case
 * that forces it: a user answering "1000 mg every 10 weeks" whose answer was
 * averaged on the way in would reopen the questionnaire to "100 mg/week", a
 * number they never typed and would reasonably try to correct. The weekly
 * figure the projection needs is derived at read time by
 * `effectiveWeeklyDoseMg`, where the arithmetic is visible and tested.
 *
 * A missing interval means weekly, which is what an unstated interval means
 * everywhere the user might have come from.
 */
export const coachProfileEnhancementSchema = z.object({
  status: z.enum(ENHANCEMENT_STATUSES),
  testosterone_mg_per_dose: z.number().nonnegative().optional(),
  dose_interval_weeks: z.number().positive().optional(),
  ester: z.enum(TESTOSTERONE_ESTERS).optional(),
});

const coachProfilesFieldsSchema = z.object({
  user_id: userIdSchema,
  goals: z.string().nullable(),
  training_days_per_week: z.number().int().nullable(),
  session_minutes: z.number().int().nullable(),
  // Self-stated training experience, in the exercises.level vocabulary so the
  // generator's exact-match level term can compare the two. Null = not stated.
  experience_level: z.enum(EXPERIENCE_LEVELS).nullable(),
  // The training-plan questionnaire's structured answers. Null on every one
  // means "not answered", under which generation and weekly set targets behave
  // exactly as they did before these columns existed.
  primary_goal: z.enum(PRIMARY_GOALS).nullable(),
  physique_target: z.enum(PHYSIQUE_TARGETS).nullable(),
  priority_muscle_groups: z.array(z.enum(MUSCLE_GROUPS)).nullable(),
  enhancement: coachProfileEnhancementSchema.nullable(),
  // Null is what makes the Exercise home offer to set a plan up. Not derivable
  // from the other four: answering one question is not a finished plan.
  plan_completed_at: z.date().nullable(),
  equipment: z.array(z.string()),
  limitations: z.array(z.string()),
  food_preferences: z.record(z.string(), z.unknown()),
  aliases: z.record(z.string(), coachProfileAliasSchema),
  // Working sets per training group the user means to hit each week, keyed by
  // MuscleGroup. An empty object means "not set": the server then derives a
  // default from training_days_per_week rather than showing a target of zero.
  weekly_set_targets: z.record(z.string(), z.number()),
  created_at: z.date(),
  updated_at: z.date(),
});

export const coachProfilesSchema = coachProfilesFieldsSchema.extend({
  id: coachProfilesIdSchema,
});

export const coachProfilesInitializerSchema = coachProfilesFieldsSchema
  .partial()
  .extend({
    user_id: userIdSchema,
  });

export const coachProfilesMutatorSchema = coachProfilesFieldsSchema
  .partial()
  .extend({
    id: coachProfilesIdSchema.optional(),
  });

export type CoachProfiles = z.infer<typeof coachProfilesSchema>;
export type CoachProfileEnhancement = z.infer<
  typeof coachProfileEnhancementSchema
>;
export type CoachProfileAlias = z.infer<typeof coachProfileAliasSchema>;
export type CoachProfilesInitializer = z.infer<
  typeof coachProfilesInitializerSchema
>;
export type CoachProfilesMutator = z.infer<typeof coachProfilesMutatorSchema>;
