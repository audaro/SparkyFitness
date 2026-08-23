import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { isCardioModality, type RecommendedExercise } from '@workspace/shared';

import BottomSheetPicker from '../components/BottomSheetPicker';
import Button from '../components/ui/Button';
import Icon from '../components/Icon';
import SafeImage from '../components/SafeImage';
import StatusView from '../components/StatusView';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import { usePreferences } from '../hooks';
import { useExerciseImageSource } from '../hooks/useExerciseImageSource';
import { useGymProfiles, useGymProfileMutations } from '../hooks/useGymProfiles';
import { useStartLiveWorkout } from '../hooks/useStartLiveWorkout';
import {
  useUpdateRecommendationStatus,
  useWorkoutRecommendation,
} from '../hooks/useWorkoutRecommendation';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import {
  buildRecommendationStartPayload,
  formatDuration,
  formatRecommendedSets,
  formatRestChip,
  makeSparseExercise,
  normalizeWeightUnit,
} from '../utils/workoutSession';
import type { RootStackScreenProps } from '../types/navigation';

type UpNextScreenProps = RootStackScreenProps<'UpNext'>;

/** Sentinel for "no equipment constraint" — picker values must be scalars. */
const ANY_GYM = 'any';

const DURATION_OPTIONS = [30, 45, 60, 75, 90, 120];

/** Canonical muscle/equipment values are stored lowercase; capitalize to show. */
function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

