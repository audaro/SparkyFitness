import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { freshnessPercent, freshnessTone, MUSCLES } from '@workspace/shared';

import PickMusclesScreen from '../../src/screens/PickMusclesScreen';
import { useMuscleRecovery } from '../../src/hooks/useMuscleRecovery';
import { BODY_PATHS } from '../../src/constants/muscleArt.generated';
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

jest.mock('../../src/hooks/useMuscleRecovery', () => ({
  useMuscleRecovery: jest.fn(),
}));

// Force the custom (Android / Liquid-Glass-off) header path so Cancel and Save
// are in the rendered tree instead of being mirrored into the native header.
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

const mockRemoveListener = jest.fn();
const mockAddListener = jest.fn(() => mockRemoveListener);

const mockNavigation = {
  goBack: jest.fn(),
  setOptions: jest.fn(),
  navigate: jest.fn(),
  addListener: mockAddListener,
};

/** The `beforeRemove` handler the screen registered, if it registered one. */
function beforeRemoveListener(): ((event: { preventDefault: () => void }) => void) | null {
  const call = mockAddListener.mock.calls.find(
    ([event]: unknown[]) => event === 'beforeRemove',
  ) as [string, (event: { preventDefault: () => void }) => void] | undefined;
  return call ? call[1] : null;
}

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
  // The screen renders outside a NavigationContainer here, and the query hooks
  // under it refresh on focus. Run the effect once, as a mounted focused screen
  // would; ExerciseHomeScreen's suite stubs it the same way.
  useFocusEffect: (callback: () => void) => {
    callback();
  },
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

function setRecovery(muscles: ReturnType<typeof item>[]) {
  mockUseMuscleRecovery.mockReturnValue({
    recovery: null,
    muscles,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  } as never);
}

function renderScreen() {
  const route = { key: 'PickMuscles-1', name: 'PickMuscles', params: undefined } as never;
  return render(<PickMusclesScreen navigation={mockNavigation as never} route={route} />, {
    wrapper: createQueryWrapper(createTestQueryClient()),
  });
}

/** Every muscle fully fresh, so the screen always has a complete vector. */
function fullyRecovered() {
  return MUSCLES.map((muscle) => item(muscle, 1));
}

