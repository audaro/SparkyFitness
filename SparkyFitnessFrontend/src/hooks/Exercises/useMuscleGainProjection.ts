import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getMuscleGainProjection } from '@/api/Exercises/muscleGainProjection';
import { muscleGainProjectionKeys } from '@/api/keys/exercises';

// Pages may not import from `@/api` (enforced by no-restricted-imports), so the
// domain type reaches them through this hook module.
export type { MuscleGainProjection } from '@/api/Exercises/muscleGainProjection';

/**
 * The lean-mass projection for a horizon, in weeks.
 *
 * Keyed by the horizon because the server answers a different question for
 * each one — a year is not twelve weeks times four, and no client-side
 * arithmetic can turn one into the other.
 */
export const useMuscleGainProjection = (
  weeks: number,
  enabled: boolean = true
) => {
  const { t } = useTranslation();

  return useQuery({
    queryKey: muscleGainProjectionKeys.horizon(weeks),
    queryFn: () => getMuscleGainProjection(weeks),
    enabled,
    // The horizon is a control the user flips, and the card hides itself when
    // it has nothing to draw. Without this, asking for the year would unmount
    // the card mid-click and put it back a moment later.
    placeholderData: keepPreviousData,
    meta: {
      errorMessage: t(
        'muscleGainProjection.loadError',
        'Failed to load your projection.'
      ),
    },
  });
};
