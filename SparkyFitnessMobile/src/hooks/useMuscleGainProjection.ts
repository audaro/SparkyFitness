import { useQuery } from '@tanstack/react-query';
import {
  fetchMuscleGainProjection,
  type MuscleGainProjection,
} from '../services/api/muscleGainProjectionApi';
import { muscleGainProjectionQueryKey } from './queryKeys';

/**
 * The lean-mass projection for a horizon, in weeks.
 *
 * Keyed by the horizon because the server answers a different question for
 * each one, and the plan screen offers a year alongside the twelve-week
 * default. Not refetched on focus: the inputs are a weigh-in and four weeks of
 * completed training, neither of which changes while the user is looking at it.
 */
export function useMuscleGainProjection(weeks: number, enabled = true) {
  const query = useQuery<MuscleGainProjection>({
    queryKey: muscleGainProjectionQueryKey(weeks),
    queryFn: () => fetchMuscleGainProjection(weeks),
    enabled,
  });

  return {
    projection: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
