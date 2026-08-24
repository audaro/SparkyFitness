import React, { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useCSSVariable } from 'uniwind';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ExerciseSessionResponse } from '@workspace/shared';

import CalendarSheet, { type CalendarSheetRef } from '../components/CalendarSheet';
import CreateTile from '../components/CreateTile';
import DateNavigator from '../components/DateNavigator';
import ExerciseSummary from '../components/ExerciseSummary';
import HexagonProgressRing from '../components/HexagonProgressRing';
import Icon from '../components/Icon';
import MuscleRecoveryStrip from '../components/MuscleRecoveryStrip';
import SettingsRow, { SettingsRowGroup } from '../components/SettingsRow';
import UpNextCard from '../components/UpNextCard';
import { addSheetRef } from '../components/AddSheet';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import { useNativeIOSTabsActive } from '../services/nativeTabBarPreference';
import { useServerConnection } from '../hooks';
import { useDailySummary } from '../hooks/useDailySummary';
import { useExerciseImageSource } from '../hooks/useExerciseImageSource';
import { useGymProfiles } from '../hooks/useGymProfiles';
import { useNavigationActionGuard } from '../hooks/useNavigationActionGuard';
import { usePreferences } from '../hooks/usePreferences';
import { useWeeklySetGroupColors } from '../hooks/useWeeklySetGroupColors';
import { useWeeklySetTargets } from '../hooks/useWeeklySetTargets';
import { useActiveWorkoutStore } from '../stores/activeWorkoutStore';
import { useExerciseDateStore } from '../stores/exerciseDateStore';
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
 * going, what was logged on a given day, and the way in to every exercise list
 * and workout setting.
 *
 * The tab keeps its own selected day (`exerciseDateStore`) rather than sharing
 * the diary's: the sections above the log are "now"-based, so a day scrubbed
 * back to on the Food tab must not put yesterday's workouts under today's
 * suggestion — the recovery strip included.
 */
