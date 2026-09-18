import React from 'react';
import { useTranslation } from 'react-i18next';

import WorkoutTimerSheet from './WorkoutTimerSheet';
import { formatDurationSeconds } from '../utils/workoutSession';

interface ActiveWorkoutHoldSheetProps {
  /** Ms left on the hold (see `useHoldCountdown`). */
  remainingMs: number;
  /** Fraction of the hold remaining, 0..1. */
  progress: number;
  paused: boolean;
  /** What is being held, e.g. "Plank · Set 1". */
  label: string;
  /**
   * Seconds of rest that will start once the hold logs. Null when the set is
   * the last one, or rests back-to-back into a superset partner.
   */
  nextRestSec?: number | null;
  onAdjust: (deltaSec: number) => void;
  onPause: () => void;
  onResume: () => void;
  /** Ends the hold and logs the set with the time actually held. */
  onStop: () => void;
}

/**
 * The docked sheet for a timed set's work phase — a plank's 45s, an interval's
 * hold. Deliberately a SIBLING of `ActiveWorkoutRestBar` rather than a mode of
 * it: the two never render together (the store makes hold and rest mutually
 * exclusive), and they share `WorkoutTimerSheet`'s geometry rather than their
 * bodies, so neither grows a phase flag through its whole body.
 *
 * The primary control is pause, not stop: stopping logs the set at whatever it
 * reads, which is not undoable from here, so it sits in the eyebrow as a text
 * action while the fat centre target is the harmless one. That is also why the
 * hold passes no footer action — the rest sheet's footer logs the on-deck set
 * early, and the equivalent here is Stop, which already has its place.
 */
function ActiveWorkoutHoldSheet({
  remainingMs,
  progress,
  paused,
  label,
  nextRestSec,
  onAdjust,
  onPause,
  onResume,
  onStop,
}: ActiveWorkoutHoldSheetProps) {
  const { t } = useTranslation();

  const afterZero =
    nextRestSec != null && nextRestSec > 0
      ? t('activeWorkout.hold.logsThenRest', {
          defaultValue: 'Logs at 0:00, then {{rest}} rest',
          rest: formatDurationSeconds(nextRestSec),
        })
      : t('activeWorkout.hold.logsAtZero', { defaultValue: 'Logs at 0:00' });

  return (
    <WorkoutTimerSheet
      phase="hold"
      remainingMs={remainingMs}
      progress={progress}
      paused={paused}
      hint={
        label.length > 0
          ? t('activeWorkout.hold.holdingHint', {
              defaultValue: '{{label}} · {{afterZero}}',
              label,
              afterZero,
            })
          : afterZero
      }
      onAdjust={onAdjust}
      onPause={onPause}
      onResume={onResume}
      onDismiss={onStop}
      testIDs={{
        fill: 'hold-progress-fill',
        countdown: 'hold-countdown',
        glass: 'hold-sheet-glass',
        docked: 'hold-sheet-docked',
      }}
    />
  );
}

export default React.memo(ActiveWorkoutHoldSheet);
