import { z } from "zod";
import { MUSCLES } from "../../constants/exerciseTaxonomy.ts";
import { CANONICAL_SET_TYPES } from "../../constants/setTypes.ts";
import { exerciseModalitySchema } from "./Exercises.api.zod.ts";
import { workoutRecommendationStatusSchema } from "../database/WorkoutRecommendations.zod.ts";

/**
 * Wire contracts for the workout recommendation engine.
 *
 * `.strict()` throughout — deliberately unlike the preset schemas, which are
 * strip-mode because web spreads a response object back into a request. Nothing
 * round-trips a recommendation payload, so an unknown key here is a caller bug
 * worth surfacing.
 *
 * Units, restated because this payload is what clients render: weight in
 * **kilograms**, duration and rest in whole **seconds**, distance in
 * **kilometers**. Same contract as every other stored workout value; the UI
 * converts for display only.
 */

/**
 * One muscle's recovery state.
 *
 * `muscle` is `z.string()`, not `z.enum(MUSCLES)`: the response mirrors what
 * the caller asked for, and a custom exercise's snapshot can carry a muscle
 * outside the pinned free-exercise-db vocabulary. Pinning the enum here would
 * turn "the user logged something unusual" into a 500 on a read endpoint.
 */
export const muscleFreshnessSchema = z
  .object({
    muscle: z.string(),
    /** 0 = fully fatigued, 1 = fully fresh. */
    freshness: z.number().min(0).max(1),
    /** Decayed primary-equivalent working sets standing against this muscle. */
    fatigue_sets: z.number().min(0),
    /** YYYY-MM-DD, or null when the muscle has no history in the window. */
    last_trained: z.string().nullable(),
  })
  .strict();

/**
 * The recovery vector, freshest first.
 *
 * `tunables` rides along because the numbers are meaningless without them: a
 * client cannot render "3 of 10 sets of fatigue" or size a heatmap gradient
 * without knowing `full_fatigue_sets`, and hard-coding a copy on each client is
 * how the two drift apart.
 */
export const muscleRecoveryResponseSchema = z
  .object({
    /** The day the scores were computed for, in the user's timezone. */
    date: z.string(),
    muscles: z.array(muscleFreshnessSchema),
    tunables: z
      .object({
        window_days: z.number().int().positive(),
        half_life_days: z.number().positive(),
        secondary_weight: z.number().min(0).max(1),
        full_fatigue_sets: z.number().positive(),
      })
      .strict(),
  })
  .strict();

export type MuscleFreshnessResponse = z.infer<typeof muscleFreshnessSchema>;
export type MuscleRecoveryResponse = z.infer<
  typeof muscleRecoveryResponseSchema
>;

// ---------------------------------------------------------------------------
// The generated workout payload
// ---------------------------------------------------------------------------

/**
 * One programmed set.
 *
 * Every measure is nullable because modality decides which ones mean anything:
 * a `reps_only` set has no weight, a `duration` set has no reps. The engine
 * fills exactly the fields its modality gate allows and leaves the rest null,
 * rather than writing 0 — which a client would render as "0 kg" instead of
 * omitting the column.
 */
export const recommendationSetSchema = z
  .object({
    set_number: z.number().int().positive(),
    set_type: z.enum(CANONICAL_SET_TYPES),
    reps: z.number().int().nullable(),
    /** Kilograms. */
    weight: z.number().nullable(),
    /** Whole seconds — never minutes. */
    duration: z.number().int().nullable(),
    /** Kilometers. */
    distance: z.number().nullable(),
    /** Whole seconds of rest after this set. */
    rest_time: z.number().int().nullable(),
  })
  .strict();

/**
 * One exercise in the generated workout, carrying enough denormalized catalog
 * detail for a client to render the card without a second round trip.
 *
 * `exercise_id` is always a LOCAL uuid. If the engine had to reach
 * free-exercise-db to fill a muscle slot, it imported the exercise before
 * persisting, so nothing downstream ever has to resolve an external id.
 */
export const recommendedExerciseSchema = z
  .object({
    exercise_id: z.string().uuid(),
    exercise_name: z.string(),
    modality: exerciseModalitySchema,
    primary_muscles: z.array(z.string()),
    secondary_muscles: z.array(z.string()),
    equipment: z.array(z.string()),
    images: z.array(z.string()),
    sort_order: z.number().int().min(0),
    /** The "2:00 rest" chip. Also stamped on each set's `rest_time`. */
    rest_seconds: z.number().int().min(0),
    /** Display only: "fresh quads · +2.5% from last session". */
    rationale: z.string(),
    sets: z.array(recommendationSetSchema).min(1),
  })
  .strict();

export const workoutRecommendationPayloadSchema = z
  .object({
    /** The "5 Muscles" header — the muscles this workout was built around. */
    muscle_groups: z.array(z.string()),
    estimated_duration_minutes: z.number().int(),
    exercises: z.array(recommendedExerciseSchema).min(1),
  })
  .strict();

// ---------------------------------------------------------------------------
// Row contract
// ---------------------------------------------------------------------------