const UpNextScreen: React.FC<UpNextScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const usesNativeHeader = useNativeIOSHeadersActive();
  const [accentPrimary, textMuted, textSecondary] = useCSSVariable([
    '--color-accent-primary',
    '--color-text-muted',
    '--color-text-secondary',
  ]) as [string, string, string];

  const { preferences } = usePreferences();
  const weightUnit = normalizeWeightUnit(preferences?.default_weight_unit);
  const distanceUnit = (preferences?.default_distance_unit as 'km' | 'miles') ?? 'km';

  const { recommendation, isLoading, isError, refetch, generateAsync, isGenerating } =
    useWorkoutRecommendation();
  const { profiles } = useGymProfiles();
  const { activateProfileAsync } = useGymProfileMutations();
  const { startLiveWorkout, isStarting } = useStartLiveWorkout(navigation);
  const { mutate: updateStatus } = useUpdateRecommendationStatus();
  const { getImageSource } = useExerciseImageSource();

  // Distinguishes "Swap is working" from "the duration chip is working" so only
  // the control the user touched shows a spinner.
  const [pendingAction, setPendingAction] = useState<'swap' | 'settings' | null>(null);
  const inFlightRef = useRef(false);

  const header = useScreenHeader({ title: 'Up Next', left: { kind: 'back' } });

  const payload = recommendation?.payload ?? null;

  const runGenerate = useCallback(
    async (
      body: Parameters<typeof generateAsync>[0],
      action: 'swap' | 'settings',
    ) => {
      // The disabled props alone cannot stop a double-tap: they follow the
      // mutation's pending state, which only flips on the next render.
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setPendingAction(action);
      try {
        await generateAsync(body);
      } catch {
        // The hook's onError already showed the failure toast.
      } finally {
        inFlightRef.current = false;
        setPendingAction(null);
      }
    },
    [generateAsync],
  );

  const handleSwap = useCallback(() => {
    void runGenerate({ swap: true }, 'swap');
  }, [runGenerate]);

  const handleSelectDuration = useCallback(
    (minutes: number) => {
      void runGenerate({ duration_minutes: minutes }, 'settings');
    },
    [runGenerate],
  );

  const handleSelectGym = useCallback(
    async (value: string) => {
      // Activation is a server-side transaction that flips two rows, so it has
      // to land before the regenerate reads the active profile — even though
      // this request also names the profile explicitly.
      if (value !== ANY_GYM) {
        try {
          await activateProfileAsync(value);
        } catch {
          // The mutation already showed its toast; don't regenerate against a
          // profile the server may not have switched to.
          return;
        }
      }
      await runGenerate({ gym_profile_id: value === ANY_GYM ? null : value }, 'settings');
    },
    [activateProfileAsync, runGenerate],
  );

  const handleStart = useCallback(() => {
    if (!recommendation || !payload) return;
    void startLiveWorkout({
      name: 'Up Next workout',
      exercises: buildRecommendationStartPayload(payload),
    });
    // Optimistic, best-effort lifecycle marker. `startLiveWorkout` swallows its
    // own failures (it owns the toast) and returns the same void promise either
    // way, so there is no success signal to gate on — and the "workout already
    // in progress" prompt makes the store's sessionId a false one. Nothing
    // server-side branches on the status yet, so a marker set for a start the
    // user then cancelled costs nothing; a failure here must never unwind a
    // workout that is already live.
    updateStatus({ id: recommendation.id, status: 'started' });
  }, [recommendation, payload, startLiveWorkout, updateStatus]);

  const handleOpenExercise = useCallback(
    (exercise: RecommendedExercise) => {
      navigation.navigate('ExerciseDetail', {
        item: makeSparseExercise({
          id: exercise.exercise_id,
          name: exercise.exercise_name,
          modality: exercise.modality,
          images: exercise.images,
        }),
        hideWorkoutActions: true,
      });
    },
    [navigation],
  );

  const gymOptions = useMemo(
    () => [
      ...profiles.map((profile) => ({ label: profile.name, value: profile.id })),
      { label: 'Any equipment', value: ANY_GYM },
    ],
    [profiles],
  );

  // The chips label what THIS workout was built with, not what is active now —
  // the two differ until the next regenerate.
  const gymValue = recommendation?.gym_profile_id ?? ANY_GYM;
  const gymLabel =
    profiles.find((profile) => profile.id === recommendation?.gym_profile_id)?.name ??
    'Any equipment';

  const renderChip = (
    label: string,
    icon: 'clock' | 'exercise-weights',
    onPress: () => void,
    accessibilityLabel: string,
  ) => (
    <TouchableOpacity
      className="flex-row items-center bg-raised rounded-full px-3 py-2 mr-2"
      activeOpacity={0.7}
      onPress={onPress}
      disabled={isGenerating || isStarting}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Icon name={icon} size={14} color={textSecondary} />
      <Text className="text-text-primary text-sm ml-1.5">{label}</Text>
      <Icon name="chevron-down" size={14} color={textMuted} style={{ marginLeft: 4 }} />
    </TouchableOpacity>
  );

  const renderExerciseRow = (exercise: RecommendedExercise) => {
    const image = exercise.images[0] ?? null;
    return (
      <TouchableOpacity
        key={exercise.exercise_id}
        className="flex-row items-center px-4 py-3 border-b border-border-subtle"
        activeOpacity={0.7}
        onPress={() => handleOpenExercise(exercise)}
        testID="up-next-exercise-row"
      >
        <SafeImage
          source={image ? getImageSource(image) : null}
          style={{ width: 52, height: 52, borderRadius: 8 }}
          fallback={
            <View
              className="bg-raised items-center justify-center"
              style={{ width: 52, height: 52, borderRadius: 8 }}
            >
              <Icon name="exercise-weights" size={24} color={textMuted} />
            </View>
          }
        />
        <View className="flex-1 ml-3">
          <Text className="text-text-primary text-base font-medium" numberOfLines={1}>
            {exercise.exercise_name}
          </Text>
          <Text className="text-sm mt-0.5" style={{ color: textSecondary }}>
            {formatRecommendedSets(exercise, weightUnit, distanceUnit)}
          </Text>
          <Text className="text-xs mt-0.5" style={{ color: textMuted }} numberOfLines={1}>
            {/* Cardio is one continuous block, so its rest prescription is not
                something the row should advertise. */}
            {isCardioModality(exercise.modality)
              ? exercise.rationale
              : `${exercise.rationale} · ${formatRestChip(exercise.rest_seconds)}`}
          </Text>
        </View>
        <Icon name="chevron-forward" size={18} color={textMuted} />
      </TouchableOpacity>
    );
  };

  const renderContent = () => {
    if (isLoading) {
      return <StatusView loading />;
    }
    if (isError) {
      return (
        <StatusView
          icon="alert-circle"
          title="Failed to load your workout"
          action={{ label: 'Retry', onPress: () => refetch() }}
        />
      );
    }
    if (!recommendation || !payload) {
      return (
        <StatusView
          icon="exercise-weights"
          title="No workout yet"
          subtitle="Build one from the muscles you have recovered and the equipment you have."
          action={{
            label: isGenerating ? 'Generating…' : "Generate today's workout",
            onPress: () => void runGenerate({}, 'settings'),
            variant: 'primary',
          }}
        />
      );
    }

    const muscleCount = payload.muscle_groups.length;
    const exerciseCount = payload.exercises.length;

    return (
      <>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior={usesNativeHeader ? 'automatic' : 'never'}
        >
          <View className="px-4 pt-4 pb-3">
            <Text className="text-text-primary text-2xl font-bold">Up Next</Text>
            <Text className="text-sm mt-1" style={{ color: textSecondary }}>
              {exerciseCount} {exerciseCount === 1 ? 'Exercise' : 'Exercises'} •{' '}
              {muscleCount} {muscleCount === 1 ? 'Muscle' : 'Muscles'} •{' '}
              {formatDuration(payload.estimated_duration_minutes)}
            </Text>
            <Text className="text-xs mt-1" style={{ color: textMuted }}>
              {payload.muscle_groups.map(titleCase).join(', ')}
            </Text>

            <View className="flex-row items-center mt-3">
              <BottomSheetPicker<number>
                value={recommendation.target_duration_minutes}
                options={DURATION_OPTIONS.map((minutes) => ({
                  label: formatDuration(minutes),
                  value: minutes,
                }))}
                onSelect={handleSelectDuration}
                title="Workout length"
                renderTrigger={({ onPress }) =>
                  renderChip(
                    formatDuration(recommendation.target_duration_minutes),
                    'clock',
                    onPress,
                    'Change workout length',
                  )
                }
              />
              <BottomSheetPicker<string>
                value={gymValue}
                options={gymOptions}
                onSelect={(value) => void handleSelectGym(value)}
                title="Gym equipment"
                renderTrigger={({ onPress }) =>
                  renderChip(gymLabel, 'exercise-weights', onPress, 'Change gym equipment')
                }
              />
              {pendingAction === 'settings' && isGenerating && (
                <ActivityIndicator size="small" color={accentPrimary} />
              )}
            </View>

            <View className="mt-3">
              <Button
                variant="outline"
                onPress={handleSwap}
                disabled={isGenerating || isStarting}
                loading={pendingAction === 'swap' && isGenerating}
                testID="up-next-swap"
              >
                Swap workout
              </Button>
            </View>
          </View>

          {payload.exercises.map(renderExerciseRow)}
        </ScrollView>

        <View
          className="px-4 pt-3 border-t border-border-subtle bg-background"
          style={{ paddingBottom: insets.bottom + 12 + activeWorkoutBarPadding }}
        >
          <Button
            variant="primary"
            onPress={handleStart}
            disabled={isGenerating}
            loading={isStarting}
            testID="up-next-start"
          >
            Start Workout
          </Button>
        </View>
      </>
    );
  };

  return (
    <View
      className="flex-1 bg-background"
      style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
    >
      {header}
      {renderContent()}
    </View>
  );
};

export default UpNextScreen;
