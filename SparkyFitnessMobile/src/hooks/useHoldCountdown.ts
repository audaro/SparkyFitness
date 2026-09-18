import { useEffect, useState } from 'react';

import { useActiveWorkoutStore } from '../stores/activeWorkoutStore';

export interface HoldCountdown {
  state: 'idle' | 'holding' | 'paused';
  /** The set being held, or null when idle. */
  setId: string | null;
  /** Ms left on the hold — live while holding, frozen while paused, 0 when idle. */
  remainingMs: number;
  /** Fraction of the hold remaining, clamped to 0..1. */
  progress: number;
}

/**
 * Hold-timer display state, the sibling of `useRestCountdown` and deliberately
 * the same shape. `remainingMs` reads `Date.now()` fresh at render time so the
 * first render after a hold starts is never stale; the hook's 1s interval
 * exists only to force re-renders. The holding → logged transition itself is
 * owned by the store's deadline timer, not by consumers of this hook.
 *
 * Pass `selfTick: false` when the calling component already re-renders at
 * least once per second (the active-workout screen's elapsed clock) so a
 * second interval isn't stacked on top of it.
 */
export function useHoldCountdown(opts?: { selfTick?: boolean }): HoldCountdown {
  const selfTick = opts?.selfTick ?? true;
  const state = useActiveWorkoutStore((s) => s.hold.state);
  const setId = useActiveWorkoutStore((s) => s.hold.setId);
  const endsAt = useActiveWorkoutStore((s) => s.hold.endsAt);
  const pausedRemainingMs = useActiveWorkoutStore(
    (s) => s.hold.pausedRemainingMs
  );
  const targetSec = useActiveWorkoutStore((s) => s.hold.targetSec);

  const [, setTick] = useState(0);
  useEffect(() => {
    if (!selfTick || state !== 'holding') return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [selfTick, state]);

  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const remainingMs =
    state === 'holding' && endsAt != null
      ? Math.max(0, endsAt - now)
      : state === 'paused' && pausedRemainingMs != null
        ? pausedRemainingMs
        : 0;
  // `adjustHold` moves `targetSec` with the deadline, so this stays in range
  // on its own; the clamp is belt-and-braces against a restored hold whose
  // target was edited underneath it.
  const progress =
    targetSec > 0
      ? Math.max(0, Math.min(1, remainingMs / (targetSec * 1000)))
      : 0;

  return { state, setId, remainingMs, progress };
}
