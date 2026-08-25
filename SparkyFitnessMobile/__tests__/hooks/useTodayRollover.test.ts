import { renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useTodayRollover } from '../../src/hooks/useTodayRollover';
import { useFocusEffect } from '@react-navigation/native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));

const mockUseFocusEffect = useFocusEffect as jest.MockedFunction<typeof useFocusEffect>;

describe('useTodayRollover', () => {
  let focusCallback: (() => void) | undefined;
  let appStateCallback: ((state: AppStateStatus) => void) | undefined;
  let removeListener: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    focusCallback = undefined;
    appStateCallback = undefined;
    mockUseFocusEffect.mockImplementation((callback) => {
      focusCallback = callback as () => void;
      callback();
    });
    removeListener = jest.fn();
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, handler) => {
        appStateCallback = handler as (state: AppStateStatus) => void;
        return { remove: removeListener } as ReturnType<typeof AppState.addEventListener>;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('syncs on focus', () => {
    const sync = jest.fn();

    renderHook(() => useTodayRollover(sync));

    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('syncs when the app returns to the foreground', () => {
    const sync = jest.fn();

    renderHook(() => useTodayRollover(sync));
    // The overnight case: the screen never lost focus, so nothing else asks
    // whether the calendar day has moved.
    appStateCallback!('active');

    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('ignores states other than active', () => {
    const sync = jest.fn();

    renderHook(() => useTodayRollover(sync));
    appStateCallback!('background');
    appStateCallback!('inactive');

    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('syncs on every focus, unthrottled', () => {
    const sync = jest.fn();

    renderHook(() => useTodayRollover(sync));
    focusCallback!();
    focusCallback!();

    // Unlike a refetch this costs nothing when the day has not turned over —
    // the store returns early — so there is no throttle to get wrong.
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it('removes its listener on unmount', () => {
    const { unmount } = renderHook(() => useTodayRollover(jest.fn()));

    unmount();

    expect(removeListener).toHaveBeenCalled();
  });
});
