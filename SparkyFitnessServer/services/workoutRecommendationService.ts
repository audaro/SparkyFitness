import {
  addDays,
  computeMuscleFreshness,
  todayInZone,
  RECOVERY_TUNABLES,
  type MuscleFreshness,
  type MuscleRecoveryResponse,
} from '@workspace/shared';
import { loadUserTimezone } from '../utils/timezoneLoader.js';
import workoutRecommendationRepository from '../models/workoutRecommendationRepository.js';

/**
 * Orchestration for the workout recommendation engine: resolve the user's
 * calendar day, read history, hand it to the pure math in `@workspace/shared`.
 *
 * The split is load-bearing. Everything time- or database-dependent stays here;
 * the scoring stays pure and deterministic, which is what lets "Up Next" be
 * stable across app opens and lets Swap mean something.
 */

/**
 * The user's per-muscle recovery for today, freshest first.
 *
 * `today` comes from the user's timezone, never the server's — an entry logged
 * "yesterday" in Los Angeles is 2 days old to a UTC process for seven hours
 * every day, and at a 2-day half-life that is a 30% error in the score.
 *
 * Ties break on muscle name so the ordering is total. Without that, muscles at
 * the untrained 1.0 plateau — most of the vector for most users — would come
 * back in whatever order the sort happened to leave them, and a client
 * rendering "your freshest muscle" would see it change between two identical
 * calls.
 */
async function getMuscleRecovery(
  userId: string
): Promise<MuscleRecoveryResponse> {
  const tz = await loadUserTimezone(userId);
  const today = todayInZone(tz);
  // Inclusive lower bound, so the read spans `windowDays` days *plus today*.
  // The extra day is free: at a 2-day half-life the oldest entry in the window
  // retains under 1% of its fatigue, so the bound exists to keep the query
  // bounded, not to shape the score.
  const since = addDays(today, -RECOVERY_TUNABLES.windowDays);

  const inputs = await workoutRecommendationRepository.getMuscleFatigueInputs(
    userId,
    since
  );
  // Plain string comparison, not `localeCompare`: the ordering has to be the
  // same on every machine, and collation is an ICU/locale-dependent thing.
  const muscles = computeMuscleFreshness(inputs, today).sort(
    (a: MuscleFreshness, b: MuscleFreshness) =>
      b.freshness - a.freshness ||
      (a.muscle < b.muscle ? -1 : a.muscle > b.muscle ? 1 : 0)
  );

  return {
    date: today,
    muscles: muscles.map((entry) => ({
      muscle: entry.muscle,
      freshness: entry.freshness,
      fatigue_sets: entry.fatigueSets,
      last_trained: entry.lastTrained,
    })),
    tunables: {
      window_days: RECOVERY_TUNABLES.windowDays,
      half_life_days: RECOVERY_TUNABLES.halfLifeDays,
      secondary_weight: RECOVERY_TUNABLES.secondaryWeight,
      full_fatigue_sets: RECOVERY_TUNABLES.fullFatigueSets,
    },
  };
}

export { getMuscleRecovery };
export default { getMuscleRecovery };
