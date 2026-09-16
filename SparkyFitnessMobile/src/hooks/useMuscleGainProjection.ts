import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
    // The horizon is a control the user flips, and the surfaces that render a
    // projection hide themselves when there is nothing to draw. Without this,
    // asking for the year would unmount the card mid-tap and put it back a
    // moment later somewhere else on the page.
    placeholderData: keepPreviousData,
  });

  return {
    projection: query.data,
    // True only while the data on hand belongs to a *different* horizon than
    // the one asked for, which is exactly when a caller must not present it as
    // the answer to the selected one.
    isPlaceholderData: query.isPlaceholderData,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
