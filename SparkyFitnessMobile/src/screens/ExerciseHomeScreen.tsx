import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import HexagonProgressRing from '../components/HexagonProgressRing';
import Icon from '../components/Icon';
import SettingsRow, { SettingsRowGroup } from '../components/SettingsRow';
import UpNextCard from '../components/UpNextCard';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import { useNativeIOSTabsActive } from '../services/nativeTabBarPreference';
import { useWeeklySetGroupColors } from '../hooks/useWeeklySetGroupColors';
import { useWeeklySetTargets } from '../hooks/useWeeklySetTargets';
import { formatSetCount } from '../utils/workoutSession';
import type { MuscleGroup } from '../services/api/weeklySetTargetsApi';
import type { RootStackParamList, TabParamList } from '../types/navigation';

type ExerciseHomeScreenProps = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'Exercise'>,
  NativeStackScreenProps<RootStackParamList>
>;

const SUMMARY_RING_SIZE = 88;
const SUMMARY_RING_STROKE = 8;

/**
 * Short group names. WeeklySetTargetsScreen spells them out ("Push Muscles")
 * because it is the screen where you edit them; here they sit in a narrow
 * column beside the ring, so they are abbreviated on purpose.
 */
const SHORT_GROUP_LABELS: Record<MuscleGroup, string> = {
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  core: 'Core',
};

/**
 * Home for everything training-related: what to train next, how the week is
 * going, and the way in to every exercise list and workout setting.
 *
 * The recovery section and the dated exercise history arrive in later steps.
 */
const ExerciseHomeScreen: React.FC<ExerciseHomeScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding();
  const usesNativeTabs = useNativeIOSTabsActive();

  const [accentPrimary, trackColor, textMuted] = useCSSVariable([
    '--color-accent-primary',
    '--color-progress-track',
    '--color-text-muted',
  ]) as [string, string, string];

  const groupColors = useWeeklySetGroupColors();
  const {
    data: weeklyTargets,
    isLoading: isLoadingWeek,
    isError: isWeekError,
  } = useWeeklySetTargets();

  const week = weeklyTargets?.current ?? null;
  // Not memoized on purpose — the React Compiler rejects a manual memo over
  // this mapping on the targets screen too, and a rejected memo is worse
  // than none.
  const segments = (week?.groups ?? []).map((group) => ({
    percent: group.percent,
    color: groupColors[group.group],
  }));

  return (
    <ScrollView
      className="flex-1 bg-background"
      style={[{ flex: 1 }, usesNativeTabs ? undefined : { paddingTop: insets.top }]}
      contentContainerStyle={{
        paddingHorizontal: 16,
        ...(!usesNativeTabs ? { paddingTop: 16 } : null),
        paddingBottom: insets.bottom + activeWorkoutBarPadding + 16,
      }}
      contentInsetAdjustmentBehavior={usesNativeTabs ? 'automatic' : 'never'}
      automaticallyAdjustsScrollIndicatorInsets={usesNativeTabs}
    >
      {!usesNativeTabs && (
        <View className="mb-6">
          <Text className="text-2xl font-bold text-text-primary">Exercise</Text>
        </View>
      )}

      {/*
        Up Next is a permanent section here, so it ignores the
        `upNextCardVisible` dashboard preference — that toggle governs the
        Home card, which is a summary of this tab rather than its subject.
      */}
      <UpNextCard navigation={navigation} />

      {/* A failed read is not worth an error block on a tab that has plenty
          else to offer; the section simply stays out of the way, and the ring
          is one tap away on the targets screen either way. */}
      {!isWeekError && (
        <Pressable
          className="bg-surface rounded-xl p-4 mb-6 shadow-sm"
          onPress={() => navigation.navigate('WeeklySetTargets')}
          accessibilityRole="button"
          accessibilityLabel="Open your weekly set targets"
          testID="exercise-home-week-card"
        >
          <View className="flex-row items-center justify-between">
            <Text className="font-bold text-text-secondary">This week</Text>
            {isLoadingWeek ? (
              <ActivityIndicator size="small" color={accentPrimary} />
            ) : (
              <Icon name="chevron-forward" size={14} color={accentPrimary} />
            )}
          </View>

          {week ? (
            <View className="flex-row items-center mt-3">
              <View className="items-center justify-center mr-4">
                <HexagonProgressRing
                  size={SUMMARY_RING_SIZE}
                  strokeWidth={SUMMARY_RING_STROKE}
                  segments={segments}
                  trackColor={trackColor}
                />
                <View
                  className="absolute items-center"
                  pointerEvents="none"
                  testID="exercise-home-week-overall"
                >
                  <Text className="text-lg font-bold italic text-text-primary">
                    {Math.round(week.overall_percent * 100)}%
                  </Text>
                </View>
              </View>

              <View className="flex-1">
                {week.groups.map((group) => (
                  <View
                    key={group.group}
                    className="flex-row items-center py-0.5"
                    testID={`exercise-home-week-group-${group.group}`}
                  >
                    <View
                      className="mr-2 h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: groupColors[group.group] }}
                    />
                    <Text className="flex-1 text-sm text-text-primary">
                      {SHORT_GROUP_LABELS[group.group]}
                    </Text>
                    <Text className="text-sm" style={{ color: textMuted }}>
                      {formatSetCount(group.completed)} / {group.target}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            !isLoadingWeek && (
              <Text className="text-sm mt-1" style={{ color: textMuted }}>
                Set a weekly target for each muscle group
              </Text>
            )
          )}
        </Pressable>
      )}

      {/* Recovery — per-muscle freshness from
          GET /api/workout-recommendations/recovery. Section intentionally
          absent until the muscle grid lands rather than shipping an empty
          card that says nothing. */}

      <View className="mb-3">
        <Text className="text-lg font-semibold text-text-primary">Quick access</Text>
      </View>

      <SettingsRowGroup>
        <SettingsRow
          icon="bookmark-filled"
          title="Workout presets"
          subtitle="Routines you have saved"
          onPress={() => navigation.navigate('WorkoutPresetsLibrary')}
          testID="exercise-home-workout-presets"
        />
        <SettingsRow
          icon="exercise-weights"
          title="Exercise library"
          subtitle="Every exercise you can log"
          onPress={() => navigation.navigate('ExercisesLibrary')}
          testID="exercise-home-exercises-library"
        />
      </SettingsRowGroup>

      <View className="mb-3">
        <Text className="text-lg font-semibold text-text-primary">Setup</Text>
      </View>

      <SettingsRowGroup>
        <SettingsRow
          icon="workout-settings"
          title="Gym profiles"
          subtitle="Which equipment your workouts may use"
          onPress={() => navigation.navigate('GymProfiles')}
          testID="exercise-home-gym-profiles"
        />
        <SettingsRow
          icon="list"
          title="Exercise packs"
          subtitle="Add a ready-made set of exercises"
          onPress={() => navigation.navigate('ExercisePacks')}
          testID="exercise-home-exercise-packs"
        />
      </SettingsRowGroup>
    </ScrollView>
  );
};

export default ExerciseHomeScreen;
