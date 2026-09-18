import { fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ExerciseSheetScreen from '../../src/screens/ExerciseSheetScreen';
import {
  findHeaderMenuAction,
  pressHeaderMenuAction,
} from './helpers/nativeHeaderTestUtils';
import { useActiveWorkoutStore } from '../../src/stores/activeWorkoutStore';
import type { Exercise } from '../../src/types/exercise';
import type { PresetSessionResponse } from '@workspace/shared';

jest.mock('../../src/hooks', () => ({
  usePreferences: jest.fn(() => ({
    preferences: { default_weight_unit: 'kg', default_distance_unit: 'km' },
  })),
}));

jest.mock('../../src/hooks/useExerciseHistory', () => ({
  useExerciseHistory: jest.fn(() => ({
    sessions: [],
    isLoading: false,
    isLoadingMore: false,
    isError: false,
    refetch: jest.fn(),
    loadMore: jest.fn(),
    hasMore: false,
  })),
}));

jest.mock('../../src/services/notifications', () => ({
  scheduleRestNotification: jest.fn(async () => 'n1'),
  scheduleHoldNotification: jest.fn(async () => 'n2'),
  cancelScheduledNotification: jest.fn(async () => undefined),
  REST_TIMER_CATEGORY: 'rest-timer',
  COMPLETE_SET_ACTION: 'complete-set',
  addNotificationResponseListener: jest.fn(() => ({ remove: jest.fn() })),
  dismissDeliveredNotification: jest.fn(async () => undefined),
}));

jest.mock('../../src/services/LogService', () => ({
  addLog: jest.fn(async () => undefined),
}));

jest.mock('../../src/hooks/useExerciseImageSource', () => ({
  useExerciseImageSource: jest.fn(() => ({
    getImageSource: (path: string) => ({ uri: path, headers: {} }),
  })),
  useImagePairAspectMatch: jest.fn(() => undefined),
}));

// useScreenHeader reaches for useNavigation itself, so the hook and the
// screen have to see the same navigation object for header actions to be
// findable.
const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  setOptions: jest.fn(),
  isFocused: jest.fn(() => true),
} as any;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
  useIsFocused: () => true,
}));

const insets = { top: 0, bottom: 0, left: 0, right: 0 };
const frame = { x: 0, y: 0, width: 390, height: 844 };

const baseExercise: Exercise = {
  id: 'ex-1',
  name: 'Bench Press',
  category: 'strength',
  equipment: ['barbell', 'bench'],
  primary_muscles: ['chest'],
  secondary_muscles: ['triceps'],
  calories_per_hour: 360,
  source: 'sparky',
  images: [],
  tags: [],
  level: 'beginner',
};

/** Plank (duration, two 45s sets) — one entry is all the sheet renders. */
function makeSession(): PresetSessionResponse {
  return {
    type: 'preset',
    id: 'session-1',
    entry_date: '2026-03-20',
    workout_preset_id: null,
    name: 'Core Day',
    description: null,
    notes: null,
    source: 'sparky',
    total_duration_minutes: 30,
    activity_details: [],
    exercises: [
      {
        id: 'entry-1',
        exercise_id: 'ex-1',
        duration_minutes: 10,
        calories_burned: 50,
        entry_date: '2026-03-20',
        notes: null,
        distance: null,
        avg_heart_rate: null,
        source: null,
        exercise_snapshot: {
          id: 'ex-1',
          name: 'Plank',
          category: 'Strength',
          modality: 'duration',
          calories_per_hour: 200,
          source: 'system',
          images: [],
        },
        activity_details: [],
        sets: [
          {
            id: 101,
            set_number: 1,
            set_type: 'working',
            reps: null,
            weight: null,
            duration: 45,
            rest_time: 30,
            notes: null,
            rpe: null,
            completed_at: null,
          },
          {
            id: 102,
            set_number: 2,
            set_type: 'working',
            reps: null,
            weight: null,
            duration: 45,
            rest_time: 30,
            notes: null,
            rpe: null,
            completed_at: null,
          },
        ],
      },
    ],
  } as unknown as PresetSessionResponse;
}

