import type {
  GenerateWorkoutRecommendationRequest,
  WorkoutRecommendationResponse,
  WorkoutRecommendationStatus,
} from '@workspace/shared';
import { apiFetch } from './apiClient';
import { ApiError } from './errors';

// Payload shapes are the shared request schemas the server validates against;
// these aliases keep the mobile-local names the screens were written against.
export type WorkoutRecommendation = WorkoutRecommendationResponse;
export type GenerateRecommendationPayload = GenerateWorkoutRecommendationRequest;

const SERVICE_NAME = 'Workout Recommendations API';

/**
 * The stored "Up Next" workout, or null when none has been generated.
 *
 * The server answers 404 for a user who has never generated one. That is the
 * normal first-run state, not a failure — surfacing it as a query error would
 * put a retry screen in front of every new user instead of the Generate CTA.
 * Every other status still throws.
 */
export const fetchRecommendation = async (): Promise<WorkoutRecommendation | null> => {
  try {
    return await apiFetch<WorkoutRecommendation>({
      endpoint: '/api/workout-recommendations',
      serviceName: SERVICE_NAME,
      operation: 'fetch workout recommendation',
    });
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) return null;
    throw error;
  }
};

/**
 * Generate (or regenerate) the workout. Also the whole-workout Swap: generation
 * is deterministic, so a plain regenerate returns the identical payload —
 * `swap: true` penalizes the current exercises so the planner picks others for
 * the same muscles.
 */
export const generateRecommendation = async (
  body: GenerateRecommendationPayload = {},
): Promise<WorkoutRecommendation> => {
  return apiFetch<WorkoutRecommendation>({
    endpoint: '/api/workout-recommendations/generate',
    method: 'POST',
    body,
    serviceName: SERVICE_NAME,
    operation: 'generate workout recommendation',
  });
};

/** Lifecycle only — the payload itself is never client-edited. */
export const patchRecommendationStatus = async (
  id: string,
  status: WorkoutRecommendationStatus,
): Promise<WorkoutRecommendation> => {
  return apiFetch<WorkoutRecommendation>({
    endpoint: `/api/workout-recommendations/${id}`,
    method: 'PATCH',
    body: { status },
    serviceName: SERVICE_NAME,
    operation: 'update workout recommendation status',
  });
};
