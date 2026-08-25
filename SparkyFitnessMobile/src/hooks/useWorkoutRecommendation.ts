import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import type {
  AlternativeExercise,
  ReplaceRecommendationExerciseRequest,
  WorkoutRecommendationStatus,
} from '@workspace/shared';
import {
  fetchAlternatives,
  fetchRecommendation,
  generateRecommendation,
  patchRecommendationStatus,
  replaceRecommendationExercise,
  type GenerateRecommendationPayload,
  type WorkoutRecommendation,
} from '../services/api/workoutRecommendationsApi';
import { ApiError, getApiErrorMessage } from '../services/api/errors';
import {
  exerciseAlternativesQueryKey,
  workoutRecommendationQueryKey,
} from './queryKeys';
import { useRefetchOnFocus } from './useRefetchOnFocus';

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

  // The stored row is the server's answer to "what should this user train
  // today", so it goes stale on a day rollover and on a workout generated from
  // another device — neither of which the client can see. `staleTime` is
  // `Infinity` app-wide, so without this the card holds whatever it fetched at
  // launch. Generation still writes its response straight into the cache; the
  // shared 30s throttle keeps a focus right after that from asking again.
  useRefetchOnFocus(query.refetch, enabled);

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

/**
 * Ranked replacements for one exercise — the Suggested section on the exercise
 * search screen when it was opened to replace something.
 *
 * Disabled until an exercise is named, so the same screen reached from Add
 * costs nothing. Never `throwOnError`: a failed lookup should leave the user
 * with a plain search, not an error screen in place of one.
 */
export function useExerciseAlternatives(exerciseId: string | undefined) {
  const query = useQuery<AlternativeExercise[]>({
    queryKey: exerciseAlternativesQueryKey(exerciseId ?? ''),
    queryFn: () => fetchAlternatives(exerciseId as string),
    enabled: Boolean(exerciseId),
  });

  return {
    alternatives: query.data ?? [],
    isLoading: query.isLoading && Boolean(exerciseId),
    isError: query.isError,
  };
}

/**
 * Swap one exercise in the stored workout for another.
 *
 * The response is the whole re-prescribed recommendation, so it goes straight
 * into the cache — same reasoning as generate: the server just handed back the
 * new state, and a refetch would only ask for it again.
 */
export function useReplaceRecommendationExercise() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ReplaceRecommendationExerciseRequest) =>
      replaceRecommendationExercise(body),
    onSuccess: (recommendation) => {
      queryClient.setQueryData(workoutRecommendationQueryKey, recommendation);
    },
    onError: (error) => {
      Toast.show({
        type: 'error',
        text1: 'Could not replace that exercise',
        // 422 is the server refusing a swap it cannot make — the exercise is
        // already in the workout, or is not in the catalog. Its message says
        // which, and it is the user's to act on, so surface it verbatim.
        text2:
          (error instanceof ApiError && error.statusCode === 422
            ? getApiErrorMessage(error)
            : null) ?? 'Please try again.',
      });
    },
  });
}
