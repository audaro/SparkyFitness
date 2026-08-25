import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

type RefetchFn = () => void;

const DEFAULT_STALE_TIME = 30_000;

/**
 * Triggers a refetch when the user comes back to this screen, but only if
 * enough time has elapsed since the last refetch to avoid redundant network
 * requests on rapid tab switches.
 *
 * "Comes back" is two things, not one. Navigating to the screen is the obvious
 * one. The other is the app itself returning from the background while this
 * screen is already focused — no focus event fires there, so without the
 * AppState listener a tab left open overnight keeps whatever it fetched
 * yesterday, `staleTime` being `Infinity` app-wide. Both paths share the one
 * throttle, so a foreground return moments after a tab switch still costs one
 * request rather than two.
 *
 * A screen that is not focused when the app resumes deliberately does nothing:
 * it refetches when the user navigates to it, which is the focus path above.
 *
 * @param refetch - The refetch function from useQuery (stable reference per React Query)
 * @param enabled - Whether refetching is enabled (defaults to true)
 * @param staleTime - Minimum ms between refetches (defaults to 30 000)
 */
export function useRefetchOnFocus(
  refetch: RefetchFn,
  enabled: boolean = true,
  staleTime: number = DEFAULT_STALE_TIME,
): void {
  const lastRefetchedAt = useRef(-Infinity);
  const isFocused = useRef(false);

  const refetchIfStale = useCallback(() => {
    if (!enabled || Date.now() - lastRefetchedAt.current < staleTime) return;
    lastRefetchedAt.current = Date.now();
    refetch();
  }, [refetch, enabled, staleTime]);

  useFocusEffect(
    useCallback(() => {
      isFocused.current = true;
      refetchIfStale();
      return () => {
        isFocused.current = false;
      };
    }, [refetchIfStale])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !isFocused.current) return;
      refetchIfStale();
    });
    return () => subscription.remove();
  }, [refetchIfStale]);
}
