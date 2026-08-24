import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import {
  fetchWeeklySetTargets,
  updateWeeklySetTargets,
  type MuscleGroup,
  type WeeklySetTargetsResponse,
} from '../services/api/weeklySetTargetsApi';
import { weeklySetTargetsQueryKey } from './queryKeys';
import { useRefetchOnFocus } from './useRefetchOnFocus';

/** History weeks the screen asks for. Twelve is the server's ceiling. */
export const WEEKLY_SET_HISTORY_WEEKS = 8;

export function useWeeklySetTargets(
  historyWeeks: number = WEEKLY_SET_HISTORY_WEEKS,
) {
  const query = useQuery<WeeklySetTargetsResponse>({
    queryKey: weeklySetTargetsQueryKey(historyWeeks),
    queryFn: () => fetchWeeklySetTargets(historyWeeks),
  });

  // Sets logged elsewhere in the app land here, and the default stale time is
  // infinite, so without this the screen would show the week it was first
  // opened on until the app restarted.
  useRefetchOnFocus(query.refetch, true);

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/**
 * Saves changed targets. Sends only the groups that actually changed, because
 * the server merges a partial map — resending all four would overwrite an edit
 * made on another device between load and save.
 */
export function useUpdateWeeklySetTargets(
  historyWeeks: number = WEEKLY_SET_HISTORY_WEEKS,
) {
  const queryClient = useQueryClient();
  // Saves can overlap: stepping legs and then immediately tapping push fires
  // the second request while the first is still out. Each response carries the
  // whole recomputed screen, so an early one landing last would put the stale
  // pre-edit targets back on screen. Only the newest save writes to the cache.
  const latestSaveRef = useRef(0);

  return useMutation({
    mutationFn: (targets: Partial<Record<MuscleGroup, number>>) => {
      const saveId = ++latestSaveRef.current;
      return updateWeeklySetTargets(targets, historyWeeks).then((response) => ({
        saveId,
        response,
      }));
    },
    onSuccess: ({ saveId, response }) => {
      // The server returns the recomputed screen, so write it straight in
      // rather than invalidating and paying for a second round trip.
      if (saveId === latestSaveRef.current) {
        queryClient.setQueryData(
          weeklySetTargetsQueryKey(historyWeeks),
          response,
        );
      }
      Toast.show({ type: 'success', text1: 'Targets saved' });
    },
    onError: () => {
      Toast.show({
        type: 'error',
        text1: 'Could not save targets',
        text2: 'Please check your connection and try again.',
      });
    },
  });
}
