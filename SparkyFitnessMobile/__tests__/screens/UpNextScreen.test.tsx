import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type {
  RecommendationSet,
  RecommendedExercise,
  WorkoutRecommendationPayload,
} from '@workspace/shared';

import UpNextScreen from '../../src/screens/UpNextScreen';
import type { ActionSheetItem } from '../../src/components/ActionSheet';
import { usePreferences } from '../../src/hooks';
import { useGymProfiles, useGymProfileMutations } from '../../src/hooks/useGymProfiles';
import { useScreenHeader } from '../../src/hooks/useScreenHeader';
import { useStartLiveWorkout } from '../../src/hooks/useStartLiveWorkout';
import {
  useReplaceRecommendationExercise,
  useUpdateRecommendationStatus,
  useWorkoutRecommendation,
} from '../../src/hooks/useWorkoutRecommendation';
import {
  buildRecommendationStartPayload,
  orderedRecommendationExercises,
} from '../../src/utils/workoutSession';
import type { WorkoutRecommendation } from '../../src/services/api/workoutRecommendationsApi';

jest.mock('../../src/hooks', () => ({
  usePreferences: jest.fn(),
}));

jest.mock('../../src/hooks/useWorkoutRecommendation', () => ({
  useWorkoutRecommendation: jest.fn(),
  useUpdateRecommendationStatus: jest.fn(),
  useReplaceRecommendationExercise: jest.fn(),
}));

jest.mock('../../src/hooks/useGymProfiles', () => ({
  useGymProfiles: jest.fn(),
  useGymProfileMutations: jest.fn(),
}));

jest.mock('../../src/hooks/useStartLiveWorkout', () => ({
  useStartLiveWorkout: jest.fn(),
}));

jest.mock('../../src/hooks/useExerciseImageSource', () => ({
  useExerciseImageSource: jest.fn(() => ({
    getImageSource: jest.fn((path: string) => ({ uri: path, headers: {} })),
  })),
}));

jest.mock('../../src/hooks/useScreenHeader', () => ({
  useScreenHeader: jest.fn(() => null),
}));

jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  useActiveWorkoutBarPadding: jest.fn(() => 0),
}));

jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSHeadersActive: jest.fn(() => false),
}));

// The sheet is captured rather than rendered (same pattern as
// WorkoutDetailScreen.test.tsx): tests assert the imperative present() wiring
// and drive item onPress callbacks directly. ActionSheet's own rendering is
// covered by __tests__/components/ActionSheet.test.tsx.
type MockSheetProps = {
  title: string;
  items: ActionSheetItem[];
  onBack?: () => void;
  onDismiss?: () => void;
};

type MockSheetInstance = {
  props: MockSheetProps;
  present: jest.Mock;
  dismiss: jest.Mock;
};

// The screen mounts two sheets, in a fixed order and in every state (both live
// outside renderContent), so each claims a stable slot on its first render and
// the tests address them positionally.
const mockSheets: MockSheetInstance[] = [];

jest.mock('../../src/components/ActionSheet', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: React.forwardRef((props: MockSheetProps, ref: unknown) => {
      // Slot claimed and props published from an effect, never during render —
      // the compiler lint rejects writing to module scope from a render pass.
      const indexRef = React.useRef(-1);
      React.useEffect(() => {
        if (indexRef.current === -1) {
          indexRef.current = mockSheets.length;
          mockSheets.push({ props, present: jest.fn(), dismiss: jest.fn() });
        } else {
          mockSheets[indexRef.current].props = props;
        }
      });
      // Resolved at call time, so the handle works before the slot exists.
      React.useImperativeHandle(ref, () => ({
        present: () => mockSheets[indexRef.current]?.present(),
        dismiss: () => mockSheets[indexRef.current]?.dismiss(),
      }));
      return null;
    }),
  };
});

/** The Swap Workout sheet — mounted first. */
const swapSheet = (): MockSheetInstance | undefined => mockSheets[0];
/** The superset builder — mounted second. */
const supersetSheet = (): MockSheetInstance | undefined => mockSheets[1];