const ExerciseHomeScreen: React.FC<ExerciseHomeScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding();
  const usesNativeTabs = useNativeIOSTabsActive();
  const scrollViewRef = useRef<ScrollView>(null);
  const calendarRef = useRef<CalendarSheetRef>(null);

  const [accentPrimary, trackColor, textMuted] = useCSSVariable([
    '--color-accent-primary',
    '--color-progress-track',
    '--color-text-muted',
  ]) as [string, string, string];

  const selectedDate = useExerciseDateStore((s) => s.selectedDate);
  const setSelectedDate = useExerciseDateStore((s) => s.setSelectedDate);
  const goToPreviousDay = useExerciseDateStore((s) => s.goToPreviousDay);
  const goToNextDay = useExerciseDateStore((s) => s.goToNextDay);
  const goToToday = useExerciseDateStore((s) => s.goToToday);
  const syncTodayRollover = useExerciseDateStore((s) => s.syncTodayRollover);

  useFocusEffect(
    useCallback(() => {
      syncTodayRollover();
    }, [syncTodayRollover]),
  );

  // Re-tapping the active Exercise tab returns to today and the top, matching
  // the Food tab.
  useEffect(() => {
    return navigation.addListener('tabPress', () => {
      if (navigation.isFocused()) {
        goToToday();
        scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      }
    });
  }, [navigation, goToToday]);

  // Published so the Add sheet can date what it logs from this tab; without it
  // a workout added while browsing an earlier day lands on the diary's day.
  useEffect(() => {
    navigation.setParams({ selectedDate });
  }, [navigation, selectedDate]);

  const { isNavigationLocked, runNavigationAction } = useNavigationActionGuard(navigation);
  const { isConnected } = useServerConnection();
  const { preferences } = usePreferences();
  const weightUnit = (preferences?.default_weight_unit as 'kg' | 'lbs') ?? 'kg';
  const distanceUnit = (preferences?.default_distance_unit as 'km' | 'miles') ?? 'km';
  const { getImageSource } = useExerciseImageSource();
  // Which gym the user is in constrains every suggestion this tab makes, so
  // the row names it rather than describing what gym profiles are.
  const { activeProfile } = useGymProfiles();

  const { summary } = useDailySummary({ date: selectedDate, enabled: isConnected });

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

  const openWorkout = (session: ExerciseSessionResponse) => {
    if (session.type === 'preset') {
      // The live workout's surface is the active screen; detail is for
      // reviewing past or planned sessions.
      if (useActiveWorkoutStore.getState().sessionId === session.id) {
        navigation.navigate('ActiveWorkout');
        return;
      }
      navigation.navigate('WorkoutDetail', { session });
      return;
    }
    navigation.navigate('ActivityDetail', { session });
  };

  return (
    <>
      <ScrollView
        ref={scrollViewRef}
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
            <Text
              className="text-2xl font-bold text-text-primary"
              testID="exercise-home-title"
            >
              Exercise
            </Text>
          </View>
        )}

        {/*
          Up Next is a permanent section here, and "now"-based like the fasting
          card: it is today's recommendation regardless of the day the log
          below is showing.
        */}
        <UpNextCard navigation={navigation} />

        {/* A failed read is not worth an error block on a tab that has plenty
            else to offer; the section simply stays out of the way, and the ring
            is one tap away on the targets screen either way.

            Only when there is nothing to draw, though: `isError` is also true
            when a refetch fails over cached data (React Query's isRefetchError),
            and this hook refetches on every tab focus — so keying on the error
            alone would blank a populated ring the moment the user went offline. */}
        {!(isWeekError && !week) && (
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

        {/* Per-muscle freshness from GET /api/workout-recommendations/recovery.
            "Now"-based like Up Next above it — today's recovery, not the
            selected day's. The strip hides itself when it has nothing to draw. */}
        <MuscleRecoveryStrip />


        <DateNavigator
          title="Logged"
          selectedDate={selectedDate}
          onPreviousDay={goToPreviousDay}
          onNextDay={goToNextDay}
          onToday={goToToday}
          onDatePress={() => calendarRef.current?.present()}
          showDateAlways
          compact
          skipHorizontalPadding
        />

        <View className="mt-3 mb-6">
          <ExerciseSummary
            exerciseEntries={summary?.exerciseEntries ?? []}
            entryDate={selectedDate}
            getImageSource={getImageSource}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            onAddExercise={() => addSheetRef.current?.present({ initialMenu: 'exercise' })}
            onPressWorkout={openWorkout}
          />
        </View>

        <View className="mb-3">
          <Text className="text-lg font-semibold text-text-primary">Create</Text>
        </View>

        {/* The Library tab used to be the app's only way to author a custom
            exercise or a preset from scratch. Everything else that reaches
            those forms starts from a finished session. */}
        <View className="flex-row justify-between mb-6">
          <CreateTile
            icon="exercise-weights"
            title="Exercise"
            subtitle="Manual entry"
            disabled={isNavigationLocked}
            onPress={() =>
              runNavigationAction(() =>
                navigation.navigate('ExerciseForm', { mode: 'create-exercise' }),
              )
            }
            className="w-[48%]"
            testID="exercise-home-create-exercise"
          />
          <CreateTile
            icon="bookmark-filled"
            title="Workout preset"
            subtitle="Exercise routine"
            disabled={isNavigationLocked}
            onPress={() =>
              runNavigationAction(() =>
                navigation.navigate('WorkoutPresetForm', { mode: 'create-preset' }),
              )
            }
            className="w-[48%]"
            testID="exercise-home-create-preset"
          />
        </View>

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

        {/* Weekly set targets are reachable from the week card above too, but
            that card hides itself when the read came back with nothing —
            leaving the screen that sets the targets unreachable exactly when a
            user would go looking for it. This row does not hide. */}
        <SettingsRowGroup>
          <SettingsRow
            icon="workout-settings"
            title="Gym profiles"
            subtitle={
              activeProfile
                ? `Active: ${activeProfile.name}`
                : 'No active profile — every exercise is available'
            }
            onPress={() => navigation.navigate('GymProfiles')}
            testID="exercise-home-gym-profiles"
          />
          <SettingsRow
            icon="chart-bar"
            title="Weekly set targets"
            subtitle="Working sets per muscle group, per week"
            onPress={() => navigation.navigate('WeeklySetTargets')}
            testID="exercise-home-weekly-set-targets"
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

      <CalendarSheet
        ref={calendarRef}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />
    </>
  );
};

export default ExerciseHomeScreen;
