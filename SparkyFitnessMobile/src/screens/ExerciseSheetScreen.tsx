import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommonActions } from '@react-navigation/native';
import { useCSSVariable } from 'uniwind';

import ActiveWorkoutExerciseCard from '../components/ActiveWorkoutExerciseCard';
import CoachNoteCard from '../components/CoachNoteCard';
import { type AnchorRect } from '../components/AnchoredMenu';
import ExerciseHeroMedia from '../components/ExerciseHeroMedia';
import ExerciseHistoryList from '../components/ExerciseHistoryList';
import FooterActionBar from '../components/FooterActionBar';
import ExerciseSetRestSheet, {
  type ExerciseSetRestUpdate,
} from '../components/ExerciseSetRestSheet';
import Icon, { type IconName } from '../components/Icon';
import { MetricColumnMenu } from '../components/WorkoutMenus';
import Button from '../components/ui/Button';
import { usePreferences } from '../hooks';
import { useActiveWorkoutRestSheet } from '../hooks/useActiveWorkoutRestSheet';
import { useExerciseImageSource } from '../hooks/useExerciseImageSource';
import { useSelectedExercise } from '../hooks/useSelectedExercise';
import { localizeExerciseTaxonomyValue } from '../localization/exerciseTaxonomy';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';
import {
  useActiveWorkoutStore,
  type ActiveSetPatch,
} from '../stores/activeWorkoutStore';
import type { RootStackScreenProps } from '../types/navigation';
import {
  applyCardSetsToPlannedExercise,
  formatRestChip,
  plannedExerciseToCardExercise,
  resolveSnapshotModality,
  type WorkoutCardSet,
} from '../utils/workoutSession';
import type { PlannedExercise } from '../utils/workoutSupersets';

type ExerciseSheetScreenProps = RootStackScreenProps<'ExerciseSheet'>;

/** A plan exercise being edited, with the client-side ids of its sets. */
interface PlanDraft {
  exercise: PlannedExercise;
  setIds: readonly string[];
}

/** The next `set-<n>` suffix no id in `setIds` is already using. */
function nextPlanSetIdSuffix(setIds: readonly string[]): number {
  let highest = -1;
  for (const id of setIds) {
    const suffix = Number(id.slice('set-'.length));
    if (id.startsWith('set-') && Number.isInteger(suffix) && suffix > highest) {
      highest = suffix;
    }
  }
  return highest + 1;
}

/**
 * The card requires a collapse handler, and a metric-header one; the sheet has
 * nothing to collapse, and the plan card's metric column is fixed.
 */
function noop(): void {}

