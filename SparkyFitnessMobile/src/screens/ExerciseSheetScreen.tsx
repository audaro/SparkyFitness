import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import ActiveWorkoutExerciseCard from '../components/ActiveWorkoutExerciseCard';
import { type AnchorRect } from '../components/AnchoredMenu';
import ExerciseHeroMedia from '../components/ExerciseHeroMedia';
import ExerciseHistoryList from '../components/ExerciseHistoryList';
import ExerciseSetRestSheet from '../components/ExerciseSetRestSheet';
import Icon, { type IconName } from '../components/Icon';
import { MetricColumnMenu } from '../components/WorkoutMenus';
import { usePreferences } from '../hooks';
import { useActiveWorkoutRestSheet } from '../hooks/useActiveWorkoutRestSheet';
import { useExerciseImageSource } from '../hooks/useExerciseImageSource';
import { useScreenHeader, type HeaderItem } from '../hooks/useScreenHeader';
import { useSelectedExercise } from '../hooks/useSelectedExercise';
import { localizeExerciseTaxonomyValue } from '../localization/exerciseTaxonomy';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';
import {
  useActiveWorkoutStore,
  type ActiveSetPatch,
} from '../stores/activeWorkoutStore';
import type { RootStackScreenProps } from '../types/navigation';
import { resolveSnapshotModality } from '../utils/workoutSession';

type ExerciseSheetScreenProps = RootStackScreenProps<'ExerciseSheet'>;

/** The card requires a collapse handler; the sheet has nothing to collapse. */
function noop(): void {}

interface SheetChipProps {
  icon: IconName;
  label: string;
  active?: boolean;
  onPress: () => void;
  testID?: string;
}

