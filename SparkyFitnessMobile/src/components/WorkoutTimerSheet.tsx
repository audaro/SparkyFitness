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
import { formatRestCountdown } from '../utils/workoutSession';

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

/**
 * Scroll clearance the workout log needs above the floating glass variant of
 * this sheet, so the last card and the End Workout button can scroll clear of
 * it. Measured from the geometry below: track + eyebrow + countdown + hint +
 * the control cluster + the footer slot, plus breathing room. The compact
 * on-deck bar has its own, much smaller clearance — see
 * `REST_BAR_GLASS_CLEARANCE`.
 */
export const TIMER_SHEET_GLASS_CLEARANCE = 330;

/** Matches the workout HUD's pill so the floating variants read as one family. */
const GLASS_BORDER_RADIUS = 28;

const SHEET_CORNER_RADIUS = 24;
const SHEET_PADDING_X = 16;
const TRACK_HEIGHT = 3;
const SIDE_BUTTON_SIZE = 56;
const CENTRE_BUTTON_SIZE = 72;
const COUNTDOWN_FONT_SIZE = 62;
const COUNTDOWN_LINE_HEIGHT = 74;
const FOOTER_HEIGHT = 50;
const ADJUST_STEP_SEC = 15;

interface WorkoutTimerSheetProps {
  /**
   * Which timer is running. The store makes rest and hold mutually exclusive,
   * so this is the surface naming its current phase rather than two surfaces
   * competing for the dock.
   */
  phase: 'rest' | 'hold';
  remainingMs: number;
  /** Fraction of the phase remaining, 0..1. */
  progress: number;
  paused: boolean;
  /** Centred line under the countdown: what reaching 0:00 will do. */
  hint?: string | null;
  onAdjust: (deltaSec: number) => void;
  onPause: () => void;
  onResume: () => void;
  /** The eyebrow's trailing action: skip the rest, or stop and log the hold. */
  onDismiss: () => void;
  /**
   * Full-width action under the control cluster. Rest uses it to log the
   * on-deck set without waiting out the clock; a hold has no equivalent (its
   * only ending is the countdown or Stop), so it passes none.
   */
  footer?: {
    label: string;
    accessibilityLabel: string;
    onPress: () => void;
  } | null;
  /** Taps on the sheet's dead space — the nested controls claim their own. */
  onPressBody?: () => void;
  testIDs?: {
    track?: string;
    fill?: string;
    countdown?: string;
    glass?: string;
    docked?: string;
    /**
     * The dead-space tap target. Not named `body`: the i18n audit reads a
     * string literal on a prop called `body` as user-facing copy and blocks
     * `validate` over a testID.
     */
    press?: string;
  };
}

/**
 * The docked timer sheet for the active workout: one surface, two phases. A
 * full-bleed progress track across the top, an eyebrow naming the phase with
 * its dismissal beside it, the countdown at display size, a line saying what
 * happens at zero, then −15s / pause / +15s as a thumb-reachable cluster and
 * an optional full-width action beneath.
 *
 * It exists because `ActiveWorkoutRestBar` and `ActiveWorkoutHoldSheet` are
 * deliberately siblings — the store keeps rest and hold mutually exclusive, and
 * folding them into one component would thread a phase flag through both
 * bodies. What they genuinely share is this geometry and chrome (the rule of
 * two: the second copy is where it gets extracted), so the phase-specific copy,
 * callbacks and after-zero behaviour stay with the callers.
 *
 * Chrome follows the workout HUD's: with Liquid Glass tabs active it is a
 * floating pill overlaying the log (the screen reserves
 * `TIMER_SHEET_GLASS_CLEARANCE` of scroll padding for it); otherwise it is a
 * bottom-docked sheet in normal flow, where the track can run edge to edge.
 */
