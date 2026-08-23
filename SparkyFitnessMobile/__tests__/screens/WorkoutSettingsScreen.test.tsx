import React from 'react';
import { Platform } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import WorkoutSettingsScreen from '../../src/screens/WorkoutSettingsScreen';
import {
  useAppPreferencesStore,
  __resetAppPreferencesStoreForTests,
} from '../../src/stores/appPreferencesStore';
import { createQueryWrapper, createTestQueryClient } from '../hooks/queryTestUtils';

// The gym-profiles row reads the active profile through the API client; stub
// the fetch layer rather than the hook so the row's real query path is covered.
const mockFetchGymProfiles = jest.fn();
jest.mock('../../src/services/api/gymProfilesApi', () => ({
  fetchGymProfiles: (...args: unknown[]) => mockFetchGymProfiles(...args),
  createGymProfile: jest.fn(),
  updateGymProfile: jest.fn(),
  deleteGymProfile: jest.fn(),
  activateGymProfile: jest.fn(),
}));

const mockPresent = jest.fn();
let sheetOnChange: ((seconds: number) => void) | null = null;

jest.mock('../../src/components/RestPeriodSheet', () => {
  const ReactModule = require('react');
  return {
    __esModule: true,
    default: ReactModule.forwardRef((props: { onChange: (seconds: number) => void }, ref: unknown) => {
      ReactModule.useImperativeHandle(ref, () => ({ present: mockPresent, dismiss: jest.fn() }));
      sheetOnChange = props.onChange;
      return null;
    }),
  };
});

jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  useActiveWorkoutBarPadding: () => 0,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockNavigation = { goBack: jest.fn(), setOptions: jest.fn(), navigate: jest.fn() } as any;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

const navigation = mockNavigation;
const route = { params: {} } as any;

function renderScreen() {
  return render(<WorkoutSettingsScreen navigation={navigation} route={route} />, {
    wrapper: createQueryWrapper(createTestQueryClient()),
  });
}

describe('WorkoutSettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sheetOnChange = null;
    mockFetchGymProfiles.mockResolvedValue([]);
    __resetAppPreferencesStoreForTests();
  });

  it('renders the "Workout Settings" header', () => {
    const { getByText, queryByText } = renderScreen();
    if (Platform.OS === 'ios') {
      // On iOS the title is provided by the native stack header (configured in
      // App.tsx via createStackScreenOptions), so the inline title is hidden.
      expect(queryByText('Workout Settings')).toBeNull();
    } else {
      expect(getByText('Workout Settings')).toBeTruthy();
    }
  });

  it('shows the default rest period row with the current value', () => {
    const { getByText } = renderScreen();
    expect(getByText('Default rest period')).toBeTruthy();
    expect(getByText('1:30')).toBeTruthy();
  });

  it('opens the rest period sheet at the current value when the dropdown is tapped', () => {
    useAppPreferencesStore.getState().setDefaultRestSec(120);
    const { getByText } = renderScreen();
    fireEvent.press(getByText('2:00'));
    expect(mockPresent).toHaveBeenCalledWith(120);
  });

  it('persists the value picked in the sheet and updates the row', () => {
    const { getByText } = renderScreen();
    act(() => {
      sheetOnChange!(150);
    });
    expect(useAppPreferencesStore.getState().defaultRestSec).toBe(150);
    expect(getByText('2:30')).toBeTruthy();
  });

  it('toggles the rest timer sound preference from the switch', () => {
    const { getAllByRole } = renderScreen();
    const [soundToggle] = getAllByRole('switch');
    expect(soundToggle.props.value).toBe(true);

    fireEvent(soundToggle, 'valueChange', false);
    expect(useAppPreferencesStore.getState().restTimerSoundEnabled).toBe(false);
  });

  it('toggles the keep screen awake preference from the switch', () => {
    const { getAllByRole } = renderScreen();
    const [, keepAwakeToggle] = getAllByRole('switch');
    expect(keepAwakeToggle.props.value).toBe(false);

    fireEvent(keepAwakeToggle, 'valueChange', true);
    expect(useAppPreferencesStore.getState().workoutKeepAwakeEnabled).toBe(true);
  });

  it('opens the gym profiles screen from the gym profiles row', () => {
    const { getByText } = renderScreen();
    fireEvent.press(getByText('Gym profiles'));
    expect(navigation.navigate).toHaveBeenCalledWith('GymProfiles');
  });

  it('names the active gym profile in the row subtitle', async () => {
    mockFetchGymProfiles.mockResolvedValue([
      {
        id: 'profile-1',
        user_id: 'user-1',
        name: 'Home',
        equipment: ['dumbbell', 'bands'],
        is_active: true,
        created_at: '2026-08-23T00:00:00.000Z',
        updated_at: '2026-08-23T00:00:00.000Z',
      },
    ]);
    const { findByText } = renderScreen();
    expect(await findByText('Active: Home')).toBeTruthy();
  });

  it('says every exercise is available when no profile is active', async () => {
    const { findByText } = renderScreen();
    expect(
      await findByText('No active profile — every exercise is available.'),
    ).toBeTruthy();
  });
});
