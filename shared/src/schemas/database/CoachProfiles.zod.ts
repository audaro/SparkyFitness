import { z } from "zod";

// Branded so a public.coach_profiles id cannot be passed where another
// table's id belongs.
export const coachProfilesIdSchema = z
  .string()
  .uuid()
  .brand<"public.coach_profiles">();

const userIdSchema = z.string().uuid();

// An alias maps a personal phrase ("my usual walk") to a concrete record.
export const coachProfileAliasSchema = z.object({
  kind: z.enum(["exercise", "food", "meal", "workout_preset"]),
  id: z.string().uuid(),
});

const coachProfilesFieldsSchema = z.object({
  user_id: userIdSchema,
  goals: z.string().nullable(),
  training_days_per_week: z.number().int().nullable(),
  session_minutes: z.number().int().nullable(),
  equipment: z.array(z.string()),
  limitations: z.array(z.string()),
  food_preferences: z.record(z.string(), z.unknown()),
  aliases: z.record(z.string(), coachProfileAliasSchema),
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
export type CoachProfileAlias = z.infer<typeof coachProfileAliasSchema>;
export type CoachProfilesInitializer = z.infer<
  typeof coachProfilesInitializerSchema
>;
export type CoachProfilesMutator = z.infer<typeof coachProfilesMutatorSchema>;
