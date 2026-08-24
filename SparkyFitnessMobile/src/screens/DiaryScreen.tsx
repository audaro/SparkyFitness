import React, { useState, useCallback, useRef, useMemo, useEffect, useLayoutEffect } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import Button from '../components/ui/Button';
import { Gesture, GestureDetector, Directions } from 'react-native-gesture-handler';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { hasSupplementNutrition } from '@workspace/shared';
import CreateTile from '../components/CreateTile';
import DateNavigator from '../components/DateNavigator';
import FoodLibraryRow from '../components/FoodLibraryRow';
import FoodSummary from '../components/FoodSummary';
import MealLibraryRow from '../components/MealLibraryRow';
import MeasurementsSummary from '../components/MeasurementsSummary';
import SettingsRow, { SettingsRowGroup } from '../components/SettingsRow';
import CalendarSheet, { type CalendarSheetRef } from '../components/CalendarSheet';
import ServingAdjustSheet, { type ServingAdjustSheetRef } from '../components/ServingAdjustSheet';
import EmptyDayIllustration from '../components/EmptyDayIllustration';
import DiaryCalorieMacroSummary from '../components/DiaryCalorieMacroSummary';
import StatusView from '../components/StatusView';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import {
  useCustomNutrients,
  useDailySummary,
  useFavorites,
  useFoods,
  useMealTypes,
  useNutrientDisplayPreferences,
  useRecentMeals,
  useServerConnection,
} from '../hooks';
import { useMeasurements } from '../hooks/useMeasurements';
import { useCustomMeasurementsByDate } from '../hooks/useCustomMeasurements';
import { useNavigationActionGuard } from '../hooks/useNavigationActionGuard';
import { isManualSource } from '../utils/customMeasurementsForm';
import { usePreferences } from '../hooks/usePreferences';
import { foodItemToFoodInfo } from '../types/foodInfo';
import type { FoodItem } from '../types/foods';
import type { Meal } from '../types/meals';
import {
  setNativeHeaderDatePickerOptions,
  type NativeHeaderDatePickerNavigation,
} from '../utils/nativeHeaderDatePicker';
import { useNativeIOSTabsActive } from '../services/nativeTabBarPreference';
import { useDiaryDateStore } from '../stores/diaryDateStore';
import { getHistoricalMealTypeLabel, getMealTypeDisplayLabel } from '../utils/mealNutrition';
import type { FoodEntry } from '../types/foodEntries';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, TabParamList } from '../types/navigation';
import { useHeaderActionColors } from '../hooks/useHeaderActionColors';

type DiaryScreenProps = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'Food'>,
  NativeStackScreenProps<RootStackParamList>
>;

const RECENT_LIMIT = 4;

type RecentItem = { type: 'meal'; data: Meal } | { type: 'food'; data: FoodItem };

