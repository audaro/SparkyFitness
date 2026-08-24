import { useQuery } from '@tanstack/react-query';
import type { MuscleFreshnessResponse, MuscleRecoveryResponse } from '@workspace/shared';
import { fetchMuscleRecovery } from '../services/api/workoutRecommendationsApi';
import { freshnessPercent, freshnessTone, type FreshnessTone } from '../utils/muscleRecoveryDisplay';
import { muscleRecoveryQueryKey } from './queryKeys';
import { useRefetchOnFocus } from './useRefetchOnFocus';

/** One muscle's recovery, with the render-ready values derived once. */
export interface MuscleRecoveryItem extends MuscleFreshnessResponse {
  /** `freshness` as a whole percentage, 0–100. */
  percent: number;
  tone: FreshnessTone;
}

export interface MuscleRecovery extends Omit<MuscleRecoveryResponse, 'muscles'> {
  muscles: MuscleRecoveryItem[];
}

/**
 * Derived in `select` rather than in the hook body so React Query caches the
 * mapped array against the raw response — consumers get a stable reference and
 * the ×100 happens once per fetch, not once per render.
 */
function toRecovery(response: MuscleRecoveryResponse): MuscleRecovery {
  return {
    ...response,
    muscles: response.muscles.map((entry) => ({
      ...entry,
      percent: freshnessPercent(entry.freshness),
      tone: freshnessTone(entry.freshness),
    })),
  };
}

/**
 * Today's per-muscle recovery, freshest first — the server's own ranking, kept
 * as it arrives. Re-sorting here would put the tab's answer to "what can I
 * train?" out of step with the muscles the generator picks for the same reason.
 *
 * **`freshness` is 0.0–1.0.** Read `percent` for anything user-facing; nothing
 * downstream should multiply by 100 again.
 *
 * Refetches on focus because fatigue moves whenever a workout is logged
 * anywhere else in the app, and the default stale time is infinite — without it
 * the strip would show the day the tab was first opened on.
 */
export function useMuscleRecovery() {
  const query = useQuery<MuscleRecoveryResponse, Error, MuscleRecovery>({
    queryKey: muscleRecoveryQueryKey,
    queryFn: fetchMuscleRecovery,
    select: toRecovery,
  });

  useRefetchOnFocus(query.refetch, true);

  return {
    recovery: query.data ?? null,
    muscles: query.data?.muscles ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
