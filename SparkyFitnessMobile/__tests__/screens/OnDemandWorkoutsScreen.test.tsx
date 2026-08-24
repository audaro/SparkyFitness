import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { MUSCLES, ON_DEMAND_WORKOUTS } from '@workspace/shared';

import OnDemandWorkoutsScreen from '../../src/screens/OnDemandWorkoutsScreen';
import { createQueryWrapper, createTestQueryClient } from '../hooks/queryTestUtils';

const mockGenerateRecommendation = jest.fn();
const mockFetchRecommendation = jest.fn();

jest.mock('../../src/services/api/workoutRecommendationsApi', () => ({
  fetchRecommendation: (...args: unknown[]) => mockFetchRecommendation(...args),
  generateRecommendation: (...args: unknown[]) => mockGenerateRecommendation(...args),
  fetchAlternatives: jest.fn(),
  replaceRecommendationExercise: jest.fn(),
  patchRecommendationStatus: jest.fn(),
}));

// Force the custom (Android / Liquid-Glass-off) header path so the screen's own
// bar is in the rendered tree instead of being mirrored into the native header.
jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSTabsActive: jest.fn(() => false),
  useNativeIOSHeadersActive: jest.fn(() => false),
}));

jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  useActiveWorkoutBarPadding: () => 0,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockNavigation = {
  goBack: jest.fn(),
  setOptions: jest.fn(),
  navigate: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
} as never;

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

function renderScreen() {
  const route = {
    key: 'OnDemandWorkouts-1',
    name: 'OnDemandWorkouts',
    params: undefined,
  } as never;
  return render(
    <OnDemandWorkoutsScreen navigation={mockNavigation} route={route} />,
    { wrapper: createQueryWrapper(createTestQueryClient()) },
  );
}

/** The first theme that constrains muscles, and the first that does not. */
const targeted = ON_DEMAND_WORKOUTS.find((theme) => theme.target_muscles);
const untargeted = ON_DEMAND_WORKOUTS.find((theme) => !theme.target_muscles);

describe('OnDemandWorkoutsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateRecommendation.mockResolvedValue({ id: 'rec-1' });
  });

  it('offers a row for every theme', () => {
    const screen = renderScreen();

    for (const theme of ON_DEMAND_WORKOUTS) {
      expect(screen.getByTestId(`on-demand-${theme.id}`)).toBeTruthy();
      expect(screen.getByText(theme.name)).toBeTruthy();
    }
  });

  it('generates from the theme it was given', async () => {
    expect(targeted).toBeDefined();
    const screen = renderScreen();

    fireEvent.press(screen.getByTestId(`on-demand-${targeted!.id}`));

    await waitFor(() => expect(mockGenerateRecommendation).toHaveBeenCalled());
    expect(mockGenerateRecommendation).toHaveBeenCalledWith({
      duration_minutes: targeted!.duration_minutes,
      target_muscles: [...targeted!.target_muscles!],
    });
  });

  // The wire carries canonical muscles, never a theme or split name — catalog
  // matching is `::jsonb ?|`, exact and case-sensitive, so anything else is a
  // filter that quietly matches nothing.
  it('puts only canonical muscle names on the wire', async () => {
    const screen = renderScreen();

    fireEvent.press(screen.getByTestId(`on-demand-${targeted!.id}`));

    await waitFor(() => expect(mockGenerateRecommendation).toHaveBeenCalled());
    const body = mockGenerateRecommendation.mock.calls[0][0] as {
      target_muscles: string[];
    };
    for (const muscle of body.target_muscles) {
      expect(MUSCLES).toContain(muscle);
    }
    expect(body.target_muscles).not.toContain(targeted!.id);
  });

  // `target_muscles` is `.min(1)`, so an unconstrained theme has to omit the
  // field rather than send an empty array — and omitting it is a different
  // request from naming every muscle: the first tracks recovery.
  it('omits target_muscles for a theme that names no muscles', async () => {
    expect(untargeted).toBeDefined();
    const screen = renderScreen();

    fireEvent.press(screen.getByTestId(`on-demand-${untargeted!.id}`));

    await waitFor(() => expect(mockGenerateRecommendation).toHaveBeenCalled());
    const body = mockGenerateRecommendation.mock.calls[0][0] as Record<string, unknown>;
    expect('target_muscles' in body).toBe(false);
    expect(body.duration_minutes).toBe(untargeted!.duration_minutes);
  });

  it('lands on the generated workout', async () => {
    const screen = renderScreen();

    fireEvent.press(screen.getByTestId(`on-demand-${targeted!.id}`));

    await waitFor(() => expect(mockNavigation.navigate).toHaveBeenCalledWith('UpNext'));
  });

  it('stays put when generation fails', async () => {
    mockGenerateRecommendation.mockRejectedValue(new Error('nope'));
    const screen = renderScreen();

    fireEvent.press(screen.getByTestId(`on-demand-${targeted!.id}`));

    await waitFor(() => expect(mockGenerateRecommendation).toHaveBeenCalled());
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId(`on-demand-${targeted!.id}`)).toBeTruthy();
  });

  it('ignores a second tap while a request is in flight', async () => {
    const screen = renderScreen();

    const row = screen.getByTestId(`on-demand-${targeted!.id}`);
    fireEvent.press(row);
    fireEvent.press(row);

    await waitFor(() => expect(mockGenerateRecommendation).toHaveBeenCalled());
    expect(mockGenerateRecommendation).toHaveBeenCalledTimes(1);
  });

  // Backing out mid-request is legitimate — the workout still lands in the
  // cache Up Next reads — but pushing a screen at someone who already left is
  // not.
  it('does not navigate after the screen has been left', async () => {
    let settle: ((value: unknown) => void) | undefined;
    mockGenerateRecommendation.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const screen = renderScreen();

    fireEvent.press(screen.getByTestId(`on-demand-${targeted!.id}`));
    screen.unmount();
    await act(async () => {
      settle?.({ id: 'rec-1' });
    });

    expect(mockGenerateRecommendation).toHaveBeenCalledTimes(1);
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });

  // The screen renders no stored recommendation, so reading one would be a
  // request for nothing.
  it('does not read the stored recommendation', () => {
    renderScreen();

    expect(mockFetchRecommendation).not.toHaveBeenCalled();
  });
});