describe('PickMusclesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setRecovery(fullyRecovered());
    mockGenerateRecommendation.mockResolvedValue({ id: 'rec-1' });
  });

  describe('splits', () => {
    it('resolves a split to canonical muscles client-side', async () => {
      const screen = renderScreen();

      fireEvent.press(screen.getByTestId('pick-muscles-split-push'));

      await waitFor(() => expect(mockGenerateRecommendation).toHaveBeenCalled());
      expect(mockGenerateRecommendation).toHaveBeenCalledWith({
        target_muscles: ['chest', 'shoulders', 'triceps'],
      });
    });

    it('never puts a split name on the wire', async () => {
      const screen = renderScreen();

      fireEvent.press(screen.getByTestId('pick-muscles-split-upper-body'));

      await waitFor(() => expect(mockGenerateRecommendation).toHaveBeenCalled());
      const body = mockGenerateRecommendation.mock.calls[0][0] as {
        target_muscles: string[];
      };
      expect(body.target_muscles).not.toContain('upper body');
      // Upper body is everything that is not lower body: 11 of the 17.
      expect(body.target_muscles).toHaveLength(11);
      for (const muscle of body.target_muscles) {
        expect(MUSCLES).toContain(muscle);
      }
    });

    it('sends every canonical muscle for a full-body split', async () => {
      const screen = renderScreen();

      fireEvent.press(screen.getByTestId('pick-muscles-split-full-body'));

      await waitFor(() => expect(mockGenerateRecommendation).toHaveBeenCalled());
      expect(mockGenerateRecommendation).toHaveBeenCalledWith({
        target_muscles: [...MUSCLES],
      });
    });

    // `target_muscles` is `.min(1)`, so an empty array is a 400 — and omitting
    // the field is a different request from naming every muscle: the first
    // tracks recovery, the second overrides it.
    it('omits target_muscles entirely for "Recovered muscles"', async () => {
      const screen = renderScreen();

      fireEvent.press(screen.getByTestId('pick-muscles-recovered'));

      await waitFor(() => expect(mockGenerateRecommendation).toHaveBeenCalled());
      expect(mockGenerateRecommendation).toHaveBeenCalledWith({});
      const body = mockGenerateRecommendation.mock.calls[0][0] as Record<string, unknown>;
      expect('target_muscles' in body).toBe(false);
    });

    it('lands on the generated workout', async () => {
      const screen = renderScreen();

      fireEvent.press(screen.getByTestId('pick-muscles-split-pull'));

      await waitFor(() => expect(mockNavigation.navigate).toHaveBeenCalledWith('UpNext'));
    });

    it('stays put when generation fails', async () => {
      mockGenerateRecommendation.mockRejectedValue(new Error('nope'));
      const screen = renderScreen();

      fireEvent.press(screen.getByTestId('pick-muscles-split-pull'));

      await waitFor(() => expect(mockGenerateRecommendation).toHaveBeenCalled());
      expect(mockNavigation.navigate).not.toHaveBeenCalled();
      expect(screen.getByTestId('pick-muscles-splits')).toBeTruthy();
    });

    it('leaves the back button alone so it pops the picker', () => {
      renderScreen();

      expect(beforeRemoveListener()).toBeNull();
    });

    // Backing out mid-request is legitimate; pushing a workout screen at
    // someone who already left is not.
    it('does not navigate after the picker has been left', async () => {
      let settle: ((value: unknown) => void) | undefined;
      mockGenerateRecommendation.mockReturnValue(
        new Promise((resolve) => {
          settle = resolve;
        }),
      );
      const screen = renderScreen();

      fireEvent.press(screen.getByTestId('pick-muscles-split-push'));
      screen.unmount();
      await act(async () => {
        settle?.({ id: 'rec-1' });
      });

      expect(mockGenerateRecommendation).toHaveBeenCalledTimes(1);
      expect(mockNavigation.navigate).not.toHaveBeenCalled();
    });

    it('ignores a second tap while a request is in flight', async () => {
      const screen = renderScreen();

      const row = screen.getByTestId('pick-muscles-split-push');
      fireEvent.press(row);
      fireEvent.press(row);

      await waitFor(() => expect(mockGenerateRecommendation).toHaveBeenCalled());
      expect(mockGenerateRecommendation).toHaveBeenCalledTimes(1);
    });
  });

  describe('grid', () => {
    function openGrid(screen: ReturnType<typeof renderScreen>) {
      fireEvent.press(screen.getByTestId('pick-muscles-open-grid'));
      return screen;
    }

    /** Flip the figure. Selection is shared across both views. */
    function showBack(screen: ReturnType<typeof renderScreen>) {
      fireEvent.press(screen.getByText('Back'));
      return screen;
    }

    /** Which view each muscle is drawn on, straight from the generated art. */
    const drawnOn = (view: 'front' | 'back') =>
      new Set(
        BODY_PATHS.flatMap((path) =>
          path.kind === 'muscle' && path.view === view ? [path.muscle] : [],
        ),
      );

    // Every canonical muscle is on the figure now — five of them only because
    // the art relabels two upstream regions and hand-draws three more. A muscle
    // on neither view could not be targeted at all.
    it('offers every one of the 17 canonical muscles on one view or the other', () => {
      const screen = openGrid(renderScreen());

      const front = drawnOn('front');
      for (const muscle of front) {
        expect(screen.getByTestId(`pick-muscles-body-${muscle}`)).toBeTruthy();
      }

      showBack(screen);
      const back = drawnOn('back');
      for (const muscle of back) {
        expect(screen.getByTestId(`pick-muscles-body-${muscle}`)).toBeTruthy();
      }

      expect([...new Set([...front, ...back])].sort()).toEqual([...MUSCLES].sort());
    });

    it('sends canonical muscle names for the picked tiles', async () => {
      const screen = openGrid(renderScreen());

      // One from each view, and one of them a tile covering two muscles: the
      // lats are drawn on the back, and picking them picks the whole Back tile.
      fireEvent.press(screen.getByTestId('pick-muscles-body-quadriceps'));
      showBack(screen);
      fireEvent.press(screen.getByTestId('pick-muscles-body-lats'));
      fireEvent.press(screen.getByText('Build workout'));

      await waitFor(() => expect(mockGenerateRecommendation).toHaveBeenCalled());
      expect(mockGenerateRecommendation).toHaveBeenCalledWith({
        target_muscles: ['lats', 'middle back', 'quadriceps'],
      });
    });

    // The two figures are one picker, not two: flipping the view must not lose
    // what was already chosen on the other side.
    it('keeps a pick made on one view when the other is shown', () => {
      const screen = openGrid(renderScreen());

      fireEvent.press(screen.getByTestId('pick-muscles-body-chest'));
      showBack(screen);

      expect(screen.getByTestId('pick-muscles-selected-chest')).toBeTruthy();
      expect(screen.queryByTestId('pick-muscles-body-chest')).toBeNull();
    });

    it('drops a tile that is tapped twice', async () => {
      const screen = openGrid(renderScreen());

      fireEvent.press(screen.getByTestId('pick-muscles-body-chest'));
      fireEvent.press(screen.getByTestId('pick-muscles-body-biceps'));
      fireEvent.press(screen.getByTestId('pick-muscles-body-chest'));
      fireEvent.press(screen.getByText('Build workout'));

      await waitFor(() => expect(mockGenerateRecommendation).toHaveBeenCalled());
      expect(mockGenerateRecommendation).toHaveBeenCalledWith({
        target_muscles: ['biceps'],
      });
    });

    it('does not generate with nothing picked', () => {
      const screen = openGrid(renderScreen());

      fireEvent.press(screen.getByText('Build workout'));

      expect(mockGenerateRecommendation).not.toHaveBeenCalled();
    });

    // The percentage is already 0-100 from useMuscleRecovery's select.
    it('shows each tile the recovery percentage the hook derived', () => {
      setRecovery([...fullyRecovered(), item('quadriceps', 0.12)]);
      const screen = openGrid(renderScreen());

      expect(screen.getByLabelText('Quadriceps, 12% recovered')).toBeTruthy();
    });

    // Training back trains both muscles the tile stands for, so the readout
    // must not claim the fresher one's number.
    it('shows the more fatigued muscle on a tile that covers two', () => {
      setRecovery([
        ...MUSCLES.filter((muscle) => muscle !== 'lats' && muscle !== 'middle back').map(
          (muscle) => item(muscle, 1),
        ),
        item('lats', 1),
        item('middle back', 0.2),
      ]);
      const screen = showBack(openGrid(renderScreen()));

      fireEvent.press(screen.getByTestId('pick-muscles-body-lats'));

      expect(screen.getByText('Back · 20% recovered')).toBeTruthy();
    });

    describe('the readout', () => {
      it('says what to do when nothing is picked', () => {
        const screen = openGrid(renderScreen());

        expect(screen.getByTestId('pick-muscles-none')).toBeTruthy();
        expect(screen.getByText('Selected (0)')).toBeTruthy();
      });

      // Fill carries selection now, so this is where the exact percentage lives.
      it('names each pick with the recovery the hook derived', () => {
        setRecovery([...fullyRecovered(), item('chest', 0.37)]);
        const screen = openGrid(renderScreen());

        fireEvent.press(screen.getByTestId('pick-muscles-body-chest'));

        expect(screen.getByText('Selected (1)')).toBeTruthy();
        expect(screen.getByText('Chest · 37% recovered')).toBeTruthy();
      });

      // The other half of why it exists: undoing a mistap without having to hit
      // the same small shape on the body again.
      it('drops a pick when its row is tapped', async () => {
        const screen = openGrid(renderScreen());

        fireEvent.press(screen.getByTestId('pick-muscles-body-chest'));
        fireEvent.press(screen.getByTestId('pick-muscles-body-biceps'));
        fireEvent.press(screen.getByTestId('pick-muscles-selected-chest'));

        expect(screen.queryByTestId('pick-muscles-selected-chest')).toBeNull();

        fireEvent.press(screen.getByText('Build workout'));
        await waitFor(() => expect(mockGenerateRecommendation).toHaveBeenCalled());
        expect(mockGenerateRecommendation).toHaveBeenCalledWith({ target_muscles: ['biceps'] });
      });
    });

    it('renders the figure before recovery has arrived', () => {
      setRecovery([]);
      const screen = openGrid(renderScreen());

      // Choosing what to train does not depend on knowing how fresh it is, so
      // the region is there and pickable with no percentage to announce.
      expect(screen.getByTestId('pick-muscles-body-chest')).toBeTruthy();
      expect(screen.getByLabelText('Chest')).toBeTruthy();
    });

    it('announces a picked region as selected', () => {
      // The only way selection reaches a screen reader: react-native-svg passes
      // no accessibility state through to a path, so it has to be in the label.
      const screen = openGrid(renderScreen());

      fireEvent.press(screen.getByTestId('pick-muscles-body-chest'));

      expect(screen.getByLabelText('Chest, selected, 100% recovered')).toBeTruthy();
    });

    it('a muscle drawn in pieces is one control, not eight', () => {
      // The illustration draws the quads as eight paths. Every one is pressable
      // so any part of the region works, but only one announces itself — else a
      // screen reader reads the same checkbox eight times.
      const screen = openGrid(renderScreen());

      expect(screen.getAllByTestId('pick-muscles-body-quadriceps')).toHaveLength(1);
      expect(screen.getAllByLabelText(/^Quadriceps/)).toHaveLength(1);
    });

    it('returns to the split list on Cancel without generating', () => {
      const screen = openGrid(renderScreen());

      fireEvent.press(screen.getByLabelText('Cancel'));

      expect(screen.getByTestId('pick-muscles-splits')).toBeTruthy();
      expect(mockGenerateRecommendation).not.toHaveBeenCalled();
    });

    // Android's hardware back does not go through the header, so it has to be
    // intercepted or it pops the picker out from under a half-made selection.
    it('does what Cancel does when the screen is backed out of', () => {
      const screen = openGrid(renderScreen());
      const event = { preventDefault: jest.fn() };

      const listener = beforeRemoveListener();
      expect(listener).not.toBeNull();
      act(() => listener?.(event));

      expect(event.preventDefault).toHaveBeenCalled();
      expect(screen.getByTestId('pick-muscles-splits')).toBeTruthy();
      expect(mockGenerateRecommendation).not.toHaveBeenCalled();
    });

    // ...but that guard must not block the pop back to Up Next that a
    // successful Save performs.
    it('lets the screen go once a pick has generated', async () => {
      const screen = openGrid(renderScreen());

      fireEvent.press(screen.getByTestId('pick-muscles-body-chest'));
      fireEvent.press(screen.getByText('Build workout'));
      await waitFor(() => expect(mockNavigation.navigate).toHaveBeenCalledWith('UpNext'));

      const event = { preventDefault: jest.fn() };
      act(() => beforeRemoveListener()?.(event));

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(screen.queryByTestId('pick-muscles-splits')).toBeNull();
    });
  });
});
