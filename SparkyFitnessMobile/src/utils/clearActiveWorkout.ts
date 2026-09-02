import type { QueryClient } from '@tanstack/react-query';
import type { WorkoutRecommendationStatus } from '@workspace/shared';
import { useActiveWorkoutStore } from '../stores/activeWorkoutStore';
import { patchRecommendationStatus } from '../services/api/workoutRecommendationsApi';
import { workoutRecommendationQueryKey } from '../hooks/queryKeys';
import { addLog } from '../services/LogService';

/**
 * How a live workout ended, as far as Today's Workout is concerned.
 *
 * - `abandoned`: the user cleared, discarded or replaced it. The
 *   recommendation goes back to `active` so the card offers Start again
 *   instead of staying `started` forever.
 * - `completed`: every set was done and the user dismissed the HUD without
 *   passing through the Complete screen.
 */
export type ClearActiveWorkoutOutcome = 'abandoned' | 'completed';

const STATUS_FOR_OUTCOME: Record<ClearActiveWorkoutOutcome, WorkoutRecommendationStatus> = {
  abandoned: 'active',
  completed: 'completed',
};

/**
 * The one way to drop a live workout from this device outside the finish
 * path. Clears the store synchronously, then — when the workout was started
 * from Today's Workout — moves the recommendation to the status matching
 * `outcome`. Starting marks it `started` (UpNextScreen), finishing marks it
 * `completed` (WorkoutCompleteScreen); without this, every other exit left
 * it `started`.
 *
 * Best-effort, like the other lifecycle markers: nothing server-side branches
 * on the status, so a failure is logged and never surfaced or retried. The
 * query is invalidated rather than seeded with the response so a regenerated
 * recommendation (different id) is never overwritten by a stale one.
 */
export function clearActiveWorkout(
  queryClient: QueryClient,
  outcome: ClearActiveWorkoutOutcome,
): void {
  const store = useActiveWorkoutStore.getState();
  const recommendationId = store.sourceRecommendationId;
  store.clearWorkout();
  if (recommendationId == null) return;

  patchRecommendationStatus(recommendationId, STATUS_FOR_OUTCOME[outcome])
    .then(() => queryClient.invalidateQueries({ queryKey: workoutRecommendationQueryKey }))
    .catch((error: unknown) => {
      addLog(`Failed to mark recommendation ${outcome}: ${String(error)}`, 'WARNING');
    });
}