export const workoutRecommendationResponseSchema = z
  .object({
    id: z.string().uuid(),
    status: workoutRecommendationStatusSchema,
    target_duration_minutes: z.number().int(),
    gym_profile_id: z.string().uuid().nullable(),
    generated_at: z.string(),
    payload: workoutRecommendationPayloadSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Request contracts
// ---------------------------------------------------------------------------

/**
 * `POST /generate`.
 *
 * Every field is optional because the common case — the app opening for the
 * first time that day — has nothing to say: duration falls back to the coach
 * profile's `session_minutes` and then to 60, the gym falls back to whichever
 * profile is active, and naming no muscles is what asks the engine to pick the
 * freshest ones itself.
 */
export const generateWorkoutRecommendationRequestSchema = z
  .object({
    duration_minutes: z.number().int().min(15).max(180).optional(),
    gym_profile_id: z.string().uuid().nullable().optional(),
    /**
     * Fitbod's whole-workout Swap. The engine is deterministic, so a plain
     * regenerate would hand back the identical workout — the point of Swap is
     * that it does not. Setting this passes the current payload's exercise ids
     * to the planner as a scoring penalty, so it prefers different movements
     * for the same muscles but can still repeat one if nothing else fits.
     */
    swap: z.boolean().optional(),
    /**
     * Build the workout around these muscles instead of the freshest ones.
     *
     * Validated against the canonical enum rather than accepted as free
     * strings: catalog muscle matching is `::jsonb ?|`, which is exact and
     * case-sensitive, so `"Quadriceps"` would not fail — it would quietly
     * match nothing and return a workout built around a muscle the user did
     * not ask for. A 400 is the honest answer.
     *
     * Split names never reach the wire. The client resolves Push / Upper body
     * / Full body to canonical muscles (`MUSCLE_SPLIT_MEMBERS`) and sends the
     * muscles, which keeps the split list and the per-muscle grid on one code
     * path and keeps training vocabulary out of the server.
     *
     * The upper bound is the size of the vocabulary, not a smaller "sensible"
     * number, because Full body legitimately names all 17 and Upper body names
     * 11. How many of them a session can actually serve is the planner's
     * decision through duration fitting, not the wire's. Omitting the field
     * and sending every muscle are different requests: the first tracks
     * recovery, the second overrides it.
     */
    target_muscles: z
      .array(z.enum(MUSCLES))
      .min(1)
      .max(MUSCLES.length)
      .optional(),
  })
  .strict();

/** `PATCH /:id` — lifecycle only; the payload is never client-edited. */
export const updateWorkoutRecommendationRequestSchema = z
  .object({
    status: workoutRecommendationStatusSchema,
  })
  .strict();

/**
 * `POST /replace` — swap one exercise in the stored workout for another.
 *
 * The one exception to "the payload is never client-edited", and it is still
 * not the client doing the editing: the client names two exercises and the
 * server re-runs prescription for the incoming one, so sets, rest and the
 * warm-up ramp stay engine-owned. A client that spliced the row itself would
 * have to reimplement progression, and would drift from it.
 *
 * Both ids are local uuids. `exercise_id_in` must already be in the user's
 * catalog — an external candidate is imported first, which is what makes it
 * one.
 */
export const replaceRecommendationExerciseRequestSchema = z
  .object({
    exercise_id_out: z.string().uuid(),
    exercise_id_in: z.string().uuid(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Alternatives (feeds Replace)
// ---------------------------------------------------------------------------

/**
 * A replacement candidate.
 *
 * `source` distinguishes a local catalog row, which Replace can select
 * immediately, from a free-exercise-db result the client must import first.
 * `exercise_id` is a uuid only for local rows; an external carries its
 * upstream id, which is not a uuid — hence the plain string.
 */
export const alternativeExerciseSchema = z
  .object({
    exercise_id: z.string(),
    exercise_name: z.string(),
    source: z.enum(["local", "external"]),
    primary_muscles: z.array(z.string()),
    secondary_muscles: z.array(z.string()),
    equipment: z.array(z.string()),
    images: z.array(z.string()),
    mechanic: z.string().nullable(),
    level: z.string().nullable(),
    /** Ranking score; exposed so a client can show why an order was chosen. */
    score: z.number(),
  })
  .strict();

export const alternativeExercisesResponseSchema = z
  .object({
    alternatives: z.array(alternativeExerciseSchema),
  })
  .strict();

export type RecommendationSet = z.infer<typeof recommendationSetSchema>;
export type RecommendedExercise = z.infer<typeof recommendedExerciseSchema>;
export type WorkoutRecommendationPayload = z.infer<
  typeof workoutRecommendationPayloadSchema
>;
export type WorkoutRecommendationResponse = z.infer<
  typeof workoutRecommendationResponseSchema
>;
export type GenerateWorkoutRecommendationRequest = z.infer<
  typeof generateWorkoutRecommendationRequestSchema
>;
export type UpdateWorkoutRecommendationRequest = z.infer<
  typeof updateWorkoutRecommendationRequestSchema
>;
export type ReplaceRecommendationExerciseRequest = z.infer<
  typeof replaceRecommendationExerciseRequestSchema
>;
export type AlternativeExercise = z.infer<typeof alternativeExerciseSchema>;
export type AlternativeExercisesResponse = z.infer<
  typeof alternativeExercisesResponseSchema
>;
