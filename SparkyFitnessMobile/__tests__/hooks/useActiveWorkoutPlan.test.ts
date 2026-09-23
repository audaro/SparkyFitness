import { renderHook, waitFor } from '@testing-library/react-native';
import {
  useActiveWorkoutPlan,
  useActiveWorkoutPlans,
} from '../../src/hooks/useActiveWorkoutPlan';
import { fetchActiveWorkoutPlans } from '../../src/services/api/workoutPlansApi';
import {
  createTestQueryClient,
  createQueryWrapper,
  type QueryClient,
} from './queryTestUtils';

jest.mock('../../src/services/api/workoutPlansApi', () => ({
  fetchActiveWorkoutPlans: jest.fn(),
  fetchActiveWorkoutPlan: jest.fn(),
}));

jest.mock('../../src/hooks/useRefetchOnFocus', () => ({
  useRefetchOnFocus: jest.fn(),
}));

const mockFetchActivePlans = fetchActiveWorkoutPlans as jest.MockedFunction<
  typeof fetchActiveWorkoutPlans
>;

describe('useActiveWorkoutPlan', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('returns null plan when loading', () => {
    mockFetchActivePlans.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useActiveWorkoutPlan('2026-09-21'), {
      wrapper: createQueryWrapper(queryClient),
    });

    expect(result.current.plan).toBeNull();
    expect(result.current.plans).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it('returns active plan from API', async () => {
    const data = {
      id: 'plan-1',
      user_id: 'user-1',
      plan_name: 'PPL Cycle',
      schedule_type: 'sequential' as const,
      start_date: '2026-09-01',
      is_active: true,
      next_assignment: {
        id: 'asgn-1',
        template_id: 'plan-1',
        day_of_week: null,
        sort_order: 0,
        workout_preset_id: 'preset-1',
        workout_preset_name: 'Push Day',
        sets: [],
      },
      sequence_position: { current: 1, total: 3 },
    };
    mockFetchActivePlans.mockResolvedValue([data] as any);

    const { result } = renderHook(() => useActiveWorkoutPlans('2026-09-21'), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.plan).toEqual(data);
      expect(result.current.plans).toEqual([data]);
    });
    expect(result.current.isLoading).toBe(false);
  });

  it('does not fetch when enabled is false', () => {
    const { result } = renderHook(
      () => useActiveWorkoutPlan('2026-09-21', { enabled: false }),
      {
        wrapper: createQueryWrapper(queryClient),
      }
    );

    expect(mockFetchActivePlans).not.toHaveBeenCalled();
    expect(result.current.plan).toBeNull();
  });

  it('sets isError on failure', async () => {
    mockFetchActivePlans.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useActiveWorkoutPlan('2026-09-21'), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
