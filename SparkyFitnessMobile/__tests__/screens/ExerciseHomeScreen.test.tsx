import React from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ExerciseHomeScreen from '../../src/screens/ExerciseHomeScreen';
import { useDailySummary } from '../../src/hooks/useDailySummary';
import { useWeeklySetTargets } from '../../src/hooks/useWeeklySetTargets';
import { useWorkoutRecommendation } from '../../src/hooks/useWorkoutRecommendation';
import { useMuscleRecovery } from '../../src/hooks/useMuscleRecovery';
import { getTodayDate } from '../../src/utils/dateUtils';
import type { WeeklySetTargetsResponse } from '../../src/services/api/weeklySetTargetsApi';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useFocusEffect: (callback: () => void) => {
      callback();
    },
  };
});

jest.mock('../../src/hooks/useWeeklySetTargets', () => ({
  useWeeklySetTargets: jest.fn(),
}));

jest.mock('../../src/hooks/useDailySummary', () => ({
  useDailySummary: jest.fn(),
}));

jest.mock('../../src/hooks', () => ({
  useServerConnection: jest.fn(() => ({ isConnected: true, isLoading: false })),
}));

jest.mock('../../src/hooks/usePreferences', () => ({
  usePreferences: jest.fn(() => ({
    preferences: { default_weight_unit: 'kg', default_distance_unit: 'km' },
  })),
}));

jest.mock('../../src/hooks/useExerciseImageSource', () => ({
  useExerciseImageSource: jest.fn(() => ({ getImageSource: jest.fn() })),
}));

// The gym-profiles row reads the active profile through the API client; stub
// the fetch layer rather than the hook so the row's real query path is covered.
const mockFetchGymProfiles = jest.fn();
jest.mock('../../src/services/api/gymProfilesApi', () => ({
  fetchGymProfiles: (...args: unknown[]) => mockFetchGymProfiles(...args),
  createGymProfile: jest.fn(),
  updateGymProfile: jest.fn(),
  deleteGymProfile: jest.fn(),
  activateGymProfile: jest.fn(),
}));

// Same shape as the gym-profiles mock above: stub the fetch layer so the
// experience row exercises the real query + mutation path.
const mockFetchCoachProfile = jest.fn();
const mockUpdateCoachProfile = jest.fn();
jest.mock('../../src/services/api/coachProfileApi', () => ({
  fetchCoachProfile: (...args: unknown[]) => mockFetchCoachProfile(...args),
  updateCoachProfile: (...args: unknown[]) => mockUpdateCoachProfile(...args),
}));

jest.mock('../../src/hooks/useWorkoutRecommendation', () => ({
  useWorkoutRecommendation: jest.fn(),
}));

