import { z } from "zod";
import {
  EQUIPMENT,
  EQUIPMENT_PREFERENCES,
} from "../../constants/exerciseTaxonomy.ts";
import { EXERCISE_APPARATUS } from "../../constants/exerciseApparatus.ts";
import { EQUIPMENT_ITEM_SLUGS } from "../../constants/equipmentItems.ts";

// Branded so a public.gym_equipment_profiles id cannot be passed where
// another table's id belongs.
export const gymEquipmentProfilesIdSchema = z
  .string()
  .uuid()
  .brand<"public.gym_equipment_profiles">();

const userIdSchema = z.string().uuid();

/**
 * Equipment elements are the canonical free-exercise-db strings. Validated
 * against the pinned enum rather than accepted as free text: the catalog
 * matches them with `equipment::jsonb ?|`, an exact case-sensitive
 * comparison, so a drifted value would silently filter every exercise out
 * instead of failing.
 */
export const gymEquipmentSchema = z.enum(EQUIPMENT);

/**
 * Apparatus values come from EXERCISE_APPARATUS, deliberately NOT the
 * equipment enum: they exist only for the engine's performability test and
 * must never reach the `?|` catalog filter. NULL means "never stated" (the
 * engine infers from barbell/cable/machine); '[]' means "stated: none".
 */
export const gymApparatusSchema = z.enum(EXERCISE_APPARATUS);

/**
 * Granular item slugs from the shared EQUIPMENT_ITEMS vocabulary — the
 * engine-side overlay, deliberately NOT the upstream equipment enum: a slug
 * must never reach the `?|` catalog filter. NULL on the column means "never
 * stated" (legacy profile, coarse behavior everywhere); an array is an
 * authoritative statement, with `[]` meaning "nothing here".
 */
export const equipmentItemSlugSchema = z.enum(EQUIPMENT_ITEM_SLUGS);

/**
 * One equipment type's limit, kg (dumbbell: per hand). `max_kg` is the
 * heaviest load the gym stocks; `increment_kg` overrides the global step
 * used to quantize prescriptions. NULL on the column = no limits stated.
 */
export const gymLoadLimitSchema = z
  .object({
    max_kg: z.number().positive().max(500),
    increment_kg: z.number().positive().max(50).optional(),
  })
  .strict();

/**
 * Which kind of equipment the user would rather train on at this gym. NULL on
 * the column means never stated — not a third value, just the absence of a
 * statement — and the engine then selects exactly as it did before the column
 * existed. Validated against the pinned vocabulary rather than accepted as
 * free text, for the same reason `coach_profiles.experience_level` is: the
 * value is compared by exact string equality, so a synonym would silently
 * behave as "unstated" instead of failing.
 */
export const gymEquipmentPreferenceSchema = z.enum(EQUIPMENT_PREFERENCES);

const gymEquipmentProfilesFieldsSchema = z.object({
  user_id: userIdSchema,
  name: z.string().min(1).max(100),
  equipment: z.array(gymEquipmentSchema),
  equipment_preference: gymEquipmentPreferenceSchema.nullable(),
  apparatus: z.array(gymApparatusSchema).nullable(),
  equipment_items: z
    .array(equipmentItemSlugSchema)
    .max(EQUIPMENT_ITEM_SLUGS.length)
    .nullable(),
  load_limits: z
    .partialRecord(gymEquipmentSchema, gymLoadLimitSchema)
    .nullable(),
  is_active: z.boolean(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const gymEquipmentProfilesSchema =
  gymEquipmentProfilesFieldsSchema.extend({
    id: gymEquipmentProfilesIdSchema,
  });

export const gymEquipmentProfilesInitializerSchema =
  gymEquipmentProfilesFieldsSchema.partial().extend({
    user_id: userIdSchema,
    name: z.string().min(1).max(100),
  });

export const gymEquipmentProfilesMutatorSchema =
  gymEquipmentProfilesFieldsSchema.partial().extend({
    id: gymEquipmentProfilesIdSchema.optional(),
  });

export type GymEquipmentProfiles = z.infer<typeof gymEquipmentProfilesSchema>;
export type GymEquipmentProfilesInitializer = z.infer<
  typeof gymEquipmentProfilesInitializerSchema
>;
export type GymEquipmentProfilesMutator = z.infer<
  typeof gymEquipmentProfilesMutatorSchema
>;
