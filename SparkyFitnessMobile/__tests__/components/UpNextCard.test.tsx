import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import UpNextCard from '../../src/components/UpNextCard';
import { useWorkoutRecommendation } from '../../src/hooks/useWorkoutRecommendation';

jest.mock('../../src/hooks/useWorkoutRecommendation', () => ({
  useWorkoutRecommendation: jest.fn(),
}));

const mockUseWorkoutRecommendation = useWorkoutRecommendation as jest.MockedFunction<
  typeof useWorkoutRecommendation
>;

const navigation = { navigate: jest.fn() } as never;

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
  });

  it('summarizes the generated workout', () => {
    setState({ recommendation });

    const screen = render(<UpNextCard navigation={navigation} />);

    expect(screen.getByText('Chest · Triceps')).toBeTruthy();
    expect(screen.getByText('3 exercises · 2 muscles · 38 min')).toBeTruthy();
  });

  it('prompts a first-run user to generate one', () => {
    setState({ recommendation: null });

    const screen = render(<UpNextCard navigation={navigation} />);

    expect(screen.getByText("Generate today's workout")).toBeTruthy();
  });

  it('stays silent rather than showing an error block on a failed read', () => {
    setState({ recommendation: null, isError: true });

    const screen = render(<UpNextCard navigation={navigation} />);

    expect(screen.queryByTestId('up-next-card')).toBeNull();
  });

  it('navigates to the Up Next screen', () => {
    setState({ recommendation });

    const screen = render(<UpNextCard navigation={navigation} />);
    fireEvent.press(screen.getByTestId('up-next-card'));

    expect(navigation.navigate).toHaveBeenCalledWith('UpNext');
  });
});
