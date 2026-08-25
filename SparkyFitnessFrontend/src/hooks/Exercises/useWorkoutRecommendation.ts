import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  generateWorkoutRecommendation,
  getWorkoutRecommendation,
} from '@/api/Exercises/workoutRecommendations';
import { workoutRecommendationKeys } from '@/api/keys/exercises';

// Pages may not import from `@/api` (enforced by no-restricted-imports), so the
// domain types reach them through this hook module.
export type {
  WorkoutRecommendation,
  GenerateRecommendationPayload,
} from '@/api/Exercises/workoutRecommendations';

/**
 * The stored "Up Next" workout.
 *
 * `data` is `null` — not an error — before the user has ever generated one; the
 * API client resolves the server's 404 to null so the first-run state renders a
 * Generate button rather than a failure.
 */
export const useWorkoutRecommendation = (enabled: boolean = true) => {
  const { t } = useTranslation();

  return useQuery({
    queryKey: workoutRecommendationKeys.current(),
    queryFn: getWorkoutRecommendation,
    enabled,
    meta: {
      errorMessage: t(
        'upNext.loadError',
        'Failed to load your suggested workout.'
      ),
    },
  });
};

/**
 * Generate, regenerate, or Swap the workout.
 *
 * The response IS the new row, so it is written straight into the cache instead
 * of invalidating — a refetch would only ask the server to hand back what it
 * just returned.
 *
 * A 422 is the engine reporting it had nothing to program with: a catalog too
 * thin, or a gym profile so narrow no exercise survives the filter. The server
 * says which, and `apiCall` surfaces that message verbatim, so it is not
 * restated here.
 */
export const useGenerateWorkoutRecommendationMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: generateWorkoutRecommendation,
    onSuccess: (recommendation) => {
      queryClient.setQueryData(
        workoutRecommendationKeys.current(),
        recommendation
      );
    },
    meta: {
      errorMessage: t('upNext.generateError', 'Could not build a workout.'),
    },
  });
};
