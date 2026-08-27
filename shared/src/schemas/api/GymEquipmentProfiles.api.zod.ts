import { z } from "zod";
import { EQUIPMENT } from "../../constants/exerciseTaxonomy.ts";
import { EXERCISE_APPARATUS } from "../../constants/exerciseApparatus.ts";
import { EQUIPMENT_ITEM_SLUGS } from "../../constants/equipmentItems.ts";

/**
 * Gym equipment profiles: named, switchable equipment sets. The active one
 * constrains workout generation and, opt-in, catalog search.
 *
 * Equipment elements are validated against the canonical free-exercise-db
 * enum rather than accepted as free text. The catalog filter is
 * `equipment::jsonb ?|` — exact and case-sensitive — so an unknown or
 * title-cased string would not error, it would just quietly match nothing.
 * Rejecting it at the boundary is the fail-loud choice.
 */
export const gymEquipmentValueSchema = z.enum(EQUIPMENT);

/** Bounded so one profile cannot carry an unbounded jsonb blob. */
const equipmentListSchema = z
  .array(gymEquipmentValueSchema)
  .max(EQUIPMENT.length);

/**
 * Apparatus the gym physically has (pull-up bar, dip station, squat rack,
 * bench). A separate vocabulary from the equipment enum on purpose: these
 * values exist only for the engine's performability test and must never
 * reach the `?|` catalog filter. The field is tri-state — absent/NULL means
 * "never stated" and the engine keeps inferring apparatus from
 * barbell/cable/machine; an empty array is an authoritative "none".
 */
export const gymApparatusValueSchema = z.enum(EXERCISE_APPARATUS);

const apparatusListSchema = z
  .array(gymApparatusValueSchema)
  .max(EXERCISE_APPARATUS.length);

/**
 * Granular equipment items, as kebab-case slugs from the shared
 * EQUIPMENT_ITEMS vocabulary. Tri-state like apparatus: absent/NULL means
 * "never stated" (the profile stays coarse), an array is authoritative and
 * `[]` means "nothing here".
 *
 * The derivation contract makes items and the coarse fields mutually
 * exclusive in one payload: when items are stated the server *derives*
 * `equipment` and `apparatus` from them, because accepting both would be two
 * sources of truth, and two sources of truth is how they drift.
 */
export const gymEquipmentItemValueSchema = z.enum(EQUIPMENT_ITEM_SLUGS);

const equipmentItemsListSchema = z
  .array(gymEquipmentItemValueSchema)
  .max(EQUIPMENT_ITEM_SLUGS.length);

const DUAL_SOURCE_MESSAGE =
  "equipment and apparatus are derived from equipment_items; send one or the other, not both";

/**
 * Per-equipment load ceilings and step overrides, kg (dumbbell: per hand),
 * keyed by canonical equipment value. Keys outside the enum are rejected —
 * a `Dumbbell` entry would silently cap nothing. Absent/NULL means "no
 * limits stated": prescription keeps the global increments and no ceiling.
 */
export const loadLimitsSchema = z.partialRecord(
  gymEquipmentValueSchema,
  z
    .object({
      max_kg: z.number().positive().max(500),
      increment_kg: z.number().positive().max(50).optional(),
    })
    .strict(),
);

const profileNameSchema = z.string().trim().min(1).max(100);

// --- Response contracts ---
//
// Timestamps cross the wire as ISO strings: the routes serialize the pg
// `Date` values before parsing, so clients get strings, not Dates.
export const gymEquipmentProfileResponseSchema = z
  .object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    name: z.string(),
    equipment: z.array(z.string()),
    apparatus: z.array(z.string()).nullable(),
    equipment_items: z.array(z.string()).nullable(),
    load_limits: loadLimitsSchema.nullable(),
    is_active: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

export const gymEquipmentProfilesListResponseSchema = z
  .object({
    profiles: z.array(gymEquipmentProfileResponseSchema),
  })
  .strict();

// --- Request contracts ---
//
// `.strict()`: no client spreads a response object into these payloads, so an
// unknown key is a caller bug worth surfacing rather than silently dropping.

export const createGymEquipmentProfileRequestSchema = z
  .object({
    name: profileNameSchema,
    /**
     * Required for a coarse-mode create (the legacy contract, unchanged);
     * forbidden alongside `equipment_items`, whose derivation writes it.
     */
    equipment: equipmentListSchema.optional(),
    /** Omitted = "never stated" (stored NULL; the engine keeps inferring). */
    apparatus: apparatusListSchema.optional(),
    /**
     * Stated granular items. When present the server derives `equipment`
     * and `apparatus` from them and this payload must not carry either.
     */
    equipment_items: equipmentItemsListSchema.optional(),
    /** Omitted = no limits (stored NULL; prescription is unconstrained). */
    load_limits: loadLimitsSchema.optional(),
    /**
     * Creating a profile already active is a real flow (the first profile a
     * user makes). The server routes it through the same transaction the
     * activate endpoint uses, because the partial unique index allows only
     * one active row per user.
     */
    is_active: z.boolean().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.equipment_items !== undefined) {
      if (body.equipment !== undefined || body.apparatus !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["equipment_items"],
          message: DUAL_SOURCE_MESSAGE,
        });
      }
    } else if (body.equipment === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["equipment"],
        message: "Provide equipment or equipment_items",
      });
    }
  });

/**
 * `is_active` is deliberately absent: activation is a cross-row operation
 * (deactivate the current one, activate this one) and belongs to
 * `POST /:id/activate`, which does it in a transaction. Allowing it here
 * would let a plain UPDATE trip the one-active partial unique index.
 */
export const updateGymEquipmentProfileRequestSchema = z
  .object({
    name: profileNameSchema.optional(),
    equipment: equipmentListSchema.optional(),
    /** Explicit null clears back to "never stated" (inference resumes). */
    apparatus: apparatusListSchema.nullable().optional(),
    /**
     * An array states items (the server re-derives `equipment` and
     * `apparatus`, so neither may ride along); explicit null clears back to
     * a coarse-mode profile, keeping the last derived coarse columns.
     * Conversely, a patch that rewrites `equipment` or `apparatus` on an
     * item-stated profile drops the row back to coarse mode server-side —
     * stale items silently disagreeing with edited coarse columns would be
     * worse than losing the detail.
     */
    equipment_items: equipmentItemsListSchema.nullable().optional(),
    /** Explicit null clears every limit; the map replaces, never merges. */
    load_limits: loadLimitsSchema.nullable().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Provide at least one field to update",
  })
  .superRefine((patch, ctx) => {
    if (
      patch.equipment_items !== undefined &&
      patch.equipment_items !== null &&
      (patch.equipment !== undefined || patch.apparatus !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["equipment_items"],
        message: DUAL_SOURCE_MESSAGE,
      });
    }
  });

export type GymEquipmentValue = z.infer<typeof gymEquipmentValueSchema>;
export type GymEquipmentItemValue = z.infer<typeof gymEquipmentItemValueSchema>;
export type GymApparatusValue = z.infer<typeof gymApparatusValueSchema>;
export type GymLoadLimits = z.infer<typeof loadLimitsSchema>;
export type GymEquipmentProfileResponse = z.infer<
  typeof gymEquipmentProfileResponseSchema
>;
export type GymEquipmentProfilesListResponse = z.infer<
  typeof gymEquipmentProfilesListResponseSchema
>;
export type CreateGymEquipmentProfileRequest = z.infer<
  typeof createGymEquipmentProfileRequestSchema
>;
export type UpdateGymEquipmentProfileRequest = z.infer<
  typeof updateGymEquipmentProfileRequestSchema
>;
