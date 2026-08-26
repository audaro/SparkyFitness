import { z } from 'zod';
import { uuidSchema } from './common.js';

// An alias maps a personal phrase ("my usual walk") to a concrete record the
// coach can resolve without asking again.
// workout_presets.id is SERIAL (integer); the other target tables use UUIDs.
const aliasTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.enum(['exercise', 'food', 'meal']),
      id: uuidSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('workout_preset'),
      id: z.coerce.number().int().positive(),
    })
    .strict(),
]);

const profileEditFields = {
  goals: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .optional()
    .describe("The user's training/health goals, in their own words"),
  training_days_per_week: z.coerce
    .number()
    .int()
    .min(1)
    .max(7)
    .optional()
    .describe('Days per week the user can train'),
  session_minutes: z.coerce
    .number()
    .int()
    .min(5)
    .max(360)
    .optional()
    .describe('Minutes available per training session'),
  // The exercises.level vocabulary, exactly — the workout generator matches
  // this against candidate rows with an exact string comparison, so a synonym
  // ("advanced", "novice") would silently match nothing.
  experience_level: z
    .enum(['beginner', 'intermediate', 'expert'])
    .optional()
    .describe(
      "The user's training experience level: beginner, intermediate, or expert"
    ),
  equipment: z
    .array(z.string().trim().min(1).max(100))
    .max(50)
    .optional()
    .describe('Equipment on hand — REPLACES the stored list'),
  limitations: z
    .array(z.string().trim().min(1).max(200))
    .max(50)
    .optional()
    .describe('Injuries/constraints, freeform — REPLACES the stored list'),
  food_preferences: z
    .record(z.string(), z.unknown())
    .refine((prefs) => JSON.stringify(prefs).length <= 2000, {
      message:
        'food_preferences is too large (max 2000 characters serialized) — store a compact summary',
    })
    .optional()
    .describe(
      'Food preferences object (e.g. {"likes": [...], "dislikes": [...], "style": "vegetarian"}) — REPLACES the stored object'
    ),
  aliases: z
    .record(z.string().trim().min(1).max(200), aliasTargetSchema)
    .refine((aliasMap) => Object.keys(aliasMap).length <= 50, {
      message: 'Too many aliases (max 50)',
    })
    .optional()
    .describe(
      'Personal phrase → record map (e.g. {"my usual walk": {"kind": "exercise", "id": "..."}}) — REPLACES the stored map'
    ),
};

// A gym profile is named equipment ("Home", "Hotel gym"); switching the active
// one is what makes "I'm at home today" change the next suggested workout.
// Both selectors are optional because the model normally has neither on the
// first turn — get_gym_profiles hands it the names, and a name is what the
// user actually said.
const gymProfileSelectorFields = {
  gym_profile_id: uuidSchema
    .optional()
    .describe('UUID of the gym equipment profile, from get_gym_profiles'),
  gym_profile_name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('Name of the gym equipment profile (alternative to the UUID)'),
};

const getCoachProfileSchema = z
  .object({
    action: z.literal('get_coach_profile'),
  })
  .strict();

const getGymProfilesSchema = z
  .object({
    action: z.literal('get_gym_profiles'),
  })
  .strict();

const setActiveGymProfileSchema = z
  .object({
    action: z.literal('set_active_gym_profile'),
    ...gymProfileSelectorFields,
  })
  .strict();

const updateCoachProfileSchema = z
  .object({
    action: z.literal('update_coach_profile'),
    ...profileEditFields,
  })
  .strict();

export const manageCoachProfileSchema = z.discriminatedUnion('action', [
  getCoachProfileSchema,
  updateCoachProfileSchema,
  getGymProfilesSchema,
  setActiveGymProfileSchema,
]);

export type ManageCoachProfileInput = z.infer<typeof manageCoachProfileSchema>;

// Flat input shape published to the LLM as `inputSchema`. See comment on
// manageFoodInput in ./food.js for the rationale. Runtime validation still
// uses manageCoachProfileSchema in the tool handler via safeParse.
export const manageCoachProfileInput = z.object({
  action: z
    .enum([
      'get_coach_profile',
      'update_coach_profile',
      'get_gym_profiles',
      'set_active_gym_profile',
    ])
    .optional()
    .describe('Action to perform; see tool description for per-action fields.'),
  ...profileEditFields,
  ...gymProfileSelectorFields,
});
