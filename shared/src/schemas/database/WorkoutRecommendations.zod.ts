import { z } from "zod";

// Branded so a public.workout_recommendations id cannot be passed where
// another table's id belongs.
export const workoutRecommendationsIdSchema = z
  .string()
  .uuid()
  .brand<"public.workout_recommendations">();

const userIdSchema = z.string().uuid();

/**
 * Lifecycle of a generated workout. Nothing server-side branches on it yet —
 * it exists so a client can tell a fresh suggestion from one already acted on,
 * and know when to offer regeneration.
 */
export const workoutRecommendationStatuses = [
  "active",
  "started",
  "completed",
  "dismissed",
] as const;
export const workoutRecommendationStatusSchema = z.enum(
  workoutRecommendationStatuses,
);

const workoutRecommendationsFieldsSchema = z.object({
  user_id: userIdSchema,
  /** Null once the gym profile it was built for is deleted. */
  gym_profile_id: z.string().uuid().nullable(),
  target_duration_minutes: z.number().int(),
  /**
   * A `WorkoutRecommendationPayload` (see the matching api schema). Left as
   * `unknown` here rather than restated: the api schema is the contract, and
   * two copies of a 3-level-deep shape drift.
   */
  payload: z.unknown(),
  status: workoutRecommendationStatusSchema,
  generated_at: z.date(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const workoutRecommendationsSchema =
  workoutRecommendationsFieldsSchema.extend({
    id: workoutRecommendationsIdSchema,
  });

export const workoutRecommendationsInitializerSchema =
  workoutRecommendationsFieldsSchema.partial().extend({
    user_id: userIdSchema,
    target_duration_minutes: z.number().int(),
  });

export const workoutRecommendationsMutatorSchema =
  workoutRecommendationsFieldsSchema.partial().extend({
    id: workoutRecommendationsIdSchema.optional(),
  });

export type WorkoutRecommendationStatus = z.infer<
  typeof workoutRecommendationStatusSchema
>;
export type WorkoutRecommendations = z.infer<
  typeof workoutRecommendationsSchema
>;
export type WorkoutRecommendationsInitializer = z.infer<
  typeof workoutRecommendationsInitializerSchema
>;
export type WorkoutRecommendationsMutator = z.infer<
  typeof workoutRecommendationsMutatorSchema
>;
