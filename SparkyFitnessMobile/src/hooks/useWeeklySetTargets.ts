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
  const inFlightRef = useRef(0);
  // Set whenever the write-through alone cannot be trusted to leave the cache
  // holding what the server actually stored. Two ways that happens: a newer
  // save fails, so the older successful response was suppressed for a value
  // that never landed; or the server commits two overlapping patches in the
  // opposite order to the one the responses arrive in, so the response the
  // guard keeps was computed before the other patch was stored. Both converge
  // once nothing is in flight and the canonical query is refetched.
  const needsReconcileRef = useRef(false);

  return useMutation({
    mutationFn: (targets: Partial<Record<MuscleGroup, number>>) => {
      const saveId = ++latestSaveRef.current;
      inFlightRef.current += 1;
      if (inFlightRef.current > 1) needsReconcileRef.current = true;
      return updateWeeklySetTargets(targets, historyWeeks).then((response) => ({
        saveId,
        response,
      }));
    },
    onSuccess: ({ saveId, response }) => {
      // The server returns the recomputed screen, so write it straight in
      // rather than invalidating and paying for a second round trip. The lone
      // save — much the common case — is fully served by this and never
      // refetches.
      if (saveId === latestSaveRef.current) {
        queryClient.setQueryData(
          weeklySetTargetsQueryKey(historyWeeks),
          response,
        );
      }
      Toast.show({ type: 'success', text1: 'Targets saved' });
    },
    onError: () => {
      needsReconcileRef.current = true;
      Toast.show({
        type: 'error',
        text1: 'Could not save targets',
        text2: 'Please check your connection and try again.',
      });
    },
    onSettled: () => {
      inFlightRef.current -= 1;
      if (inFlightRef.current === 0 && needsReconcileRef.current) {
        needsReconcileRef.current = false;
        void queryClient.invalidateQueries({
          queryKey: weeklySetTargetsQueryKey(historyWeeks),
        });
      }
    },
  });
}
