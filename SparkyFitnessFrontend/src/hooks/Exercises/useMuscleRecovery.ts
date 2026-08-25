import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  freshnessPercent,
  freshnessTone,
  type FreshnessTone,
  type MuscleFreshnessResponse,
} from '@workspace/shared';
import { getMuscleRecovery } from '@/api/Exercises/workoutRecommendations';
import { muscleRecoveryKeys } from '@/api/keys/exercises';
import { useActiveUser } from '@/contexts/ActiveUserContext';

export type { FreshnessTone } from '@workspace/shared';

/** One muscle's recovery, with the render-ready values derived once. */
export interface MuscleRecoveryItem extends MuscleFreshnessResponse {
  /** `freshness` as a whole percentage, 0–100. */
  percent: number;
  tone: FreshnessTone;
}

/**
 * Today's per-muscle recovery, freshest first — the server's own ranking, kept
 * as it arrives. Re-sorting here would put the card's answer to "what can I
 * train?" out of step with the muscles the generator picks for the same reason.
 *
 * **`freshness` is 0.0–1.0, not a percentage.** Read `percent` for anything
 * user-facing; nothing downstream should multiply by 100 again. The mapping
 * happens in `select` so React Query caches it against the raw response —
 * consumers get a stable reference and the ×100 runs once per fetch rather than
 * once per render.
 */
export const useMuscleRecovery = (enabled: boolean = true) => {
  const { t } = useTranslation();
  const { activeUserId } = useActiveUser();

  const query = useQuery({
    queryKey: muscleRecoveryKeys.current(activeUserId),
    queryFn: getMuscleRecovery,
    enabled,
    select: (response) =>
      response.muscles.map(
        (entry): MuscleRecoveryItem => ({
          ...entry,
          percent: freshnessPercent(entry.freshness),
          tone: freshnessTone(entry.freshness),
        })
      ),
    meta: {
      errorMessage: t(
        'muscleRecovery.loadError',
        'Failed to load your recovery.'
      ),
    },
  });

  return { ...query, muscles: query.data ?? [] };
};
