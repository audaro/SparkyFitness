import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ExerciseSheetScreen from '../../src/screens/ExerciseSheetScreen';
import {
  findHeaderMenuAction,
  pressHeaderMenuAction,
} from './helpers/nativeHeaderTestUtils';
import type { Exercise } from '../../src/types/exercise';

jest.mock('../../src/hooks/useExerciseImageSource', () => ({
  useExerciseImageSource: jest.fn(() => ({
    getImageSource: (path: string) => ({ uri: path, headers: {} }),
  })),
  useImagePairAspectMatch: jest.fn(() => undefined),
}));

// useScreenHeader reaches for useNavigation itself, so the hook and the
// screen have to see the same navigation object for header actions to be
// findable.
const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  setOptions: jest.fn(),
  isFocused: jest.fn(() => true),
} as any;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
  useIsFocused: () => true,
}));

const insets = { top: 0, bottom: 0, left: 0, right: 0 };
const frame = { x: 0, y: 0, width: 390, height: 844 };

const baseExercise: Exercise = {
  id: 'ex-1',
  name: 'Bench Press',
  category: 'strength',
  equipment: ['barbell', 'bench'],
  primary_muscles: ['chest'],
  secondary_muscles: ['triceps'],
  calories_per_hour: 360,
  source: 'sparky',
  images: [],
  tags: [],
  level: 'beginner',
};

function renderSheet(
  overrides: {
    exercise?: Partial<Exercise>;
    params?: Record<string, unknown>;
  } = {}
) {
  const navigation = mockNavigation;
  const exercise = { ...baseExercise, ...overrides.exercise };
  const route = {
    key: 'ExerciseSheet-1',
    name: 'ExerciseSheet' as const,
    params: {
      context: 'active-workout',
      item: exercise,
      entryId: 'entry-1',
      ...overrides.params,
    },
  } as any;
  const screen = render(
    <SafeAreaProvider initialMetrics={{ insets, frame }}>
      <ExerciseSheetScreen navigation={navigation} route={route} />
    </SafeAreaProvider>
  );
  return { ...screen, navigation, exercise };
}

describe('ExerciseSheetScreen', () => {
  beforeEach(() => {
    mockNavigation.navigate.mockClear();
    mockNavigation.goBack.mockClear();
    mockNavigation.setOptions.mockClear();
  });

  it('names the exercise and summarizes its taxonomy', () => {
    const { getByTestId } = renderSheet();

    expect(getByTestId('exercise-sheet-name').props.children).toBe(
      'Bench Press'
    );
    expect(getByTestId('exercise-sheet-taxonomy').props.children).toBe(
      'Barbell, Bench · Chest · Beginner'
    );
  });

  it('omits the taxonomy line entirely when the exercise carries none', () => {
    const { queryByTestId } = renderSheet({
      exercise: {
        equipment: [],
        primary_muscles: [],
        level: null,
      },
    });

    expect(queryByTestId('exercise-sheet-taxonomy')).toBeNull();
  });

  it('drops blank taxonomy values rather than emitting bare separators', () => {
    const { getByTestId } = renderSheet({
      exercise: { equipment: ['   ', 'barbell'], primary_muscles: [] },
    });

    expect(getByTestId('exercise-sheet-taxonomy').props.children).toBe(
      'Barbell · Beginner'
    );
  });

  it('keeps a route to the catalog page in the overflow menu', () => {
    const { navigation } = renderSheet();

    expect(findHeaderMenuAction(navigation, 'Exercise details')).toBeTruthy();
    pressHeaderMenuAction(navigation, 'Exercise details');

    expect(navigation.navigate).toHaveBeenCalledWith('ExerciseDetail', {
      item: expect.objectContaining({ id: 'ex-1' }),
      hideWorkoutActions: true,
    });
  });
});
