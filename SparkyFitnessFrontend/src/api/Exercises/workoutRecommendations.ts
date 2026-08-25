import { apiCall } from '@/api/api';
import type {
  GenerateWorkoutRecommendationRequest,
  WorkoutRecommendationResponse,
} from '@workspace/shared';

export type WorkoutRecommendation = WorkoutRecommendationResponse;
export type GenerateRecommendationPayload =
  GenerateWorkoutRecommendationRequest;

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