const DiaryScreen: React.FC<DiaryScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const selectedDate = useDiaryDateStore((s) => s.selectedDate);
  const setSelectedDate = useDiaryDateStore((s) => s.setSelectedDate);
  const goToPreviousDay = useDiaryDateStore((s) => s.goToPreviousDay);
  const goToNextDay = useDiaryDateStore((s) => s.goToNextDay);
  const goToToday = useDiaryDateStore((s) => s.goToToday);
  const syncTodayRollover = useDiaryDateStore((s) => s.syncTodayRollover);
  const scrollViewRef = useRef<ScrollView>(null);
  const calendarRef = useRef<CalendarSheetRef>(null);
  const servingSheetRef = useRef<ServingAdjustSheetRef>(null);

  useFocusEffect(
    useCallback(() => {
      syncTodayRollover();
    }, [syncTodayRollover])
  );

  // Re-tapping the active Food tab acts as a quick return to today's
  // entries and the top of the screen.
  useEffect(() => {
    return navigation.addListener('tabPress', () => {
      if (navigation.isFocused()) {
        goToToday();
        scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      }
    });
  }, [navigation, goToToday]);

  useEffect(() => {
    navigation.setParams({ selectedDate });
  }, [navigation, selectedDate]);

  const openCalendar = useCallback(() => calendarRef.current?.present(), []);
  const accentColor = useCSSVariable('--color-accent-primary') as string;
  const usesNativeTabs = useNativeIOSTabsActive();
  const { defaultColor: nativeHeaderActionColor } = useHeaderActionColors();

  const syncNativeHeaderDatePicker = useCallback(() => {
    if (!usesNativeTabs) return;

    setNativeHeaderDatePickerOptions(
      navigation as unknown as NativeHeaderDatePickerNavigation,
      {
        selectedDate,
        onPreviousDate: goToPreviousDay,
        onDatePress: openCalendar,
        onNextDate: goToNextDay,
        tintColor: nativeHeaderActionColor,
        accessibilityLabel: 'Choose diary date',
      },
    );
  }, [
    goToNextDay,
    goToPreviousDay,
    nativeHeaderActionColor,
    navigation,
    openCalendar,
    selectedDate,
    usesNativeTabs,
  ]);

  useLayoutEffect(() => {
    syncNativeHeaderDatePicker();
  }, [syncNativeHeaderDatePicker]);

  useFocusEffect(
    useCallback(() => {
      syncNativeHeaderDatePicker();
    }, [syncNativeHeaderDatePicker])
  );

  const swipeGesture = useMemo(() => Gesture.Race(
    Gesture.Fling().direction(Directions.RIGHT).onEnd(goToPreviousDay).runOnJS(true),
    Gesture.Fling().direction(Directions.LEFT).onEnd(goToNextDay).runOnJS(true),
  ), [goToPreviousDay, goToNextDay]);

  const handleCalendarSelect = useCallback((date: string) => setSelectedDate(date), [setSelectedDate]);
  const { mealTypes } = useMealTypes();
  const openMealTypeDetail = useCallback(
    (mealTypeId: string | null, mealTypeName: string, entries: FoodEntry[]) => {
      // Resolve the label from the canonical definition (ownership-aware); for
      // a deleted/hidden type fall back to the literal historical name.
      const definition = mealTypes.find((mt) => mt.id === mealTypeId) ?? null;
      const mealLabel = definition
        ? getMealTypeDisplayLabel(definition)
        : getHistoricalMealTypeLabel(mealTypeName);
      navigation.navigate('MealTypeDetail', {
        date: selectedDate,
        mealTypeId: mealTypeId ?? undefined,
        mealType: mealTypeName,
        mealLabel,
      });
    },
    [navigation, selectedDate, mealTypes],
  );

  const { preferences } = usePreferences();
  const weightMode = preferences?.default_weight_unit ?? 'kg';
  const bodyUnit: 'cm' | 'inches' =
    preferences?.default_measurement_unit === 'inches' ? 'inches' : 'cm';
  const heightMode = preferences?.default_measurement_unit ?? 'cm';

  const { isConnected, isLoading: isConnectionLoading } = useServerConnection();
  const {
    summary,
    isLoading,
    isError,
    refetch,
  } = useDailySummary({
    date: selectedDate,
    enabled: isConnected,
  });
  const {
    measurements,
    refetch: refetchMeasurements,
  } = useMeasurements({
    date: selectedDate,
    enabled: isConnected,
  });
  const {
    data: customMeasurements,
    refetch: refetchCustomMeasurements,
  } = useCustomMeasurementsByDate(selectedDate, { enabled: isConnected });
  const {
    customNutrients,
    refetch: refetchCustomNutrients,
  } = useCustomNutrients({ enabled: isConnected });
  const {
    preferences: nutrientPrefs,
    refetch: refetchNutrientPrefs,
  } = useNutrientDisplayPreferences({ enabled: isConnected });
  // The library half of the tab: what the Library tab used to hold for food,
  // now that this screen is the single Food destination.
  const { isNavigationLocked, runNavigationAction } = useNavigationActionGuard(navigation);
  const { favoriteFoods, favoriteMeals } = useFavorites({ enabled: isConnected });
  const {
    recentFoods,
    isLoading: isRecentFoodsLoading,
    isError: isRecentFoodsError,
    refetch: refetchRecentFoods,
  } = useFoods({ enabled: isConnected });
  const {
    recentMeals,
    isLoading: isRecentMealsLoading,
    isError: isRecentMealsError,
    refetch: refetchRecentMeals,
  } = useRecentMeals({ enabled: isConnected, limit: RECENT_LIMIT });

  const favoriteFoodIds = useMemo(() => new Set(favoriteFoods.map((f) => f.id)), [favoriteFoods]);
  const favoriteMealIds = useMemo(() => new Set(favoriteMeals.map((m) => m.id)), [favoriteMeals]);

  const recentItems = useMemo<RecentItem[]>(() => {
    const items: RecentItem[] = [];
    let mi = 0;
    let fi = 0;
    while (items.length < RECENT_LIMIT) {
      const hasMeal = mi < recentMeals.length;
      const hasFood = fi < recentFoods.length;
      if (!hasMeal && !hasFood) break;
      if (hasMeal) {
        items.push({ type: 'meal', data: recentMeals[mi++] });
        if (items.length >= RECENT_LIMIT) break;
      }
      if (hasFood) items.push({ type: 'food', data: recentFoods[fi++] });
    }
    return items;
  }, [recentMeals, recentFoods]);

  const isRecentLoading = isRecentFoodsLoading || isRecentMealsLoading;
  // Only when nothing survived the failure: a refetch that fails over cached
  // rows must leave the rows on screen.
  const showRecentError =
    !isRecentLoading && recentItems.length === 0 && (isRecentFoodsError || isRecentMealsError);

  const retryRecent = () => {
    void refetchRecentFoods();
    void refetchRecentMeals();
  };

  const diaryNutrientRow = nutrientPrefs.find(
    (p) => p.view_group === 'diary' && p.platform === 'mobile',
  );
  const customNutrientKeys = (diaryNutrientRow?.visible_nutrients ?? []).slice(0, 4);
  const hasAnyMeasurement = useMemo(() => {
    // Only MANUAL custom entries make the Measurements section meaningful — a
    // user with pages of health-synced custom entries should not see the
    // section flash on their behalf.
    const manualCustom = customMeasurements?.filter((e) => isManualSource(e.source)) ?? [];
    if (manualCustom.length > 0) return true;
    if (!measurements) return false;
    return (
      measurements.weight != null ||
      measurements.body_fat_percentage != null ||
      measurements.height != null ||
      measurements.neck != null ||
      measurements.waist != null ||
      measurements.hips != null ||
      measurements.steps != null
    );
  }, [measurements, customMeasurements]);

  // Manual-only custom entries for the Diary tiles: health-synced entries are
  // filtered here (before presentation) so MeasurementsSummary never receives
  // them; the component itself re-filters defensively too.
  const manualCustomMeasurements = useMemo(
    () => (customMeasurements ?? []).filter((e) => isManualSource(e.source)),
    [customMeasurements],
  );

  const [refreshing, setRefreshing] = useState(false);
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding();
  const onRefresh = useCallback(async () => {
    if (!isConnected) return;
    setRefreshing(true);
    // Error-isolated refresh: one failing query must not prevent the others
    // from completing nor produce an unhandled rejection. The spinner is torn
    // down in `finally` regardless of individual query outcomes.
    try {
      await Promise.allSettled([
        refetch(),
        refetchMeasurements(),
        refetchCustomMeasurements(),
        refetchCustomNutrients(),
        refetchNutrientPrefs(),
        refetchRecentFoods(),
        refetchRecentMeals(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [
    isConnected,
    refetch,
    refetchMeasurements,
    refetchCustomMeasurements,
    refetchCustomNutrients,
    refetchNutrientPrefs,
    refetchRecentFoods,
    refetchRecentMeals,
  ]);

  const isRefreshing = refreshing;

  // The day's half of the tab. It renders inside the scroll view rather than
  // replacing it, so a failed or slow summary read never takes the Create,
  // Browse and Recently Logged sections down with it.
  const renderDay = () => {
    if (isLoading) {
      return <StatusView inline loading title="Loading diary..." />;
    }

    // `isError` is also true when a refetch fails over cached data, and this
    // screen refetches on focus — so only a read that left nothing behind
    // replaces the day with an error.
    if (isError && !summary) {
      return (
        <StatusView
          inline
          icon="alert-circle"
          iconTone="danger"
          iconSize={48}
          title="Failed to load diary"
          subtitle="Please check your connection and try again."
          action={{ label: 'Retry', onPress: () => refetch(), variant: 'primary' }}
        />
      );
    }

    if (!summary) {
      return null;
    }

    return (
      <>
        {(summary.foodEntries.length > 0 ||
          hasSupplementNutrition(summary.supplementTotals) ||
          summary.exerciseEntries.length > 0 ||
          summary.calorieGoal > 0) && (
          <DiaryCalorieMacroSummary
            summary={summary}
            showNetCarbs={preferences?.show_net_carbs === true}
            customNutrientKeys={customNutrientKeys}
            customNutrients={customNutrients}
          />
        )}
        {/* A logged supplement is something the user recorded for this day, so the day is
            not empty even with no food, exercise or measurement. */}
        {summary.foodEntries.length === 0 &&
        !hasSupplementNutrition(summary.supplementTotals) &&
        summary.exerciseEntries.length === 0 &&
        !hasAnyMeasurement ? (
          <>
            <EmptyDayIllustration />
            <Button
              variant="primary"
              className="px-6 mt-4 self-center"
              onPress={() => navigation.navigate('FoodSearch', { date: selectedDate })}
            >
              Add Food
            </Button>
          </>
        ) : (
          <>
            <FoodSummary
              foodEntries={summary.foodEntries}
              mealTypes={mealTypes}
              goals={summary.goals}
              calorieGoal={summary.calorieGoal}
              onAddFood={() => navigation.navigate('FoodSearch', { date: selectedDate })}
              onAdjustServing={(entry) => servingSheetRef.current?.present(entry)}
              onPressMealType={openMealTypeDetail}
            />
            {/* Logged exercise lives on the Exercise tab. It still counts
                towards the calorie balance above, and towards whether the day
                is empty — a day with a workout on it is not an empty day. */}
            <MeasurementsSummary
              measurements={measurements}
              customMeasurements={manualCustomMeasurements}
              weightMode={weightMode}
              bodyUnit={bodyUnit}
              heightMode={heightMode}
              onPress={() => navigation.navigate('MeasurementsAdd', { date: selectedDate })}
            />
          </>
        )}
      </>
    );
  };

  const renderContent = () => {
    if (!isConnectionLoading && !isConnected) {
      return (
        <StatusView
          icon="cloud-offline"
          iconTone="muted"
          iconSize={64}
          title="No server configured"
          subtitle="Configure your server connection in Settings to view your diary."
          action={{ label: 'Go to Settings', onPress: () => navigation.navigate('Settings'), variant: 'primary' }}
        />
      );
    }

    if (isConnectionLoading) {
      return <StatusView loading title="Loading diary..." />;
    }

    return (
      <ScrollView
        ref={scrollViewRef}
        className="flex-1 bg-background"
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 80 + activeWorkoutBarPadding,
        }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior={usesNativeTabs ? 'automatic' : 'never'}
        automaticallyAdjustsScrollIndicatorInsets={usesNativeTabs}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={accentColor} />
        }
      >
        {renderDay()}

        <View className="mb-3 mt-6">
          <Text className="text-lg font-semibold text-text-primary">Create</Text>
        </View>

        <View className="flex-row justify-between mb-6">
          <CreateTile
            icon="food"
            title="Food"
            subtitle="Manual entry"
            disabled={isNavigationLocked}
            onPress={() =>
              runNavigationAction(() =>
                navigation.navigate('FoodForm', { mode: 'create-food', pickerMode: 'library' }),
              )
            }
            className="w-[48%]"
            testID="food-home-create-food"
          />
          <CreateTile
            icon="meal"
            title="Meal"
            subtitle="Group foods"
            disabled={isNavigationLocked}
            onPress={() => runNavigationAction(() => navigation.navigate('MealAdd'))}
            className="w-[48%]"
            testID="food-home-create-meal"
          />
        </View>

        <View className="mb-3">
          <Text className="text-lg font-semibold text-text-primary">Quick access</Text>
        </View>

        <SettingsRowGroup>
          <SettingsRow
            icon="food"
            title="Foods"
            subtitle="Every food you can log"
            onPress={() => navigation.navigate('FoodsLibrary')}
            testID="food-home-foods-library"
          />
          <SettingsRow
            icon="meal"
            title="Meals"
            subtitle="Groups of foods you have saved"
            onPress={() => navigation.navigate('MealsLibrary')}
            testID="food-home-meals-library"
          />
        </SettingsRowGroup>

        <View className="mb-3">
          <Text className="text-lg font-semibold text-text-primary">Recently logged</Text>
        </View>

        <View className="bg-surface rounded-xl overflow-hidden shadow-sm">
          {isRecentLoading ? (
            <StatusView inline loading title="Loading recent items..." />
          ) : showRecentError ? (
            <View className="px-4 py-6 items-start">
              <Text className="text-text-secondary text-sm">Failed to load recent items.</Text>
              <Button
                variant="link"
                className="px-0 py-0 mt-3"
                textClassName="text-sm"
                onPress={retryRecent}
              >
                Retry
              </Button>
            </View>
          ) : recentItems.length > 0 ? (
            recentItems.map((item, index) => {
              const showDivider = index < recentItems.length - 1;
              if (item.type === 'meal') {
                return (
                  <MealLibraryRow
                    key={`meal-${item.data.id}`}
                    meal={item.data}
                    isFavorite={favoriteMealIds.has(item.data.id)}
                    showDivider={showDivider}
                    onPress={() =>
                      navigation.navigate('MealDetail', {
                        mealId: item.data.id,
                        initialMeal: item.data,
                      })
                    }
                  />
                );
              }
              return (
                <FoodLibraryRow
                  key={`food-${item.data.id}`}
                  food={item.data}
                  isFavorite={favoriteFoodIds.has(item.data.id)}
                  showDivider={showDivider}
                  onPress={() =>
                    navigation.navigate('FoodDetail', { item: foodItemToFoodInfo(item.data) })
                  }
                />
              );
            })
          ) : (
            <View className="px-4 py-6">
              <Text className="text-text-primary text-base font-medium">No recent items yet</Text>
              <Text className="text-text-secondary text-sm mt-1">
                Foods and meals you log will appear here for quick access.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    );
  };

  const renderedContent = renderContent();

  if (usesNativeTabs) {
    return (
      <>
        <GestureDetector gesture={swipeGesture}>
          <View collapsable={false} className="flex-1">
            {renderedContent ?? <View className="flex-1 bg-background" />}
          </View>
        </GestureDetector>
        <CalendarSheet ref={calendarRef} selectedDate={selectedDate} onSelectDate={handleCalendarSelect} />
        <ServingAdjustSheet ref={servingSheetRef} onViewEntry={(entry) => navigation.navigate('FoodEntryView', { entry })} />
      </>
    );
  }

  const content = (
    <>
      {!isConnectionLoading && isConnected ? (
        <DateNavigator
          title="Food"
          selectedDate={selectedDate}
          onPreviousDay={goToPreviousDay}
          onNextDay={goToNextDay}
          onToday={goToToday}
          onDatePress={openCalendar}
          showDateAlways
        />
      ) : !isConnectionLoading && (
        <View
          className="px-4 pb-5"
          style={{ paddingTop: insets.top + 16 }}
        >
          <Text className="text-2xl font-bold text-text-primary">Food</Text>
        </View>
      )}
      {renderedContent}
      <CalendarSheet ref={calendarRef} selectedDate={selectedDate} onSelectDate={handleCalendarSelect} />
      <ServingAdjustSheet ref={servingSheetRef} onViewEntry={(entry) => navigation.navigate('FoodEntryView', { entry })} />
    </>
  );

  return (
    <>
      <GestureDetector gesture={swipeGesture}>
        <View className="flex-1 bg-background">
          {content}
        </View>
      </GestureDetector>
    </>
  );
};

export default DiaryScreen;
