import { apiCall } from '@/api/api';
import type {
  GenerateWorkoutRecommendationRequest,
  MuscleRecoveryResponse,
  WorkoutRecommendationResponse,
  WorkoutRecommendationStatus,
} from '@workspace/shared';

export type WorkoutRecommendation = WorkoutRecommendationResponse;
export type GenerateRecommendationPayload =
  GenerateWorkoutRecommendationRequest;
export type MuscleRecovery = MuscleRecoveryResponse;
export type RecommendationStatus = WorkoutRecommendationStatus;

/**
 * Today's per-muscle recovery, freshest first.
 *
 * Unlike the rest of this route family, recovery is **not** owner-only: it is
 * derived from logged exercise entries rather than from the coaching-context
 * tables, so the route rides the `diary` permission and a delegate with diary
 * access reads the account they are acting for.
 */
export const getMuscleRecovery = async (): Promise<MuscleRecovery> => {
  return apiCall('/workout-recommendations/recovery', { method: 'GET' });
};

/**
 * The stored "Up Next" workout, or null when none has been generated.
 *
 * The server answers 404 for a user who has never generated one. That is the
 * normal first-run state, not a failure, so it is suppressed here (apiCall
 * returns null for a suppressed 404) — surfacing it would put an error toast
 * and a retry in front of every new user instead of the Generate button.
 */
export const getWorkoutRecommendation =
  async (): Promise<WorkoutRecommendation | null> => {
    return apiCall('/workout-recommendations', {
      method: 'GET',
      suppress404Toast: true,
    });
  };

/**
 * Generate (or regenerate) the workout.
 *
 * Also the whole-workout Swap: generation is deterministic, so a plain
 * regenerate hands back the identical payload — `swap: true` penalizes the
 * current exercises so the planner picks different movements for the same
 * muscles.
 *
 * An empty body is the common case: duration falls back to the coach profile's
 * session length, the gym to whichever profile is active, and naming no muscles
 * is what asks the engine to pick the freshest ones itself.
 */
export const generateWorkoutRecommendation = async (
  payload: GenerateRecommendationPayload = {}
): Promise<WorkoutRecommendation> => {
  return apiCall('/workout-recommendations/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

/**
 * Move the stored workout through its lifecycle — the only field a client may
 * PATCH. The payload itself is engine-owned and never client-edited.
 *
 * The response is the updated row, so callers can cache it rather than refetch.
 */
export const updateWorkoutRecommendationStatus = async (variables: {
  id: string;
  status: RecommendationStatus;
}): Promise<WorkoutRecommendation> => {
  return apiCall(`/workout-recommendations/${variables.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: variables.status }),
  });
};