/** One action in the sheet's chip row. */
function SheetChip({ icon, label, active, onPress, testID }: SheetChipProps) {
  const [accentPrimary, textSecondary] = useCSSVariable([
    '--color-accent-primary',
    '--color-text-secondary',
  ]) as [string, string];
  const color = active ? accentPrimary : textSecondary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active === true }}
      testID={testID}
      className={`flex-row items-center gap-1.5 rounded-full px-3 py-2 ${
        active ? 'bg-accent-subtle' : 'bg-raised'
      }`}
    >
      <Icon name={icon} size={14} color={color} />
      <Text className="text-sm" style={{ color }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Title-cases one taxonomy word for the subtitle line. */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * The per-exercise sheet: everything about one exercise *in this workout*,
 * on one screen — what it is, how it is programmed, and the control that
 * starts it.
 *
 * Deliberately a separate route from `ExerciseDetailScreen` rather than a mode
 * of it. That screen is the catalog page: it answers "what is this movement"
 * for an exercise that may not be in any workout, and its tabs, library
 * actions and edit/delete belong to that job. This one answers "what am I
 * doing with it right now", and its content is owned by a session or a plan.
 * Merging them would mean a screen where half the chrome is wrong in either
 * context. The ⋯ menu keeps a route to the catalog page so nothing that used
 * to be reachable stops being reachable.
 *
 * Two contexts, two owners of the sets — see `RootStackParamList`:
 * `active-workout` edits the live session entry through the store;
 * `up-next` edits a copy and hands it back to the Up Next screen, because a
 * generated recommendation has no session entries and nothing to persist to.
 */
function ExerciseSheetScreen({ navigation, route }: ExerciseSheetScreenProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const usesNativeHeader = useNativeIOSHeadersActive();
  const exercise = route.params.item;

  // Equipment · primary muscles · level, skipping whatever this exercise has
  // nothing for, so a sparse custom exercise gets a short line and not a line
  // of separators.
  const taxonomyLine = useMemo(() => {
    const equipment = (exercise.equipment ?? [])
      .filter((value) => value?.trim().length > 0)
      .map(capitalize)
      .join(', ');
    const muscles = (exercise.primary_muscles ?? [])
      .filter((value) => value?.trim().length > 0)
      .map(capitalize)
      .join(', ');
    const level = localizeExerciseTaxonomyValue(t, 'level', exercise.level);
    return [equipment, muscles, level].filter((part) => part.length > 0);
  }, [exercise.equipment, exercise.primary_muscles, exercise.level, t]);

  // Active-workout context only for now: the live session owns the sets. The
  // up-next context edits a local copy of the generated plan, which lands with
  // the Up Next repoint.
  const entryId =
    route.params.context === 'active-workout' ? route.params.entryId : null;
  const entry = useActiveWorkoutStore((s) =>
    entryId == null
      ? null
      : (s.session?.exercises.find((e) => e.id === entryId) ?? null)
  );
  const completedSetIds = useActiveWorkoutStore((s) => s.completedSetIds);
  const activeSetId = useActiveWorkoutStore((s) => s.activeSetId);
  const restState = useActiveWorkoutStore((s) => s.rest.state);
  const holdSetId = useActiveWorkoutStore((s) => s.hold.setId);
  const holdState = useActiveWorkoutStore((s) => s.hold.state);

  const metricColumn = useAppPreferencesStore(
    (s) => s.activeWorkoutMetricColumn
  );
  const { preferences } = usePreferences();
  const weightUnit = (preferences?.default_weight_unit ?? 'kg') as 'kg' | 'lbs';
  const distanceUnit =
    (preferences?.default_distance_unit as 'km' | 'miles') ?? 'km';
  const { getImageSource } = useExerciseImageSource();

  const [historyOpen, setHistoryOpen] = useState(false);
  const [metricMenu, setMetricMenu] = useState<{
    anchor: AnchorRect;
    clampedToRpe: boolean;
  } | null>(null);

  const {
    ref: setRestSheetRef,
    present: presentRestSheet,
    apply: applySetRests,
  } = useActiveWorkoutRestSheet();

  // Same gate the active-workout screen applies: a hold belongs to the cursor
  // set, and the store refuses one mid-rest or mid-hold. Passing the callback
  // only when it would be accepted keeps the row from offering a dead control.
  const canStartHold =
    holdState === 'idle' && restState === 'ready' && activeSetId != null;

  const handleCommitField = useCallback(
    (setId: string, patch: ActiveSetPatch) => {
      useActiveWorkoutStore.getState().updateSetField(setId, patch);
    },
    []
  );
  const handleCompleteSet = useCallback((setId: string) => {
    useActiveWorkoutStore.getState().completeSet(setId);
  }, []);
  const handleUncomplete = useCallback((setId: string) => {
    useActiveWorkoutStore.getState().uncompleteSet(setId);
  }, []);
  const handleStartHold = useCallback((setId: string) => {
    useActiveWorkoutStore.getState().startHold(setId);
  }, []);
  const handleDeleteSet = useCallback((setId: string) => {
    useActiveWorkoutStore.getState().deleteSet(setId);
  }, []);
  const handleAddSet = useCallback((id: string) => {
    useActiveWorkoutStore.getState().addSetToExercise(id);
  }, []);
  const handlePressMetricHeader = useCallback(
    (anchor: AnchorRect, clampedToRpe: boolean) => {
      setMetricMenu({ anchor, clampedToRpe });
    },
    []
  );
  const handlePressRest = useCallback(() => {
    if (entryId != null) presentRestSheet(entryId);
  }, [entryId, presentRestSheet]);

  // Replacing swaps the entry under this screen, so the sheet re-points its own
  // `item` at the incoming exercise rather than leaving the hero and title
  // describing the movement that is no longer here.
  const handleReplace = useCallback(() => {
    if (entryId == null) return;
    navigation.navigate('ExerciseSearch', {
      returnKey: route.key,
      suggestForExerciseId: entry?.exercise_id ?? undefined,
    });
  }, [navigation, route.key, entryId, entry?.exercise_id]);

  // Only the active-workout arm carries the picker's return params; the
  // weak-type check on the other arm is the type system saying the same thing.
  useSelectedExercise(
    route.params.context === 'active-workout' ? route.params : undefined,
    (incoming) => {
      if (entryId == null) return;
      useActiveWorkoutStore.getState().replaceExercise(entryId, incoming);
      navigation.setParams({ item: incoming });
    }
  );

  const handleOpenCatalog = useCallback(() => {
    navigation.navigate('ExerciseDetail', {
      item: exercise,
      hideWorkoutActions: true,
    });
  }, [navigation, exercise]);

  const rightItems = useMemo<HeaderItem[]>(
    () => [
      {
        kind: 'menu',
        accessibilityLabel: t('exerciseSheet.moreOptions', {
          defaultValue: 'More options',
        }),
        items: [
          {
            label: t('exerciseSheet.exerciseDetails', {
              defaultValue: 'Exercise details',
            }),
            sfSymbol: 'info.circle',
            icon: 'info-circle',
            onPress: handleOpenCatalog,
          },
        ],
      },
    ],
    [t, handleOpenCatalog]
  );

  const header = useScreenHeader({
    title: exercise.name,
    nativeTitle: exercise.name,
    borderless: true,
    left: { kind: 'back' },
    right: rightItems,
  });

  return (
    <View
      className="flex-1 bg-background"
      style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
    >
      {header}

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 16,
        }}
      >
        <ExerciseHeroMedia exercise={exercise} />

        <View className="mt-4">
          <Text
            className="text-text-primary font-bold"
            style={{ fontSize: 24 }}
            testID="exercise-sheet-name"
          >
            {exercise.name}
          </Text>
          {taxonomyLine.length > 0 ? (
            <Text
              className="text-text-secondary mt-1"
              style={{ fontSize: 13 }}
              testID="exercise-sheet-taxonomy"
            >
              {taxonomyLine.join(' · ')}
            </Text>
          ) : null}
        </View>

        <View className="flex-row flex-wrap gap-2 mt-4">
          <SheetChip
            icon="timer"
            label={t('exerciseSheet.rest', { defaultValue: 'Rest' })}
            onPress={handlePressRest}
            testID="exercise-sheet-rest-chip"
          />
          <SheetChip
            icon="arrow-undo"
            label={t('exerciseSheet.history', { defaultValue: 'History' })}
            active={historyOpen}
            onPress={() => setHistoryOpen((open) => !open)}
            testID="exercise-sheet-history-chip"
          />
          <SheetChip
            icon="swap-vertical"
            label={t('exerciseSheet.replace', { defaultValue: 'Replace' })}
            onPress={handleReplace}
            testID="exercise-sheet-replace-chip"
          />
        </View>

        {historyOpen ? (
          <View className="mt-4" testID="exercise-sheet-history">
            <ExerciseHistoryList
              exerciseId={exercise.id}
              weightUnit={weightUnit}
              distanceUnit={distanceUnit}
              modality={resolveSnapshotModality(entry?.exercise_snapshot)}
            />
          </View>
        ) : null}

        {entry != null ? (
          <View className="mt-4" testID="exercise-sheet-sets">
            <ActiveWorkoutExerciseCard
              exercise={entry}
              // The sheet is this one exercise, so there is nothing to collapse
              // into and no header to collapse from.
              headerless
              expanded
              // The Rest chip above owns rest here; leaving the card's chip in
              // would put the same control on screen twice.
              showRestChip={false}
              completedSetIds={completedSetIds}
              activeSetId={activeSetId}
              metricColumn={metricColumn}
              weightUnit={weightUnit}
              distanceUnit={distanceUnit}
              getImageSource={getImageSource}
              onToggleExpanded={noop}
              onPressMetricHeader={handlePressMetricHeader}
              onComplete={handleCompleteSet}
              onStartHold={canStartHold ? handleStartHold : undefined}
              holdingSetId={holdSetId}
              onUncomplete={handleUncomplete}
              onCommitField={handleCommitField}
              onDeleteSet={handleDeleteSet}
              onAddSet={handleAddSet}
            />
          </View>
        ) : null}
      </ScrollView>

      <ExerciseSetRestSheet ref={setRestSheetRef} onApply={applySetRests} />

      <MetricColumnMenu
        anchor={metricMenu?.anchor ?? null}
        onClose={() => setMetricMenu(null)}
        includeWeightMetrics={!metricMenu?.clampedToRpe}
      />
    </View>
  );
}

export default ExerciseSheetScreen;