/** Stable empty map — a plan has nothing completed, and won't. */
const EMPTY_COMPLETED_SETS = {};

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
  const [textSecondaryColor] = useCSSVariable(['--color-text-secondary']) as [
    string,
  ];
  // The close button sits on photographic media in every theme, so its backdrop is
  // a fixed scrim rather than a theme token -- there is no light hero to invert for.
  const scrimColor = 'rgba(0,0,0,0.45)';
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

  // The two contexts own their sets differently. `active-workout` edits the
  // live session through the store. `up-next` edits a local copy of the
  // generated plan and hands each edit straight back to the Up Next screen —
  // a recommendation has no session entries and nothing to persist to.
  const isPlan = route.params.context === 'up-next';
  const planReturnKey =
    route.params.context === 'up-next' ? route.params.returnKey : null;
  // Counted, not `Date.now()`: edits fire in a stream as the user types, and
  // two landing in the same millisecond would share a nonce — Up Next's
  // handoff would take the first as already-consumed and drop the second.
  const planEditNonceRef = useRef(0);
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

  // The plan draft, with its set ids. Seeded once from the route: re-seeding on
  // a param change would throw away edits the moment the sheet writes its own
  // `editedExercise` back to Up Next.
  //
  // The ids are client-side. A RecommendationSet has none — nothing is
  // persisted yet — so the sheet mints them, and they live in state beside the
  // exercise because they must stay stable across edits: they are what the
  // card's rows are keyed and edited by, and an id that moved would land an
  // edit on the wrong row.
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(() =>
    route.params.context === 'up-next'
      ? {
          exercise: route.params.planned,
          setIds: route.params.planned.sets.map((_, index) => `set-${index}`),
        }
      : null
  );

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

  const planCard = useMemo(
    () =>
      planDraft == null
        ? null
        : plannedExerciseToCardExercise(planDraft.exercise, planDraft.setIds),
    [planDraft]
  );

  /**
   * Rewrite the draft from the card sets the mutator produces. The mutator is
   * handed the sets *and* their ids and returns both, so the two can never
   * drift: every edit that reorders or removes a set moves its id with it.
   */
  const editPlanSets = useCallback(
    (
      next: (
        sets: WorkoutCardSet[],
        setIds: readonly string[]
      ) => { sets: WorkoutCardSet[]; setIds: readonly string[] }
    ) => {
      setPlanDraft((current) => {
        if (current == null) return current;
        const cardSets = plannedExerciseToCardExercise(
          current.exercise,
          current.setIds
        ).sets;
        const result = next(cardSets, current.setIds);
        return {
          exercise: applyCardSetsToPlannedExercise(
            current.exercise,
            result.sets
          ),
          setIds: result.setIds,
        };
      });
    },
    []
  );

  const handleCommitField = useCallback(
    (setId: string, patch: ActiveSetPatch) => {
      if (isPlan) {
        editPlanSets((sets, setIds) => ({
          sets: sets.map((set) =>
            String(set.id) === setId ? { ...set, ...patch } : set
          ),
          setIds,
        }));
        return;
      }
      useActiveWorkoutStore.getState().updateSetField(setId, patch);
    },
    [isPlan, editPlanSets]
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
  const handleDeleteSet = useCallback(
    (setId: string) => {
      if (isPlan) {
        editPlanSets((sets, setIds) => {
          const index = sets.findIndex((set) => String(set.id) === setId);
          if (index === -1) return { sets, setIds };
          return {
            sets: sets.filter((_, i) => i !== index),
            setIds: setIds.filter((_, i) => i !== index),
          };
        });
        return;
      }
      useActiveWorkoutStore.getState().deleteSet(setId);
    },
    [isPlan, editPlanSets]
  );
  const handleAddSet = useCallback(
    (id: string) => {
      if (isPlan) {
        editPlanSets((sets, setIds) => {
          // The new set copies the last one, which is what the store's
          // addSetToExercise does and what a lifter adding a set means.
          const last = sets[sets.length - 1];
          // Derived from the ids in hand rather than a counter: the updater
          // may run more than once for one edit, and a counter bumped inside
          // it would skip ids and desync them from the sets.
          const newId = `set-${nextPlanSetIdSuffix(setIds)}`;
          return {
            sets: [
              ...sets,
              {
                ...(last ?? {
                  set_type: 'normal',
                  weight: null,
                  reps: null,
                  duration: null,
                  distance: null,
                  rest_time: null,
                }),
                id: newId,
                set_number: sets.length + 1,
              },
            ],
            setIds: [...setIds, newId],
          };
        });
        return;
      }
      useActiveWorkoutStore.getState().addSetToExercise(id);
    },
    [isPlan, editPlanSets]
  );
  const handleApplyRests = useCallback(
    (updates: ExerciseSetRestUpdate[]) => {
      if (isPlan) {
        const bySetId = new Map(updates.map((u) => [u.setId, u.seconds]));
        editPlanSets((sets, setIds) => ({
          sets: sets.map((set) =>
            bySetId.has(String(set.id))
              ? { ...set, rest_time: bySetId.get(String(set.id)) ?? null }
              : set
          ),
          setIds,
        }));
        return;
      }
      applySetRests(updates);
    },
    [isPlan, editPlanSets, applySetRests]
  );
  const handlePressMetricHeader = useCallback(
    (anchor: AnchorRect, clampedToRpe: boolean) => {
      setMetricMenu({ anchor, clampedToRpe });
    },
    []
  );
  const handlePressRest = useCallback(() => {
    if (planDraft != null) {
      // Presented straight rather than through the hook's `present`, which
      // reads the live session. Never as a superset member: per-round rest is
      // shared across members and the sheet holds one exercise, so grouping
      // stays Up Next's to edit.
      setRestSheetRef.current?.present(
        exercise.name,
        planDraft.exercise.sets.map((set, index) => ({
          setId: planDraft.setIds[index] ?? `set-${index}`,
          setNumber: set.set_number,
          restSec: set.rest_time ?? null,
        })),
        false
      );
      return;
    }
    if (entryId != null) presentRestSheet(entryId);
  }, [planDraft, exercise.name, setRestSheetRef, entryId, presentRestSheet]);

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

  /**
   * Hand every plan edit straight back to Up Next, the way the active-workout
   * context writes straight to the store: an edit is never held hostage by a
   * footer button the user can swipe past. Nothing is persisted — a
   * recommendation has no per-set storage, so the edit lives in Up Next's plan
   * state until the workout starts, exactly like a superset built there, and
   * is dropped by the same payload swap.
   */
  const planSeedRef = useRef(planDraft?.exercise);
  useEffect(() => {
    if (planReturnKey == null || planDraft == null) return;
    // Opening the sheet is not an edit. Every mutator builds a new exercise
    // object, so still holding the seeded one means nothing has changed and
    // there is nothing to hand back.
    if (planDraft.exercise === planSeedRef.current) return;
    navigation.dispatch({
      ...CommonActions.setParams({
        editedExercise: planDraft.exercise,
        editNonce: ++planEditNonceRef.current,
      }),
      source: planReturnKey,
    });
  }, [navigation, planReturnKey, planDraft]);

  const handleOpenCatalog = useCallback(() => {
    navigation.navigate('ExerciseDetail', {
      item: exercise,
      hideWorkoutActions: true,
    });
  }, [navigation, exercise]);

  /**
   * Rest as it is actually set, not the word "Rest". The chip is the only
   * place this number is visible without opening the drawer, and the drawer
   * is where it is changed — so a chip that named the control rather than its
   * value made the user open it to find out.
   */
  // The store's cursor is the workout's, not this exercise's: opening a sheet
  // does not move it, so a sheet for any other exercise must not offer to log
  // a set that is not on it.
  const sheetActiveSetId = useMemo(() => {
    if (entry == null || activeSetId == null) return null;
    return entry.sets.some((set) => String(set.id) === activeSetId)
      ? activeSetId
      : null;
  }, [entry, activeSetId]);

  const restChipLabel = useMemo(() => {
    const sets = planDraft?.exercise.sets ?? entry?.sets;
    const restSec = sets?.[0]?.rest_time;
    return restSec == null || restSec <= 0
      ? t('exerciseSheet.rest', { defaultValue: 'Rest' })
      : formatRestChip(restSec);
  }, [planDraft, entry, t]);

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingBottom: sheetActiveSetId != null ? 12 : 16,
        }}
      >
        {/* Full bleed, under the status bar: the demonstration is what the
            screen is for, and a title bar over it would spend the top of the
            display naming the exercise the picture already shows. */}
        <ExerciseHeroMedia exercise={exercise} fullBleed />

        <View className="px-4">
          <View className="mt-4 flex-row items-start">
            <View className="flex-1 pr-3">
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
            {/* The written instructions, which live on the catalog page. It
                sits on the title rather than in a menu because it is the one
                thing on this screen nobody can guess from the picture. */}
            <Pressable
              onPress={handleOpenCatalog}
              accessibilityRole="button"
              accessibilityLabel={t('exerciseSheet.howTo', {
                defaultValue: 'How-To',
              })}
              testID="exercise-sheet-how-to"
              className="flex-row items-center gap-1.5 rounded-full bg-raised px-3 py-2"
            >
              <Icon name="play" size={13} color={textSecondaryColor} />
              <Text className="text-text-secondary text-sm font-semibold">
                {t('exerciseSheet.howTo', { defaultValue: 'How-To' })}
              </Text>
            </Pressable>
          </View>

          <View className="flex-row flex-wrap gap-2 mt-4">
            <SheetChip
              icon="timer"
              label={restChipLabel}
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
            {/*
            Replace is active-workout only. Swapping a *planned* exercise
            re-prescribes the whole workout server-side, so it belongs to Up
            Next's row menu, which owns the payload; a chip here would hand
            back one exercise the server never agreed to.
          */}
            {!isPlan && (
              <SheetChip
                icon="swap-vertical"
                label={t('exerciseSheet.replace', { defaultValue: 'Replace' })}
                onPress={handleReplace}
                testID="exercise-sheet-replace-chip"
              />
            )}
          </View>

          {historyOpen ? (
            <View className="mt-4" testID="exercise-sheet-history">
              <ExerciseHistoryList
                exerciseId={exercise.id}
                weightUnit={weightUnit}
                distanceUnit={distanceUnit}
                modality={resolveSnapshotModality(
                  planDraft?.exercise ?? entry?.exercise_snapshot
                )}
              />
            </View>
          ) : null}

          {/* Why the engine picked this exercise. Same card Up Next carries for
              the workout as a whole, so the coach reads as one voice rather
              than as an info banner here and a tinted note there. Live entries
              have no rationale to show: the session carries the exercises, not
              the prescription that produced them. */}
          {isPlan &&
          planDraft != null &&
          planDraft.exercise.rationale.length > 0 ? (
            <CoachNoteCard
              rationale={planDraft.exercise.rationale}
              testID="exercise-sheet-rationale"
            />
          ) : null}

          {planCard != null ? (
            <View className="mt-4" testID="exercise-sheet-sets">
              <ActiveWorkoutExerciseCard
                exercise={planCard}
                mode="plan"
                headerless
                expanded
                setLayout="timeline"
                // The Rest chip above owns rest in this context too.
                showRestChip={false}
                completedSetIds={EMPTY_COMPLETED_SETS}
                activeSetId={null}
                // Not the user's column preference: RPE records effort that has
                // not been made yet, and a RecommendationSet has nowhere to keep
                // it, so a typed value would be dropped on the way back.
                metricColumn="volume"
                weightUnit={weightUnit}
                distanceUnit={distanceUnit}
                getImageSource={getImageSource}
                onToggleExpanded={noop}
                onPressMetricHeader={noop}
                onCommitField={handleCommitField}
                onDeleteSet={handleDeleteSet}
                onAddSet={handleAddSet}
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
                setLayout="timeline"
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
        </View>
      </ScrollView>

      {/*
        The live sheet logs. It is the whole screen for this exercise while it
        is open, and it covers the active workout's own docked bar, so without
        one the only way to log the set you came here to log would be the small
        badge on its row. The plan sheet deliberately has none: Up Next owns
        starting the workout, and a second Start pill here would be a second
        way to begin the same session.
      */}
      {sheetActiveSetId != null && (
        <FooterActionBar>
          <Button
            variant="primary"
            onPress={() => handleCompleteSet(sheetActiveSetId)}
            testID="exercise-sheet-log-set"
            accessibilityLabel={t('activeWorkout.rest.completeSet', {
              defaultValue: 'Log set',
            })}
            className="h-[50px] items-center justify-center rounded-2xl"
            textClassName="text-base"
          >
            {t('activeWorkout.rest.completeSetTitle', {
              defaultValue: 'Log Set',
            })}
          </Button>
        </FooterActionBar>
      )}

      {/* Over the hero, not in a bar above it. Absolute so the media keeps the
          full width, and inset by the safe area because there is no header
          left to hold it clear of the status bar. */}
      <Pressable
        onPress={() => navigation.goBack()}
        accessibilityRole="button"
        accessibilityLabel={t('common.close', { defaultValue: 'Close' })}
        testID="exercise-sheet-close"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={{
          position: 'absolute',
          top: insets.top + 8,
          right: 16,
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: scrimColor,
        }}
      >
        <Icon name="close" size={19} color="#ffffff" />
      </Pressable>

      <ExerciseSetRestSheet ref={setRestSheetRef} onApply={handleApplyRests} />

      <MetricColumnMenu
        anchor={metricMenu?.anchor ?? null}
        onClose={() => setMetricMenu(null)}
        includeWeightMetrics={!metricMenu?.clampedToRpe}
      />
    </View>
  );
}

export default ExerciseSheetScreen;
