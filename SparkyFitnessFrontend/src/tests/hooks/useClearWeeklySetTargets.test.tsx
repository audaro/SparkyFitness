import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useClearWeeklySetTargetsMutation,
  useWeeklySetTargets,
  WEEKLY_SET_HISTORY_WEEKS,
  type WeeklySetTargets,
} from '@/hooks/Exercises/useWeeklySetTargets';
import {
  clearWeeklySetTargets,
  getWeeklySetTargets,
} from '@/api/Exercises/weeklySetTargets';
import { weeklySetTargetKeys } from '@/api/keys/exercises';

jest.mock('@/api/Exercises/weeklySetTargets', () => ({
  clearWeeklySetTargets: jest.fn(),
  getWeeklySetTargets: jest.fn(),
  updateWeeklySetTargets: jest.fn(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, d?: string) => d ?? key }),
}));

const mockGet = getWeeklySetTargets as jest.MockedFunction<
  typeof getWeeklySetTargets
>;
const mockClear = clearWeeklySetTargets as jest.MockedFunction<
  typeof clearWeeklySetTargets
>;

function makeWeek(custom: boolean): WeeklySetTargets {
  return {
    current: {
      week_start: '2026-09-13',
      week_end: '2026-09-19',
      groups: [],
      overall_percent: custom ? 50 : 100,
    },
    history: [],
    targets_are_custom: custom,
  } as WeeklySetTargets;
}

/**
 * Saving a training plan invalidates the weekly targets, so by the time the
 * clear runs there is already a read of the *pre-clear* week in flight. It was
 * started first and can land last, which would put the hand-set targets back
 * over a week the server no longer holds them for — the ring then claims
 * overrides that are gone, which is the exact failure the clear exists to fix.
 */
describe('clearing weekly set targets', () => {
  let queryClient: QueryClient;

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it('is not undone by the refetch the plan save started', async () => {
    mockGet.mockResolvedValueOnce(makeWeek(true));

    const { result } = renderHook(
      () => ({
        week: useWeeklySetTargets(),
        clear: useClearWeeklySetTargetsMutation(),
      }),
      { wrapper }
    );

    await waitFor(() =>
      expect(result.current.week.data?.targets_are_custom).toBe(true)
    );

    // The save's invalidation: a read of the still-custom week that will not
    // answer until after the clear has.
    let answerSlowRead: (week: WeeklySetTargets) => void = () => {};
    mockGet.mockImplementationOnce(
      () =>
        new Promise<WeeklySetTargets>((resolve) => {
          answerSlowRead = resolve;
        })
    );
    void queryClient.invalidateQueries({ queryKey: weeklySetTargetKeys.all });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));

    mockClear.mockResolvedValue(makeWeek(false));
    result.current.clear.mutate();
    await waitFor(() =>
      expect(mockClear).toHaveBeenCalledWith(WEEKLY_SET_HISTORY_WEEKS)
    );

    // …and only now does the older read come back, carrying the overrides the
    // clear just removed.
    answerSlowRead(makeWeek(true));

    await waitFor(() => expect(result.current.clear.isSuccess).toBe(true));
    expect(result.current.week.data?.targets_are_custom).toBe(false);
    expect(
      queryClient.getQueryData<WeeklySetTargets>(
        weeklySetTargetKeys.week(WEEKLY_SET_HISTORY_WEEKS)
      )?.targets_are_custom
    ).toBe(false);
  });
});
