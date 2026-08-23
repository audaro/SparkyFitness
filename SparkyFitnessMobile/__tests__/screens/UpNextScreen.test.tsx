import React from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type {
  RecommendationSet,
  RecommendedExercise,
  WorkoutRecommendationPayload,
} from '@workspace/shared';

import UpNextScreen from '../../src/screens/UpNextScreen';
import { usePreferences } from '../../src/hooks';
import { useGymProfiles, useGymProfileMutations } from '../../src/hooks/useGymProfiles';
import { useStartLiveWorkout } from '../../src/hooks/useStartLiveWorkout';
import {
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
const mockUseGymProfiles = useGymProfiles as jest.MockedFunction<typeof useGymProfiles>;
const mockUseGymProfileMutations = useGymProfileMutations as jest.MockedFunction<
  typeof useGymProfileMutations
>;
const mockUseStartLiveWorkout = useStartLiveWorkout as jest.MockedFunction<
  typeof useStartLiveWorkout
>;

const insets = { top: 0, bottom: 0, left: 0, right: 0 };
const frame = { x: 0, y: 0, width: 390, height: 844 };

const EX_A = '11111111-1111-4111-8111-111111111111';
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

function renderScreen() {
  return render(
    <SafeAreaProvider initialMetrics={{ insets, frame }}>
      <UpNextScreen
        navigation={navigation}
        route={{ key: 'UpNext-key', name: 'UpNext', params: undefined } as never}
      />
    </SafeAreaProvider>,
  );
}

describe('UpNextScreen', () => {
  const generateAsync = jest.fn();
  const startLiveWorkout = jest.fn();
  const updateStatus = jest.fn();
  const activateProfileAsync = jest.fn();

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

  it('regenerates with swap when Swap is pressed', async () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId('up-next-swap'));

    await waitFor(() => expect(generateAsync).toHaveBeenCalledWith({ swap: true }));
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
});
