import { useQuery } from '@tanstack/react-query';
import { fetchLatestCheckIn } from '../services/api/measurementsApi';
import { getTodayDate } from '../utils/dateUtils';
import { latestCheckInQueryKey } from './queryKeys';
import { useRefetchOnFocus } from './useRefetchOnFocus';
import type { CheckInMeasurement } from '../types/measurements';

/**
 * The most recent check-in on or before today, each field carried forward
 * independently.
 *
 * For readers that want the latest known value rather than a particular day's
 * — "what do you weigh", not "what did you weigh on Tuesday". Refetched on
 * focus because a weigh-in logged elsewhere in the app would otherwise not
 * reach the screen until a restart.
 */
export function useLatestCheckIn(date: string = getTodayDate()) {
  const query = useQuery<CheckInMeasurement | null>({
    queryKey: latestCheckInQueryKey(date),
    queryFn: () => fetchLatestCheckIn(date),
  });

  useRefetchOnFocus(query.refetch, true);

  return {
    measurement: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
