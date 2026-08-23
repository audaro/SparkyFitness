import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import GymProfilesScreen from '../../src/screens/GymProfilesScreen';
import { createQueryWrapper, createTestQueryClient } from '../hooks/queryTestUtils';

const mockFetchGymProfiles = jest.fn();
const mockCreateGymProfile = jest.fn();
const mockUpdateGymProfile = jest.fn();
const mockDeleteGymProfile = jest.fn();
const mockActivateGymProfile = jest.fn();

jest.mock('../../src/services/api/gymProfilesApi', () => ({
  fetchGymProfiles: (...args: unknown[]) => mockFetchGymProfiles(...args),
  createGymProfile: (...args: unknown[]) => mockCreateGymProfile(...args),
  updateGymProfile: (...args: unknown[]) => mockUpdateGymProfile(...args),
  deleteGymProfile: (...args: unknown[]) => mockDeleteGymProfile(...args),
  activateGymProfile: (...args: unknown[]) => mockActivateGymProfile(...args),
}));

// Force the custom (Android / Liquid-Glass-off) header path so the header's
// Save button is in the rendered tree instead of being mirrored into the
// native stack header.
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

const mockNavigation = { goBack: jest.fn(), setOptions: jest.fn(), navigate: jest.fn() } as any;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

const route = { params: {} } as any;

function makeProfile(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'profile-home',
    user_id: 'user-1',
    name: 'Home',
    equipment: ['dumbbell', 'bands'],
    is_active: false,
    created_at: '2026-08-23T00:00:00.000Z',
    updated_at: '2026-08-23T00:00:00.000Z',
    ...overrides,
  };
}

function renderScreen() {
  return render(<GymProfilesScreen navigation={mockNavigation} route={route} />, {
    wrapper: createQueryWrapper(createTestQueryClient()),
  });
}

