import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getWeeklySetTargets,
  updateWeeklySetTargets,
  type WeeklySetTargetsMap,
} from '@/api/Exercises/weeklySetTargets';
import { weeklySetTargetKeys } from '@/api/keys/exercises';

// Pages may not import from `@/api` (enforced by no-restricted-imports), so the
// domain types reach them through this hook module.
export type {
  WeeklySetTargets,
  WeeklySetTargetsMap,
  MuscleGroup,
} from '@/api/Exercises/weeklySetTargets';

/** History weeks the card asks for. Twelve is the server's ceiling. */
export const WEEKLY_SET_HISTORY_WEEKS = 8;

export const useWeeklySetTargets = (
  enabled: boolean = true,
  historyWeeks: number = WEEKLY_SET_HISTORY_WEEKS
) => {
  const { t } = useTranslation();

  return useQuery({
    queryKey: weeklySetTargetKeys.week(historyWeeks),
    queryFn: () => getWeeklySetTargets(historyWeeks),
    enabled,
    meta: {
      errorMessage: t(
        'weeklySetTargets.loadError',
        'Failed to load your weekly targets.'
      ),
    },
  });
};

/**
 * Saves changed targets.
 *
 * Saves can overlap — stepping legs and then immediately editing push fires the
 * second request while the first is still out. Each response carries the whole
 * recomputed week, so an early one landing last would put the stale pre-edit
 * targets back on screen. Only the newest save writes to the cache; anything
 * that leaves the cache untrustworthy schedules a reconciling refetch for when
 * nothing is in flight.
 */
export const useUpdateWeeklySetTargetsMutation = (
  historyWeeks: number = WEEKLY_SET_HISTORY_WEEKS
) => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const latestSaveRef = useRef(0);
  const inFlightRef = useRef(0);
  // Set whenever the write-through alone cannot be trusted to leave the cache
  // holding what the server actually stored. Two ways that happens: a newer
  // save fails, so the older successful response was suppressed for a value
  // that never landed; or the server commits two overlapping patches in the
  // opposite order to the one the responses arrive in, so the response the
  // guard keeps was computed before the other patch was stored.
  const needsReconcileRef = useRef(false);

  return useMutation({
    mutationFn: (targets: WeeklySetTargetsMap) => {
      const saveId = ++latestSaveRef.current;
      inFlightRef.current += 1;
      if (inFlightRef.current > 1) needsReconcileRef.current = true;
      return updateWeeklySetTargets(targets, historyWeeks).then((response) => ({
        saveId,
        response,
      }));
    },
    onSuccess: ({ saveId, response }) => {
      // The server returns the recomputed week, so write it straight in rather
      // than invalidating and paying for a second round trip. The lone save —
      // much the common case — is fully served by this and never refetches.
      if (saveId === latestSaveRef.current) {
        queryClient.setQueryData(
          weeklySetTargetKeys.week(historyWeeks),
          response
        );
      }
    },
    onError: () => {
      needsReconcileRef.current = true;
    },
    onSettled: () => {
      inFlightRef.current -= 1;
      if (inFlightRef.current === 0 && needsReconcileRef.current) {
        needsReconcileRef.current = false;
        void queryClient.invalidateQueries({
          queryKey: weeklySetTargetKeys.week(historyWeeks),
        });
      }
    },
    meta: {
      successMessage: t('weeklySetTargets.saved', 'Targets saved'),
      errorMessage: t(
        'weeklySetTargets.saveError',
        'Could not save your targets.'
      ),
    },
  });
};
