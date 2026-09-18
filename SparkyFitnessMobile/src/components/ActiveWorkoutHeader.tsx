import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import type { PresetSessionResponse } from '@workspace/shared';
import { useNativeIOSTabsActive } from '../services/nativeTabBarPreference';
import type { CompletedSetMap } from '../stores/activeWorkoutStore';
import { formatElapsedClock } from '../utils/workoutSession';
import Icon, { type IconName } from './Icon';
import KeyboardCollapsible from './KeyboardCollapsible';
import LiquidGlassSurface, {
  createLiquidGlassPillStyle,
} from './LiquidGlassSurface';
import ActionSheet, {
  type ActionSheetItem,
  type ActionSheetRef,
} from './ActionSheet';

/** Per-exercise completion used by the segmented progress bar. */
export interface ExerciseProgress {
  entryId: string;
  totalSets: number;
  completedSets: number;
}

export function buildExerciseProgress(
  session: PresetSessionResponse,
  completedSetIds: CompletedSetMap
): ExerciseProgress[] {
  return session.exercises.map((exercise) => ({
    entryId: exercise.id,
    totalSets: exercise.sets.length,
    completedSets: exercise.sets.filter((s) => completedSetIds[String(s.id)])
      .length,
  }));
}

interface ActiveWorkoutHeaderProps {
  name: string;
  startedAt: number | null;
  /** Epoch ms driving the elapsed clock — the screen's 1s tick. */
  now: number;
  progress: ExerciseProgress[];
  onBack: () => void;
  onDiscard: () => void;
  /** Adds an "End workout" action (the finish flow) in its own menu group. */
  onEndWorkout?: () => void;
  /** Opens the rename dialog from a "Rename workout" menu action. */
  onRename?: () => void;
  /** When provided, adds an "Add exercise" action. */
  onAddExercise?: () => void;
  /** When provided, adds a "Reorder exercises" action. */
  onReorder?: () => void;
  /** When provided, adds a "Workout settings" action. */
  onOpenSettings?: () => void;
  /** When provided (any set logged), adds a "Clear all logged sets" action. */
  onClearAllSets?: () => void;
}

/**
 * Header action button. With Liquid Glass active it floats on its own round
 * glass surface, matching the native iOS 26 bar buttons every native-header
 * screen gets; otherwise it stays a flat pressable icon.
 */
