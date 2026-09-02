import { fireEvent, render } from '@testing-library/react-native';

import UpNextCard from '../../src/components/UpNextCard';
import { useWorkoutRecommendation } from '../../src/hooks/useWorkoutRecommendation';
import { useActiveWorkoutStore } from '../../src/stores/activeWorkoutStore';

jest.mock('../../src/hooks/useWorkoutRecommendation', () => ({
  useWorkoutRecommendation: jest.fn(),
}));

const mockUseWorkoutRecommendation = useWorkoutRecommendation as jest.MockedFunction<
  typeof useWorkoutRecommendation
>;

const navigation = { navigate: jest.fn() };

function setState(state: Record<string, unknown>) {
  mockUseWorkoutRecommendation.mockReturnValue({
    recommendation: null,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    generate: jest.fn(),
    generateAsync: jest.fn(),
    isGenerating: false,
    ...state,
  } as never);
}

const recommendation = {
  id: 'rec-1',
  status: 'active',
  target_duration_minutes: 60,
  gym_profile_id: null,
  generated_at: '2026-08-23T10:00:00.000Z',
  payload: {
    muscle_groups: ['chest', 'triceps'],
    estimated_duration_minutes: 38,
    exercises: [
      { exercise_id: 'ex-1' },
      { exercise_id: 'ex-2' },
      { exercise_id: 'ex-3' },
    ],
  },
};

describe('UpNextCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useActiveWorkoutStore.getState().clearWorkout();
  });

  it('summarizes the generated workout', () => {
    setState({ recommendation });

    const screen = render(<UpNextCard navigation={navigation as never} />);

    expect(screen.getByText('Chest · Triceps')).toBeTruthy();
    expect(screen.getByText('3 exercises · 2 muscles · 38 min')).toBeTruthy();
  });

  it('prompts a first-run user to generate one', () => {
    setState({ recommendation: null });

    const screen = render(<UpNextCard navigation={navigation as never} />);

    expect(screen.getByText("Build today's workout")).toBeTruthy();
  });

  it('stays silent rather than showing an error block on a failed read', () => {
    setState({ recommendation: null, isError: true });

    const screen = render(<UpNextCard navigation={navigation as never} />);

    expect(screen.queryByTestId('up-next-card')).toBeNull();
  });

  // isError also covers a refetch that failed over cached data, and the card
  // sits on screens that refetch on focus. A stale workout the user can still
  // start beats no card at all the moment they lose signal.
  it('keeps showing a cached workout when a refetch fails', () => {
    setState({ recommendation, isError: true });

    const screen = render(<UpNextCard navigation={navigation as never} />);

    expect(screen.getByTestId('up-next-card')).toBeTruthy();
    expect(screen.getByText('Chest · Triceps')).toBeTruthy();
  });

  it('shows Done today once the recommendation is completed', () => {
    setState({ recommendation: { ...recommendation, status: 'completed' } });

    const screen = render(<UpNextCard navigation={navigation as never} />);

    expect(screen.getByTestId('up-next-card-completed')).toBeTruthy();
    expect(screen.getByText('Done today')).toBeTruthy();
  });

  it('shows In progress while this recommendation is the live workout, whatever the server status says', () => {
    setState({ recommendation: { ...recommendation, status: 'started' } });
    useActiveWorkoutStore.setState({ sessionId: 'session-1', sourceRecommendationId: 'rec-1' });

    const screen = render(<UpNextCard navigation={navigation as never} />);

    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.queryByTestId('up-next-card-completed')).toBeNull();
  });

  it('does not claim In progress when the live workout came from somewhere else', () => {
    setState({ recommendation: { ...recommendation, status: 'started' } });
    useActiveWorkoutStore.setState({ sessionId: 'session-1', sourceRecommendationId: null });

    const screen = render(<UpNextCard navigation={navigation as never} />);

    expect(screen.queryByText('In progress')).toBeNull();
  });

  it('navigates to the Up Next screen', () => {
    setState({ recommendation });

    const screen = render(<UpNextCard navigation={navigation as never} />);
    fireEvent.press(screen.getByTestId('up-next-card'));

    expect(navigation.navigate).toHaveBeenCalledWith('UpNext');
  });
});
