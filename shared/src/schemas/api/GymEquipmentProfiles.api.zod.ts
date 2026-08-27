import { z } from "zod";
import { EQUIPMENT } from "../../constants/exerciseTaxonomy.ts";
import { EXERCISE_APPARATUS } from "../../constants/exerciseApparatus.ts";

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
    equipment: equipmentListSchema,
    /** Omitted = "never stated" (stored NULL; the engine keeps inferring). */
    apparatus: apparatusListSchema.optional(),
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
  .strict();

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
    /** Explicit null clears every limit; the map replaces, never merges. */
    load_limits: loadLimitsSchema.nullable().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Provide at least one field to update",
  });

export type GymEquipmentValue = z.infer<typeof gymEquipmentValueSchema>;
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
