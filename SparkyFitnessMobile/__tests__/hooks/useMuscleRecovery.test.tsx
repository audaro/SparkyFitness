import { renderHook, waitFor } from '@testing-library/react-native';
import { MUSCLES } from '@workspace/shared';
import type { MuscleRecoveryResponse } from '@workspace/shared';

import { useMuscleRecovery } from '../../src/hooks/useMuscleRecovery';
import { fetchMuscleRecovery } from '../../src/services/api/workoutRecommendationsApi';
import { createQueryWrapper, createTestQueryClient } from './queryTestUtils';

jest.mock('../../src/services/api/workoutRecommendationsApi', () => ({
  fetchMuscleRecovery: jest.fn(),
}));

jest.mock('../../src/hooks/useRefetchOnFocus', () => ({
  useRefetchOnFocus: jest.fn(),
}));

const mockFetch = fetchMuscleRecovery as jest.MockedFunction<typeof fetchMuscleRecovery>;

function response(
  muscles: { muscle: string; freshness: number }[],
): MuscleRecoveryResponse {
  return {
    date: '2026-08-24',
    muscles: muscles.map(({ muscle, freshness }) => ({
      muscle,
      freshness,
      fatigue_sets: (1 - freshness) * 10,
      last_trained: freshness === 1 ? null : '2026-08-23',
    })),
    tunables: {
      window_days: 10,
      half_life_days: 2.5,
      secondary_weight: 0.5,
      full_fatigue_sets: 10,
    },
  };
}

/** What the server actually sends: the whole canonical vocabulary, freshest first. */
function fullVector(): MuscleRecoveryResponse {
  return response(
    MUSCLES.map((muscle, index) => ({
      muscle,
      freshness: 1 - index / MUSCLES.length,
    })),
  );
}

function render() {
  return renderHook(() => useMuscleRecovery(), {
    wrapper: createQueryWrapper(createTestQueryClient()),
  });
}

describe('useMuscleRecovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // The trap this hook exists to close: `freshness` is 0.0-1.0, so a surface
  // that renders it raw shows every muscle at 1%.
  it('converts freshness to a whole percentage', async () => {
    mockFetch.mockResolvedValue(
      response([
        { muscle: 'chest', freshness: 1 },
        { muscle: 'quadriceps', freshness: 0.844 },
        { muscle: 'hamstrings', freshness: 0.005 },
        { muscle: 'glutes', freshness: 0 },
      ]),
    );

    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.muscles.map((entry) => entry.percent)).toEqual([
      100, 84, 1, 0,
    ]);
    // The raw score survives alongside it — the muscle grid bands on the score.
    expect(result.current.muscles[1].freshness).toBe(0.844);
  });

  it('bands each score into a tone', async () => {
    mockFetch.mockResolvedValue(
      response([
        { muscle: 'chest', freshness: 0.66 },
        { muscle: 'lats', freshness: 0.65 },
        { muscle: 'quadriceps', freshness: 0.33 },
        { muscle: 'hamstrings', freshness: 0.32 },
      ]),
    );

    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.muscles.map((entry) => entry.tone)).toEqual([
      'fresh',
      'moderate',
      'moderate',
      'fatigued',
    ]);
  });

  it('returns every canonical muscle, in the order the server ranked them', async () => {
    const server = fullVector();
    mockFetch.mockResolvedValue(server);

    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.muscles).toHaveLength(MUSCLES.length);
    expect(result.current.muscles.map((entry) => entry.muscle)).toEqual(
      server.muscles.map((entry) => entry.muscle),
    );
  });

  it('passes the tunables through, since fatigue_sets is unreadable without them', async () => {
    mockFetch.mockResolvedValue(fullVector());

    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.recovery?.tunables.full_fatigue_sets).toBe(10);
    expect(result.current.recovery?.date).toBe('2026-08-24');
  });

  it('reports a failed read with no muscles rather than throwing', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));

    const { result } = render();
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.muscles).toEqual([]);
    expect(result.current.recovery).toBeNull();
  });
});
