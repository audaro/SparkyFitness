import { renderHook, waitFor, act } from '@testing-library/react-native';
import {
  useUpdateWeeklySetTargets,
  useWeeklySetTargets,
} from '../../src/hooks/useWeeklySetTargets';
import {
  fetchWeeklySetTargets,
  updateWeeklySetTargets,
  type WeeklySetTargetsResponse,
} from '../../src/services/api/weeklySetTargetsApi';
import { weeklySetTargetsQueryKey } from '../../src/hooks/queryKeys';
import { createTestQueryClient, createQueryWrapper } from './queryTestUtils';

jest.mock('../../src/services/api/weeklySetTargetsApi', () => ({
  fetchWeeklySetTargets: jest.fn(),
  updateWeeklySetTargets: jest.fn(),
}));

jest.mock('../../src/hooks/useRefetchOnFocus', () => ({
  useRefetchOnFocus: jest.fn(),
}));

const mockFetch = fetchWeeklySetTargets as jest.MockedFunction<
  typeof fetchWeeklySetTargets
>;
const mockUpdate = updateWeeklySetTargets as jest.MockedFunction<
  typeof updateWeeklySetTargets
>;

function response(
  targets: { push: number; pull: number; legs: number; core: number },
  custom = false,
): WeeklySetTargetsResponse {
  return {
    current: {
      week_start: '2026-08-23',
      week_end: '2026-08-29',
      groups: (['push', 'pull', 'legs', 'core'] as const).map((group) => ({
        group,
        completed: 0,
        target: targets[group],
        remaining: targets[group],
        percent: 0,
      })),
      overall_percent: 0,
    },
    history: [],
    targets_are_custom: custom,
  };
}

describe('useWeeklySetTargets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requests the history depth it is asked for', async () => {
    mockFetch.mockResolvedValue(response({ push: 11, pull: 11, legs: 11, core: 5 }));

    const { result } = renderHook(() => useWeeklySetTargets(4), {
      wrapper: createQueryWrapper(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockFetch).toHaveBeenCalledWith(4);
    expect(result.current.data?.current.groups).toHaveLength(4);
  });
});

describe('useUpdateWeeklySetTargets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // The server merges a partial map, so resending every group would clobber an
  // edit made elsewhere between load and save.
  it('sends only the group that changed', async () => {
    mockUpdate.mockResolvedValue(
      response({ push: 11, pull: 11, legs: 20, core: 5 }, true),
    );

    const { result } = renderHook(() => useUpdateWeeklySetTargets(2), {
      wrapper: createQueryWrapper(createTestQueryClient()),
    });

    await act(async () => {
      await result.current.mutateAsync({ legs: 20 });
    });

    expect(mockUpdate).toHaveBeenCalledWith({ legs: 20 }, 2);
  });

  // The response is the recomputed screen; writing it straight in avoids a
  // second round trip and a frame of stale numbers.
  it('writes the server response into the cache', async () => {
    const queryClient = createTestQueryClient();
    const saved = response({ push: 11, pull: 11, legs: 20, core: 5 }, true);
    mockUpdate.mockResolvedValue(saved);

    const { result } = renderHook(() => useUpdateWeeklySetTargets(2), {
      wrapper: createQueryWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ legs: 20 });
    });

    expect(queryClient.getQueryData(weeklySetTargetsQueryKey(2))).toEqual(saved);
  });

  // Stepping legs and then immediately tapping push puts two saves in flight.
  // Each response carries the whole recomputed screen, so if the slower first
  // one landed last it would put the pre-edit targets back on screen.
  it('ignores a slow response that lands after a newer save', async () => {
    const queryClient = createTestQueryClient();
    const stale = response({ push: 11, pull: 11, legs: 20, core: 5 }, true);
    const fresh = response({ push: 16, pull: 11, legs: 20, core: 5 }, true);

    let releaseFirst: (value: WeeklySetTargetsResponse) => void = () => {};
    mockUpdate
      .mockImplementationOnce(
        () =>
          new Promise<WeeklySetTargetsResponse>((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(fresh);

    const { result } = renderHook(() => useUpdateWeeklySetTargets(2), {
      wrapper: createQueryWrapper(queryClient),
    });

    await act(async () => {
      const first = result.current.mutateAsync({ legs: 20 });
      const second = result.current.mutateAsync({ push: 16 });
      await second;
      releaseFirst(stale);
      await first;
    });

    expect(queryClient.getQueryData(weeklySetTargetsQueryKey(2))).toEqual(fresh);
  });

  // The seq guard alone would drop the successful save on the floor: its
  // response is not the newest, and the newest never produced one. Only a
  // refetch after everything settles gets the screen back to the truth.
  it('refetches when a newer save fails after an older one succeeded', async () => {
    const queryClient = createTestQueryClient();
    const saved = response({ push: 11, pull: 11, legs: 20, core: 5 }, true);
    mockFetch.mockResolvedValue(saved);

    let releaseFirst: (value: WeeklySetTargetsResponse) => void = () => {};
    let rejectSecond: (reason: Error) => void = () => {};
    mockUpdate
      .mockImplementationOnce(
        () =>
          new Promise<WeeklySetTargetsResponse>((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<WeeklySetTargetsResponse>((_resolve, reject) => {
            rejectSecond = reject;
          }),
      );

    // The read hook has to be mounted too: an invalidate only refetches a query
    // something is actually observing.
    const { result } = renderHook(
      () => ({
        query: useWeeklySetTargets(2),
        update: useUpdateWeeklySetTargets(2),
      }),
      { wrapper: createQueryWrapper(queryClient) },
    );
    await waitFor(() => expect(result.current.query.isLoading).toBe(false));
    mockFetch.mockClear();

    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    // Both mutations have to reach their mutationFn before the resolvers above
    // are assigned; firing and settling in one act would reject a closure that
    // is still the initial no-op.
    await act(async () => {
      first = result.current.update.mutateAsync({ legs: 20 });
      second = result.current.update
        .mutateAsync({ push: 16 })
        .catch(() => undefined);
    });
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));

    await act(async () => {
      rejectSecond(new Error('network down'));
      await second;
      releaseFirst(saved);
      await first;
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(2));
  });

  it('surfaces a failed save without writing anything to the cache', async () => {
    const queryClient = createTestQueryClient();
    mockUpdate.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useUpdateWeeklySetTargets(2), {
      wrapper: createQueryWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ legs: 20 }).catch(() => undefined);
    });

    expect(
      queryClient.getQueryData(weeklySetTargetsQueryKey(2)),
    ).toBeUndefined();
  });
});
