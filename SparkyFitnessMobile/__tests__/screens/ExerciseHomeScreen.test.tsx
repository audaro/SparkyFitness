import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import ExerciseHomeScreen from '../../src/screens/ExerciseHomeScreen';
import { useWeeklySetTargets } from '../../src/hooks/useWeeklySetTargets';
import { useWorkoutRecommendation } from '../../src/hooks/useWorkoutRecommendation';
import type { WeeklySetTargetsResponse } from '../../src/services/api/weeklySetTargetsApi';

jest.mock('../../src/hooks/useWeeklySetTargets', () => ({
  useWeeklySetTargets: jest.fn(),
}));

jest.mock('../../src/hooks/useWorkoutRecommendation', () => ({
  useWorkoutRecommendation: jest.fn(),
}));

jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  useActiveWorkoutBarPadding: jest.fn(() => 0),
}));

// The custom (Android / Liquid-Glass-off) path, so the screen renders its own
// title rather than deferring to a native tab header.
jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSTabsActive: jest.fn(() => false),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockUseWeeklySetTargets = useWeeklySetTargets as jest.MockedFunction<
  typeof useWeeklySetTargets
>;
const mockUseWorkoutRecommendation = useWorkoutRecommendation as jest.Mock;

function makeWeek(): WeeklySetTargetsResponse {
  return {
    targets_are_custom: true,
    current: {
      week_start: '2026-08-24',
      week_end: '2026-08-30',
      overall_percent: 0.5,
      groups: [
        // Fractional, because a secondary mover counts as half a set.
        { group: 'push', target: 16, completed: 8.5, remaining: 7.5, percent: 0.53 },
        { group: 'pull', target: 18, completed: 9, remaining: 9, percent: 0.5 },
        { group: 'legs', target: 16, completed: 4, remaining: 12, percent: 0.25 },
        { group: 'core', target: 8, completed: 8, remaining: 0, percent: 1 },
      ],
    },
    history: [],
  } as WeeklySetTargetsResponse;
}

const navigation = { navigate: jest.fn() } as never;
const route = { params: undefined } as never;

function renderScreen() {
  return render(<ExerciseHomeScreen navigation={navigation} route={route} />);
}

describe('ExerciseHomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseWorkoutRecommendation.mockReturnValue({
      recommendation: null,
      isLoading: false,
      isError: false,
    });
    mockUseWeeklySetTargets.mockReturnValue({
      data: makeWeek(),
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as never);
  });

  it('renders every section of the tab', () => {
    const { getByText, getByTestId } = renderScreen();

    expect(getByText('Exercise')).toBeTruthy();
    expect(getByTestId('up-next-card')).toBeTruthy();
    expect(getByTestId('exercise-home-week-card')).toBeTruthy();
    expect(getByText('Quick access')).toBeTruthy();
    expect(getByText('Setup')).toBeTruthy();
    expect(getByText('Workout presets')).toBeTruthy();
    expect(getByText('Exercise library')).toBeTruthy();
    expect(getByText('Gym profiles')).toBeTruthy();
    expect(getByText('Exercise packs')).toBeTruthy();
  });

  it('shows the week as an overall percentage and a per-group breakdown', () => {
    const { getByTestId, getByText } = renderScreen();

    expect(getByTestId('exercise-home-week-overall')).toHaveTextContent('50%');
    // Half sets must not render as "8.5" rounded away, nor whole ones as "9.0".
    expect(getByText('8.5 / 16')).toBeTruthy();
    expect(getByText('9 / 18')).toBeTruthy();
  });

  it('opens the weekly set targets screen from the week card', () => {
    const { getByTestId } = renderScreen();

    fireEvent.press(getByTestId('exercise-home-week-card'));

    expect(navigation.navigate).toHaveBeenCalledWith('WeeklySetTargets');
  });

  it('hides the week card when the targets read fails with nothing cached', () => {
    mockUseWeeklySetTargets.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: jest.fn(),
    } as never);

    const { queryByTestId, getByText } = renderScreen();

    expect(queryByTestId('exercise-home-week-card')).toBeNull();
    // The rest of the tab still works — a failed read is not a broken screen.
    expect(getByText('Quick access')).toBeTruthy();
  });

  // The hook refetches on every tab focus, so a user who goes offline hits
  // isError with data still cached (React Query's isRefetchError) on the very
  // next focus. Blanking the ring there would be the common offline case.
  it('keeps the week card when a refetch fails over cached data', () => {
    mockUseWeeklySetTargets.mockReturnValue({
      data: makeWeek(),
      isLoading: false,
      isError: true,
      refetch: jest.fn(),
    } as never);

    const { getByTestId } = renderScreen();

    expect(getByTestId('exercise-home-week-card')).toBeTruthy();
    expect(getByTestId('exercise-home-week-overall')).toHaveTextContent('50%');
  });

  it('routes each quick access and setup row to its own screen', () => {
    const { getByTestId } = renderScreen();

    fireEvent.press(getByTestId('exercise-home-workout-presets'));
    expect(navigation.navigate).toHaveBeenCalledWith('WorkoutPresetsLibrary');

    fireEvent.press(getByTestId('exercise-home-exercises-library'));
    expect(navigation.navigate).toHaveBeenCalledWith('ExercisesLibrary');

    fireEvent.press(getByTestId('exercise-home-gym-profiles'));
    expect(navigation.navigate).toHaveBeenCalledWith('GymProfiles');

    fireEvent.press(getByTestId('exercise-home-exercise-packs'));
    expect(navigation.navigate).toHaveBeenCalledWith('ExercisePacks');
  });
});
