import { useCSSVariable } from 'uniwind';

import type { FreshnessTone } from '../utils/muscleRecoveryDisplay';

/**
 * The colour each recovery band is drawn in.
 *
 * Kept in one place because freshness is rendered on two surfaces — the
 * recovery strip on the Exercise tab and the muscle grid on Pick Muscles. A
 * colour that drifted between them would say a muscle is fresh on one screen
 * and fatigued on the other.
 *
 * These are the semantic status colours, not the category palette the weekly
 * ring uses: "fatigued" is a caution, not a fourth category.
 */
export function useFreshnessToneColors(): Record<FreshnessTone, string> {
  const [fresh, moderate, fatigued] = useCSSVariable([
    '--color-icon-success',
    '--color-icon-warning',
    '--color-icon-danger',
  ]) as [string, string, string];

  return { fresh, moderate, fatigued };
}