function WorkoutTimerSheet({
  phase,
  remainingMs,
  progress,
  paused,
  hint,
  onAdjust,
  onPause,
  onResume,
  onDismiss,
  footer,
  onPressBody,
  testIDs,
}: WorkoutTimerSheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const usesGlass = useNativeIOSTabsActive();
  const [
    accentPrimary,
    accentText,
    textPrimary,
    textMuted,
    trackColor,
    chromeBorder,
  ] = useCSSVariable([
    '--color-accent-primary',
    '--color-accent-text',
    '--color-text-primary',
    '--color-text-muted',
    '--color-progress-track',
    '--color-chrome-border',
  ]) as [string, string, string, string, string, string];

  const isRest = phase === 'rest';
  const phaseColor = paused ? textMuted : accentPrimary;

  const eyebrow = isRest
    ? t('activeWorkout.timer.restPhase', { defaultValue: 'Rest' })
    : t('activeWorkout.timer.holdPhase', { defaultValue: 'Hold' });
  const dismissLabel = isRest
    ? t('activeWorkout.timer.skip', { defaultValue: 'Skip' })
    : t('activeWorkout.timer.stop', { defaultValue: 'Stop' });
  const dismissAccessibilityLabel = isRest
    ? t('activeWorkout.rest.skip', { defaultValue: 'Skip rest' })
    : t('activeWorkout.hold.stop', {
        defaultValue: 'Stop hold and log the set',
      });
  const shortenLabel = isRest
    ? t('activeWorkout.rest.shorten', {
        defaultValue: 'Shorten rest by 15 seconds',
      })
    : t('activeWorkout.hold.shorten', {
        defaultValue: 'Shorten hold by 15 seconds',
      });
  const extendLabel = isRest
    ? t('activeWorkout.rest.extend', {
        defaultValue: 'Extend rest by 15 seconds',
      })
    : t('activeWorkout.hold.extend', {
        defaultValue: 'Extend hold by 15 seconds',
      });
  const toggleLabel = paused
    ? isRest
      ? t('activeWorkout.rest.resume', { defaultValue: 'Resume rest' })
      : t('activeWorkout.hold.resume', { defaultValue: 'Resume hold' })
    : isRest
      ? t('activeWorkout.rest.pause', { defaultValue: 'Pause rest' })
      : t('activeWorkout.hold.pause', { defaultValue: 'Pause hold' });

  const adjustButton = (deltaSec: number, label: string) => (
    <Pressable
      onPress={() => onAdjust(deltaSec)}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="items-center justify-center bg-raised"
      style={{
        width: SIDE_BUTTON_SIZE,
        height: SIDE_BUTTON_SIZE,
        borderRadius: 999,
      }}
    >
      <Text
        className="font-semibold text-text-primary"
        style={{ fontSize: 15, fontVariant: ['tabular-nums'] }}
      >
        {deltaSec < 0
          ? isRest
            ? t('activeWorkout.rest.subtractSecondsShort', {
                defaultValue: '−{{seconds}}s',
                seconds: ADJUST_STEP_SEC,
              })
            : t('activeWorkout.hold.subtractSecondsShort', {
                defaultValue: '−{{seconds}}s',
                seconds: ADJUST_STEP_SEC,
              })
          : isRest
            ? t('activeWorkout.rest.addSecondsShort', {
                defaultValue: '+{{seconds}}s',
                seconds: ADJUST_STEP_SEC,
              })
            : t('activeWorkout.hold.addSecondsShort', {
                defaultValue: '+{{seconds}}s',
                seconds: ADJUST_STEP_SEC,
              })}
      </Text>
    </Pressable>
  );

  const content = (
    <>
      {/* Docked, the track runs edge to edge under the sheet's top border, as
          the canvas draws it; inside the glass pill it insets and rounds so it
          does not collide with the pill's own corners. */}
      <View
        testID={testIDs?.track}
        className="overflow-hidden"
        style={{
          height: TRACK_HEIGHT,
          backgroundColor: trackColor,
          ...(usesGlass
            ? { borderRadius: 999 }
            : { marginHorizontal: -SHEET_PADDING_X }),
        }}
      >
        <View
          testID={testIDs?.fill}
          className="h-full"
          style={{
            width: `${progress * 100}%`,
            backgroundColor: phaseColor,
            ...(usesGlass ? { borderRadius: 999 } : null),
          }}
        />
      </View>

      <View className="flex-row items-center" style={{ paddingTop: 14 }}>
        <Text
          className="flex-1 font-bold uppercase"
          style={{ fontSize: 12, letterSpacing: 1, color: phaseColor }}
        >
          {eyebrow}
        </Text>
        <Pressable
          onPress={onDismiss}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={dismissAccessibilityLabel}
          className="px-2 py-3 -mx-2 -my-3"
        >
          <Text
            className="font-semibold text-text-muted"
            style={{ fontSize: 14 }}
          >
            {dismissLabel}
          </Text>
        </Pressable>
      </View>

      <Text
        testID={testIDs?.countdown}
        className="text-center font-bold"
        style={{
          fontSize: COUNTDOWN_FONT_SIZE,
          lineHeight: COUNTDOWN_LINE_HEIGHT,
          letterSpacing: -1,
          paddingTop: 6,
          paddingBottom: 2,
          color: paused ? textMuted : textPrimary,
          fontVariant: ['tabular-nums'],
        }}
      >
        {formatRestCountdown(remainingMs)}
      </Text>

      {hint != null && hint.length > 0 && (
        <Text
          numberOfLines={2}
          className="text-center text-text-secondary"
          style={{ fontSize: 13, lineHeight: 18, paddingBottom: 14 }}
        >
          {hint}
        </Text>
      )}

      <View
        className="flex-row items-center justify-center"
        style={{ gap: 22, paddingBottom: 16 }}
      >
        {adjustButton(-ADJUST_STEP_SEC, shortenLabel)}
        <Pressable
          onPress={paused ? onResume : onPause}
          accessibilityRole="button"
          accessibilityLabel={toggleLabel}
          className="items-center justify-center"
          style={{
            width: CENTRE_BUTTON_SIZE,
            height: CENTRE_BUTTON_SIZE,
            borderRadius: 999,
            backgroundColor: phaseColor,
          }}
        >
          <Icon
            name={paused ? 'play' : 'pause'}
            size={28}
            color={accentText}
            weight="bold"
          />
        </Pressable>
        {adjustButton(ADJUST_STEP_SEC, extendLabel)}
      </View>

      {footer != null && (
        <Pressable
          onPress={footer.onPress}
          accessibilityRole="button"
          accessibilityLabel={footer.accessibilityLabel}
          className="items-center justify-center bg-raised"
          style={{
            height: FOOTER_HEIGHT,
            borderRadius: 16,
            marginBottom: 4,
          }}
        >
          <Text
            className="font-semibold"
            style={{ fontSize: 16, color: accentPrimary }}
          >
            {footer.label}
          </Text>
        </Pressable>
      )}
    </>
  );

  // Nested pressables claim their own touches, so this only sees taps on the
  // sheet's dead space. accessible={false} keeps the inner buttons individually
  // reachable for screen readers (see the AnchoredMenu note in AGENTS.md).
  const body = (
    <Pressable testID={testIDs?.press} onPress={onPressBody} accessible={false}>
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
          testID={testIDs?.glass}
          style={createLiquidGlassPillStyle(chromeBorder, {
            borderRadius: GLASS_BORDER_RADIUS,
            paddingHorizontal: SHEET_PADDING_X,
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
      testID={testIDs?.docked}
      className="bg-surface border-t border-border-subtle overflow-hidden"
      style={{
        borderTopLeftRadius: SHEET_CORNER_RADIUS,
        borderTopRightRadius: SHEET_CORNER_RADIUS,
        paddingHorizontal: SHEET_PADDING_X,
        paddingBottom: Math.max(insets.bottom, 16),
      }}
    >
      {body}
    </View>
  );
}

export default React.memo(WorkoutTimerSheet);
