import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import MuscleGainProjectionCard from '../../src/components/MuscleGainProjectionCard';
import type { MuscleGainProjection } from '../../src/services/api/muscleGainProjectionApi';

/**
 * The Exercise tab's projection card.
 *
 * The estimate is the server's, so what is worth testing here is everything
 * around it: which horizon gets asked for, what happens when there is nothing
 * to estimate from, and whether the year is labelled for what it is.
 */

const mockFetch = jest.fn();
jest.mock('../../src/services/api/muscleGainProjectionApi', () => ({
  fetchMuscleGainProjection: (...args: unknown[]) => mockFetch(...args),
}));

jest.mock('../../src/hooks/usePreferences', () => ({
  usePreferences: jest.fn(() => ({
    preferences: { default_weight_unit: 'kg' },
  })),
}));

const { usePreferences } = jest.requireMock('../../src/hooks/usePreferences');

function projection(
  weeks: number,
  overrides: Partial<MuscleGainProjection['projection']> = {},
  inputs: Partial<MuscleGainProjection['inputs']> = {},
): MuscleGainProjection {
  return {
    horizon_weeks: weeks,
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

const onPress = jest.fn();

function renderCard(enabled = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MuscleGainProjectionCard enabled={enabled} onPress={onPress} />
    </QueryClientProvider>,
  );
}

describe('MuscleGainProjectionCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePreferences.mockReturnValue({
      preferences: { default_weight_unit: 'kg' },
    });
    mockFetch.mockImplementation(async (weeks: number) => projection(weeks));
  });

  it('opens on twelve weeks, the horizon the model was fitted on', async () => {
    const { findByTestId } = renderCard();
    const range = await findByTestId('exercise-home-projection-range');
    expect(mockFetch).toHaveBeenCalledWith(12);
    expect(range.props.children).toBe('+1.2–2.4 kg of lean mass');
  });

  // A profile that has not answered the questionnaire is already being offered
  // the questionnaire; estimating from defaults underneath that offer would
  // put a number on screen that no answer of the user's produced.
  it('asks for nothing until the plan has been answered', async () => {
    const { queryByTestId } = renderCard(false);
    await waitFor(() => expect(queryByTestId('exercise-home-projection-card')).toBeNull());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Every figure is null without a weigh-in, and a card explaining why it has
  // nothing to say is worse than no card on a tab with plenty else on it.
  it('stays off screen when there is no bodyweight to estimate from', async () => {
    mockFetch.mockResolvedValue(
      projection(12, { total_kg: null, natural_kg: null }, { bodyweight_kg: null }),
    );
    const { queryByTestId } = renderCard();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(queryByTestId('exercise-home-projection-card')).toBeNull();
  });

  // The year is the model run well past the trials behind it, so it has to say
  // so rather than sit next to the twelve-week figure looking equally solid.
  it('names the year as an extrapolation and asks the server for it', async () => {
    const { getByText, getByTestId, queryByTestId, findByTestId } = renderCard();
    await findByTestId('exercise-home-projection-range');
    expect(queryByTestId('exercise-home-projection-extrapolation')).toBeNull();

    fireEvent.press(getByText('1 year'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(52));
    expect(getByTestId('exercise-home-projection-extrapolation')).toBeTruthy();
  });

  // Switching horizon must not unmount the card under the finger that switched
  // it: the card hides itself when it has no data, so the previous horizon has
  // to stay on screen until the new one lands.
  it('keeps the figure on screen while the other horizon loads', async () => {
    const { getByText, getByTestId, findByTestId } = renderCard();
    await findByTestId('exercise-home-projection-range');

    let resolveYear: (value: MuscleGainProjection) => void = () => {};
    mockFetch.mockImplementation(
      () => new Promise((resolve) => { resolveYear = resolve; }),
    );
    fireEvent.press(getByText('1 year'));

    expect(getByTestId('exercise-home-projection-range').props.children).toBe(
      '+1.2–2.4 kg of lean mass',
    );
    resolveYear(projection(52, { total_kg: { low_kg: 5, high_kg: 9 } }));
    await waitFor(() =>
      expect(getByTestId('exercise-home-projection-range').props.children).toBe(
        '+5.0–9.0 kg of lean mass',
      ),
    );
  });

  it('shows the estimate in the weight unit the user reads', async () => {
    usePreferences.mockReturnValue({
      preferences: { default_weight_unit: 'lbs' },
    });
    const { findByTestId } = renderCard();
    const range = await findByTestId('exercise-home-projection-range');
    expect(range.props.children).toBe('+2.6–5.3 lbs of lean mass');
  });

  // A user who has just answered the questionnaire has not failed at anything,
  // and the card must not imply they have.
  it('says the estimate assumes full adherence when nothing is logged yet', async () => {
    mockFetch.mockResolvedValue(
      projection(12, {}, { adherence: 1, adherence_basis: 'no_history', adherence_weeks: 0 }),
    );
    const { getByText } = renderCard();
    await waitFor(() =>
      expect(
        getByText(
          'Assumes you hit every target, because there is nothing logged yet to measure against.',
        ),
      ).toBeTruthy(),
    );
  });

  it('opens the plan from the review row', async () => {
    const { getByTestId, findByTestId } = renderCard();
    await findByTestId('exercise-home-projection-review');
    fireEvent.press(getByTestId('exercise-home-projection-review'));
    expect(onPress).toHaveBeenCalled();
  });
});