function renderSheet(
  overrides: {
    exercise?: Partial<Exercise>;
    params?: Record<string, unknown>;
  } = {}
) {
  const navigation = mockNavigation;
  const exercise = { ...baseExercise, ...overrides.exercise };
  const route = {
    key: 'ExerciseSheet-1',
    name: 'ExerciseSheet' as const,
    params: {
      context: 'active-workout',
      item: exercise,
      entryId: 'entry-1',
      ...overrides.params,
    },
  } as any;
  const screen = render(
    <QueryClientProvider client={new QueryClient()}>
      <SafeAreaProvider initialMetrics={{ insets, frame }}>
        <ExerciseSheetScreen navigation={navigation} route={route} />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
  return { ...screen, navigation, exercise };
}

describe('ExerciseSheetScreen', () => {
  beforeEach(() => {
    mockNavigation.navigate.mockClear();
    mockNavigation.goBack.mockClear();
    mockNavigation.setOptions.mockClear();
  });

  it('names the exercise and summarizes its taxonomy', () => {
    const { getByTestId } = renderSheet();

    expect(getByTestId('exercise-sheet-name').props.children).toBe(
      'Bench Press'
    );
    expect(getByTestId('exercise-sheet-taxonomy').props.children).toBe(
      'Barbell, Bench · Chest · Beginner'
    );
  });

  it('omits the taxonomy line entirely when the exercise carries none', () => {
    const { queryByTestId } = renderSheet({
      exercise: {
        equipment: [],
        primary_muscles: [],
        level: null,
      },
    });

    expect(queryByTestId('exercise-sheet-taxonomy')).toBeNull();
  });

  it('drops blank taxonomy values rather than emitting bare separators', () => {
    const { getByTestId } = renderSheet({
      exercise: { equipment: ['   ', 'barbell'], primary_muscles: [] },
    });

    expect(getByTestId('exercise-sheet-taxonomy').props.children).toBe(
      'Barbell · Beginner'
    );
  });

  describe('active workout context', () => {
    beforeEach(() => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
    });
    afterEach(() => {
      useActiveWorkoutStore.getState().clearWorkout();
    });

    it("renders the entry's set rows through the shared card", () => {
      const { getByTestId, getAllByText } = renderSheet();

      expect(getByTestId('exercise-sheet-sets')).toBeTruthy();
      // Both of the plank's sets, numbered by the card's own rail.
      expect(getAllByText('1').length).toBeGreaterThan(0);
      expect(getAllByText('2').length).toBeGreaterThan(0);
    });

    it('offers the hold control on the cursor set, since the store would take it', () => {
      const { getByTestId } = renderSheet();

      fireEvent.press(getByTestId('start-hold-control'));

      expect(useActiveWorkoutStore.getState().hold.state).toBe('holding');
      expect(useActiveWorkoutStore.getState().hold.setId).toBe('101');
    });

    it('withholds the hold control while a rest is running', () => {
      useActiveWorkoutStore.getState().completeSet('101');

      const { queryByTestId } = renderSheet();

      expect(useActiveWorkoutStore.getState().rest.state).toBe('resting');
      expect(queryByTestId('start-hold-control')).toBeNull();
    });

    it('toggles the history section from its chip', () => {
      const { getByTestId, queryByTestId } = renderSheet();

      expect(queryByTestId('exercise-sheet-history')).toBeNull();
      fireEvent.press(getByTestId('exercise-sheet-history-chip'));
      expect(getByTestId('exercise-sheet-history')).toBeTruthy();
      fireEvent.press(getByTestId('exercise-sheet-history-chip'));
      expect(queryByTestId('exercise-sheet-history')).toBeNull();
    });

    it('sends the replace chip to the picker, suggesting against the outgoing exercise', () => {
      const { getByTestId, navigation } = renderSheet();

      fireEvent.press(getByTestId('exercise-sheet-replace-chip'));

      expect(navigation.navigate).toHaveBeenCalledWith('ExerciseSearch', {
        returnKey: 'ExerciseSheet-1',
        suggestForExerciseId: 'ex-1',
      });
    });

    it('renders nothing for an entry that is no longer in the session', () => {
      const { queryByTestId } = renderSheet({
        params: { entryId: 'entry-gone' },
      });

      expect(queryByTestId('exercise-sheet-sets')).toBeNull();
      // The identity half of the sheet still stands on the route params.
      expect(queryByTestId('exercise-sheet-name')).toBeTruthy();
    });
  });

  it('keeps a route to the catalog page in the overflow menu', () => {
    const { navigation } = renderSheet();

    expect(findHeaderMenuAction(navigation, 'Exercise details')).toBeTruthy();
    pressHeaderMenuAction(navigation, 'Exercise details');

    expect(navigation.navigate).toHaveBeenCalledWith('ExerciseDetail', {
      item: expect.objectContaining({ id: 'ex-1' }),
      hideWorkoutActions: true,
    });
  });
});