function HeaderIconButton({
  icon,
  color,
  usesGlass,
  chromeBorder,
  onPress,
  accessibilityLabel,
}: {
  icon: IconName;
  color: string;
  usesGlass: boolean;
  chromeBorder: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const button = (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className={
        usesGlass ? 'h-[38px] w-[38px] items-center justify-center' : 'p-2'
      }
    >
      <Icon name={icon} size={22} color={color} />
    </Pressable>
  );

  if (!usesGlass) return button;
  return (
    <LiquidGlassSurface
      style={createLiquidGlassPillStyle(chromeBorder, {
        marginHorizontal: 0,
        marginBottom: 0,
      })}
      isInteractive
    >
      {button}
    </LiquidGlassSurface>
  );
}

/**
 * Custom chrome for the active-workout screen (the route renders with
 * `headerShown: false`): two round corner buttons, the display clock, and the
 * segmented per-exercise progress bar.
 *
 * The workout's name is deliberately not on screen. It is on the row menu's
 * title and nowhere else: a running workout has one name, the user chose it a
 * screen ago, and the space it was taking is the only place a clock this size
 * fits. What the header answers is how long you have been training — which is
 * why the clock is the largest thing on the screen rather than a caption under
 * a title.
 */
function ActiveWorkoutHeader({
  name,
  startedAt,
  now,
  progress,
  onBack,
  onDiscard,
  onEndWorkout,
  onRename,
  onAddExercise,
  onReorder,
  onOpenSettings,
  onClearAllSets,
}: ActiveWorkoutHeaderProps) {
  const { t } = useTranslation();
  const [
    textPrimary,
    textMuted,
    accentPrimary,
    successColor,
    trackColor,
    chromeBorder,
  ] = useCSSVariable([
    '--color-text-primary',
    '--color-text-muted',
    '--color-accent-primary',
    '--color-icon-success',
    '--color-progress-track',
    '--color-chrome-border',
  ]) as [string, string, string, string, string, string];
  const usesGlass = useNativeIOSTabsActive();

  const menuSheetRef = useRef<ActionSheetRef>(null);
  const openMenu = () => menuSheetRef.current?.present();

  const menuItems: ActionSheetItem[] = [];
  if (onAddExercise) {
    menuItems.push({
      key: 'add-exercise',
      label: t('activeWorkout.header.addExercise', {
        defaultValue: 'Add exercise',
      }),
      group: 'edit',
      onPress: onAddExercise,
    });
  }
  if (onReorder) {
    menuItems.push({
      key: 'reorder',
      label: t('activeWorkout.header.reorderExercises', {
        defaultValue: 'Reorder exercises',
      }),
      group: 'edit',
      onPress: onReorder,
    });
  }
  if (onRename) {
    menuItems.push({
      key: 'rename',
      label: t('activeWorkout.header.renameWorkout', {
        defaultValue: 'Rename workout',
      }),
      group: 'workout',
      onPress: onRename,
    });
  }
  if (onOpenSettings) {
    menuItems.push({
      key: 'workout-settings',
      label: t('activeWorkout.header.settings', {
        defaultValue: 'Workout settings',
      }),
      group: 'workout',
      onPress: onOpenSettings,
    });
  }
  if (onEndWorkout) {
    menuItems.push({
      key: 'end-workout',
      label: t('activeWorkout.header.endWorkout', {
        defaultValue: 'End workout',
      }),
      group: 'finish',
      onPress: onEndWorkout,
    });
  }
  if (onClearAllSets) {
    menuItems.push({
      key: 'clear-sets',
      label: t('activeWorkout.header.clearAllSets', {
        defaultValue: 'Clear all logged sets',
      }),
      group: 'danger',
      destructive: true,
      onPress: onClearAllSets,
    });
  }
  menuItems.push({
    key: 'discard',
    label: t('activeWorkout.header.discardWorkout', {
      defaultValue: 'Discard workout',
    }),
    group: 'danger',
    destructive: true,
    onPress: onDiscard,
  });

  return (
    <View className="px-3 pb-2 border-b border-border-subtle bg-background">
      <View className="flex-row items-center justify-between">
        {/* Close, not Back: the workout keeps running when you leave, and a
            chevron promises a screen to return to rather than one to leave. */}
        <HeaderIconButton
          icon="close"
          color={textPrimary}
          usesGlass={usesGlass}
          chromeBorder={chromeBorder}
          onPress={onBack}
          accessibilityLabel={t('activeWorkout.header.close', {
            defaultValue: 'Close workout',
          })}
        />

        {/* Glass chrome is monochrome (see resolveHeaderActionColors), so the
            kebab takes the primary tint on that path. */}
        <HeaderIconButton
          icon="ellipsis-horizontal"
          color={usesGlass ? textPrimary : textMuted}
          usesGlass={usesGlass}
          chromeBorder={chromeBorder}
          onPress={openMenu}
          accessibilityLabel={t('activeWorkout.header.menu', {
            defaultValue: 'Workout menu',
          })}
        />
      </View>

      {/* Both fold away with the keyboard so the log gets their height back —
          which is most of the header, since the clock is the tall part. */}
      <KeyboardCollapsible>
        <View className="items-center pt-1 pb-3">
          <View className="flex-row items-center" style={{ gap: 10 }}>
            {/* Running indicator. It is the only thing on the header that says
                the clock is live rather than a total from a finished session. */}
            <View
              testID="active-workout-running-dot"
              style={{
                width: 9,
                height: 9,
                borderRadius: 5,
                backgroundColor: accentPrimary,
              }}
            />
            <Text
              testID="active-workout-elapsed"
              accessibilityLabel={t('activeWorkout.header.elapsedTime', {
                defaultValue: '{{time}} elapsed',
                time: formatElapsedClock(startedAt, now),
              })}
              className="text-text-primary"
              style={{
                fontSize: 40,
                lineHeight: 46,
                fontWeight: '800',
                letterSpacing: 0.5,
                fontVariant: ['tabular-nums'],
              }}
            >
              {formatElapsedClock(startedAt, now)}
            </Text>
          </View>
        </View>

        <View className="flex-row items-center px-2">
          <View className="flex-1 flex-row gap-1">
            {progress.map((p) => {
              const isDone = p.totalSets > 0 && p.completedSets >= p.totalSets;
              const fillPct =
                p.totalSets > 0
                  ? Math.min(1, p.completedSets / p.totalSets)
                  : 0;
              return (
                <View
                  key={p.entryId}
                  testID={isDone ? 'header-segment-done' : 'header-segment'}
                  className="flex-1 h-[5px] rounded-full overflow-hidden"
                  style={{
                    backgroundColor: isDone ? successColor : trackColor,
                  }}
                >
                  {!isDone && fillPct > 0 && (
                    <View
                      testID="header-segment-fill"
                      className="h-full rounded-full"
                      style={{
                        width: `${fillPct * 100}%`,
                        backgroundColor: accentPrimary,
                      }}
                    />
                  )}
                </View>
              );
            })}
          </View>
        </View>
      </KeyboardCollapsible>

      <ActionSheet ref={menuSheetRef} title={name} items={menuItems} />
    </View>
  );
}

export default React.memo(ActiveWorkoutHeader);
