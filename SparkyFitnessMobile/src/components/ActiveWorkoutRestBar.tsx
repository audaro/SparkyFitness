import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import Icon from './Icon';
import LiquidGlassSurface, {
  createLiquidGlassPillStyle,
} from './LiquidGlassSurface';
import WorkoutTimerSheet from './WorkoutTimerSheet';
import { useNativeIOSTabsActive } from '../services/nativeTabBarPreference';

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

/**
 * Scroll clearance the workout log needs above the floating glass variant of
 * the READY state so the last card and the End Workout button can scroll out
 * from under the pill (content height ≈ 112 + the pill's bottom gap + breathing
 * room). While a rest is actually running the surface is the much taller
 * `WorkoutTimerSheet`; that one has `TIMER_SHEET_GLASS_CLEARANCE`.
 */
export const REST_BAR_GLASS_CLEARANCE = 128;

/**
 * Taller than the HUD's stadium pill, so a matching 999 radius would curve
 * into the on-deck row's corners; this keeps the same glass language with
 * corners the content clears.
 */
const GLASS_BORDER_RADIUS = 28;

interface ActiveWorkoutRestBarProps {
  remainingMs: number;
  /** Fraction of the rest remaining, 0..1 (see `useRestCountdown`). */
  progress: number;
  state: 'ready' | 'resting' | 'paused';
  /** What's up next, e.g. "Incline DB Press · Set 3". */
  label: string;
  /** Target load for the on-deck set, e.g. "135 lbs × 8". Null hides the line. */
  nextSetText?: string | null;
  /** Number of the on-deck set, for the sheet's "Log set N now" action. */
  nextSetNumber?: number | null;
  onAdjust: (deltaSec: number) => void;
  onSkip: () => void;
  onPause: () => void;
  onResume: () => void;
  /** Completes the on-deck set — the primary action in both states. */
  onCompleteSet: () => void;
  /** Taps on the bar outside its controls (the buttons claim their own). */
  onPressBar?: () => void;
}

/**
 * The active workout's bottom surface, in two shapes.
 *
 * While a rest timer exists (resting or paused) it is the rest **sheet** —
 * `WorkoutTimerSheet`, the same geometry the hold sheet uses, with REST in the
 * eyebrow, what is on deck under the countdown, and a footer that logs the
 * on-deck set without waiting the clock out.
 *
 * When no timer is running (ready) it stays the compact on-deck bar — set +
 * target on the left, a Complete Set button on the right — giving a fixed thumb
 * target between rests without a display-size countdown reading 0:00 above it.
 * The screen hides the bar entirely once no on-deck set remains.
 *
 * Chrome follows the workout HUD's: with Liquid Glass tabs active the ready bar
 * is a floating glass pill overlaying the log (the screen reserves
 * `REST_BAR_GLASS_CLEARANCE` of scroll padding for it); otherwise it is a
 * bottom-docked strip in normal flow. The sheet makes the same split itself.
 */
function ActiveWorkoutRestBar({
  remainingMs,
  progress,
  state,
  label,
  nextSetText,
  nextSetNumber,
  onAdjust,
  onSkip,
  onPause,
  onResume,
  onCompleteSet,
  onPressBar,
}: ActiveWorkoutRestBarProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const usesGlass = useNativeIOSTabsActive();
  const [accentPrimary, chromeBorder] = useCSSVariable([
    '--color-accent-primary',
    '--color-chrome-border',
  ]) as [string, string];

  if (state !== 'ready') {
    const hasTarget = nextSetText != null && nextSetText.length > 0;
    return (
      <WorkoutTimerSheet
        phase="rest"
        remainingMs={remainingMs}
        progress={progress}
        paused={state === 'paused'}
        hint={
          label.length === 0
            ? null
            : hasTarget
              ? t('activeWorkout.rest.thenNext', {
                  defaultValue: 'Then {{label}} · {{target}}',
                  label,
                  target: nextSetText,
                })
              : t('activeWorkout.rest.thenNextNoTarget', {
                  defaultValue: 'Then {{label}}',
                  label,
                })
        }
        onAdjust={onAdjust}
        onPause={onPause}
        onResume={onResume}
        onDismiss={onSkip}
        footer={
          nextSetNumber == null
            ? null
            : {
                label: t('activeWorkout.rest.logSetNow', {
                  defaultValue: 'Log set {{number}} now',
                  number: nextSetNumber,
                }),
                accessibilityLabel: t('activeWorkout.rest.completeSet', {
                  defaultValue: 'Complete set',
                }),
                onPress: onCompleteSet,
              }
        }
        onPressBody={onPressBar}
        testIDs={{
          fill: 'rest-progress-fill',
          countdown: 'rest-countdown',
          glass: 'rest-bar-glass',
          docked: 'rest-bar-docked',
          press: 'rest-bar-body',
        }}
      />
    );
  }

  const content = (
    <View className="flex-row items-center py-1">
      <View className="flex-1 pr-3">
        <Text
          numberOfLines={1}
          className="text-sm font-semibold text-text-primary"
        >
          {label}
        </Text>
        {nextSetText != null && nextSetText.length > 0 && (
          <Text
            numberOfLines={1}
            className="text-xs text-text-secondary"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {t('activeWorkout.rest.targetValue', {
              defaultValue: 'Target {{value}}',
              value: nextSetText,
            })}
          </Text>
        )}
      </View>
      <Pressable
        onPress={onCompleteSet}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={t('activeWorkout.rest.completeSet', {
          defaultValue: 'Complete set',
        })}
        className="flex-row items-center rounded-full px-4 py-2.5"
        style={{ backgroundColor: accentPrimary, gap: 6 }}
      >
        <Icon name="checkmark" size={16} color="#ffffff" weight="bold" />
        <Text className="text-sm font-semibold" style={{ color: '#ffffff' }}>
          {t('activeWorkout.rest.completeSetTitle', {
            defaultValue: 'Complete Set',
          })}
        </Text>
      </Pressable>
    </View>
  );

  // Nested pressables claim their own touches, so this only sees taps on the
  // bar's dead space (label, gaps). accessible={false} keeps the inner button
  // individually reachable for screen readers.
  const body = (
    <Pressable testID="rest-bar-body" onPress={onPressBar} accessible={false}>
      {content}
    </Pressable>
  );

  if (usesGlass) {
    return (
      <View
        pointerEvents="box-none"
        className="absolute inset-x-0 bottom-0"
        style={{ paddingBottom: insets.bottom }}
      >
        <LiquidGlassSurface
          testID="rest-bar-glass"
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
      className="bg-surface border-t border-border-subtle px-4 pt-2"
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
    >
      {body}
    </View>
  );
}

export default React.memo(ActiveWorkoutRestBar);
