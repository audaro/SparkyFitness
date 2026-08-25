import type { QueryClient } from '@tanstack/react-query';
import {
  exerciseHistoryQueryKey,
  exerciseHistoryResetQueryKey,
  exerciseStatsQueryKeyRoot,
  muscleRecoveryQueryKey,
  suggestedExercisesQueryKey,
  dailySummaryQueryKey,
  weeklySetTargetsRootQueryKey,
} from './queryKeys';

export function invalidateExerciseCache(queryClient: QueryClient, entryDate: string) {
  void queryClient.invalidateQueries({ queryKey: [...exerciseHistoryQueryKey] });
  queryClient.removeQueries({ queryKey: [...exerciseHistoryQueryKey], type: 'inactive' });
  queryClient.setQueryData(exerciseHistoryResetQueryKey, Date.now());
  void queryClient.invalidateQueries({ queryKey: [...suggestedExercisesQueryKey] });
  void queryClient.invalidateQueries({ queryKey: [...exerciseStatsQueryKeyRoot] });
  void queryClient.invalidateQueries({ queryKey: dailySummaryQueryKey(entryDate) });
  // Fatigue is computed straight from the sets this write just changed, and the
  // recovery query's stale time is infinite — without this the Exercise tab's
  // strip would keep the freshness it was last focused with. Autosave calls
  // this on every set, but the strip is unmounted during a live workout, so an
  // inactive query is only marked stale and refetches once, on next mount.
  void queryClient.invalidateQueries({ queryKey: muscleRecoveryQueryKey });
  // Working sets per training group are derived from the same sets, so the
  // week's progress is stale for exactly the same reason recovery is — the
  // Exercise tab's ring would otherwise keep counting the week as it stood
  // before this workout until the app was restarted. Invalidated by the root
  // key on purpose: the key carries the requested history window, and the tab
  // and the targets screen ask for different ones.
  void queryClient.invalidateQueries({ queryKey: weeklySetTargetsRootQueryKey });
}
