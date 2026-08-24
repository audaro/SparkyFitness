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
      ]),
    );
  });
});
