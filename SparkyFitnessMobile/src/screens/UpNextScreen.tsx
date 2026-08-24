import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { isCardioModality, type RecommendedExercise } from '@workspace/shared';

import ActionSheet, {
  type ActionSheetItem,
  type ActionSheetRef,
} from '../components/ActionSheet';
import AnchoredMenu, {
  measureAnchoredMenuTrigger,
  type AnchorRect,
} from '../components/AnchoredMenu';
import BottomSheetPicker from '../components/BottomSheetPicker';
import Button from '../components/ui/Button';
import Icon from '../components/Icon';
import SafeImage from '../components/SafeImage';
import StatusView from '../components/StatusView';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import { useSupersetBorders } from '../components/ActiveWorkoutRail';
import { usePreferences } from '../hooks';
import { useExerciseImageSource } from '../hooks/useExerciseImageSource';
import { useGymProfiles, useGymProfileMutations } from '../hooks/useGymProfiles';
import { useStartLiveWorkout } from '../hooks/useStartLiveWorkout';
import {
  useReplaceRecommendationExercise,
  useUpdateRecommendationStatus,
  useWorkoutRecommendation,
} from '../hooks/useWorkoutRecommendation';
import { useSelectedExercise } from '../hooks/useSelectedExercise';
import { useScreenHeader, type HeaderMenuEntry } from '../hooks/useScreenHeader';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import {
  buildRecommendationStartPayload,
  formatDuration,
  formatRecommendedSets,
  formatRestChip,
  makeSparseExercise,
  normalizeWeightUnit,
  orderedRecommendationExercises,
  titleCaseCanonical,
} from '../utils/workoutSession';
import {
  getPlannedSupersetRuns,
  supersetPlannedExercises,
  ungroupPlannedExercise,
  type PlannedExercise,
} from '../utils/workoutSupersets';
import type { RootStackScreenProps } from '../types/navigation';

type UpNextScreenProps = RootStackScreenProps<'UpNext'>;

/** Sentinel for "no equipment constraint" — picker values must be scalars. */
const ANY_GYM = 'any';

const DURATION_OPTIONS = [30, 45, 60, 75, 90, 120];

