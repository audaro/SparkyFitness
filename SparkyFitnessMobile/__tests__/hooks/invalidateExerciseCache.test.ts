import { invalidateExerciseCache } from '../../src/hooks/invalidateExerciseCache';
import { createTestQueryClient } from './queryTestUtils';

describe('invalidateExerciseCache', () => {
  it('invalidates every cache a logged exercise can change', () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    invalidateExerciseCache(queryClient, '2026-08-24');

    const keys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ['exerciseHistory'],
        ['suggestedExercises'],
        ['exerciseStats'],
        ['dailySummary', '2026-08-24'],
        // Fatigue is derived from the sets this write just changed, and the
        // recovery query never goes stale on its own — without this the
        // Exercise tab's strip keeps the freshness it was last focused with.
        ['muscleRecovery'],
        // Same reason, same sets: the week's working-set counts move with the
        // workout that was just written.
        ['weeklySetTargets'],
      ]),
    );
  });

  it('invalidates weekly set targets by the root key, not one history window', () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['weeklySetTargets', 1], { current: 'tab' });
    queryClient.setQueryData(['weeklySetTargets', 8], { current: 'targets screen' });

    invalidateExerciseCache(queryClient, '2026-08-24');

    // The Exercise tab and the targets screen ask for different history
    // windows, so a key-exact invalidation would refresh one and strand the
    // other showing last week's totals.
    const stale = queryClient
      .getQueryCache()
      .findAll({ queryKey: ['weeklySetTargets'] })
      .map((query) => query.isStale());
    expect(stale).toHaveLength(2);
    expect(stale.every(Boolean)).toBe(true);
  });
});
