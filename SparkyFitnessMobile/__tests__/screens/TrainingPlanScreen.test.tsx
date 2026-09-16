import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import TrainingPlanScreen from '../../src/screens/TrainingPlanScreen';

/**
 * The training-plan questionnaire.
 *
 * What is worth testing here is not the layout but the round trip: the answers
 * the screen loads have to be the answers it shows, and the patch it sends has
 * to be the answers on screen. The dose is the case that forces the shape — a
 * ten-weekly protocol stored as a weekly average would reopen as a number the
 * user never typed.
 */

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useFocusEffect: (callback: () => void) => callback() };
});

const mockFetchCoachProfile = jest.fn();
const mockUpdateCoachProfile = jest.fn();
jest.mock('../../src/services/api/coachProfileApi', () => ({
  fetchCoachProfile: (...args: unknown[]) => mockFetchCoachProfile(...args),
  updateCoachProfile: (...args: unknown[]) => mockUpdateCoachProfile(...args),
}));

const mockClearWeeklySetTargets = jest.fn();
jest.mock('../../src/hooks/useWeeklySetTargets', () => ({
  WEEKLY_SET_HISTORY_WEEKS: 8,
  useWeeklySetTargets: jest.fn(() => ({ data: { targets_are_custom: false } })),
}));
jest.mock('../../src/services/api/weeklySetTargetsApi', () => ({
  clearWeeklySetTargets: (...args: unknown[]) =>
    mockClearWeeklySetTargets(...args),
}));

