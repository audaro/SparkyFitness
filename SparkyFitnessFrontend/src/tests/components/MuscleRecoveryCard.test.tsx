import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MuscleRecoveryCard from '@/pages/Exercises/MuscleRecoveryCard';
import type { MuscleRecoveryItem } from '@/hooks/Exercises/useMuscleRecovery';

let mockHasPermission = true;
let mockMuscles: MuscleRecoveryItem[] = [];
let mockQueryState = { isLoading: false, isError: false, hasData: true };

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultOrValues?: string | Record<string, unknown>) => {
      if (typeof defaultOrValues === 'string') return defaultOrValues;
      if (defaultOrValues && typeof defaultOrValues === 'object') {
        const { defaultValue, ...values } = defaultOrValues as {
          defaultValue?: string;
        } & Record<string, unknown>;
        if (typeof defaultValue === 'string') {
          return defaultValue.replace(
            /\{\{(\w+)\}\}/g,
            (_match, name: string) => String(values[name] ?? '')
          );
        }
        return key;
      }
      return key;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({ hasPermission: () => mockHasPermission }),
}));

jest.mock('@/hooks/Exercises/useMuscleRecovery', () => ({
  useMuscleRecovery: () => ({
    muscles: mockMuscles,
    data: mockQueryState.hasData ? mockMuscles : undefined,
    isLoading: mockQueryState.isLoading,
    isError: mockQueryState.isError,
  }),
}));

const item = (
  muscle: string,
  percent: number,
  tone: MuscleRecoveryItem['tone']
): MuscleRecoveryItem => ({
  muscle,
  freshness: percent / 100,
  fatigue_sets: ((100 - percent) / 100) * 10,
  last_trained: percent === 100 ? null : '2026-08-22',
  percent,
  tone,
});

describe('MuscleRecoveryCard', () => {
  beforeEach(() => {
    mockHasPermission = true;
    mockMuscles = [];
    mockQueryState = { isLoading: false, isError: false, hasData: true };
  });

  it('renders nothing without diary permission for the active context', () => {
    mockHasPermission = false;
    mockMuscles = [item('chest', 90, 'fresh')];

    const { container } = render(<MuscleRecoveryCard />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders muscles in the order the server ranked them', () => {
    mockMuscles = [
      item('chest', 92, 'fresh'),
      item('lower back', 55, 'moderate'),
      item('quadriceps', 12, 'fatigued'),
    ];

    render(<MuscleRecoveryCard />);

    const names = screen
      .getAllByRole('progressbar')
      .map((bar) => bar.getAttribute('aria-label'));
    // Freshest first, unsorted by the client — re-sorting would put the card
    // out of step with the muscles the generator picks.
    expect(names).toEqual(['Chest', 'Lower Back', 'Quadriceps']);
  });

  it('renders the derived percentage, never the 0-1 freshness', () => {
    mockMuscles = [item('chest', 84, 'fresh')];

    render(<MuscleRecoveryCard />);

    expect(screen.getByText('84%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '84'
    );
  });

  it('title-cases the canonical muscle name for display', () => {
    mockMuscles = [item('middle back', 40, 'moderate')];

    render(<MuscleRecoveryCard />);

    // Stored lowercase because catalog matching is case-sensitive; capitalized
    // only on the way to the screen.
    expect(screen.getByText('Middle Back')).toBeInTheDocument();
  });

  it('keeps showing cached recovery when a refetch fails', () => {
    mockMuscles = [item('chest', 92, 'fresh')];
    mockQueryState = { isLoading: false, isError: true, hasData: true };

    render(<MuscleRecoveryCard />);

    expect(screen.getByText('Chest')).toBeInTheDocument();
    expect(
      screen.queryByText('Failed to load your recovery.')
    ).not.toBeInTheDocument();
  });

  it('reports the failure when there is nothing cached', () => {
    mockQueryState = { isLoading: false, isError: true, hasData: false };

    render(<MuscleRecoveryCard />);

    expect(
      screen.getByText('Failed to load your recovery.')
    ).toBeInTheDocument();
  });

  it('explains the empty state rather than showing a blank grid', () => {
    mockMuscles = [];

    render(<MuscleRecoveryCard />);

    expect(
      screen.getByText('Log a workout and your recovery will show up here.')
    ).toBeInTheDocument();
  });
});
