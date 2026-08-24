import type {
  AlternativeExercise,
  AlternativeExercisesResponse,
  GenerateWorkoutRecommendationRequest,
  MuscleRecoveryResponse,
  ReplaceRecommendationExerciseRequest,
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
 * Per-muscle recovery for today, in the user's timezone, freshest first.
 *
 * The server answers with a complete vector over the whole canonical muscle
 * vocabulary — a muscle with no history comes back at `freshness: 1`,
 * `last_trained: null` rather than being omitted — so callers never fill gaps.
 *
 * `freshness` is **0.0–1.0, not a percentage**. `tunables` rides along because
 * `fatigue_sets` is meaningless without `full_fatigue_sets` to read it against.
 */
export const fetchMuscleRecovery = async (): Promise<MuscleRecoveryResponse> => {
  return apiFetch<MuscleRecoveryResponse>({
    endpoint: '/api/workout-recommendations/recovery',
    serviceName: SERVICE_NAME,
    operation: 'fetch muscle recovery',
  });
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

/**
 * Ranked replacements for one exercise, best first — what turns Replace from a
 * blank search box into a shortlist.
 *
 * `source: 'local'` rows can be selected straight away; `source: 'external'`
 * rows are free-exercise-db results the server appended because the local
 * catalog was too thin to offer a real choice, and must be imported before use.
 * An empty list is a normal answer (an exercise with no primary muscle recorded
 * has nothing to rank against), not a failure.
 */
export const fetchAlternatives = async (
  exerciseId: string,
  limit = 10,
): Promise<AlternativeExercise[]> => {
  const response = await apiFetch<AlternativeExercisesResponse>({
    endpoint: `/api/workout-recommendations/alternatives/${exerciseId}?limit=${limit}`,
    serviceName: SERVICE_NAME,
    operation: 'fetch exercise alternatives',
  });
  return response.alternatives;
};

/**
 * Swap one exercise in the stored "Up Next" workout for another, in place.
 *
 * The server re-runs prescription for the incoming exercise, so it arrives with
 * its own sets, load, rest and warm-up ramp rather than inheriting the outgoing
 * exercise's. Both ids must be local uuids — an external suggestion is imported
 * first, which is what makes it one. The response is the whole updated
 * recommendation, so callers write it into the cache the way generate does.
 */
export const replaceRecommendationExercise = async (
  body: ReplaceRecommendationExerciseRequest,
): Promise<WorkoutRecommendation> => {
  return apiFetch<WorkoutRecommendation>({
    endpoint: '/api/workout-recommendations/replace',
    method: 'POST',
    body,
    serviceName: SERVICE_NAME,
    operation: 'replace workout recommendation exercise',
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