// Renders the trigger plus every option as its own pressable, so a test can
// pick from a sheet that never actually opens.
jest.mock('../../src/components/BottomSheetPicker', () => {
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    __esModule: true,
    default: ({
      options,
      onSelect,
      renderTrigger,
    }: {
      options?: { label: string; value: string | number }[];
      onSelect: (value: never) => void;
      renderTrigger?: (props: { onPress: () => void }) => React.ReactNode;
    }) => (
      <View>
        {renderTrigger?.({ onPress: () => {} })}
        {options?.map((option) => (
          <TouchableOpacity
            key={String(option.value)}
            testID={`picker-option-${option.value}`}
            onPress={() => onSelect(option.value as never)}
          >
            <Text>{option.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    ),
  };
});

const mockUsePreferences = usePreferences as jest.MockedFunction<typeof usePreferences>;
const mockUseWorkoutRecommendation = useWorkoutRecommendation as jest.MockedFunction<
  typeof useWorkoutRecommendation
>;
const mockUseUpdateRecommendationStatus =
  useUpdateRecommendationStatus as jest.MockedFunction<typeof useUpdateRecommendationStatus>;
const mockUseReplaceRecommendationExercise =
  useReplaceRecommendationExercise as jest.MockedFunction<
    typeof useReplaceRecommendationExercise
  >;
const mockUseGymProfiles = useGymProfiles as jest.MockedFunction<typeof useGymProfiles>;
const mockUseGymProfileMutations = useGymProfileMutations as jest.MockedFunction<
  typeof useGymProfileMutations
>;
const mockUseStartLiveWorkout = useStartLiveWorkout as jest.MockedFunction<
  typeof useStartLiveWorkout
>;
const mockUseScreenHeader = useScreenHeader as jest.MockedFunction<typeof useScreenHeader>;

type HeaderTextItem = {
  kind?: string;
  label?: string;
  onPress?: () => void;
  disabled?: boolean;
  role?: string;
  accessibilityLabel?: string;
  items?: { label: string; onPress: () => void }[];
};

/**
 * useScreenHeader is mocked out, so reach the header's sheet action through the
 * descriptor the screen handed it rather than through a bar that never renders.
 * The screen declares it only in the states with no body Swap button, so this
 * returns null rather than throwing when there is none.
 */
function headerRightItem(): HeaderTextItem | null {
  const config = mockUseScreenHeader.mock.calls.at(-1)?.[0] as {
    right?: HeaderTextItem | null;
  };
  return config?.right ?? null;
}

function sheetItem(key: string): ActionSheetItem | undefined {
  return swapSheet()?.props.items.find((item) => item.key === key);
}

/** One row of the superset sheet, by its visible label (an exercise name). */
function supersetSheetRow(label: string): ActionSheetItem {
  const row = supersetSheet()?.props.items.find((item) => item.label === label);
  if (!row) throw new Error(`supersetSheetRow: no "${label}" row in the superset sheet`);
  return row;
}

/** One row of the ⋯ header menu, by its visible label. */
function menuAction(label: string): { label: string; onPress: () => void } {
  const action = headerRightItem()?.items?.find((item) => item.label === label);
  if (!action) throw new Error(`menuAction: no "${label}" row in the overflow menu`);
  return action;
}

const insets = { top: 0, bottom: 0, left: 0, right: 0 };
const frame = { x: 0, y: 0, width: 390, height: 844 };

const EX_A = '11111111-1111-4111-8111-111111111111';
const EX_B = '22222222-2222-4222-8222-222222222222';
const EX_C = '66666666-6666-4666-8666-666666666666';
const GYM_A = '33333333-3333-4333-8333-333333333333';
const GYM_B = '55555555-5555-4555-8555-555555555555';

const makeSet = (overrides: Partial<RecommendationSet> = {}): RecommendationSet => ({
  set_number: 1,
  set_type: 'Working Set',
  reps: 8,
  weight: 80,
  duration: null,
  distance: null,
  rest_time: 120,
  ...overrides,
});

const makeExercise = (
  overrides: Partial<RecommendedExercise> = {},
): RecommendedExercise => ({
  exercise_id: EX_A,
  exercise_name: 'Bench Press',
  modality: 'weight_reps',
  primary_muscles: ['chest'],
  secondary_muscles: ['triceps'],
  equipment: ['barbell'],
  images: [],
  sort_order: 0,
  rest_seconds: 120,
  rationale: 'fresh chest · holding last session load',
  sets: [makeSet({ set_type: 'Warmup', weight: 37.5 }), makeSet({ set_number: 2 })],
  ...overrides,
});

const makePayload = (
  overrides: Partial<WorkoutRecommendationPayload> = {},
): WorkoutRecommendationPayload => ({
  muscle_groups: ['chest', 'triceps'],
  estimated_duration_minutes: 38,
  exercises: [makeExercise()],
  ...overrides,
});

/** Three prescribed exercises — the smallest workout a circuit fits in. */
const makeThreeExercisePayload = (): WorkoutRecommendationPayload =>
  makePayload({
    exercises: [
      makeExercise({ sort_order: 0 }),
      makeExercise({
        exercise_id: EX_B,
        exercise_name: 'Cable Fly',
        sort_order: 1,
        rest_seconds: 60,
        sets: [makeSet({ rest_time: 60 })],
      }),
      makeExercise({
        exercise_id: EX_C,
        exercise_name: 'Triceps Pushdown',
        sort_order: 2,
        rest_seconds: 45,
        sets: [makeSet({ rest_time: 45 })],
      }),
    ],
  });

const makeRecommendation = (
  overrides: Partial<WorkoutRecommendation> = {},
): WorkoutRecommendation => ({
  id: '44444444-4444-4444-8444-444444444444',
  status: 'active',
  target_duration_minutes: 60,
  gym_profile_id: GYM_A,
  generated_at: '2026-08-23T10:00:00.000Z',
  payload: makePayload(),
  ...overrides,
});

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  replace: jest.fn(),
  isFocused: jest.fn(() => true),
  setOptions: jest.fn(),
};

function renderScreen(params: Record<string, unknown> | undefined = undefined) {
  return render(
    <SafeAreaProvider initialMetrics={{ insets, frame }}>
      <UpNextScreen
        navigation={navigation as never}
        route={{ key: 'UpNext-key', name: 'UpNext', params } as never}
      />
    </SafeAreaProvider>,
  );
}

describe('UpNextScreen', () => {
  const generateAsync = jest.fn();
  const startLiveWorkout = jest.fn();
  const updateStatus = jest.fn();
  const activateProfileAsync = jest.fn();
  const replaceExercise = jest.fn();

  function setRecommendation(
    recommendation: WorkoutRecommendation | null,
    overrides: Record<string, unknown> = {},
  ) {
    mockUseWorkoutRecommendation.mockReturnValue({
      recommendation,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      generate: jest.fn(),
      generateAsync,
      isGenerating: false,
      ...overrides,
    } as never);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockSheets.length = 0;
    generateAsync.mockResolvedValue(makeRecommendation());
    activateProfileAsync.mockResolvedValue({});
    mockUsePreferences.mockReturnValue({
      preferences: { default_weight_unit: 'kg', default_distance_unit: 'km' },
    } as never);
    setRecommendation(makeRecommendation());
    mockUseGymProfiles.mockReturnValue({
      profiles: [{ id: GYM_A, name: 'Planet Fitness', is_active: true, equipment: [] }],
      activeProfile: null,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as never);
    mockUseGymProfileMutations.mockReturnValue({ activateProfileAsync } as never);
    mockUseStartLiveWorkout.mockReturnValue({ startLiveWorkout, isStarting: false });
    mockUseUpdateRecommendationStatus.mockReturnValue({ mutate: updateStatus } as never);
    mockUseReplaceRecommendationExercise.mockReturnValue({
      mutate: replaceExercise,
      isPending: false,
      variables: undefined,
    } as never);
  });

  it('summarizes the payload and prescribes each exercise', () => {
    const screen = renderScreen();

    expect(screen.getByText(/1 Exercise •/)).toBeTruthy();
    expect(screen.getByText(/2 Muscles •/)).toBeTruthy();
    expect(screen.getByText('Chest, Triceps')).toBeTruthy();
    expect(screen.getByText('Bench Press')).toBeTruthy();
    // Working sets only — the warm-up ramp is not one of the "sets".
    expect(screen.getByText('1 set · 8 reps · 80 kg')).toBeTruthy();
    expect(screen.getByText(/2:00 rest/)).toBeTruthy();
  });

  it('labels the chips from the workout that was generated, not the active profile', () => {
    mockUseGymProfiles.mockReturnValue({
      profiles: [
        { id: GYM_A, name: 'Planet Fitness', is_active: false, equipment: [] },
        { id: GYM_B, name: 'Home Gym', is_active: true, equipment: [] },
      ],
      activeProfile: { id: GYM_B, name: 'Home Gym', is_active: true, equipment: [] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as never);

    const screen = renderScreen();

    expect(within(screen.getByLabelText('Change workout length')).getByText('1h')).toBeTruthy();
    // The workout was built for Planet Fitness; Home Gym has since become
    // active, and the chip must keep describing the workout on screen.
    expect(
      within(screen.getByLabelText('Change gym equipment')).getByText('Planet Fitness'),
    ).toBeTruthy();
  });

  it('starts the live workout with the built payload and marks the row started', async () => {
    const recommendation = makeRecommendation();
    setRecommendation(recommendation);

    const screen = renderScreen();
    fireEvent.press(screen.getByTestId('up-next-start'));

    expect(startLiveWorkout).toHaveBeenCalledWith({
      name: 'Up Next workout',
      exercises: buildRecommendationStartPayload(
        orderedRecommendationExercises(recommendation.payload),
      ),
    });
    expect(updateStatus).toHaveBeenCalledWith({ id: recommendation.id, status: 'started' });
  });

  it('opens the swap sheet instead of regenerating when Swap is pressed', () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId('up-next-swap'));

    expect(swapSheet()?.present).toHaveBeenCalled();
    expect(generateAsync).not.toHaveBeenCalled();
  });

  it('regenerates for a new target duration', async () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId('picker-option-45'));

    // The muscles and the gym ride along: an absent field on `/generate` means
    // "use the default", so a bare `{duration_minutes: 45}` would ask for a
    // shorter workout AND re-target it onto whatever happens to be freshest.
    await waitFor(() =>
      expect(generateAsync).toHaveBeenCalledWith({
        target_muscles: ['chest', 'triceps'],
        duration_minutes: 45,
        gym_profile_id: GYM_A,
      }),
    );
  });

  it('activates a gym profile before regenerating for it', async () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId(`picker-option-${GYM_A}`));

    await waitFor(() =>
      expect(generateAsync).toHaveBeenCalledWith({
        target_muscles: ['chest', 'triceps'],
        duration_minutes: 60,
        gym_profile_id: GYM_A,
      }),
    );
    expect(activateProfileAsync).toHaveBeenCalledWith(GYM_A);
    expect(activateProfileAsync.mock.invocationCallOrder[0]).toBeLessThan(
      generateAsync.mock.invocationCallOrder[0],
    );
  });

  it('does not regenerate when activating the chosen gym profile fails', async () => {
    activateProfileAsync.mockRejectedValue(new Error('nope'));

    const screen = renderScreen();
    fireEvent.press(screen.getByTestId(`picker-option-${GYM_A}`));

    await waitFor(() => expect(activateProfileAsync).toHaveBeenCalled());
    expect(generateAsync).not.toHaveBeenCalled();
  });

  it('asks for no equipment constraint without touching activation', async () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId('picker-option-any'));

    await waitFor(() =>
      expect(generateAsync).toHaveBeenCalledWith({
        target_muscles: ['chest', 'triceps'],
        duration_minutes: 60,
        gym_profile_id: null,
      }),
    );
    expect(activateProfileAsync).not.toHaveBeenCalled();
  });

  it('offers generation instead of an error when no workout exists yet', async () => {
    setRecommendation(null);

    const screen = renderScreen();
    expect(screen.getByText('No workout yet')).toBeTruthy();

    fireEvent.press(screen.getByText("Generate today's workout"));
    // Nothing to carry forward: there is no workout on screen, and this is the
    // one generate that legitimately wants every server-side default.
    await waitFor(() => expect(generateAsync).toHaveBeenCalledWith({}));
  });

  describe('carrying the current workout forward', () => {
    // `muscle_groups` is `z.array(z.string())` on the wire — it carries whatever
    // a custom exercise's snapshot said — while `target_muscles` is the pinned
    // enum, and a member outside it is a 400 rather than a smaller workout.
    it('sends only canonical muscles, normalized and deduplicated', async () => {
      setRecommendation(
        makeRecommendation({
          payload: makePayload({ muscle_groups: ['Chest', 'chest', 'rotator cuff'] }),
        }),
      );

      const screen = renderScreen();
      fireEvent.press(screen.getByTestId('picker-option-45'));

      await waitFor(() =>
        expect(generateAsync).toHaveBeenCalledWith({
          target_muscles: ['chest'],
          duration_minutes: 45,
          gym_profile_id: GYM_A,
        }),
      );
    });

    it('omits the muscles rather than sending an empty list', async () => {
      // `target_muscles` is `.min(1)`, so `[]` is a 400 — and omitting the
      // field is not a degraded request anyway, it is the one that asks the
      // engine for the freshest muscles.
      setRecommendation(
        makeRecommendation({
          payload: makePayload({ muscle_groups: ['rotator cuff'] }),
        }),
      );

      const screen = renderScreen();
      fireEvent.press(screen.getByTestId('picker-option-45'));

      await waitFor(() =>
        expect(generateAsync).toHaveBeenCalledWith({
          duration_minutes: 45,
          gym_profile_id: GYM_A,
        }),
      );
    });
  });

  describe('swap sheet', () => {
    it('offers every way of getting a different workout', () => {
      renderScreen();

      expect(swapSheet()?.props.items.map((item) => item.key)).toEqual([
        'pick-muscles',
        'saved-workouts',
        'create-from-scratch',
        'on-demand',
      ]);
      expect(swapSheet()?.props.title).toBe('Swap Workout');
    });

    it('opens muscle targeting', () => {
      renderScreen();
      act(() => sheetItem('pick-muscles')?.onPress());

      expect(navigation.navigate).toHaveBeenCalledWith('PickMuscles');
    });

    it('opens the saved workouts library', () => {
      renderScreen();
      act(() => sheetItem('saved-workouts')?.onPress());

      expect(navigation.navigate).toHaveBeenCalledWith('WorkoutPresetsLibrary');
    });

    it('opens the preset form to build one from scratch', () => {
      renderScreen();
      act(() => sheetItem('create-from-scratch')?.onPress());

      expect(navigation.navigate).toHaveBeenCalledWith('WorkoutPresetForm', {
        mode: 'create-preset',
      });
    });

    it('opens the themed on-demand list', () => {
      renderScreen();
      act(() => sheetItem('on-demand')?.onPress());

      expect(navigation.navigate).toHaveBeenCalledWith('OnDemandWorkouts');
    });

    it('does not regenerate from the sheet', () => {
      // Regeneration is the ⋯ menu's Refresh; every row here is a destination.
      renderScreen();
      swapSheet()?.props.items.forEach((item) => act(() => item.onPress()));

      expect(generateAsync).not.toHaveBeenCalled();
    });

    it('titles itself for the state it opened in', () => {
      setRecommendation(null);
      renderScreen();

      expect(swapSheet()?.props.title).toBe('New Workout');
    });

    describe('header entry point', () => {
      it('carries the sheet when the body has no Swap button', () => {
        // `renderContent()` falls back to a StatusView here, which takes one
        // action — already spent on Generate. Without the header item the sheet
        // would be unreachable in exactly the state that needs it most.
        setRecommendation(null);
        const screen = renderScreen();

        expect(screen.getByText('No workout yet')).toBeTruthy();
        act(() => headerRightItem()?.onPress?.());
        expect(swapSheet()?.present).toHaveBeenCalled();
      });

      it.each([
        ['loading', { isLoading: true }],
        ['failed', { isError: true }],
      ])('carries the sheet while the read is %s', (_label, state) => {
        // These branches are StatusViews too, even with a cached recommendation
        // behind them — so the body Swap button is not on screen either.
        setRecommendation(makeRecommendation(), state);
        renderScreen();

        expect(headerRightItem()).not.toBeNull();
      });

      it('stands down once the Swap button renders', () => {
        // Two identical entry points on one screen; the body one wins, and the
        // header slot goes to the ⋯ menu instead.
        renderScreen();

        expect(headerRightItem()?.kind).toBe('menu');
      });

      it('declares no accent action', () => {
        // `useScreenHeader` throws in __DEV__ on a second primary; Up Next has
        // none, and this action must not become the first.
        setRecommendation(null);
        renderScreen();

        expect(headerRightItem()?.role).toBeUndefined();
      });

      it('is blocked while a workout is being generated', () => {
        setRecommendation(null, { isGenerating: true });
        renderScreen();

        expect(headerRightItem()?.disabled).toBe(true);
      });

      it('is blocked while a workout is starting', () => {
        setRecommendation(null);
        mockUseStartLiveWorkout.mockReturnValue({ startLiveWorkout, isStarting: true });
        renderScreen();

        expect(headerRightItem()?.disabled).toBe(true);
      });
    });
  });

  describe('overflow menu', () => {
    it('offers the rows that have something behind them', () => {
      renderScreen();

      // Share is deferred indefinitely (blueprint D2) and is not a row. The
      // default workout is one exercise, so there is nothing to pair either.
      expect(headerRightItem()?.items?.map((item) => item.label)).toEqual([
        'Save workout',
        'Refresh',
      ]);
      expect(headerRightItem()?.role).toBeUndefined();
    });

    it('keeps whole-workout regeneration behind Refresh', async () => {
      // The Swap button used to do this directly, and it is the only
      // whole-workout swap path there is — repointing that button at the sheet
      // moved this row, it did not drop it.
      renderScreen();
      act(() => menuAction('Refresh').onPress());

      await waitFor(() =>
        expect(generateAsync).toHaveBeenCalledWith({
          target_muscles: ['chest', 'triceps'],
          duration_minutes: 60,
          gym_profile_id: GYM_A,
          swap: true,
        }),
      );
    });

    it('saves the workout by review, not by writing it', () => {
      const recommendation = makeRecommendation();
      setRecommendation(recommendation);

      renderScreen();
      act(() => menuAction('Save workout').onPress());

      // The create form owns the write; the payload rides along as the seed so
      // a generate landing behind the user cannot change what they are saving.
      expect(navigation.navigate).toHaveBeenCalledWith('WorkoutPresetForm', {
        mode: 'create-preset',
        sourceRecommendation: recommendation.payload,
      });
    });

    it('is not on the header when there is no workout to act on', () => {
      setRecommendation(null);
      renderScreen();

      expect(headerRightItem()?.kind).toBe('text');
    });
  });

  describe('supersets', () => {
    /** Group the first two prescribed exercises through the two-stage sheet. */
    function groupFirstTwo() {
      act(() => menuAction('Build superset/circuit').onPress());
      act(() => supersetSheetRow('Bench Press').onPress());
      act(() => supersetSheetRow('Cable Fly').onPress());
    }

    it('offers the builder only when there is a pair to make', () => {
      renderScreen();
      // One exercise: nothing to pair, so the row is omitted rather than shown
      // dead — menu entries carry no disabled state on either header path.
      expect(headerRightItem()?.items?.map((item) => item.label)).not.toContain(
        'Build superset/circuit',
      );

      setRecommendation(makeRecommendation({ payload: makeThreeExercisePayload() }));
      renderScreen();
      expect(headerRightItem()?.items?.map((item) => item.label)).toEqual([
        'Save workout',
        'Build superset/circuit',
        'Refresh',
      ]);
    });

    it('picks the anchor first and the partner second', () => {
      setRecommendation(makeRecommendation({ payload: makeThreeExercisePayload() }));
      renderScreen();

      act(() => menuAction('Build superset/circuit').onPress());
      expect(supersetSheet()?.present).toHaveBeenCalled();
      expect(supersetSheet()?.props.title).toBe('Superset which exercise?');
      expect(supersetSheet()?.props.items.map((item) => item.label)).toEqual([
        'Bench Press',
        'Cable Fly',
        'Triceps Pushdown',
      ]);
      // Stage one keeps the sheet up so stage two can swap in place.
      expect(
        supersetSheet()?.props.items.every((item) => item.dismissOnPress === false),
      ).toBe(true);

      act(() => supersetSheetRow('Bench Press').onPress());
      expect(supersetSheet()?.props.title).toBe('Superset with…');
      // The anchor is not its own partner.
      expect(supersetSheet()?.props.items.map((item) => item.label)).toEqual([
        'Cable Fly',
        'Triceps Pushdown',
      ]);
      // A mis-tapped anchor costs one tap, not a reopen.
      act(() => supersetSheet()?.props.onBack?.());
      expect(supersetSheet()?.props.title).toBe('Superset which exercise?');
    });

    it('applies the grouping at start-workout rather than to the recommendation', () => {
      const recommendation = makeRecommendation({ payload: makeThreeExercisePayload() });
      setRecommendation(recommendation);
      const screen = renderScreen();

      groupFirstTwo();
      fireEvent.press(screen.getByTestId('up-next-start'));

      const started = startLiveWorkout.mock.calls.at(-1)?.[0];
      expect(
        started.exercises.map((exercise: { exercise_id: string }) => exercise.exercise_id),
      ).toEqual([EX_A, EX_B, EX_C]);
      expect(
        started.exercises.map(
          (exercise: { superset_group: number | null }) => exercise.superset_group,
        ),
      ).toEqual([1, 1, null]);
      // Blueprint D9: nothing is written back to the recommendation, so a swap,
      // refresh or replace cannot silently discard a stored grouping.
      expect(generateAsync).not.toHaveBeenCalled();
      expect(
        recommendation.payload.exercises.every((exercise) => !('superset_group' in exercise)),
      ).toBe(true);
    });

    it('harmonizes rest across the run to the anchor', () => {
      setRecommendation(makeRecommendation({ payload: makeThreeExercisePayload() }));
      const screen = renderScreen();

      groupFirstTwo();
      fireEvent.press(screen.getByTestId('up-next-start'));

      // Superset rest is per-round and shared: the partner's own 60s gives way
      // to the anchor's 120s, and the exercise outside the run keeps its 45s.
      const started = startLiveWorkout.mock.calls.at(-1)?.[0];
      expect(
        started.exercises.map((exercise: { sets: { rest_time: number }[] }) =>
          exercise.sets.map((set) => set.rest_time),
        ),
      ).toEqual([[120, 120], [120], [45]]);
    });

    it('marks each member with the run rail', () => {
      setRecommendation(makeRecommendation({ payload: makeThreeExercisePayload() }));
      const screen = renderScreen();

      expect(screen.queryByTestId(`up-next-superset-rail-${EX_A}`)).toBeNull();
      groupFirstTwo();

      expect(screen.getByTestId(`up-next-superset-rail-${EX_A}`)).toBeTruthy();
      expect(screen.getByTestId(`up-next-superset-rail-${EX_B}`)).toBeTruthy();
      expect(screen.queryByTestId(`up-next-superset-rail-${EX_C}`)).toBeNull();
    });

    it('ungroups from the row the group is on', () => {
      setRecommendation(makeRecommendation({ payload: makeThreeExercisePayload() }));
      const screen = renderScreen();

      // Ungrouped rows do not offer it at all.
      fireEvent.press(screen.getByLabelText('More options for Triceps Pushdown'));
      expect(screen.queryByText('Remove from superset')).toBeNull();
      fireEvent.press(screen.getByText('Replace exercise'));

      groupFirstTwo();
      fireEvent.press(screen.getByLabelText('More options for Cable Fly'));
      fireEvent.press(screen.getByText('Remove from superset'));

      // A two-member run minus one member is not a run — the remainder dissolves.
      expect(screen.queryByTestId(`up-next-superset-rail-${EX_A}`)).toBeNull();
      expect(screen.queryByTestId(`up-next-superset-rail-${EX_B}`)).toBeNull();
    });

    it('drops the grouping when the prescription changes underneath it', () => {
      setRecommendation(makeRecommendation({ payload: makeThreeExercisePayload() }));
      const screen = renderScreen();
      groupFirstTwo();
      expect(screen.getByTestId(`up-next-superset-rail-${EX_A}`)).toBeTruthy();

      // A refresh/swap/replace lands a different prescription. Re-homing groups
      // onto a workout the user has not seen grouped would be a guess.
      setRecommendation(
        makeRecommendation({
          payload: makePayload({
            exercises: [
              makeExercise({ sort_order: 0 }),
              makeExercise({ exercise_id: EX_B, exercise_name: 'Cable Fly', sort_order: 1 }),
            ],
          }),
        }),
      );
      screen.rerender(
        <SafeAreaProvider initialMetrics={{ insets, frame }}>
          <UpNextScreen
            navigation={navigation as never}
            route={{ key: 'UpNext-key', name: 'UpNext', params: undefined } as never}
          />
        </SafeAreaProvider>,
      );

      expect(screen.queryByTestId(`up-next-superset-rail-${EX_A}`)).toBeNull();
      fireEvent.press(screen.getByTestId('up-next-start'));
      const started = startLiveWorkout.mock.calls.at(-1)?.[0];
      expect(
        started.exercises.map(
          (exercise: { superset_group: number | null }) => exercise.superset_group,
        ),
      ).toEqual([null, null]);
    });
  });

  it('opens the exercise detail with workout actions suppressed', () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId('up-next-exercise-row'));

    expect(navigation.navigate).toHaveBeenCalledWith(
      'ExerciseDetail',
      expect.objectContaining({
        hideWorkoutActions: true,
        item: expect.objectContaining({ id: EX_A, name: 'Bench Press' }),
      }),
    );
  });

  describe('replace', () => {
    it('opens the search screen naming the exercise to suggest against', () => {
      const screen = renderScreen();
      fireEvent.press(screen.getByTestId('up-next-exercise-menu'));
      fireEvent.press(screen.getByText('Replace exercise'));

      // Without `suggestForExerciseId` the user lands on a blank search box —
      // which is exactly what W6 exists to replace.
      expect(navigation.navigate).toHaveBeenCalledWith('ExerciseSearch', {
        returnKey: 'UpNext-key',
        suggestForExerciseId: EX_A,
      });
    });

    it('sends the picked replacement to the server rather than splicing it in', () => {
      const screen = renderScreen();
      fireEvent.press(screen.getByTestId('up-next-exercise-menu'));
      fireEvent.press(screen.getByText('Replace exercise'));

      screen.rerender(
        <SafeAreaProvider initialMetrics={{ insets, frame }}>
          <UpNextScreen
            navigation={navigation as never}
            route={
              {
                key: 'UpNext-key',
                name: 'UpNext',
                params: {
                  selectedExercise: { id: EX_B, name: 'Cable Fly' },
                  selectionNonce: 1,
                },
              } as never
            }
          />
        </SafeAreaProvider>,
      );

      expect(replaceExercise).toHaveBeenCalledWith({
        exercise_id_out: EX_A,
        exercise_id_in: EX_B,
      });
    });

    it('ignores a selection that arrives without a Replace behind it', () => {
      // A stale param from some other flow must not silently swap an exercise.
      renderScreen({
        selectedExercise: { id: EX_B, name: 'Cable Fly' },
        selectionNonce: 1,
      });

      expect(replaceExercise).not.toHaveBeenCalled();
    });

    it('does not ask the server to replace an exercise with itself', () => {
      const screen = renderScreen();
      fireEvent.press(screen.getByTestId('up-next-exercise-menu'));
      fireEvent.press(screen.getByText('Replace exercise'));

      screen.rerender(
        <SafeAreaProvider initialMetrics={{ insets, frame }}>
          <UpNextScreen
            navigation={navigation as never}
            route={
              {
                key: 'UpNext-key',
                name: 'UpNext',
                params: {
                  selectedExercise: { id: EX_A, name: 'Bench Press' },
                  selectionNonce: 1,
                },
              } as never
            }
          />
        </SafeAreaProvider>,
      );

      expect(replaceExercise).not.toHaveBeenCalled();
    });
  });
});
