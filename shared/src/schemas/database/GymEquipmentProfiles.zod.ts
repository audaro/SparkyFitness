import { z } from "zod";
import { EQUIPMENT } from "../../constants/exerciseTaxonomy.ts";

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

const gymEquipmentProfilesFieldsSchema = z.object({
  user_id: userIdSchema,
  name: z.string().min(1).max(100),
  equipment: z.array(gymEquipmentSchema),
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
