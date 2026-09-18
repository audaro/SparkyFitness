import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useCSSVariable } from 'uniwind';
import { isCardioModality } from '@workspace/shared';

import Icon from './Icon';
import MuscleRegionBadge from './MuscleRegionBadge';
import SafeImage from './SafeImage';
import type { GetImageSource } from '../hooks/useExerciseImageSource';
import {
  formatRecommendedSets,
  formatRestChip,
  titleCaseCanonical,
} from '../utils/workoutSession';
import type { PlannedExercise } from '../utils/workoutSupersets';
import type { SupersetBorder } from './ActiveWorkoutRail';

/** Thumbnail edge, and the corner badge that overlaps it. */
const MEDIA_SIZE = 62;
const BADGE_SIZE = 28;

export interface UpNextExerciseRowProps {
  exercise: PlannedExercise;
  /** Non-null only while this exercise is part of a superset run. */
  supersetBorder: SupersetBorder | null;
  weightUnit: 'kg' | 'lbs';
  distanceUnit: 'km' | 'miles';
  getImageSource: GetImageSource;
  /** True while this exercise's replacement is in flight. */
  isReplacing: boolean;
  /** Disables the ⋯ trigger while the screen is busy. */
  menuDisabled: boolean;
  onPress: (exercise: PlannedExercise) => void;
  onPressMenu: (exerciseId: string) => void;
  /** Registers the ⋯ trigger so the anchored menu can measure it. */
  menuTriggerRef: (exerciseId: string, node: View | null) => void;
}

/**
 * One prescribed exercise in the Up Next list.
 *
 * Three lines, widest to narrowest: what it is, what to do, and where it lands
 * with how long to rest. The rationale used to sit on the third line — it now
 * lives in the exercise sheet's coach note, which has the room for a sentence
 * this line never had.
 *
 * The row body opens the exercise; the trailing ⋯ is a sibling pressable, not
 * a nested one, so the two cannot mis-fire into each other.
 */
function UpNextExerciseRow({
  exercise,
  supersetBorder,
  weightUnit,
  distanceUnit,
  getImageSource,
  isReplacing,
  menuDisabled,
  onPress,
  onPressMenu,
  menuTriggerRef,
}: UpNextExerciseRowProps) {
  const { t } = useTranslation();
  const [textSecondary, textMuted, accentPrimary] = useCSSVariable([
    '--color-text-secondary',
    '--color-text-muted',
    '--color-accent-primary',
  ]) as [string, string, string];

  const image = exercise.images[0] ?? null;
  const primaryMuscle = exercise.primary_muscles[0] ?? null;
  // Cardio is one continuous block, so its rest prescription is not something
  // the row should advertise.
  const restText = isCardioModality(exercise.modality)
    ? null
    : formatRestChip(exercise.rest_seconds);
  const placement = [
    primaryMuscle == null ? null : titleCaseCanonical(primaryMuscle),
    restText,
  ]
    .filter((part) => part != null && part.length > 0)
    .join(' · ');

  return (
    <View className="flex-row items-center border-b border-border-subtle">
      {supersetBorder ? (
        // Same flat 3px rail the live workout draws: interior members run the
        // full row height so consecutive members read as one line, and the
        // run's last member stops short of the divider.
        <View
          testID={`up-next-superset-rail-${exercise.exercise_id}`}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: supersetBorder.isLast ? 8 : 0,
            width: 3,
            backgroundColor: supersetBorder.color,
          }}
        />
      ) : null}
      <TouchableOpacity
        className="flex-1 flex-row items-center pl-4 py-3"
        activeOpacity={0.7}
        onPress={() => onPress(exercise)}
        testID="up-next-exercise-row"
      >
        <View style={{ width: MEDIA_SIZE, height: MEDIA_SIZE }}>
          <SafeImage
            source={image ? getImageSource(image) : null}
            style={{
              width: MEDIA_SIZE,
              height: MEDIA_SIZE,
              borderRadius: 12,
            }}
            fallback={
              <View
                className="bg-raised items-center justify-center"
                style={{
                  width: MEDIA_SIZE,
                  height: MEDIA_SIZE,
                  borderRadius: 12,
                }}
              >
                <Icon name="exercise-weights" size={26} color={textMuted} />
              </View>
            }
          />
          {/* Overlaps the corner rather than sitting beside the media: the row
              has three lines to fit and the badge is a footnote to the
              picture, not a column of its own. */}
          <View
            pointerEvents="none"
            style={{ position: 'absolute', right: -6, bottom: -6 }}
          >
            <MuscleRegionBadge muscle={primaryMuscle} size={BADGE_SIZE} />
          </View>
        </View>
        <View className="flex-1 ml-3.5">
          <Text
            className="text-text-primary text-base font-semibold"
            numberOfLines={1}
          >
            {exercise.exercise_name}
          </Text>
          <Text
            className="mt-0.5"
            style={{
              color: textSecondary,
              fontSize: 13,
              lineHeight: 18,
              fontVariant: ['tabular-nums'],
            }}
            numberOfLines={1}
          >
            {formatRecommendedSets(exercise, weightUnit, distanceUnit)}
          </Text>
          {placement.length > 0 ? (
            <Text
              className="text-xs mt-0.5"
              style={{ color: textMuted, fontVariant: ['tabular-nums'] }}
              numberOfLines={1}
            >
              {placement}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        className="px-4 py-3"
        activeOpacity={0.7}
        hitSlop={8}
        disabled={menuDisabled}
        accessibilityRole="button"
        accessibilityLabel={t('upNext.moreOptionsFor', {
          defaultValue: 'More options for {{name}}',
          name: exercise.exercise_name,
        })}
        testID="up-next-exercise-menu"
        ref={(node) => {
          menuTriggerRef(exercise.exercise_id, node);
        }}
        onPress={() => onPressMenu(exercise.exercise_id)}
      >
        {isReplacing ? (
          <ActivityIndicator size="small" color={accentPrimary} />
        ) : (
          <Icon name="ellipsis-horizontal" size={20} color={textMuted} />
        )}
      </TouchableOpacity>
    </View>
  );
}

export default React.memo(UpNextExerciseRow);
