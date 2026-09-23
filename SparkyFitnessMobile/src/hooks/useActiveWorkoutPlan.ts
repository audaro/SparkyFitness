import { useQuery } from '@tanstack/react-query';
import { fetchActiveWorkoutPlans } from '../services/api/workoutPlansApi';
import { activeWorkoutPlanQueryKey } from './queryKeys';
import { useRefetchOnFocus } from './useRefetchOnFocus';
import { getTodayDate } from '../utils/dateUtils';

export function useActiveWorkoutPlans(
  date?: string,
  options?: { enabled?: boolean }
) {
  const { enabled = true } = options ?? {};
  const queryDate = date || getTodayDate();

  const query = useQuery({
    queryKey: activeWorkoutPlanQueryKey(queryDate),
    queryFn: () => fetchActiveWorkoutPlans(queryDate),
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled,
  });

  useRefetchOnFocus(query.refetch, enabled);

  return {
    plans: query.data ?? [],
    plan: query.data?.[0] ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function useActiveWorkoutPlan(
  date?: string,
  options?: { enabled?: boolean }
) {
  return useActiveWorkoutPlans(date, options);
}