jest.mock('../../src/hooks/useMuscleRecovery', () => ({
  useMuscleRecovery: jest.fn(),
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
const mockUseMuscleRecovery = useMuscleRecovery as jest.Mock;
const mockUseDailySummary = useDailySummary as jest.Mock;

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

// The server answers all-null rather than 404 for a user who has never been
// interviewed, so this is the "no profile yet" case too.
function makeCoachProfile(
  level: 'beginner' | 'intermediate' | 'expert' | null,
) {
  return {
    goals: null,
    training_days_per_week: null,
    session_minutes: null,
    experience_level: level,
    limitations: [],
  };
}

// A logged individual activity, shaped the way the daily summary returns one:
// the row reads `name`, `sets`, and the snapshot, so a stub with only an id
// crashes the summary helpers rather than rendering.
function makeActivity() {
  return {
    type: 'individual',
    id: 'session-1',
    entry_date: getTodayDate(),
    exercise_id: 'ex-1',
    name: 'Bench Press',
    duration_minutes: 30,
    calories_burned: 300,
    distance: null,
    avg_heart_rate: null,
    notes: null,
    source: null,
    superset_group: null,
    sets: [],
    exercise_snapshot: null,
  };
}

const navigation = {
  navigate: jest.fn(),
  setParams: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
  isFocused: jest.fn(() => true),
} as never;
const route = { params: undefined } as never;

// The logged-exercise rows own their own delete mutation, so the log section
// needs a real client even though every read on this screen is mocked.
function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ExerciseHomeScreen navigation={navigation} route={route} />
    </QueryClientProvider>,
  );
}

describe('ExerciseHomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchGymProfiles.mockResolvedValue([]);
    mockFetchCoachProfile.mockResolvedValue(makeCoachProfile(null));
    mockUpdateCoachProfile.mockImplementation(async (patch) => ({
      ...makeCoachProfile(null),
      ...patch,
    }));
    mockUseDailySummary.mockReturnValue({ summary: { exerciseEntries: [] } });
    mockUseWorkoutRecommendation.mockReturnValue({
      recommendation: null,
      isLoading: false,
      isError: false,
    });
    mockUseMuscleRecovery.mockReturnValue({
      recovery: null,
      muscles: [
        {
          muscle: 'chest',
          freshness: 0.84,
          fatigue_sets: 1.6,
          last_trained: '2026-08-23',
          percent: 84,
          tone: 'fresh',
        },
      ],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
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

    expect(getByTestId('exercise-home-title')).toBeTruthy();
    expect(getByTestId('up-next-card')).toBeTruthy();
    expect(getByTestId('exercise-home-week-card')).toBeTruthy();
    expect(getByTestId('exercise-home-recovery-card')).toBeTruthy();
    expect(getByText('Logged')).toBeTruthy();
    expect(getByText('Create')).toBeTruthy();
    expect(getByText('Quick access')).toBeTruthy();
    expect(getByText('Setup')).toBeTruthy();
    expect(getByTestId('exercise-home-workout-presets')).toBeTruthy();
    expect(getByTestId('exercise-home-exercises-library')).toBeTruthy();
    expect(getByTestId('exercise-home-gym-profiles')).toBeTruthy();
    expect(getByTestId('exercise-home-weekly-set-targets')).toBeTruthy();
    expect(getByTestId('exercise-home-experience-level')).toBeTruthy();
    expect(getByTestId('exercise-home-exercise-packs')).toBeTruthy();
  });

  it('publishes its day so the Add sheet dates what it logs from this tab', () => {
    renderScreen();

    expect(navigation.setParams).toHaveBeenCalledWith({
      selectedDate: getTodayDate(),
    });
  });

  it('lists the exercise logged on the selected day', () => {
    mockUseDailySummary.mockReturnValue({
      summary: { exerciseEntries: [makeActivity()] },
    });

    const { getByText } = renderScreen();

    expect(getByText('Bench Press')).toBeTruthy();
  });

  it('opens a logged activity from the log', () => {
    const session = makeActivity();
    mockUseDailySummary.mockReturnValue({ summary: { exerciseEntries: [session] } });

    const { getByText } = renderScreen();
    fireEvent.press(getByText('Bench Press'));

    expect(navigation.navigate).toHaveBeenCalledWith('ActivityDetail', { session });
  });

  // The Library tab was the app's only route to either form from scratch;
  // every other caller starts from a finished session.
  it('is the way in to authoring an exercise and a preset from scratch', () => {
    const { getByTestId } = renderScreen();

    fireEvent.press(getByTestId('exercise-home-create-exercise'));
    expect(navigation.navigate).toHaveBeenCalledWith('ExerciseForm', {
      mode: 'create-exercise',
    });
  });

  it('does not queue two create screens during one navigation transition', () => {
    const { getByTestId } = renderScreen();

    fireEvent.press(getByTestId('exercise-home-create-preset'));
    fireEvent.press(getByTestId('exercise-home-create-exercise'));

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith('WorkoutPresetForm', {
      mode: 'create-preset',
    });
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

    fireEvent.press(getByTestId('exercise-home-weekly-set-targets'));
    expect(navigation.navigate).toHaveBeenCalledWith('WeeklySetTargets');

    fireEvent.press(getByTestId('exercise-home-exercise-packs'));
    expect(navigation.navigate).toHaveBeenCalledWith('ExercisePacks');
  });

  it('names the active gym profile in the setup row', async () => {
    mockFetchGymProfiles.mockResolvedValue([
      {
        id: 'profile-1',
        user_id: 'user-1',
        name: 'Home',
        equipment: ['dumbbell', 'bands'],
        is_active: true,
        created_at: '2026-08-23T00:00:00.000Z',
        updated_at: '2026-08-23T00:00:00.000Z',
      },
    ]);

    const { findByText } = renderScreen();

    expect(await findByText('Active: Home')).toBeTruthy();
  });

  it('says every exercise is available when no profile is active', async () => {
    const { findByText } = renderScreen();

    expect(
      await findByText('No active profile — every exercise is available'),
    ).toBeTruthy();
  });

  it('shows the stated experience level in the setup row', async () => {
    mockFetchCoachProfile.mockResolvedValue(makeCoachProfile('intermediate'));

    const { getByTestId } = renderScreen();

    // The picker sheet renders the same label as an option, so scope the
    // lookup to the row rather than the whole tree.
    const row = getByTestId('exercise-home-experience-level');
    expect(await within(row).findByText('Intermediate')).toBeTruthy();
  });

  // The catalog's level vocabulary is exact-match, so what leaves this screen
  // must be the lowercase token, not the label the row displays.
  it('saves a picked experience level as its lowercase token', async () => {
    const { getByRole } = renderScreen();

    fireEvent.press(getByRole('radio', { name: 'Beginner' }));

    await waitFor(() =>
      expect(mockUpdateCoachProfile).toHaveBeenCalledWith({
        experience_level: 'beginner',
      }),
    );
  });

  // Null clears a stated level back to unstated; omitting the field would be
  // a different request (and an empty patch a 400).
  it('clears the level with an explicit null when Not set is picked', async () => {
    mockFetchCoachProfile.mockResolvedValue(makeCoachProfile('expert'));

    const { getByTestId, getByRole } = renderScreen();
    const row = getByTestId('exercise-home-experience-level');
    await within(row).findByText('Expert');

    fireEvent.press(getByRole('radio', { name: 'Not set' }));

    await waitFor(() =>
      expect(mockUpdateCoachProfile).toHaveBeenCalledWith({
        experience_level: null,
      }),
    );
  });

  it('does not save when the stored level is re-picked', async () => {
    mockFetchCoachProfile.mockResolvedValue(makeCoachProfile('intermediate'));

    const { getByTestId, getByRole } = renderScreen();
    const row = getByTestId('exercise-home-experience-level');
    await within(row).findByText('Intermediate');

    fireEvent.press(getByRole('radio', { name: 'Intermediate' }));

    // Give a would-be mutation a tick to fire before asserting it did not.
    await waitFor(() => expect(mockFetchCoachProfile).toHaveBeenCalled());
    expect(mockUpdateCoachProfile).not.toHaveBeenCalled();
  });

  // The week card is the usual way in, but it hides itself when the read came
  // back with nothing — which would leave the screen that sets the targets
  // unreachable exactly when a user goes looking for it.
  it('keeps weekly set targets reachable when the week card is hidden', () => {
    mockUseWeeklySetTargets.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: jest.fn(),
    } as never);

    const { queryByTestId, getByTestId } = renderScreen();

    expect(queryByTestId('exercise-home-week-card')).toBeNull();
    fireEvent.press(getByTestId('exercise-home-weekly-set-targets'));
    expect(navigation.navigate).toHaveBeenCalledWith('WeeklySetTargets');
  });
});