describe('GymProfilesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchGymProfiles.mockResolvedValue([]);
  });

  it('lists profiles with their equipment, capitalized for display only', async () => {
    mockFetchGymProfiles.mockResolvedValue([
      makeProfile(),
      makeProfile({ id: 'profile-gym', name: 'Gym', equipment: ['barbell'], is_active: true }),
    ]);
    const { findByText, getByText } = renderScreen();

    expect(await findByText('Home')).toBeTruthy();
    expect(getByText('Dumbbell, Bands')).toBeTruthy();
    expect(getByText('Gym')).toBeTruthy();
    expect(getByText('Barbell')).toBeTruthy();
  });

  it('marks the active profile as the selected radio option', async () => {
    mockFetchGymProfiles.mockResolvedValue([
      makeProfile(),
      makeProfile({ id: 'profile-gym', name: 'Gym', is_active: true }),
    ]);
    const { findByTestId, getByTestId } = renderScreen();

    expect((await findByTestId('gym-profile-row-profile-gym')).props.accessibilityState.selected).toBe(
      true,
    );
    expect(getByTestId('gym-profile-row-profile-home').props.accessibilityState.selected).toBe(
      false,
    );
  });

  it('activates a profile when its row is tapped', async () => {
    mockFetchGymProfiles.mockResolvedValue([makeProfile()]);
    mockActivateGymProfile.mockResolvedValue(makeProfile({ is_active: true }));
    const { findByTestId } = renderScreen();

    fireEvent.press(await findByTestId('gym-profile-row-profile-home'));

    await waitFor(() => expect(mockActivateGymProfile).toHaveBeenCalledWith('profile-home'));
  });

  it('does not re-activate the profile that is already active', async () => {
    mockFetchGymProfiles.mockResolvedValue([makeProfile({ is_active: true })]);
    const { findByTestId } = renderScreen();

    fireEvent.press(await findByTestId('gym-profile-row-profile-home'));

    expect(mockActivateGymProfile).not.toHaveBeenCalled();
  });

  it('creates a profile with canonical lowercase equipment values', async () => {
    mockCreateGymProfile.mockResolvedValue(makeProfile({ id: 'profile-new', name: 'Garage' }));
    const { findByTestId, getByTestId, getByLabelText } = renderScreen();

    // No profiles yet, so the empty state owns the create action.
    fireEvent.press(await findByTestId('gym-profile-empty-create'));
    fireEvent.changeText(getByTestId('gym-profile-name-input'), '  Garage  ');
    fireEvent.press(getByTestId('gym-profile-equipment-dumbbell'));
    fireEvent.press(getByTestId('gym-profile-equipment-bands'));
    fireEvent.press(getByLabelText('Save'));

    await waitFor(() =>
      expect(mockCreateGymProfile).toHaveBeenCalledWith({
        name: 'Garage',
        equipment: ['dumbbell', 'bands'],
        // The first profile defaults to active — an inactive first profile
        // would constrain nothing.
        is_active: true,
      }),
    );
  });

  it('deselects an equipment chip that is tapped twice', async () => {
    const { findByTestId, getByTestId, getByLabelText } = renderScreen();

    fireEvent.press(await findByTestId('gym-profile-empty-create'));
    fireEvent.changeText(getByTestId('gym-profile-name-input'), 'Garage');
    fireEvent.press(getByTestId('gym-profile-equipment-dumbbell'));
    fireEvent.press(getByTestId('gym-profile-equipment-dumbbell'));
    fireEvent.press(getByLabelText('Save'));

    await waitFor(() =>
      expect(mockCreateGymProfile).toHaveBeenCalledWith(
        expect.objectContaining({ equipment: [] }),
      ),
    );
  });

  it('saves an edited profile without an is_active field', async () => {
    mockFetchGymProfiles.mockResolvedValue([makeProfile({ is_active: true })]);
    mockUpdateGymProfile.mockResolvedValue(makeProfile({ name: 'Home Gym', is_active: true }));
    const { findByTestId, getByTestId, getByLabelText } = renderScreen();

    fireEvent.press(await findByTestId('gym-profile-edit-profile-home'));
    fireEvent.changeText(getByTestId('gym-profile-name-input'), 'Home Gym');
    fireEvent.press(getByLabelText('Save'));

    // `is_active` is not part of the PUT contract: activation is its own
    // transactional endpoint.
    await waitFor(() =>
      expect(mockUpdateGymProfile).toHaveBeenCalledWith('profile-home', {
        name: 'Home Gym',
        equipment: ['dumbbell', 'bands'],
      }),
    );
    expect(mockActivateGymProfile).not.toHaveBeenCalled();
  });

  it('activates an edited profile that was switched on in the editor', async () => {
    mockFetchGymProfiles.mockResolvedValue([makeProfile()]);
    mockUpdateGymProfile.mockResolvedValue(makeProfile());
    mockActivateGymProfile.mockResolvedValue(makeProfile({ is_active: true }));
    const { findByTestId, getByLabelText } = renderScreen();

    fireEvent.press(await findByTestId('gym-profile-edit-profile-home'));
    fireEvent(getByLabelText('Use this profile'), 'valueChange', true);
    fireEvent.press(getByLabelText('Save'));

    await waitFor(() => expect(mockActivateGymProfile).toHaveBeenCalledWith('profile-home'));
  });

  it('keeps the editor open when the save fails', async () => {
    mockCreateGymProfile.mockRejectedValue(new Error('409 Conflict'));
    const { findByTestId, getByTestId, getByLabelText } = renderScreen();

    fireEvent.press(await findByTestId('gym-profile-empty-create'));
    fireEvent.changeText(getByTestId('gym-profile-name-input'), 'Home');
    fireEvent.press(getByLabelText('Save'));

    await waitFor(() => expect(mockCreateGymProfile).toHaveBeenCalled());
    expect(getByTestId('gym-profile-editor')).toBeTruthy();
  });
});
