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

let mockWeightUnit = 'kg';
jest.mock('../../src/hooks/usePreferences', () => ({
  usePreferences: () => ({
    preferences: { default_weight_unit: mockWeightUnit },
    isLoading: false,
  }),
}));

const route = { params: {} } as any;

function makeProfile(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'profile-home',
    user_id: 'user-1',
    name: 'Home',
    equipment: ['dumbbell', 'bands'],
    apparatus: null,
    equipment_items: null,
    load_limits: null,
    equipment_preference: null,
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
    mockWeightUnit = 'kg';
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

  it('creates a profile with stated equipment items', async () => {
    mockCreateGymProfile.mockResolvedValue(makeProfile({ id: 'profile-new', name: 'Garage' }));
    const { findByTestId, getByTestId, getByLabelText } = renderScreen();

    // No profiles yet, so the empty state owns the create action. New
    // profiles open in detailed (item-stated) mode.
    fireEvent.press(await findByTestId('gym-profile-empty-create'));
    fireEvent.changeText(getByTestId('gym-profile-name-input'), '  Garage  ');
    fireEvent.press(getByTestId('gym-profile-item-dumbbells'));
    fireEvent.press(getByTestId('gym-profile-item-loop-bands'));
    fireEvent.press(getByLabelText('Save'));

    await waitFor(() =>
      expect(mockCreateGymProfile).toHaveBeenCalledWith({
        name: 'Garage',
        equipment_items: ['dumbbells', 'loop-bands'],
        // The first profile defaults to active — an inactive first profile
        // would constrain nothing.
        is_active: true,
      }),
    );
  });

  it('deselects an item chip that is tapped twice', async () => {
    const { findByTestId, getByTestId, getByLabelText } = renderScreen();

    fireEvent.press(await findByTestId('gym-profile-empty-create'));
    fireEvent.changeText(getByTestId('gym-profile-name-input'), 'Garage');
    fireEvent.press(getByTestId('gym-profile-item-dumbbells'));
    fireEvent.press(getByTestId('gym-profile-item-dumbbells'));
    fireEvent.press(getByLabelText('Save'));

    await waitFor(() =>
      expect(mockCreateGymProfile).toHaveBeenCalledWith(
        expect.objectContaining({ equipment_items: [] }),
      ),
    );
  });

  it('prefills the selection from a template, replacing rather than merging', async () => {
    mockCreateGymProfile.mockResolvedValue(makeProfile({ id: 'profile-pf', name: 'PF' }));
    const { findByTestId, getByTestId, getByLabelText } = renderScreen();

    fireEvent.press(await findByTestId('gym-profile-empty-create'));
    fireEvent.changeText(getByTestId('gym-profile-name-input'), 'PF');
    // A pick made before the template must not survive it: a template answers
    // "what kind of gym is this", not "what else does it have".
    fireEvent.press(getByTestId('gym-profile-item-barbell'));
    fireEvent.press(getByTestId('gym-profile-template-planet-fitness'));

    expect(
      getByTestId('gym-profile-item-smith-machine').props.accessibilityState.checked,
    ).toBe(true);
    expect(getByTestId('gym-profile-item-barbell').props.accessibilityState.checked).toBe(false);

    // The prefill stays editable.
    fireEvent.press(getByTestId('gym-profile-item-smith-machine'));
    fireEvent.press(getByLabelText('Save'));

    await waitFor(() => expect(mockCreateGymProfile).toHaveBeenCalled());
    const payload = mockCreateGymProfile.mock.calls[0][0];
    expect(payload.equipment_items).toContain('fixed-barbells');
    expect(payload.equipment_items).not.toContain('barbell');
    expect(payload.equipment_items).not.toContain('smith-machine');
  });

  it('upgrades a legacy profile to items without sending coarse fields', async () => {
    mockFetchGymProfiles.mockResolvedValue([makeProfile()]);
    mockUpdateGymProfile.mockResolvedValue(makeProfile());
    const { findByTestId, getByTestId, getByLabelText } = renderScreen();

    fireEvent.press(await findByTestId('gym-profile-edit-profile-home'));
    fireEvent.press(getByTestId('gym-profile-upgrade'));
    fireEvent.press(getByLabelText('Save'));

    await waitFor(() => expect(mockUpdateGymProfile).toHaveBeenCalled());
    const [id, payload] = mockUpdateGymProfile.mock.calls[0];
    expect(id).toBe('profile-home');
    // The expansion of coarse "dumbbell" states the dumbbells item; the
    // server re-derives the coarse columns, so neither may ride along.
    expect(payload.equipment_items).toContain('dumbbells');
    expect('equipment' in payload).toBe(false);
    expect('apparatus' in payload).toBe(false);
  });

  it('summarizes an item-stated profile as a count and edits it in detailed mode', async () => {
    mockFetchGymProfiles.mockResolvedValue([
      makeProfile({
        equipment: ['machine', 'cable'],
        equipment_items: ['smith-machine', 'cable-tower', 'treadmill'],
      }),
    ]);
    mockUpdateGymProfile.mockResolvedValue(makeProfile());
    const { findByText, findByTestId, getByTestId, getByLabelText, queryByTestId } =
      renderScreen();

    expect(await findByText('3 equipment items')).toBeTruthy();

    fireEvent.press(await findByTestId('gym-profile-edit-profile-home'));
    expect(
      getByTestId('gym-profile-item-smith-machine').props.accessibilityState.checked,
    ).toBe(true);
    // Detailed mode has no coarse chips and no apparatus section.
    expect(queryByTestId('gym-profile-equipment-dumbbell')).toBeNull();
    expect(queryByTestId('gym-profile-apparatus-specify')).toBeNull();
    fireEvent.press(getByTestId('gym-profile-item-cable-tower'));
    fireEvent.press(getByLabelText('Save'));

    await waitFor(() =>
      expect(mockUpdateGymProfile).toHaveBeenCalledWith('profile-home', {
        name: 'Home',
        equipment_items: ['smith-machine', 'treadmill'],
        equipment_preference: null,
        load_limits: null,
      }),
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
        apparatus: null,
        equipment_preference: null,
        load_limits: null,
      }),
    );
    expect(mockActivateGymProfile).not.toHaveBeenCalled();
  });

  it('creates a profile with stated items and a dumbbell ceiling', async () => {
    mockCreateGymProfile.mockResolvedValue(makeProfile({ id: 'profile-pf', name: 'Planet Fitness' }));
    const { findByTestId, getByTestId, getByLabelText } = renderScreen();

    fireEvent.press(await findByTestId('gym-profile-empty-create'));
    fireEvent.changeText(getByTestId('gym-profile-name-input'), 'Planet Fitness');
    fireEvent.press(getByTestId('gym-profile-item-flat-bench'));
    fireEvent.changeText(getByTestId('gym-profile-dumbbell-max-input'), '22.5');
    fireEvent.press(getByLabelText('Save'));

    await waitFor(() =>
      expect(mockCreateGymProfile).toHaveBeenCalledWith({
        name: 'Planet Fitness',
        equipment_items: ['flat-bench'],
        load_limits: { dumbbell: { max_kg: 22.5 } },
        is_active: true,
      }),
    );
  });

  it('converts the dumbbell ceiling from the display unit to kg', async () => {
    mockWeightUnit = 'lbs';
    mockCreateGymProfile.mockResolvedValue(makeProfile({ id: 'profile-hotel', name: 'Hotel' }));
    const { findByTestId, getByTestId, getByLabelText } = renderScreen();

    fireEvent.press(await findByTestId('gym-profile-empty-create'));
    fireEvent.changeText(getByTestId('gym-profile-name-input'), 'Hotel');
    fireEvent.changeText(getByTestId('gym-profile-dumbbell-max-input'), '50');
    fireEvent.press(getByLabelText('Save'));

    await waitFor(() =>
      expect(mockCreateGymProfile).toHaveBeenCalledWith(
        expect.objectContaining({ load_limits: { dumbbell: { max_kg: 22.68 } } }),
      ),
    );
  });

  it('round-trips an untouched dumbbell ceiling without unit drift', async () => {
    // 22.5 kg displays as 49.6 lbs; saving without touching the field must
    // store 22.5 again, not the double-converted 22.4982.
    mockWeightUnit = 'lbs';
    mockFetchGymProfiles.mockResolvedValue([
      makeProfile({ load_limits: { dumbbell: { max_kg: 22.5 } } }),
    ]);
    mockUpdateGymProfile.mockResolvedValue(makeProfile());
    const { findByTestId, getByTestId, getByLabelText } = renderScreen();

    fireEvent.press(await findByTestId('gym-profile-edit-profile-home'));
    expect(getByTestId('gym-profile-dumbbell-max-input').props.value).toBe('49.6');
    fireEvent.press(getByLabelText('Save'));

    await waitFor(() =>
      expect(mockUpdateGymProfile).toHaveBeenCalledWith(
        'profile-home',
        expect.objectContaining({ load_limits: { dumbbell: { max_kg: 22.5 } } }),
      ),
    );
  });

  it('clearing the dumbbell ceiling keeps the profile’s other load limits', async () => {
    mockFetchGymProfiles.mockResolvedValue([
      makeProfile({
        apparatus: ['bench'],
        load_limits: {
          barbell: { max_kg: 60 },
          dumbbell: { max_kg: 20, increment_kg: 2 },
        },
      }),
    ]);
    mockUpdateGymProfile.mockResolvedValue(makeProfile());
    const { findByTestId, getByTestId, getByLabelText } = renderScreen();

    fireEvent.press(await findByTestId('gym-profile-edit-profile-home'));
    // Stated apparatus opens the chip group pre-selected.
    expect(
      getByTestId('gym-profile-apparatus-bench').props.accessibilityState.checked,
    ).toBe(true);
    fireEvent.changeText(getByTestId('gym-profile-dumbbell-max-input'), '');
    fireEvent.press(getByLabelText('Save'));

    await waitFor(() =>
      expect(mockUpdateGymProfile).toHaveBeenCalledWith('profile-home', {
        name: 'Home',
        equipment: ['dumbbell', 'bands'],
        apparatus: ['bench'],
        equipment_preference: null,
        load_limits: { barbell: { max_kg: 60 } },
      }),
    );
  });

  it('states an equipment preference and reopens on the stated one', async () => {
    mockFetchGymProfiles.mockResolvedValue([makeProfile()]);
    mockUpdateGymProfile.mockResolvedValue(
      makeProfile({ equipment_preference: 'machines' }),
    );
    const { findByTestId, getByText, getByLabelText } = renderScreen();

    fireEvent.press(await findByTestId('gym-profile-edit-profile-home'));
    // Unstated opens on "No preference" — the absence of a statement, not a
    // third kind of gym.
    expect(getByText('No preference').props.className).toContain(
      'text-text-primary',
    );
    fireEvent.press(getByText('Machines'));
    fireEvent.press(getByLabelText('Save'));

    await waitFor(() =>
      expect(mockUpdateGymProfile).toHaveBeenCalledWith(
        'profile-home',
        expect.objectContaining({ equipment_preference: 'machines' }),
      ),
    );
  });

  it('clears a stated preference back to unstated', async () => {
    mockFetchGymProfiles.mockResolvedValue([
      makeProfile({ equipment_preference: 'machines' }),
    ]);
    mockUpdateGymProfile.mockResolvedValue(makeProfile());
    const { findByTestId, getByText, getByLabelText } = renderScreen();

    fireEvent.press(await findByTestId('gym-profile-edit-profile-home'));
    fireEvent.press(getByText('No preference'));
    fireEvent.press(getByLabelText('Save'));

    // The sentinel never reaches the wire: "no preference" travels as null,
    // which is what clears the column back to unstated.
    await waitFor(() =>
      expect(mockUpdateGymProfile).toHaveBeenCalledWith(
        'profile-home',
        expect.objectContaining({ equipment_preference: null }),
      ),
    );
  });

  it('clears stated apparatus back to unspecified as null', async () => {
    mockFetchGymProfiles.mockResolvedValue([makeProfile({ apparatus: [] })]);
    mockUpdateGymProfile.mockResolvedValue(makeProfile());
    const { findByTestId, getByTestId, getByLabelText } = renderScreen();

    fireEvent.press(await findByTestId('gym-profile-edit-profile-home'));
    fireEvent.press(getByTestId('gym-profile-apparatus-clear'));
    fireEvent.press(getByLabelText('Save'));

    await waitFor(() =>
      expect(mockUpdateGymProfile).toHaveBeenCalledWith(
        'profile-home',
        expect.objectContaining({ apparatus: null }),
      ),
    );
  });

  it('blocks saving while the dumbbell ceiling is not a positive weight', async () => {
    const { findByTestId, getByTestId, getByText } = renderScreen();

    fireEvent.press(await findByTestId('gym-profile-empty-create'));
    fireEvent.changeText(getByTestId('gym-profile-name-input'), 'Garage');
    fireEvent.changeText(getByTestId('gym-profile-dumbbell-max-input'), '0');

    expect(getByText('Enter a weight above zero, or leave it empty.')).toBeTruthy();
    expect(mockCreateGymProfile).not.toHaveBeenCalled();
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
