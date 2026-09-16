import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MuscleGainProjectionCard from '@/pages/Exercises/MuscleGainProjectionCard';
import type { MuscleGainProjection } from '@/hooks/Exercises/useMuscleGainProjection';

/**
 * The web projection card.
 *
 * The estimate is the server's, so what is tested here is the framing around
 * it: which horizon is asked for, what the card does with nothing to show, and
 * whether the year says it is an extrapolation.
 */

let mockAvailable = true;
let mockProfile: { plan_completed_at: string | null } | undefined;
let mockProjection: MuscleGainProjection | undefined;
let mockIsPlaceholderData = false;
const mockUseProjection = jest.fn();

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
      }
      return key;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

jest.mock('@/hooks/Exercises/useCoachingContextAvailable', () => ({
  useCoachingContextAvailable: () => mockAvailable,
}));

jest.mock('@/hooks/Exercises/useCoachProfile', () => ({
  useCoachProfile: () => ({ data: mockProfile }),
}));

jest.mock('@/hooks/Exercises/useMuscleGainProjection', () => ({
  useMuscleGainProjection: (weeks: number, enabled: boolean) => {
    mockUseProjection(weeks, enabled);
    return {
      data: mockProjection,
      isPlaceholderData: mockIsPlaceholderData,
    };
  },
}));

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    weightUnit: 'kg',
    convertWeight: (value: number) => value,
  }),
}));

function makeProjection(
  overrides: Partial<MuscleGainProjection['projection']> = {},
  inputs: Partial<MuscleGainProjection['inputs']> = {}
): MuscleGainProjection {
  return {
    horizon_weeks: 12,
    projection: {
      natural_kg: { low_kg: 1, high_kg: 2 },
      enhanced_kg: null,
      total_kg: { low_kg: 1.2, high_kg: 2.4 },
      per_month_kg: { low_kg: 0.4, high_kg: 0.8 },
      at_full_adherence_kg: { low_kg: 1.5, high_kg: 3 },
      unmodelled: [],
      sources: ['Bhasin 2001'],
      ...overrides,
    },
    inputs: {
      sex: 'male',
      experience_level: 'intermediate',
      bodyweight_kg: 82,
      adherence: 0.8,
      adherence_basis: 'measured',
      adherence_weeks: 4,
      enhancement_stated: false,
      ...inputs,
    },
  };
}

describe('MuscleGainProjectionCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAvailable = true;
    mockProfile = { plan_completed_at: '2026-09-16T10:00:00.000Z' };
    mockProjection = makeProjection();
    mockIsPlaceholderData = false;
  });

  it('opens on twelve weeks, the horizon the model was fitted on', () => {
    render(<MuscleGainProjectionCard />);
    expect(mockUseProjection).toHaveBeenCalledWith(12, true);
    expect(
      screen.getByTestId('muscle-gain-projection-range')
    ).toHaveTextContent('+1.2–2.4 kg of lean mass');
  });

  // A profile that has not answered the questionnaire is being offered the
  // questionnaire by the card above; estimating from defaults underneath that
  // offer would show a number no answer of theirs produced.
  it('asks for nothing until the plan has been answered', () => {
    mockProfile = { plan_completed_at: null };
    mockProjection = undefined;
    render(<MuscleGainProjectionCard />);
    expect(mockUseProjection).toHaveBeenCalledWith(12, false);
    expect(screen.queryByTestId('muscle-gain-projection-card')).toBeNull();
  });

  // Owner-only, like the rest of the coach profile: a delegate must make no
  // request rather than collect a 403.
  it('makes no request while acting for someone else', () => {
    mockAvailable = false;
    mockProjection = undefined;
    render(<MuscleGainProjectionCard />);
    expect(mockUseProjection).toHaveBeenCalledWith(12, false);
    expect(screen.queryByTestId('muscle-gain-projection-card')).toBeNull();
  });

  it('stays off screen when there is no bodyweight to estimate from', () => {
    mockProjection = makeProjection(
      { total_kg: null, natural_kg: null },
      { bodyweight_kg: null }
    );
    render(<MuscleGainProjectionCard />);
    expect(screen.queryByTestId('muscle-gain-projection-card')).toBeNull();
  });

  // The year is the model run well past the trials behind it, so it has to say
  // so rather than sit beside the twelve-week figure looking equally solid.
  it('names the year as an extrapolation and asks the server for it', () => {
    render(<MuscleGainProjectionCard />);
    expect(
      screen.queryByTestId('muscle-gain-projection-extrapolation')
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '1 year' }));

    expect(mockUseProjection).toHaveBeenLastCalledWith(52, true);
    expect(
      screen.getByTestId('muscle-gain-projection-extrapolation')
    ).toBeInTheDocument();
  });

  // `keepPreviousData` is what keeps the card mounted across a horizon change,
  // but the data it keeps answers the *other* horizon — and the buttons have
  // already moved, so rendering it puts twelve weeks of growth under a label
  // reading "1 year".
  it('waits for the figure rather than showing the other horizon under the new label', () => {
    mockIsPlaceholderData = true;
    render(<MuscleGainProjectionCard />);

    fireEvent.click(screen.getByRole('button', { name: '1 year' }));

    // Still mounted — that is what the placeholder data buys.
    expect(
      screen.getByTestId('muscle-gain-projection-card')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('muscle-gain-projection-range')
    ).toHaveTextContent('Working it out…');
    expect(
      screen.getByTestId('muscle-gain-projection-range')
    ).not.toHaveTextContent('+1.2–2.4 kg of lean mass');
  });

  // A user who has just answered the questionnaire has not failed at anything,
  // and the card must not imply they have.
  it('says the estimate assumes full adherence when nothing is logged yet', () => {
    mockProjection = makeProjection(
      {},
      { adherence: 1, adherence_basis: 'no_history', adherence_weeks: 0 }
    );
    render(<MuscleGainProjectionCard />);
    expect(
      screen.getByText(
        'Assumes you hit every target, because there is nothing logged yet to measure against.'
      )
    ).toBeInTheDocument();
  });
});
