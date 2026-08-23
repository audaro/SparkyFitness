import { z } from "zod";

/**
 * Wire contracts for the workout recommendation engine.
 *
 * `.strict()` throughout — deliberately unlike the preset schemas, which are
 * strip-mode because web spreads a response object back into a request. Nothing
 * round-trips a recommendation payload, so an unknown key here is a caller bug
 * worth surfacing.
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
