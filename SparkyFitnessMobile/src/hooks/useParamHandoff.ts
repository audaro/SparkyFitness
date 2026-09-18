import { useEffect, useRef } from 'react';

/**
 * Consume a value another screen handed back through `setParams`.
 *
 * React Navigation params persist, so the value alone cannot say "this is new";
 * the nonce does. Each distinct nonce fires `onValue` exactly once, so coming
 * back to a screen that still carries an old handoff is inert.
 */
export function useParamHandoff<T>(
  value: T | undefined,
  nonce: number | undefined,
  onValue: (value: T) => void
): void {
  const lastNonceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (value === undefined || !nonce || nonce === lastNonceRef.current) return;
    lastNonceRef.current = nonce;
    onValue(value);
  }, [value, nonce, onValue]);
}
