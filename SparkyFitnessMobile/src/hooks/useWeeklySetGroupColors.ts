import { useCSSVariable } from 'uniwind';

import type { MuscleGroup } from '../services/api/weeklySetTargetsApi';

/**
 * The colour each training group is drawn in, shared by every surface that
 * renders the weekly-set hexagon ring.
 *
 * Kept in one place because the ring appears at two sizes on two screens: the
 * summary on the Exercise tab and the full breakdown on WeeklySetTargetsScreen.
 * A colour that drifted between them would read as two unrelated charts.
 */
export function useWeeklySetGroupColors(): Record<MuscleGroup, string> {
  const [push, pull, legs, core] = useCSSVariable([
    '--color-cat-orange',
    '--color-cat-pink',
    '--color-cat-teal',
    '--color-cat-violet',
  ]) as [string, string, string, string];

  return { push, pull, legs, core };
}
