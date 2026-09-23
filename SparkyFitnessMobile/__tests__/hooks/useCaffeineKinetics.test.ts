import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useCaffeineKinetics } from '../../src/hooks/useCaffeineKinetics';
import { fetchActiveCaffeine } from '../../src/services/api/caffeineApi';
import {
  createTestQueryClient,
  createQueryWrapper,
  type QueryClient,
} from './queryTestUtils';

jest.mock('../../src/services/api/caffeineApi', () => ({
  fetchActiveCaffeine: jest.fn(),
}));

const mockFetchActiveCaffeine = fetchActiveCaffeine as jest.MockedFunction<
  typeof fetchActiveCaffeine
>;

describe('useCaffeineKinetics', () => {
  let queryClient: QueryClient;
  const testDate = '2026-09-18';

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  test('fetches active caffeine kinetics and provides refetch function', async () => {
    mockFetchActiveCaffeine.mockResolvedValue({
      half_life_hours: 5,
      target_bedtime: '22:30',
      bedtime_at: '2026-09-18T22:30:00.000Z',
      doses: [
        {
          at: '2026-09-18T08:00:00.000Z',
          mg: 150,
          name: 'Coffee',
          is_estimated: false,
        },
      ],
      active_mg_now: 45,
      at_bedtime_mg: 10,
      latest_safe_dose_time: '16:00',
      cutoff_state: 'by',
      bedtime_headroom_mg: 90,
      cutoff_dose_mg: 100,
      threshold_mg: 100,
      has_estimated_times: false,
    });

    const { result } = renderHook(() => useCaffeineKinetics(testDate), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.kinetics?.active_mg_now).toBe(45);
    expect(typeof result.current.refetch).toBe('function');

    mockFetchActiveCaffeine.mockResolvedValueOnce({
      half_life_hours: 5,
      target_bedtime: '22:30',
      bedtime_at: '2026-09-18T22:30:00.000Z',
      doses: [
        {
          at: '2026-09-18T08:00:00.000Z',
          mg: 150,
          name: 'Coffee',
          is_estimated: false,
        },
        {
          at: '2026-09-18T14:00:00.000Z',
          mg: 100,
          name: 'Energy Drink',
          is_estimated: false,
        },
      ],
      active_mg_now: 120,
      at_bedtime_mg: 35,
      latest_safe_dose_time: '16:00',
      cutoff_state: 'by',
      bedtime_headroom_mg: 65,
      cutoff_dose_mg: 100,
      threshold_mg: 100,
      has_estimated_times: false,
    });

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.kinetics?.active_mg_now).toBe(120);
    });
  });
});
