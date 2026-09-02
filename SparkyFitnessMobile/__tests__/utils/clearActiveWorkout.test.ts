import { QueryClient } from '@tanstack/react-query';

import { clearActiveWorkout } from '../../src/utils/clearActiveWorkout';
import { useActiveWorkoutStore } from '../../src/stores/activeWorkoutStore';
import { patchRecommendationStatus } from '../../src/services/api/workoutRecommendationsApi';
import { workoutRecommendationQueryKey } from '../../src/hooks/queryKeys';
import { addLog } from '../../src/services/LogService';

jest.mock('../../src/services/api/workoutRecommendationsApi', () => ({
  patchRecommendationStatus: jest.fn(),
}));
jest.mock('../../src/services/LogService', () => ({
  addLog: jest.fn(),
}));
jest.mock('../../src/services/notifications', () => ({
  cancelRestNotification: jest.fn(),
}));

const mockPatch = patchRecommendationStatus as jest.MockedFunction<typeof patchRecommendationStatus>;
const mockAddLog = addLog as jest.MockedFunction<typeof addLog>;

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('clearActiveWorkout', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = new QueryClient();
    useActiveWorkoutStore.getState().clearWorkout();
    useActiveWorkoutStore.setState({ sessionId: 'session-1' });
  });

  it('clears the store and leaves the server alone when the workout was not a recommendation', () => {
    useActiveWorkoutStore.setState({ sourceRecommendationId: null });

    clearActiveWorkout(queryClient, 'abandoned');

    expect(useActiveWorkoutStore.getState().sessionId).toBeNull();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('hands an abandoned Today\'s Workout back by marking the recommendation active again', async () => {
    useActiveWorkoutStore.setState({ sourceRecommendationId: 'rec-1' });
    mockPatch.mockResolvedValue({ id: 'rec-1', status: 'active' } as never);
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    clearActiveWorkout(queryClient, 'abandoned');
    await flushPromises();

    expect(useActiveWorkoutStore.getState().sessionId).toBeNull();
    expect(useActiveWorkoutStore.getState().sourceRecommendationId).toBeNull();
    expect(mockPatch).toHaveBeenCalledWith('rec-1', 'active');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: workoutRecommendationQueryKey });
  });

  it('marks the recommendation completed when a fully-done workout is dismissed from the HUD', async () => {
    useActiveWorkoutStore.setState({ sourceRecommendationId: 'rec-1' });
    mockPatch.mockResolvedValue({ id: 'rec-1', status: 'completed' } as never);

    clearActiveWorkout(queryClient, 'completed');
    await flushPromises();

    expect(mockPatch).toHaveBeenCalledWith('rec-1', 'completed');
  });

  it('never surfaces a failed status update — the local clear already happened', async () => {
    useActiveWorkoutStore.setState({ sourceRecommendationId: 'rec-1' });
    mockPatch.mockRejectedValue(new Error('offline'));

    expect(() => clearActiveWorkout(queryClient, 'abandoned')).not.toThrow();
    await flushPromises();

    expect(useActiveWorkoutStore.getState().sessionId).toBeNull();
    expect(mockAddLog).toHaveBeenCalledWith(expect.stringContaining('offline'), 'WARNING');
  });
});
