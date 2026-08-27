import { z } from 'zod';
import {
  EQUIPMENT,
  EQUIPMENT_ITEM_SLUGS,
  EXERCISE_APPARATUS,
  GYM_TEMPLATE_SLUGS,
} from '@workspace/shared';
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
const gymProfileNameSchema = z.string().trim().min(1).max(100);

const gymProfileSelectorFields = {
  gym_profile_id: uuidSchema
    .optional()
    .describe('UUID of the gym equipment profile, from get_gym_profiles'),
  gym_profile_name: gymProfileNameSchema
    .optional()
    .describe(
      'Name of the gym equipment profile (alternative to the UUID); for create_gym_profile, the name for the new profile'
    ),
};

// Gym-profile equipment must be the canonical free-exercise-db vocabulary —
// the catalog filter is `equipment::jsonb ?|`, exact and case-sensitive, so a
// freeform name ("treadmill", "Smith machine") would not error, it would
// silently match nothing. Lowercasing forgives the one mistake a model
// actually makes (title case); everything else has to be mapped to the enum.
const gymEquipmentValueSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z.enum(EQUIPMENT)
);

const gymEquipmentListSchema = z
  .array(gymEquipmentValueSchema)
  .min(
    1,
    'Provide at least one equipment value — use "body only" for a no-equipment profile'
  )
  .max(EQUIPMENT.length)
  .describe(
    `Equipment at this gym, only from the canonical vocabulary: ${EQUIPMENT.join(
      ', '
    )}. Map real equipment to the closest value — REPLACES the stored list on update`
  );

// Apparatus is a separate, smaller vocabulary from equipment: things a
// bodyweight movement hangs from or braces against. Stating it is what fixes
// "my gym has no squat rack" — an explicit list (empty included) overrides the
// engine's inference from barbell/cable/machine; omitted leaves it unstated.
const gymApparatusValueSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z.enum(EXERCISE_APPARATUS)
);

const gymApparatusListSchema = z
  .array(gymApparatusValueSchema)
  .max(EXERCISE_APPARATUS.length)
  .describe(
    `Apparatus physically present, only from: ${EXERCISE_APPARATUS.join(
      ', '
    )}. An empty array states the gym has none of them; omit to leave it unstated (inferred from equipment) — REPLACES the stored list on update`
  );

// Granular items are the engine-side overlay: kebab-case slugs, never the
// coarse enum. When they are stated the server derives `equipment` and
// `apparatus` from them (the same contract the REST routes enforce), so a
// payload carrying items together with either coarse field is rejected.
const gymEquipmentItemValueSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z.enum(EQUIPMENT_ITEM_SLUGS)
);

const gymEquipmentItemsListSchema = z
  .array(gymEquipmentItemValueSchema)
  .max(EQUIPMENT_ITEM_SLUGS.length)
  .describe(
    'Granular equipment items at this gym, as kebab-case slugs from the published enum (e.g. smith-machine, lat-pulldown, dumbbells). Stating items derives equipment and apparatus from them, so do not send gym_equipment or gym_apparatus alongside — REPLACES the stored items on update'
  );

// "Planet Fitness" → planet-fitness: the model echoes what the user said, so
// spaces and slashes normalize into the slug before the enum check.
const gymTemplateSchema = z.preprocess(
  (value) =>
    typeof value === 'string'
      ? value
          .trim()
          .toLowerCase()
          .replace(/[\s/]+/g, '-')
      : value,
  z.enum(GYM_TEMPLATE_SLUGS)
);

const DUAL_SOURCE_MESSAGE =
  'gym_equipment and gym_apparatus are derived from the stated items; send gym_equipment_items (or gym_template) OR the coarse fields, not both';

const gymDumbbellMaxSchema = z.coerce
  .number()
  .positive()
  .max(200)
  .describe(
    'Heaviest dumbbell at this gym, in kg per hand (50 lb ≈ 22.5 kg). Prescriptions cap at it'
  );

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

const createGymProfileSchema = z
  .object({
    action: z.literal('create_gym_profile'),
    gym_profile_name: gymProfileNameSchema.describe(
      'Name for the new gym profile (e.g. "Home", "Planet Fitness")'
    ),
    gym_equipment: gymEquipmentListSchema.optional(),
    gym_apparatus: gymApparatusListSchema.optional(),
    gym_equipment_items: gymEquipmentItemsListSchema.optional(),
    gym_template: gymTemplateSchema
      .optional()
      .describe(
        `Prefill the items from a known gym shape: ${GYM_TEMPLATE_SLUGS.join(
          ', '
        )}. Expanded server-side; use for "Planet Fitness has..." instead of listing items by hand`
      ),
    gym_dumbbell_max_kg: gymDumbbellMaxSchema.optional(),
    make_active: z
      .boolean()
      .optional()
      .describe(
        'Make the new profile active immediately (deactivates the current one); defaults to false'
      ),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (
      body.gym_equipment_items !== undefined &&
      body.gym_template !== undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['gym_template'],
        message:
          'Send gym_template or gym_equipment_items, not both — a template is a prefill of the items',
      });
      return;
    }
    if (
      body.gym_equipment_items !== undefined ||
      body.gym_template !== undefined
    ) {
      if (
        body.gym_equipment !== undefined ||
        body.gym_apparatus !== undefined
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['gym_equipment_items'],
          message: DUAL_SOURCE_MESSAGE,
        });
      }
    } else if (body.gym_equipment === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['gym_equipment'],
        message: 'Provide gym_equipment, gym_equipment_items, or gym_template',
      });
    }
  });

const updateGymProfileSchema = z
  .object({
    action: z.literal('update_gym_profile'),
    ...gymProfileSelectorFields,
    new_name: gymProfileNameSchema
      .optional()
      .describe('New name for the profile (update_gym_profile only)'),
    gym_equipment: gymEquipmentListSchema.optional(),
    gym_apparatus: gymApparatusListSchema.optional(),
    gym_equipment_items: gymEquipmentItemsListSchema.optional(),
    gym_dumbbell_max_kg: gymDumbbellMaxSchema.optional(),
  })
  .strict()
  .superRefine((patch, ctx) => {
    if (
      patch.gym_equipment_items !== undefined &&
      (patch.gym_equipment !== undefined || patch.gym_apparatus !== undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['gym_equipment_items'],
        message: DUAL_SOURCE_MESSAGE,
      });
    }
  });

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
  createGymProfileSchema,
  updateGymProfileSchema,
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
      'create_gym_profile',
      'update_gym_profile',
      'set_active_gym_profile',
    ])
    .optional()
    .describe('Action to perform; see tool description for per-action fields.'),
  ...profileEditFields,
  ...gymProfileSelectorFields,
  gym_equipment: gymEquipmentListSchema.optional(),
  gym_apparatus: gymApparatusListSchema.optional(),
  gym_equipment_items: gymEquipmentItemsListSchema.optional(),
  gym_template: gymTemplateSchema
    .optional()
    .describe(
      `create_gym_profile only: prefill the items from a known gym shape (${GYM_TEMPLATE_SLUGS.join(
        ', '
      )})`
    ),
  gym_dumbbell_max_kg: gymDumbbellMaxSchema.optional(),
  new_name: gymProfileNameSchema
    .optional()
    .describe('New name for the profile (update_gym_profile only)'),
  make_active: z
    .boolean()
    .optional()
    .describe(
      'create_gym_profile only: make the new profile active immediately'
    ),
});
