import type { QueryClient } from '@tanstack/react-query';
import {
  caffeineActiveQueryKey,
  caffeineActiveRootQueryKey,
  dailySummaryQueryKey,
  dailySummaryRootQueryKey,
  foodsQueryKey,
  waterIntakeLogQueryKey,
} from './queryKeys';

export function invalidateFoodCache(
  queryClient: QueryClient,
  entryDate?: string
) {
  if (entryDate) {
    void queryClient.invalidateQueries({
      queryKey: dailySummaryQueryKey(entryDate),
      refetchType: 'all',
    });
    void queryClient.invalidateQueries({
      queryKey: caffeineActiveQueryKey(entryDate),
      refetchType: 'all',
    });
    void queryClient.invalidateQueries({
      queryKey: waterIntakeLogQueryKey(entryDate),
      refetchType: 'all',
    });
  } else {
    void queryClient.invalidateQueries({
      queryKey: dailySummaryRootQueryKey,
      refetchType: 'all',
    });
    void queryClient.invalidateQueries({
      queryKey: caffeineActiveRootQueryKey,
      refetchType: 'all',
    });
  }
  void queryClient.invalidateQueries({
    queryKey: [...foodsQueryKey],
  });
}
