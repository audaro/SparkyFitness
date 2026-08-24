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
import { buildRecommendationStartPayload } from '../../src/utils/workoutSession';
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
type MockSheetProps = { title: string; items: ActionSheetItem[] };

const mockSheet: {
  present: jest.Mock;
  dismiss: jest.Mock;
  props: MockSheetProps | null;
} = { present: jest.fn(), dismiss: jest.fn(), props: null };

jest.mock('../../src/components/ActionSheet', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: React.forwardRef((props: MockSheetProps, ref: unknown) => {
      React.useEffect(() => {
        mockSheet.props = props;
      });
      React.useImperativeHandle(ref, () => ({
        present: mockSheet.present,
        dismiss: mockSheet.dismiss,
      }));
      return null;
    }),
  };
});

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
  label?: string;
  onPress: () => void;
  disabled?: boolean;
  role?: string;
  accessibilityLabel?: string;
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
  return mockSheet.props?.items.find((item) => item.key === key);
}

const insets = { top: 0, bottom: 0, left: 0, right: 0 };
const frame = { x: 0, y: 0, width: 390, height: 844 };

const EX_A = '11111111-1111-4111-8111-111111111111';
const EX_B = '22222222-2222-4222-8222-222222222222';
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
} as never;

function renderScreen(params: Record<string, unknown> | undefined = undefined) {
  return render(
    <SafeAreaProvider initialMetrics={{ insets, frame }}>
      <UpNextScreen
        navigation={navigation}
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
    mockSheet.props = null;
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
      exercises: buildRecommendationStartPayload(recommendation.payload),
    });
    expect(updateStatus).toHaveBeenCalledWith({ id: recommendation.id, status: 'started' });
  });

  it('opens the swap sheet instead of regenerating when Swap is pressed', () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId('up-next-swap'));

    expect(mockSheet.present).toHaveBeenCalled();
    expect(generateAsync).not.toHaveBeenCalled();
  });

  it('regenerates for a new target duration', async () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId('picker-option-45'));

    await waitFor(() => expect(generateAsync).toHaveBeenCalledWith({ duration_minutes: 45 }));
  });

  it('activates a gym profile before regenerating for it', async () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId(`picker-option-${GYM_A}`));

    await waitFor(() => expect(generateAsync).toHaveBeenCalledWith({ gym_profile_id: GYM_A }));
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

    await waitFor(() => expect(generateAsync).toHaveBeenCalledWith({ gym_profile_id: null }));
    expect(activateProfileAsync).not.toHaveBeenCalled();
  });

  it('offers generation instead of an error when no workout exists yet', async () => {
    setRecommendation(null);

    const screen = renderScreen();
    expect(screen.getByText('No workout yet')).toBeTruthy();

    fireEvent.press(screen.getByText("Generate today's workout"));
    await waitFor(() => expect(generateAsync).toHaveBeenCalledWith({}));
  });

  describe('swap sheet', () => {
    it('offers only the destinations that exist', () => {
      renderScreen();

      // On Demand is D3 and has nothing behind it yet, so it is absent rather
      // than present-and-inert.
      expect(mockSheet.props?.items.map((item) => item.key)).toEqual([
        'pick-muscles',
        'saved-workouts',
        'create-from-scratch',
        'refresh',
      ]);
      expect(mockSheet.props?.title).toBe('Swap Workout');
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

    it('keeps whole-workout regeneration behind the Refresh row', async () => {
      // The Swap button used to do this directly. It is the only whole-workout
      // swap path there is; D2 moves the row to the ⋯ menu, it does not drop it.
      renderScreen();
      act(() => sheetItem('refresh')?.onPress());

      await waitFor(() => expect(generateAsync).toHaveBeenCalledWith({ swap: true }));
      expect(navigation.navigate).not.toHaveBeenCalledWith('PickMuscles');
    });

    it('drops Refresh when there is no workout to regenerate', () => {
      setRecommendation(null);
      renderScreen();

      // The empty state's own action already offers a plain generate.
      expect(sheetItem('refresh')).toBeUndefined();
      expect(mockSheet.props?.title).toBe('New Workout');
    });

    describe('header entry point', () => {
      it('carries the sheet when the body has no Swap button', () => {
        // `renderContent()` falls back to a StatusView here, which takes one
        // action — already spent on Generate. Without the header item the sheet
        // would be unreachable in exactly the state that needs it most.
        setRecommendation(null);
        const screen = renderScreen();

        expect(screen.getByText('No workout yet')).toBeTruthy();
        act(() => headerRightItem()?.onPress());
        expect(mockSheet.present).toHaveBeenCalled();
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
        // Two identical entry points on one screen; the body one wins.
        renderScreen();

        expect(headerRightItem()).toBeNull();
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
            navigation={navigation}
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
            navigation={navigation}
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