const UpNextScreen: React.FC<UpNextScreenProps> = ({ navigation, route }) => {
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
  const {
    mutate: replaceExercise,
    isPending: isReplacing,
    variables: replaceVariables,
  } = useReplaceRecommendationExercise();
  // The row being swapped out, so its ⋯ slot can show the wait instead of
  // leaving a network round trip unmarked.
  const replacingExerciseId = isReplacing
    ? (replaceVariables?.exercise_id_out ?? null)
    : null;
  const { getImageSource } = useExerciseImageSource();

  // Distinguishes "Swap is working" from "the duration chip is working" so only
  // the control the user touched shows a spinner.
  const [pendingAction, setPendingAction] = useState<'swap' | 'settings' | null>(null);
  const inFlightRef = useRef(false);

  // Which row's ⋯ menu is open, and where to hang it.
  const [rowMenu, setRowMenu] = useState<{
    exerciseId: string;
    anchor: AnchorRect;
  } | null>(null);
  // The exercise the user chose to replace, held across the trip to the search
  // screen — the selection comes back as a route param with no memory of why.
  const replaceTargetIdRef = useRef<string | null>(null);
  // Per-row ⋯ trigger nodes, so the menu can be measured against the one tapped.
  const rowMenuTriggerRefs = useRef(
    new Map<string, React.ComponentRef<typeof TouchableOpacity> | null>(),
  );

  const payload = recommendation?.payload ?? null;

  // The workout as it will be started: the engine's prescription plus any
  // superset grouping the user built here. Grouping is deliberately NOT stored
  // on the recommendation (blueprint D9) — Swap, Refresh, Replace and the chips
  // all replace the payload wholesale, which would discard it silently. It is
  // applied to the entries that starting the workout creates.
  const basePlan = useMemo<PlannedExercise[]>(
    () => (payload ? orderedRecommendationExercises(payload) : []),
    [payload],
  );
  // Identity of the workout the grouping was built against. Any change to which
  // exercises are prescribed drops it rather than trying to re-home groups onto
  // a workout the user has not seen grouped.
  const planKey = useMemo(
    () => basePlan.map((exercise) => exercise.exercise_id).join('|'),
    [basePlan],
  );
  const [groupedPlan, setGroupedPlan] = useState<{
    key: string;
    exercises: PlannedExercise[];
  } | null>(null);
  // Derived during render rather than reset from an effect: a stale key means
  // the grouping belongs to a workout that is no longer on screen.
  const plan = groupedPlan?.key === planKey ? groupedPlan.exercises : basePlan;
  const editPlan = useCallback(
    (next: (exercises: PlannedExercise[]) => PlannedExercise[]) => {
      setGroupedPlan((previous) => {
        const current = previous?.key === planKey ? previous.exercises : basePlan;
        return { key: planKey, exercises: next(current) };
      });
    },
    [basePlan, planKey],
  );

  const supersetRuns = useMemo(() => getPlannedSupersetRuns(plan), [plan]);
  const { borders: supersetBorders } = useSupersetBorders(
    useMemo(
      () =>
        plan.map((exercise) => ({
          id: exercise.exercise_id,
          superset_group: exercise.superset_group ?? null,
        })),
      [plan],
    ),
  );

  // Every way of getting a different workout hangs off one sheet.
  const swapSheetRef = useRef<ActionSheetRef>(null);
  const handleOpenSwapSheet = useCallback(() => {
    swapSheetRef.current?.present();
  }, []);

  // Muscle targeting is a destination, not a mutation: the picker owns the
  // generate and lands back here with the workout it built.
  const handlePickMuscles = useCallback(() => {
    navigation.navigate('PickMuscles');
  }, [navigation]);

  const handleSavedWorkouts = useCallback(() => {
    navigation.navigate('WorkoutPresetsLibrary');
  }, [navigation]);

  const handleCreateFromScratch = useCallback(() => {
    navigation.navigate('WorkoutPresetForm', { mode: 'create-preset' });
  }, [navigation]);

  const handleOnDemand = useCallback(() => {
    navigation.navigate('OnDemandWorkouts');
  }, [navigation]);

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

  // Whole-workout regeneration: same targets, different exercises. This is the
  // screen's only whole-workout swap path — the Swap button is the sheet now.
  const handleRefreshWorkout = useCallback(() => {
    void runGenerate({ swap: true }, 'swap');
  }, [runGenerate]);

  // Templating the generated workout is review-and-save through the preset
  // create form, prefilled from the payload — the same shape as "Save as
  // preset" on a logged workout. Nothing is written until the user saves, and
  // the params snapshot the payload, so a generate landing behind them cannot
  // swap the form's contents out from under the review.
  const handleSaveWorkout = useCallback(() => {
    if (!payload) return;
    navigation.navigate('WorkoutPresetForm', {
      mode: 'create-preset',
      sourceRecommendation: payload,
    });
  }, [navigation, payload]);

  // Superset building is one sheet in two stages, the shape the preset form's
  // row menu uses: choose the exercise to build around, then the one to pair
  // with it. A null `anchorId` is the first stage.
  const supersetSheetRef = useRef<ActionSheetRef>(null);
  const [supersetAnchorId, setSupersetAnchorId] = useState<string | null>(null);

  const groupedExerciseIds = useMemo(
    () => new Set(supersetRuns.flatMap((run) => run.entryIds)),
    [supersetRuns],
  );
  // Only ungrouped exercises can be pulled into a group; an anchor that is
  // already in a run extends it, which is what makes a 3+ circuit reachable.
  const supersetCandidateIds = useMemo(
    () =>
      plan
        .filter((exercise) => !groupedExerciseIds.has(exercise.exercise_id))
        .map((exercise) => exercise.exercise_id),
    [plan, groupedExerciseIds],
  );
  const canBuildSuperset = plan.length >= 2 && supersetCandidateIds.length >= 1;

  const handleBuildSuperset = useCallback(() => {
    setSupersetAnchorId(null);
    supersetSheetRef.current?.present();
  }, []);

  const handleUngroupExercise = useCallback(
    (exerciseId: string) => {
      editPlan((exercises) => ungroupPlannedExercise(exercises, exerciseId));
    },
    [editPlan],
  );

  const supersetSheetItems = useMemo<ActionSheetItem[]>(() => {
    const nameOf = (exerciseId: string) =>
      plan.find((exercise) => exercise.exercise_id === exerciseId)?.exercise_name ??
      'Exercise';

    if (supersetAnchorId != null) {
      return supersetCandidateIds
        .filter((exerciseId) => exerciseId !== supersetAnchorId)
        .map((exerciseId) => ({
          key: exerciseId,
          label: nameOf(exerciseId),
          onPress: () => {
            editPlan((exercises) =>
              supersetPlannedExercises(exercises, supersetAnchorId, exerciseId),
            );
          },
        }));
    }

    return plan
      .filter((exercise) =>
        // An exercise with no possible partner would open an empty stage two.
        supersetCandidateIds.some((id) => id !== exercise.exercise_id),
      )
      .map((exercise) => ({
        key: exercise.exercise_id,
        label: exercise.exercise_name,
        // Keeps the sheet presented; the candidate list swaps in place.
        dismissOnPress: false,
        onPress: () => setSupersetAnchorId(exercise.exercise_id),
      }));
  }, [plan, supersetAnchorId, supersetCandidateIds, editPlan]);

  // The ⋯ menu. "Share" is deferred indefinitely (blueprint D2) and is not a
  // row. Menu entries carry no disabled state on either header path, so the
  // handlers guard themselves instead of rendering a dead-looking row.
  const overflowMenuItems = useMemo<HeaderMenuEntry[]>(() => {
    const items: HeaderMenuEntry[] = [
      {
        label: 'Save workout',
        sfSymbol: 'bookmark',
        icon: 'bookmark',
        onPress: handleSaveWorkout,
      },
    ];
    // Omitted rather than shown dead when there is nothing left to pair — a
    // one-exercise workout, or one already grouped end to end.
    if (canBuildSuperset) {
      items.push({
        label: 'Build superset/circuit',
        sfSymbol: 'arrow.trianglehead.2.clockwise',
        icon: 'swap-vertical',
        onPress: handleBuildSuperset,
      });
    }
    items.push({
      label: 'Refresh',
      sfSymbol: 'arrow.triangle.2.circlepath',
      icon: 'sync',
      onPress: handleRefreshWorkout,
    });
    return items;
  }, [handleSaveWorkout, canBuildSuperset, handleBuildSuperset, handleRefreshWorkout]);

  // `renderContent()` only reaches the Swap button once a workout exists; every
  // other branch is a `StatusView`, which takes exactly one action — and it is
  // already spoken for by Generate / Retry. So the sheet moves to the header in
  // exactly those states, and the two entry points are never both on screen.
  const showsSwapButton = !isLoading && !isError && !!recommendation && !!payload;

  const header = useScreenHeader({
    title: 'Up Next',
    left: { kind: 'back' },
    // With a workout on screen the header carries its ⋯ menu; without one there
    // is nothing to save or refresh, so the slot carries the sheet instead.
    // Never both, and neither is `role: 'primary'` — the screen declares no
    // accent header action.
    right: showsSwapButton
      ? {
          kind: 'menu',
          items: overflowMenuItems,
          accessibilityLabel: 'Workout options',
          identifier: 'up-next-overflow',
        }
      : {
          kind: 'text',
          // The sheet is "how do I get a workout" here, not "swap this one" —
          // there is nothing on screen to swap. Neutral (no `role`), so the
          // screen still declares no accent header action.
          label: 'New',
          onPress: handleOpenSwapSheet,
          // Retargeting mid-generate would leave two requests racing for the
          // same recommendation row, and the loser would silently win the cache.
          disabled: isGenerating || isStarting,
          accessibilityLabel: 'New workout options',
          identifier: 'up-next-workout-options',
        },
  });

  const handleOpenRowMenu = useCallback((exerciseId: string) => {
    measureAnchoredMenuTrigger(
      rowMenuTriggerRefs.current.get(exerciseId) ?? null,
      (anchor) => setRowMenu({ exerciseId, anchor }),
    );
  }, []);

  const handleReplaceExercise = useCallback(
    (exerciseId: string) => {
      replaceTargetIdRef.current = exerciseId;
      navigation.navigate('ExerciseSearch', {
        returnKey: route.key,
        suggestForExerciseId: exerciseId,
      });
    },
    [navigation, route.key],
  );

  // The picked replacement comes back here. The server re-prescribes the
  // incoming exercise and returns the whole workout, so nothing is spliced
  // client-side — see `replaceRecommendationExercise`.
  useSelectedExercise(route.params, (exercise) => {
    const outgoing = replaceTargetIdRef.current;
    replaceTargetIdRef.current = null;
    if (!outgoing || outgoing === exercise.id) return;
    replaceExercise({ exercise_id_out: outgoing, exercise_id_in: exercise.id });
  });

  // Every row is a destination that produces a *different* workout. Ordered by
  // how much the user has to decide: name the muscles, reuse one they saved,
  // build one by hand, or take a themed session whole. Regenerating the same
  // targets is not one of these rows — it is the ⋯ menu's Refresh.
  const swapSheetItems = useMemo<ActionSheetItem[]>(
    () => [
      { key: 'pick-muscles', label: 'Pick Muscles', onPress: handlePickMuscles },
      { key: 'saved-workouts', label: 'Saved Workouts', onPress: handleSavedWorkouts },
      {
        key: 'create-from-scratch',
        label: 'Create From Scratch',
        onPress: handleCreateFromScratch,
      },
      { key: 'on-demand', label: 'On Demand', onPress: handleOnDemand },
    ],
    [handlePickMuscles, handleSavedWorkouts, handleCreateFromScratch, handleOnDemand],
  );

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
      // `plan`, not the payload: this is where a locally built superset becomes
      // a `superset_group` on the entries, and its ordering is what makes each
      // run adjacent.
      exercises: buildRecommendationStartPayload(plan),
    });
    // Optimistic, best-effort lifecycle marker. `startLiveWorkout` swallows its
    // own failures (it owns the toast) and returns the same void promise either
    // way, so there is no success signal to gate on — and the "workout already
    // in progress" prompt makes the store's sessionId a false one. Nothing
    // server-side branches on the status yet, so a marker set for a start the
    // user then cancelled costs nothing; a failure here must never unwind a
    // workout that is already live.
    updateStatus({ id: recommendation.id, status: 'started' });
  }, [recommendation, payload, plan, startLiveWorkout, updateStatus]);

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

  // The row body opens the exercise; the trailing ⋯ is a sibling pressable, not
  // a nested one, so the two cannot mis-fire into each other.
  const renderExerciseRow = (exercise: PlannedExercise) => {
    const image = exercise.images[0] ?? null;
    const supersetBorder = supersetBorders.get(exercise.exercise_id) ?? null;
    return (
      <View
        key={exercise.exercise_id}
        className="flex-row items-center border-b border-border-subtle"
      >
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
      </TouchableOpacity>
        <TouchableOpacity
          className="px-4 py-3"
          activeOpacity={0.7}
          hitSlop={8}
          disabled={isGenerating || isStarting || isReplacing}
          accessibilityRole="button"
          accessibilityLabel={`More options for ${exercise.exercise_name}`}
          testID="up-next-exercise-menu"
          ref={(node) => {
            rowMenuTriggerRefs.current.set(exercise.exercise_id, node);
          }}
          onPress={() => handleOpenRowMenu(exercise.exercise_id)}
        >
          {replacingExerciseId === exercise.exercise_id ? (
            <ActivityIndicator size="small" color={accentPrimary} />
          ) : (
            <Icon name="ellipsis-horizontal" size={20} color={textMuted} />
          )}
        </TouchableOpacity>
      </View>
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
              {payload.muscle_groups.map(titleCaseCanonical).join(', ')}
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
                onPress={handleOpenSwapSheet}
                disabled={isGenerating || isStarting}
                loading={pendingAction === 'swap' && isGenerating}
                testID="up-next-swap"
              >
                Swap workout
              </Button>
            </View>
          </View>

          {plan.map(renderExerciseRow)}
        </ScrollView>

        <View
          className="px-4 pt-3 border-t border-border-subtle bg-background"
          style={{ paddingBottom: insets.bottom + 12 + activeWorkoutBarPadding }}
        >
          <Button
            variant="primary"
            onPress={handleStart}
            disabled={isGenerating || isReplacing}
            loading={isStarting}
            testID="up-next-start"
          >
            Start Workout
          </Button>
        </View>

        <AnchoredMenu
          visible={rowMenu !== null}
          anchor={rowMenu?.anchor ?? null}
          onClose={() => setRowMenu(null)}
          items={[
            {
              key: 'replace',
              label: 'Replace exercise',
              icon: 'swap-vertical',
              onPress: () => {
                const exerciseId = rowMenu?.exerciseId;
                setRowMenu(null);
                if (exerciseId) handleReplaceExercise(exerciseId);
              },
            },
            // Ungrouping lives on the row rather than in the ⋯ menu: the group a
            // tap is meant to break up is the one the row is already pointing at.
            ...(rowMenu && groupedExerciseIds.has(rowMenu.exerciseId)
              ? [
                  {
                    key: 'ungroup',
                    label: 'Remove from superset',
                    icon: 'close' as const,
                    onPress: () => {
                      const exerciseId = rowMenu.exerciseId;
                      setRowMenu(null);
                      handleUngroupExercise(exerciseId);
                    },
                  },
                ]
              : []),
          ]}
        />
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
      {/* Mounted outside renderContent so the header entry point still has a
          sheet to present in the loading / error / empty branches. */}
      <ActionSheet
        ref={swapSheetRef}
        title={payload ? 'Swap Workout' : 'New Workout'}
        items={swapSheetItems}
      />
      <ActionSheet
        ref={supersetSheetRef}
        title={supersetAnchorId == null ? 'Superset which exercise?' : 'Superset with…'}
        items={supersetSheetItems}
        // Stage two backs out to the anchor list rather than closing, so a
        // mis-tapped anchor costs one tap instead of reopening the sheet.
        onBack={supersetAnchorId == null ? undefined : () => setSupersetAnchorId(null)}
        onDismiss={() => setSupersetAnchorId(null)}
      />
    </View>
  );
};

export default UpNextScreen;
