import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { hasSupplementNutrition } from '@workspace/shared';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import {
  Directions,
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import CalendarSheet, {
  type CalendarSheetRef,
} from '../components/CalendarSheet';
import CheckInPhotosSummary from '../components/CheckInPhotosSummary';
import CreateTile from '../components/CreateTile';
import DateNavigator from '../components/DateNavigator';
import DiaryCalorieMacroSummary from '../components/DiaryCalorieMacroSummary';
import EmptyDayIllustration from '../components/EmptyDayIllustration';
import FoodLibraryRow from '../components/FoodLibraryRow';
import FoodSummary from '../components/FoodSummary';
import MealLibraryRow from '../components/MealLibraryRow';
import MeasurementsSummary from '../components/MeasurementsSummary';
import ServingAdjustSheet, {
  type ServingAdjustSheetRef,
} from '../components/ServingAdjustSheet';
import SettingsRow, { SettingsRowGroup } from '../components/SettingsRow';
import { BedTimeCard, NapsCard, WakeUpCard } from '../components/SleepCards';
import StatusView from '../components/StatusView';
import Button from '../components/ui/Button';
import {
  useCustomNutrients,
  useDailySummary,
  useFamilyUsers,
  useFavorites,
  useFoods,
  useMealTypes,
  useNutrientDisplayPreferences,
  useRecentMeals,
  useServerConnection,
} from '../hooks';
import { useActiveWorkoutPlans } from '../hooks/useActiveWorkoutPlan';
import {
  useCheckInPhotoDates,
  useCheckInPhotosByDate,
} from '../hooks/useCheckInPhotos';
import { useCustomMeasurementsByDate } from '../hooks/useCustomMeasurements';
import { useHeaderActionColors } from '../hooks/useHeaderActionColors';
import { useMeasurements } from '../hooks/useMeasurements';
import { useNavigationActionGuard } from '../hooks/useNavigationActionGuard';
import { usePreferences } from '../hooks/usePreferences';
import { useSleepDay } from '../hooks/useSleepDay';
import { useTodayRollover } from '../hooks/useTodayRollover';
import { useNativeIOSTabsActive } from '../services/nativeTabBarPreference';
import { useDiaryDateStore } from '../stores/diaryDateStore';
import type { FoodEntry } from '../types/foodEntries';
import { foodItemToFoodInfo } from '../types/foodInfo';
import type { FoodItem } from '../types/foods';
import type { Meal } from '../types/meals';
import type { RootStackParamList, TabParamList } from '../types/navigation';
import { isManualSource } from '../utils/customMeasurementsForm';
import { formatDateLabel } from '../utils/dateUtils';
import {
  getHistoricalMealTypeLabel,
  getMealTypeDisplayLabel,
} from '../utils/mealNutrition';
import {
  setNativeHeaderDatePickerOptions,
  type NativeHeaderDatePickerNavigation,
} from '../utils/nativeHeaderDatePicker';

type DiaryScreenProps = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'Food'>,
  NativeStackScreenProps<RootStackParamList>
>;

const RECENT_LIMIT = 4;

type RecentItem =
  { type: 'meal'; data: Meal } | { type: 'food'; data: FoodItem };

const DiaryScreen: React.FC<DiaryScreenProps> = ({ navigation }) => {
  const { t, i18n: translationI18n } = useTranslation();
  const dateLocale = translationI18n.language.startsWith('pl')
    ? 'pl-PL'
    : 'en-US';
  const insets = useSafeAreaInsets();
  const { isConnected, isLoading: isConnectionLoading } = useServerConnection();
  const { data: familyUsers = [] } = useFamilyUsers({ enabled: isConnected });
  const hasFamilyDiaries = isConnected && familyUsers.length > 0;
  const selectedDate = useDiaryDateStore((s) => s.selectedDate);
  const setSelectedDate = useDiaryDateStore((s) => s.setSelectedDate);
  const goToPreviousDay = useDiaryDateStore((s) => s.goToPreviousDay);
  const goToNextDay = useDiaryDateStore((s) => s.goToNextDay);
  const goToToday = useDiaryDateStore((s) => s.goToToday);
  const syncTodayRollover = useDiaryDateStore((s) => s.syncTodayRollover);
  const scrollViewRef = useRef<ScrollView>(null);
  const calendarRef = useRef<CalendarSheetRef>(null);
  const servingSheetRef = useRef<ServingAdjustSheetRef>(null);

  useTodayRollover(syncTodayRollover);

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

  // The photo-day markers are fetched on first calendar open rather than at
  // mount: a user who never opens the picker should not pay a request for it.
  const [calendarOpened, setCalendarOpened] = useState(false);
  const { dates: photoDates } = useCheckInPhotoDates(calendarOpened);
  // Owned here rather than inside CheckInPhotosSummary: the empty-day predicate
  // below needs the same answer, and one subscription keeps refetch-on-focus
  // from firing twice for one query.
  const { photos: dayPhotos, isLoading: isPhotosLoading } =
    useCheckInPhotosByDate(selectedDate);
  const openCalendar = useCallback(() => {
    setCalendarOpened(true);
    calendarRef.current?.present();
  }, []);
  const openFamilyDiaries = useCallback(
    () => navigation.navigate('FamilyMembers'),
    [navigation]
  );
  const familyDiariesAccessibilityLabel = t('familyDiary.openFamilyDiaries', {
    defaultValue: 'Open family diaries',
  });
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
        accessibilityLabel: t('diary.chooseDate', {
          defaultValue: 'Choose diary date',
        }),
        previousDayLabel: t('common.previousDay', {
          defaultValue: ': previous day',
        }),
        nextDayLabel: t('common.nextDay', { defaultValue: ': next day' }),
        dateLabel: `${formatDateLabel(selectedDate, t, dateLocale)} ▾`,
        t,
        locale: dateLocale,
        leadingAction: hasFamilyDiaries
          ? {
              sfSymbol: 'person.2.fill',
              onPress: openFamilyDiaries,
              accessibilityLabel: familyDiariesAccessibilityLabel,
              identifier: 'family-diaries',
            }
          : undefined,
      }
    );
  }, [
    goToNextDay,
    goToPreviousDay,
    nativeHeaderActionColor,
    navigation,
    openFamilyDiaries,
    openCalendar,
    selectedDate,
    familyDiariesAccessibilityLabel,
    hasFamilyDiaries,
    usesNativeTabs,
    t,
    dateLocale,
  ]);

  useLayoutEffect(() => {
    syncNativeHeaderDatePicker();
  }, [syncNativeHeaderDatePicker]);

  useFocusEffect(
    useCallback(() => {
      syncNativeHeaderDatePicker();
    }, [syncNativeHeaderDatePicker])
  );

  const swipeGesture = useMemo(
    () =>
      Gesture.Race(
        Gesture.Fling()
          .direction(Directions.RIGHT)
          .onEnd(goToPreviousDay)
          .runOnJS(true),
        Gesture.Fling()
          .direction(Directions.LEFT)
          .onEnd(goToNextDay)
          .runOnJS(true)
      ),
    [goToPreviousDay, goToNextDay]
  );

  const handleCalendarSelect = useCallback(
    (date: string) => setSelectedDate(date),
    [setSelectedDate]
  );
  const { mealTypes } = useMealTypes();
  const openMealTypeDetail = useCallback(
    (mealTypeId: string | null, mealTypeName: string, entries: FoodEntry[]) => {
      // Resolve the label from the canonical definition (ownership-aware); for
      // a deleted/hidden type fall back to the literal historical name.
      const definition = mealTypes.find((mt) => mt.id === mealTypeId) ?? null;
      const mealLabel = definition
        ? getMealTypeDisplayLabel(definition, t)
        : getHistoricalMealTypeLabel(mealTypeName, t);
      navigation.navigate('MealTypeDetail', {
        date: selectedDate,
        mealTypeId: mealTypeId ?? undefined,
        mealType: mealTypeName,
        mealLabel,
      });
    },
    [navigation, selectedDate, mealTypes, t]
  );

  const { preferences } = usePreferences();
  const weightMode = preferences?.default_weight_unit ?? 'kg';
  const bodyUnit: 'cm' | 'inches' =
    preferences?.default_measurement_unit === 'inches' ? 'inches' : 'cm';
  const heightMode = preferences?.default_measurement_unit ?? 'cm';

  const { summary, isLoading, isError, refetch } = useDailySummary({
    date: selectedDate,
    enabled: isConnected,
  });
  const { measurements, refetch: refetchMeasurements } = useMeasurements({
    date: selectedDate,
    enabled: isConnected,
  });
  const { data: customMeasurements, refetch: refetchCustomMeasurements } =
    useCustomMeasurementsByDate(selectedDate, { enabled: isConnected });
  const { customNutrients, refetch: refetchCustomNutrients } =
    useCustomNutrients({ enabled: isConnected });
  const { preferences: nutrientPrefs, refetch: refetchNutrientPrefs } =
    useNutrientDisplayPreferences({ enabled: isConnected });
  // The library half of the tab: what the Library tab used to hold for food,
  // now that this screen is the single Food destination.
  const { isNavigationLocked, runNavigationAction } =
    useNavigationActionGuard(navigation);
  const { favoriteFoods, favoriteMeals } = useFavorites({
    enabled: isConnected,
  });
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

  const favoriteFoodIds = useMemo(
    () => new Set(favoriteFoods.map((f) => f.id)),
    [favoriteFoods]
  );
  const favoriteMealIds = useMemo(
    () => new Set(favoriteMeals.map((m) => m.id)),
    [favoriteMeals]
  );

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
    !isRecentLoading &&
    recentItems.length === 0 &&
    (isRecentFoodsError || isRecentMealsError);

  const retryRecent = () => {
    void refetchRecentFoods();
    void refetchRecentMeals();
  };

  const {
    wakeUp,
    naps,
    bedTime,
    isLoading: isSleepLoading,
    refetch: refetchSleep,
  } = useSleepDay(selectedDate, { enabled: isConnected });

  const diaryNutrientRow = nutrientPrefs.find(
    (p) => p.view_group === 'diary' && p.platform === 'mobile'
  );
  const customNutrientKeys = (diaryNutrientRow?.visible_nutrients ?? []).slice(
    0,
    4
  );
  const hasAnyMeasurement = useMemo(() => {
    // Only MANUAL custom entries make the Measurements section meaningful — a
    // user with pages of health-synced custom entries should not see the
    // section flash on their behalf.
    const manualCustom =
      customMeasurements?.filter((e) => isManualSource(e.source)) ?? [];
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
    [customMeasurements]
  );

  const { plans: activePlans } = useActiveWorkoutPlans(selectedDate);

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
        refetchSleep(),
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
    refetchSleep,
  ]);

  const isRefreshing = refreshing;

  const isDayEmpty = useMemo(() => {
    return (
      !isSleepLoading &&
      wakeUp === null &&
      summary?.foodEntries.length === 0 &&
      !hasSupplementNutrition(summary?.supplementTotals) && //A logged supplement is something the user recorded for this day, so the day is not empty even with no food, exercise or measurement.
      summary?.exerciseEntries.length === 0 &&
      !hasAnyMeasurement &&
      // A progress photo is something the user recorded for this day, so it
      // defeats the empty state exactly as a logged supplement does. Gated on
      // the load like sleep above: ungated, a day with photos flashes the empty
      // illustration until they arrive.
      !isPhotosLoading &&
      dayPhotos.length === 0 &&
      naps.length === 0 &&
      bedTime === null &&
      !activePlans.some((plan) => plan.next_assignment)
    );
  }, [
    isSleepLoading,
    wakeUp,
    summary,
    hasAnyMeasurement,
    isPhotosLoading,
    dayPhotos,
    naps,
    bedTime,
    activePlans,
  ]);

  // The day's half of the tab. It renders inside the scroll view rather than
  // replacing it, so a failed or slow summary read never takes the Create,
  // Browse and Recently Logged sections down with it.
  const renderDay = () => {
    // Sleep is deliberately not part of this gate: the cards render nothing
    // until their entries arrive, so a slow `/api/sleep` fills them in late
    // instead of holding the food that already loaded behind "Loading diary...".
    if (isLoading) {
      return (
        <StatusView
          inline
          loading
          title={t('diaryHome.loading', { defaultValue: 'Loading diary...' })}
        />
      );
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
          title={t('diary.loadFailed', {
            defaultValue: 'Failed to load diary',
          })}
          subtitle={t('diary.checkConnection', {
            defaultValue: 'Please check your connection and try again.',
          })}
          action={{
            label: t('diary.retry', { defaultValue: 'Retry' }),
            onPress: () => refetch(),
            variant: 'primary',
          }}
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
        {isDayEmpty ? (
          <>
            <EmptyDayIllustration />
            <Button
              variant="primary"
              className="px-6 mt-4 self-center"
              onPress={() =>
                navigation.navigate('FoodSearch', { date: selectedDate })
              }
            >
              {t('diary.addFood', { defaultValue: 'Add Food' })}
            </Button>
          </>
        ) : (
          <>
            <WakeUpCard
              entry={wakeUp}
              day={selectedDate}
              navigation={navigation}
            />
            <FoodSummary
              foodEntries={summary.foodEntries}
              mealTypes={mealTypes}
              goals={summary.goals}
              calorieGoal={summary.calorieGoal}
              onAddFood={() =>
                navigation.navigate('FoodSearch', { date: selectedDate })
              }
              onAdjustServing={(entry) =>
                servingSheetRef.current?.present(entry)
              }
              onPressMealType={openMealTypeDetail}
            />
            {/* Logged exercise, and the plan session standing for the day,
                live on the Exercise tab. Both still count towards the calorie
                balance above and towards whether the day is empty — a day with
                a workout or a pending plan session on it is not empty. */}
            <NapsCard naps={naps} day={selectedDate} navigation={navigation} />
            <BedTimeCard
              entry={bedTime}
              day={selectedDate}
              navigation={navigation}
            />
            <MeasurementsSummary
              measurements={measurements}
              customMeasurements={manualCustomMeasurements}
              weightMode={weightMode}
              bodyUnit={bodyUnit}
              heightMode={heightMode}
              onPress={() =>
                navigation.navigate('MeasurementsAdd', { date: selectedDate })
              }
            />
            {/* Below the measurements: both are the same check-in, keyed on
                (user_id, entry_date) server-side. */}
            <CheckInPhotosSummary
              date={selectedDate}
              photos={dayPhotos}
              onPress={() =>
                navigation.navigate('ProgressPhotos', { date: selectedDate })
              }
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
          title={t('diaryHome.noServerTitle', {
            defaultValue: 'No server configured',
          })}
          subtitle={t('diaryHome.noServerSubtitle', {
            defaultValue:
              'Configure your server connection in Settings to view your diary.',
          })}
          action={{
            label: t('diaryHome.goToSettings', {
              defaultValue: 'Go to Settings',
            }),
            onPress: () => navigation.navigate('Settings'),
            variant: 'primary',
          }}
        />
      );
    }

    if (isConnectionLoading) {
      return (
        <StatusView
          loading
          title={t('diaryHome.loading', { defaultValue: 'Loading diary...' })}
        />
      );
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
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={accentColor}
          />
        }
      >
        {renderDay()}

        <View className="mb-3 mt-6">
          <Text className="text-lg font-semibold text-text-primary">
            {t('diaryHome.create', { defaultValue: 'Create' })}
          </Text>
        </View>

        <View className="flex-row justify-between mb-6">
          <CreateTile
            icon="food"
            title={t('diaryHome.createFood', { defaultValue: 'Food' })}
            subtitle={t('diaryHome.createFoodSubtitle', {
              defaultValue: 'Manual entry',
            })}
            disabled={isNavigationLocked}
            onPress={() =>
              runNavigationAction(() =>
                navigation.navigate('FoodForm', {
                  mode: 'create-food',
                  pickerMode: 'library',
                })
              )
            }
            className="w-[48%]"
            testID="food-home-create-food"
          />
          <CreateTile
            icon="meal"
            title={t('diaryHome.createMeal', { defaultValue: 'Meal' })}
            subtitle={t('diaryHome.createMealSubtitle', {
              defaultValue: 'Group foods',
            })}
            disabled={isNavigationLocked}
            onPress={() =>
              runNavigationAction(() => navigation.navigate('MealAdd'))
            }
            className="w-[48%]"
            testID="food-home-create-meal"
          />
        </View>

        <View className="mb-3">
          <Text className="text-lg font-semibold text-text-primary">
            {t('diaryHome.quickAccess', { defaultValue: 'Quick access' })}
          </Text>
        </View>

        <SettingsRowGroup>
          <SettingsRow
            icon="food"
            title={t('diaryHome.foodsLibrary', { defaultValue: 'Foods' })}
            subtitle={t('diaryHome.foodsLibrarySubtitle', {
              defaultValue: 'Every food you can log',
            })}
            onPress={() => navigation.navigate('FoodsLibrary')}
            testID="food-home-foods-library"
          />
          <SettingsRow
            icon="meal"
            title={t('diaryHome.mealsLibrary', { defaultValue: 'Meals' })}
            subtitle={t('diaryHome.mealsLibrarySubtitle', {
              defaultValue: 'Groups of foods you have saved',
            })}
            onPress={() => navigation.navigate('MealsLibrary')}
            testID="food-home-meals-library"
          />
          <SettingsRow
            icon="calendar"
            title={t('diaryHome.mealPlans', { defaultValue: 'Meal plans' })}
            subtitle={t('diaryHome.mealPlansSubtitle', {
              defaultValue: 'Repeat meals on selected days',
            })}
            onPress={() => navigation.navigate('MealPlans')}
            testID="food-home-meal-plans"
          />
        </SettingsRowGroup>

        <View className="mb-3">
          <Text className="text-lg font-semibold text-text-primary">
            {t('diaryHome.recentlyLogged', { defaultValue: 'Recently logged' })}
          </Text>
        </View>

        <View className="bg-surface rounded-xl overflow-hidden shadow-sm">
          {isRecentLoading ? (
            <StatusView
              inline
              loading
              title={t('diaryHome.recentLoading', {
                defaultValue: 'Loading recent items...',
              })}
            />
          ) : showRecentError ? (
            <View className="px-4 py-6 items-start">
              <Text className="text-text-secondary text-sm">
                {t('diaryHome.recentFailed', {
                  defaultValue: 'Failed to load recent items.',
                })}
              </Text>
              <Button
                variant="link"
                className="px-0 py-0 mt-3"
                textClassName="text-sm"
                onPress={retryRecent}
              >
                {t('common.retry', { defaultValue: 'Retry' })}
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
                    navigation.navigate('FoodDetail', {
                      item: foodItemToFoodInfo(item.data),
                    })
                  }
                />
              );
            })
          ) : (
            <View className="px-4 py-6">
              <Text className="text-text-primary text-base font-medium">
                {t('diaryHome.recentEmptyTitle', {
                  defaultValue: 'No recent items yet',
                })}
              </Text>
              <Text className="text-text-secondary text-sm mt-1">
                {t('diaryHome.recentEmptySubtitle', {
                  defaultValue:
                    'Foods and meals you log will appear here for quick access.',
                })}
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
        <CalendarSheet
          ref={calendarRef}
          selectedDate={selectedDate}
          onSelectDate={handleCalendarSelect}
          markedDates={photoDates}
        />
        <ServingAdjustSheet
          ref={servingSheetRef}
          onViewEntry={(entry) =>
            navigation.navigate('FoodEntryView', { entry })
          }
        />
      </>
    );
  }

  const content = (
    <>
      {!isConnectionLoading && isConnected ? (
        <DateNavigator
          title={t('diary.title', { defaultValue: 'Food' })}
          selectedDate={selectedDate}
          onPreviousDay={goToPreviousDay}
          onNextDay={goToNextDay}
          onToday={goToToday}
          onDatePress={openCalendar}
          showDateAlways
          action={
            hasFamilyDiaries
              ? {
                  icon: 'people',
                  accessibilityLabel: familyDiariesAccessibilityLabel,
                  onPress: openFamilyDiaries,
                }
              : undefined
          }
        />
      ) : (
        !isConnectionLoading && (
          <View className="px-4 pb-5" style={{ paddingTop: insets.top + 16 }}>
            <Text className="text-2xl font-bold text-text-primary">
              {t('diary.title', { defaultValue: 'Food' })}
            </Text>
          </View>
        )
      )}
      {renderedContent}
      <CalendarSheet
        ref={calendarRef}
        selectedDate={selectedDate}
        onSelectDate={handleCalendarSelect}
        markedDates={photoDates}
      />
      <ServingAdjustSheet
        ref={servingSheetRef}
        onViewEntry={(entry) => navigation.navigate('FoodEntryView', { entry })}
      />
    </>
  );

  return (
    <>
      <GestureDetector gesture={swipeGesture}>
        <View className="flex-1 bg-background">{content}</View>
      </GestureDetector>
    </>
  );
};

export default DiaryScreen;
