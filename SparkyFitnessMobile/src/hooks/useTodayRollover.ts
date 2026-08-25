import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

/**
 * Keeps a day-scoped screen on "today" across midnight.
 *
 * `syncTodayRollover` only moves the selected day when the user was sitting on
 * today, so this is safe to call often — and it has to be called often, because
 * the two moments the day can turn over underneath a screen are different
 * events. Navigating back to the screen is a focus. The app resuming while the
 * screen is already focused is not: no focus fires, and a tab left open
 * overnight would keep yesterday's date at the top of a screen whose other
 * sections are about now.
 *
 * All three day-scoped screens (Exercise, Home, Food) share this, which is why
 * it is a hook rather than an effect in each of them.
 */
export function useTodayRollover(syncTodayRollover: () => void): void {
  useFocusEffect(
    useCallback(() => {
      syncTodayRollover();
    }, [syncTodayRollover])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      syncTodayRollover();
    });
    return () => subscription.remove();
  }, [syncTodayRollover]);
}
