import type { QueryClient } from '@tanstack/react-query';
import {
  exerciseHistoryQueryKey,
  exerciseHistoryResetQueryKey,
  exerciseStatsQueryKeyRoot,
  muscleRecoveryQueryKey,
  suggestedExercisesQueryKey,
  dailySummaryQueryKey,
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
}
