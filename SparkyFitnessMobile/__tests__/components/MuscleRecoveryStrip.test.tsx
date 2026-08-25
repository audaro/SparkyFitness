import React from 'react';
import { render } from '@testing-library/react-native';
import { freshnessPercent, freshnessTone, MUSCLES } from '@workspace/shared';

import MuscleRecoveryStrip from '../../src/components/MuscleRecoveryStrip';
import { useMuscleRecovery } from '../../src/hooks/useMuscleRecovery';

jest.mock('../../src/hooks/useMuscleRecovery', () => ({
  useMuscleRecovery: jest.fn(),
}));

const mockUseMuscleRecovery = useMuscleRecovery as jest.MockedFunction<
  typeof useMuscleRecovery
>;

function item(muscle: string, freshness: number) {
  return {
    muscle,
    freshness,
    fatigue_sets: (1 - freshness) * 10,
    last_trained: freshness === 1 ? null : '2026-08-23',
    percent: freshnessPercent(freshness),
    tone: freshnessTone(freshness),
  };
}

function setState(state: Record<string, unknown>) {
  mockUseMuscleRecovery.mockReturnValue({
    recovery: null,
    muscles: [],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    ...state,
  } as never);
}

describe('MuscleRecoveryStrip', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('draws a tile for every canonical muscle', () => {
    setState({
      muscles: MUSCLES.map((muscle, index) =>
        item(muscle, 1 - index / MUSCLES.length),
      ),
    });

    const screen = render(<MuscleRecoveryStrip />);

    expect(screen.getByTestId('exercise-home-recovery-card')).toBeTruthy();
    for (const muscle of MUSCLES) {
      expect(screen.getByTestId(`exercise-home-recovery-${muscle}`)).toBeTruthy();
    }
  });

  // The scale trap: 0.0-1.0 rendered raw shows every muscle at 1%.
  it('renders freshness as a whole percentage', () => {
    setState({ muscles: [item('chest', 1), item('quadriceps', 0.12)] });

    const screen = render(<MuscleRecoveryStrip />);

    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('12%')).toBeTruthy();
  });

  it('capitalizes the canonical muscle name for display', () => {
    setState({ muscles: [item('lower back', 0.4)] });

    const screen = render(<MuscleRecoveryStrip />);

    expect(screen.getByText('Lower Back')).toBeTruthy();
  });

  it('keeps the order the server ranked the muscles in', () => {
    setState({
      muscles: [item('chest', 0.9), item('lats', 0.5), item('glutes', 0.1)],
    });

    const screen = render(<MuscleRecoveryStrip />);
    const tiles = screen.getAllByTestId(
      /^exercise-home-recovery-(?!card$|strip$)/,
    );

    expect(tiles.map((node) => node.props.testID)).toEqual([
      'exercise-home-recovery-chest',
      'exercise-home-recovery-lats',
      'exercise-home-recovery-glutes',
    ]);
  });

  it('shows the card while the first read is in flight', () => {
    setState({ isLoading: true });

    const screen = render(<MuscleRecoveryStrip />);

    expect(screen.getByTestId('exercise-home-recovery-card')).toBeTruthy();
    expect(screen.queryByTestId('exercise-home-recovery-strip')).toBeNull();
  });

  it('hides itself when the read failed with nothing cached', () => {
    setState({ isError: true });

    const screen = render(<MuscleRecoveryStrip />);

    expect(screen.queryByTestId('exercise-home-recovery-card')).toBeNull();
  });

  // isError is also true when a focus refetch fails over cached data, and this
  // hook refetches on every tab focus — going offline must not blank the strip.
  it('keeps the cached strip when a refetch fails', () => {
    setState({ isError: true, muscles: [item('chest', 0.9)] });

    const screen = render(<MuscleRecoveryStrip />);

    expect(screen.getByTestId('exercise-home-recovery-chest')).toBeTruthy();
  });
});