jest.mock('../../src/hooks/useProfile', () => ({
  useProfile: jest.fn(() => ({
    profile: { gender: 'male', date_of_birth: '1990-06-01' },
  })),
}));
jest.mock('../../src/hooks/useLatestCheckIn', () => ({
  useLatestCheckIn: jest.fn(() => ({
    measurement: { entry_date: '2026-09-15', weight: 82, body_fat_percentage: 18 },
  })),
}));
jest.mock('../../src/hooks/useMuscleGainProjection', () => ({
  useMuscleGainProjection: jest.fn(() => ({
    projection: undefined,
    isLoading: false,
  })),
}));
jest.mock('../../src/hooks', () => ({
  usePreferences: jest.fn(() => ({
    preferences: { default_weight_unit: 'kg' },
  })),
}));
jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  useActiveWorkoutBarPadding: jest.fn(() => 0),
}));
jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSTabsActive: jest.fn(() => false),
  useNativeIOSHeadersActive: jest.fn(() => false),
}));
// The header hook reaches for a real navigator through `useNavigation`; the
// wizard's Back button is exercised by the navigation contract test, not here.
jest.mock('../../src/hooks/useScreenHeader', () => ({
  useScreenHeader: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const { useWeeklySetTargets } = jest.requireMock(
  '../../src/hooks/useWeeklySetTargets',
);

const navigation = { navigate: jest.fn(), goBack: jest.fn() };

function emptyProfile() {
  return {
    goals: null,
    training_days_per_week: null,
    session_minutes: null,
    experience_level: null,
    limitations: [],
    primary_goal: null,
    physique_target: null,
    priority_muscle_groups: null,
    enhancement: null,
    plan_completed_at: null,
  };
}

function renderScreen(params?: { initialStep?: number }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TrainingPlanScreen
        navigation={navigation as never}
        route={{ params } as never}
      />
    </QueryClientProvider>,
  );
}

/**
 * Waits for the profile read to land. The Save button is disabled while the
 * coach profile is loading, and a press on a disabled Pressable is silently
 * dropped, so a test that only waits for the *request* presses nothing.
 */
async function waitForSaveReady(getByTestId: (id: string) => { props: Record<string, unknown> }) {
  await waitFor(() => {
    const state = getByTestId('training-plan-save').props
      .accessibilityState as { disabled?: boolean } | undefined;
    expect(state?.disabled).not.toBe(true);
  });
}

/** Walks the wizard forward from step 1 to `target`. */
function advanceTo(getByTestId: (id: string) => unknown, target: number) {
  for (let step = 1; step < target; step += 1) {
    fireEvent.press(getByTestId('training-plan-next') as never);
  }
}

describe('TrainingPlanScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchCoachProfile.mockResolvedValue(emptyProfile());
    mockUpdateCoachProfile.mockImplementation(async (patch: object) => ({
      ...emptyProfile(),
      ...patch,
    }));
    useWeeklySetTargets.mockReturnValue({ data: { targets_are_custom: false } });
  });

  it('sends every answer as one patch, with a completion stamp', async () => {
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(mockFetchCoachProfile).toHaveBeenCalled());

    advanceTo(getByTestId, 2);
    fireEvent.press(getByTestId('training-plan-goal-build_muscle'));
    fireEvent.press(getByTestId('training-plan-physique-muscular'));

    fireEvent.press(getByTestId('training-plan-next'));
    fireEvent.press(getByTestId('training-plan-experience-expert'));
    fireEvent.press(getByTestId('training-plan-priority-pull'));

    fireEvent.press(getByTestId('training-plan-next'));
    fireEvent.press(getByTestId('training-plan-limitation-knee'));

    fireEvent.press(getByTestId('training-plan-next'));
    fireEvent.press(getByTestId('training-plan-next'));
    fireEvent.press(getByTestId('training-plan-save'));

    await waitFor(() => expect(mockUpdateCoachProfile).toHaveBeenCalled());
    const patch = mockUpdateCoachProfile.mock.calls[0][0];
    expect(patch.primary_goal).toBe('build_muscle');
    expect(patch.physique_target).toBe('muscular');
    expect(patch.experience_level).toBe('expert');
    expect(patch.priority_muscle_groups).toEqual(['pull']);
    expect(patch.limitations).toEqual(['Knee pain']);
    expect(patch.enhancement).toEqual({ status: 'natural' });
    expect(typeof patch.plan_completed_at).toBe('string');
  });

  // Past two, each priority stops taking share from the others, so the cap is
  // part of what the answer means rather than a UI nicety.
  it('keeps at most two priority groups', async () => {
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(mockFetchCoachProfile).toHaveBeenCalled());

    advanceTo(getByTestId, 3);
    fireEvent.press(getByTestId('training-plan-priority-push'));
    fireEvent.press(getByTestId('training-plan-priority-pull'));
    fireEvent.press(getByTestId('training-plan-priority-legs'));

    fireEvent.press(getByTestId('training-plan-next'));
    fireEvent.press(getByTestId('training-plan-next'));
    fireEvent.press(getByTestId('training-plan-next'));
    fireEvent.press(getByTestId('training-plan-save'));

    await waitFor(() => expect(mockUpdateCoachProfile).toHaveBeenCalled());
    expect(
      mockUpdateCoachProfile.mock.calls[0][0].priority_muscle_groups,
    ).toEqual(['pull', 'legs']);
  });

  // The whole reason the stored shape is a dose and an interval rather than a
  // weekly average.
  it('stores a long-interval dose as stated rather than as a weekly average', async () => {
    const { getByTestId } = renderScreen();
    await waitFor(() => expect(mockFetchCoachProfile).toHaveBeenCalled());

    advanceTo(getByTestId, 5);
    fireEvent.press(getByTestId('training-plan-enhancement-trt'));
    fireEvent.changeText(getByTestId('training-plan-dose'), '1000');
    fireEvent.press(getByTestId('training-plan-ester-undecanoate'));

    fireEvent.press(getByTestId('training-plan-next'));
    fireEvent.press(getByTestId('training-plan-save'));

    await waitFor(() => expect(mockUpdateCoachProfile).toHaveBeenCalled());
    expect(mockUpdateCoachProfile.mock.calls[0][0].enhancement).toEqual({
      status: 'trt',
      testosterone_mg_per_dose: 1000,
      dose_interval_weeks: 10,
      ester: 'undecanoate',
    });
  });

  it('reopens a stored dose as the number the user typed', async () => {
    mockFetchCoachProfile.mockResolvedValue({
      ...emptyProfile(),
      enhancement: {
        status: 'trt',
        testosterone_mg_per_dose: 1000,
        dose_interval_weeks: 10,
        ester: 'undecanoate',
      },
    });
    const { getByTestId } = renderScreen({ initialStep: 5 });
    await waitFor(() =>
      expect(getByTestId('training-plan-dose').props.value).toBe('1000'),
    );
    expect(getByTestId('training-plan-interval-10')).toBeTruthy();
  });

  // A weekly ester needs no interval control at all, and sending one would
  // state an answer the user was never asked for.
  it('omits the interval for a weekly protocol', async () => {
    const { getByTestId, queryByTestId } = renderScreen({ initialStep: 5 });
    await waitFor(() => expect(mockFetchCoachProfile).toHaveBeenCalled());

    fireEvent.press(getByTestId('training-plan-enhancement-trt'));
    fireEvent.changeText(getByTestId('training-plan-dose'), '140');
    fireEvent.press(getByTestId('training-plan-ester-cypionate'));
    expect(queryByTestId('training-plan-interval-10')).toBeNull();

    fireEvent.press(getByTestId('training-plan-next'));
    fireEvent.press(getByTestId('training-plan-save'));

    await waitFor(() => expect(mockUpdateCoachProfile).toHaveBeenCalled());
    expect(mockUpdateCoachProfile.mock.calls[0][0].enhancement).toEqual({
      status: 'trt',
      testosterone_mg_per_dose: 140,
      ester: 'cypionate',
    });
  });

  // A hand-set target silently overrides everything the plan derives, so the
  // save has to ask rather than leave the ring disagreeing with the plan.
  it('offers to replace hand-set weekly targets', async () => {
    useWeeklySetTargets.mockReturnValue({ data: { targets_are_custom: true } });
    mockClearWeeklySetTargets.mockResolvedValue({ targets_are_custom: false });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByTestId } = renderScreen({ initialStep: 6 });
    await waitForSaveReady(getByTestId);
    fireEvent.press(getByTestId('training-plan-save'));

    expect(alert).toHaveBeenCalled();
    expect(mockUpdateCoachProfile).not.toHaveBeenCalled();

    // Taking the offer clears the overrides; declining leaves them alone.
    const buttons = alert.mock.calls[0][2] as {
      text: string;
      onPress: () => void;
    }[];
    buttons[1].onPress();
    await waitFor(() => expect(mockClearWeeklySetTargets).toHaveBeenCalled());

    alert.mockRestore();
  });

  it('does not clear targets when the user keeps their own', async () => {
    useWeeklySetTargets.mockReturnValue({ data: { targets_are_custom: true } });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { getByTestId } = renderScreen({ initialStep: 6 });
    await waitForSaveReady(getByTestId);
    fireEvent.press(getByTestId('training-plan-save'));

    const buttons = alert.mock.calls[0][2] as {
      text: string;
      onPress: () => void;
    }[];
    buttons[0].onPress();
    await waitFor(() => expect(mockUpdateCoachProfile).toHaveBeenCalled());
    expect(mockClearWeeklySetTargets).not.toHaveBeenCalled();

    alert.mockRestore();
  });

  // The projection is computed from the stored profile, so showing one for a
  // draft would answer a different question than the one on screen.
  it('withholds the projection until the plan on screen is the saved plan', async () => {
    const { getByTestId, queryByText } = renderScreen({ initialStep: 6 });
    await waitFor(() => expect(mockFetchCoachProfile).toHaveBeenCalled());
    expect(getByTestId('training-plan-projection')).toBeTruthy();
    expect(
      queryByText('Save your plan to see what hitting these targets is worth.'),
    ).toBeTruthy();
  });
});
