import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import Icon from './Icon';
import LiquidGlassSurface, {
  createLiquidGlassPillStyle,
} from './LiquidGlassSurface';
import { useNativeIOSTabsActive } from '../services/nativeTabBarPreference';
import {
  formatDurationSeconds,
  formatRestCountdown,
} from '../utils/workoutSession';

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

/** Matches `ActiveWorkoutRestBar`'s pill so the two read as one surface. */
const GLASS_BORDER_RADIUS = 28;

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
 * exclusive), and they share geometry rather than code so neither grows a
 * phase flag through its whole body. The chrome, the glass/docked split and
 * the ±15s step are copied so the handoff from hold to rest reads as one
 * surface changing phase.
 *
 * The primary control is pause, not stop: stopping logs the set at whatever it
 * reads, which is not undoable from here, so it sits to the side as a text
 * action while the fat centre target is the harmless one.
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
  const insets = useSafeAreaInsets();
  const usesGlass = useNativeIOSTabsActive();
  const [accentPrimary, textMuted, trackColor, chromeBorder] = useCSSVariable([
    '--color-accent-primary',
    '--color-text-muted',
    '--color-progress-track',
    '--color-chrome-border',
  ]) as [string, string, string, string];

  const timerColor = paused ? textMuted : accentPrimary;

  const body = (
    <View accessible={false}>
      <View
        className="h-1 rounded-full overflow-hidden mb-2"
        style={{ backgroundColor: trackColor }}
      >
        <View
          testID="hold-progress-fill"
          className="h-full rounded-full"
          style={{
            width: `${progress * 100}%`,
            backgroundColor: timerColor,
          }}
        />
      </View>

      <View className="flex-row items-center">
        <View className="flex-1 flex-row items-center" style={{ gap: 7 }}>
          <Pressable
            onPress={() => onAdjust(-15)}
            accessibilityRole="button"
            accessibilityLabel={t('activeWorkout.hold.shorten', {
              defaultValue: 'Shorten hold by 15 seconds',
            })}
            className="rounded-full bg-raised px-3 py-2"
          >
            <Text
              className="text-sm font-semibold text-text-primary"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {t('activeWorkout.hold.subtractSecondsShort', {
                defaultValue: '−{{seconds}}s',
                seconds: 15,
              })}
            </Text>
          </Pressable>
          <Pressable
            onPress={paused ? onResume : onPause}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={
              paused
                ? t('activeWorkout.hold.resume', {
                    defaultValue: 'Resume hold',
                  })
                : t('activeWorkout.hold.pause', { defaultValue: 'Pause hold' })
            }
            className="h-9 w-9 rounded-full bg-raised items-center justify-center"
          >
            <Icon
              name={paused ? 'play' : 'pause'}
              size={18}
              color={accentPrimary}
              weight="bold"
            />
          </Pressable>
        </View>

        <Text
          testID="hold-countdown"
          className="px-2 text-3xl font-bold"
          style={{ color: timerColor, fontVariant: ['tabular-nums'] }}
        >
          {formatRestCountdown(remainingMs)}
        </Text>

        <View
          className="flex-1 flex-row items-center justify-end"
          style={{ gap: 7 }}
        >
          <Pressable
            onPress={() => onAdjust(15)}
            accessibilityRole="button"
            accessibilityLabel={t('activeWorkout.hold.extend', {
              defaultValue: 'Extend hold by 15 seconds',
            })}
            className="rounded-full bg-raised px-3 py-2"
          >
            <Text
              className="text-sm font-semibold text-text-primary"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {t('activeWorkout.hold.addSecondsShort', {
                defaultValue: '+{{seconds}}s',
                seconds: 15,
              })}
            </Text>
          </Pressable>
          <Pressable
            onPress={onStop}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={t('activeWorkout.hold.stop', {
              defaultValue: 'Stop hold and log the set',
            })}
            className="h-9 w-9 rounded-full items-center justify-center"
            style={{ backgroundColor: accentPrimary }}
          >
            <Icon name="checkmark" size={16} color="#ffffff" weight="bold" />
          </Pressable>
        </View>
      </View>

      <View className="items-center mt-1.5">
        {label.length > 0 && (
          <Text
            numberOfLines={1}
            className="text-sm font-medium text-text-primary"
          >
            {label}
          </Text>
        )}
        <Text numberOfLines={1} className="text-xs text-text-secondary">
          {nextRestSec != null && nextRestSec > 0
            ? t('activeWorkout.hold.logsThenRest', {
                defaultValue: 'Logs at 0:00, then {{rest}} rest',
                rest: formatDurationSeconds(nextRestSec),
              })
            : t('activeWorkout.hold.logsAtZero', {
                defaultValue: 'Logs at 0:00',
              })}
        </Text>
      </View>
    </View>
  );

  if (usesGlass) {
    return (
      <View
        pointerEvents="box-none"
        className="absolute inset-x-0 bottom-0"
        style={{ paddingBottom: insets.bottom }}
      >
        <LiquidGlassSurface
          testID="hold-sheet-glass"
          style={createLiquidGlassPillStyle(chromeBorder, {
            borderRadius: GLASS_BORDER_RADIUS,
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: 12,
          })}
          colorScheme="auto"
          glassEffectStyle="regular"
          isInteractive
        >
          {body}
        </LiquidGlassSurface>
      </View>
    );
  }

  return (
    <View
      testID="hold-sheet-docked"
      className="bg-surface border-t border-border-subtle px-4 pt-2"
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
    >
      {body}
    </View>
  );
}

export default React.memo(ActiveWorkoutHoldSheet);
