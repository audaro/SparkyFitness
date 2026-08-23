import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import type { WorkoutRecommendationStatus } from '@workspace/shared';
import {
  fetchRecommendation,
  generateRecommendation,
  patchRecommendationStatus,
  type GenerateRecommendationPayload,
  type WorkoutRecommendation,
} from '../services/api/workoutRecommendationsApi';
import { ApiError } from '../services/api/errors';
import { workoutRecommendationQueryKey } from './queryKeys';

interface UseWorkoutRecommendationOptions {
  enabled?: boolean;
}

/**
 * The stored "Up Next" workout plus the generate/Swap mutation.
 *
 * `data` is `null` (not an error) before the user has ever generated one —
 * see `fetchRecommendation`. Generation writes the fresh row straight into the
 * cache rather than invalidating: the response IS the new row, and a refetch
 * would only ask the server to hand back what it just returned.
 */
export function useWorkoutRecommendation({
  enabled = true,
}: UseWorkoutRecommendationOptions = {}) {
  const queryClient = useQueryClient();

  const query = useQuery<WorkoutRecommendation | null>({
    queryKey: workoutRecommendationQueryKey,
    queryFn: fetchRecommendation,
    enabled,
  });

  const generate = useMutation({
    mutationFn: (body: GenerateRecommendationPayload = {}) =>
      generateRecommendation(body),
    onSuccess: (recommendation) => {
      queryClient.setQueryData(workoutRecommendationQueryKey, recommendation);
    },
    onError: (error) => {
      Toast.show({
        type: 'error',
        text1: 'Could not build a workout',
        // 422 is the engine reporting it had nothing to program with — a fresh
        // catalog, or a gym profile so narrow no exercise survives the filter.
        // That is the user's to fix, so it gets its own message.
        text2:
          error instanceof ApiError && error.statusCode === 422
            ? 'No exercises matched your gym equipment. Try another gym profile.'
            : 'Please try again.',
      });
    },
  });

  return {
    recommendation: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    generate: generate.mutate,
    generateAsync: generate.mutateAsync,
    isGenerating: generate.isPending,
  };
}

/**
 * Lifecycle marker, fired when a generated workout is started. Best-effort by
 * design: nothing server-side branches on the status yet, so a failure here
 * must never block or unwind a live workout that is already running.
 */
export function useUpdateRecommendationStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: WorkoutRecommendationStatus }) =>
      patchRecommendationStatus(id, status),
    onSuccess: (recommendation) => {
      queryClient.setQueryData(workoutRecommendationQueryKey, recommendation);
    },
    // Deliberately silent: see the note above.
    onError: () => {},
  });
}
