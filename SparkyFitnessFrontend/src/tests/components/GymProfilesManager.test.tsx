import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import GymProfilesManager from '@/pages/Exercises/GymProfilesManager';
import type { GymProfile } from '@/hooks/Exercises/useGymProfiles';

const mockCreateProfile = jest.fn();
const mockUpdateProfile = jest.fn();
const mockDeleteProfile = jest.fn();
const mockActivateProfile = jest.fn();

let mockProfiles: GymProfile[] = [];
let mockIsActingOnBehalf = false;
let mockQueryState = { isLoading: false, isError: false, hasData: true };
let mockWeightUnit = 'kg';

const KG_PER_LB = 0.45359237;

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    weightUnit: mockWeightUnit,
    convertWeight: (value: number, from: string, to: string) => {
      if (from === to) return value;
      if (from === 'kg' && to === 'lbs') return value / KG_PER_LB;
      if (from === 'lbs' && to === 'kg') return value * KG_PER_LB;
      return value;
    },
  }),
}));

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
  useActiveUser: () => ({ isActingOnBehalf: mockIsActingOnBehalf }),
}));

jest.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

jest.mock('@/hooks/Exercises/useGymProfiles', () => ({
  useGymProfiles: () => ({
    profiles: mockProfiles,
    activeProfile: mockProfiles.find((profile) => profile.is_active) ?? null,
    data: mockQueryState.hasData ? mockProfiles : undefined,
    isLoading: mockQueryState.isLoading,
    isError: mockQueryState.isError,
  }),
  useCreateGymProfileMutation: () => ({
    mutateAsync: mockCreateProfile,
    isPending: false,
  }),
  useUpdateGymProfileMutation: () => ({
    mutateAsync: mockUpdateProfile,
    isPending: false,
  }),
  useDeleteGymProfileMutation: () => ({
    mutateAsync: mockDeleteProfile,
    isPending: false,
  }),
  useActivateGymProfileMutation: () => ({
    mutateAsync: mockActivateProfile,
    isPending: false,
  }),
}));

function makeProfile(overrides: Partial<GymProfile> = {}): GymProfile {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: 'user-1',
    name: 'Home',
    equipment: ['dumbbell', 'bands'],
    apparatus: null,
    equipment_items: null,
    equipment_preference: null,
    load_limits: null,
    is_active: true,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('GymProfilesManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfiles = [];
    mockIsActingOnBehalf = false;
    mockQueryState = { isLoading: false, isError: false, hasData: true };
    mockWeightUnit = 'kg';
  });

  it('renders nothing while acting on behalf of another user', () => {
    // gym_equipment_profiles is owner-only at the RLS layer, so a delegate
    // would get an empty list and a rejected write.
    mockIsActingOnBehalf = true;
    mockProfiles = [makeProfile()];

    const { container } = render(<GymProfilesManager />);

    expect(container).toBeEmptyDOMElement();
  });

  it('capitalizes equipment for display without changing the stored value', () => {
    mockProfiles = [makeProfile({ equipment: ['body only', 'e-z curl bar'] })];

    render(<GymProfilesManager />);

    expect(screen.getByText('Body Only, E-Z Curl Bar')).toBeInTheDocument();
  });

  it('activates a profile that is not already active', async () => {
    const inactive = makeProfile({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Commercial Gym',
      is_active: false,
    });
    mockProfiles = [makeProfile(), inactive];

    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('radio', { name: /Commercial Gym/ }));

    await waitFor(() => {
      expect(mockActivateProfile).toHaveBeenCalledWith(inactive.id);
    });
  });

  it('does not re-activate the profile that is already active', () => {
    mockProfiles = [makeProfile()];

    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('radio', { name: /Home/ }));

    expect(mockActivateProfile).not.toHaveBeenCalled();
  });

  it('creates the first profile as active', async () => {
    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Profile' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: '  Garage  ' },
    });
    // Creation is detailed mode: granular items, and the server derives the
    // coarse columns from them.
    fireEvent.click(screen.getByLabelText('Dumbbells'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith({
        name: 'Garage',
        equipment_items: ['dumbbells'],
        is_active: true,
      });
    });
  });

  it('sends no is_active on update and activates separately when switched on', async () => {
    const inactive = makeProfile({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Commercial Gym',
      equipment: ['barbell'],
      is_active: false,
    });
    mockProfiles = [inactive];

    render(<GymProfilesManager />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Edit Commercial Gym' })
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Use this profile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        id: inactive.id,
        payload: {
          name: 'Commercial Gym',
          equipment: ['barbell'],
          apparatus: null,
          equipment_preference: null,
          load_limits: null,
        },
      });
    });
    expect(mockActivateProfile).toHaveBeenCalledWith(inactive.id);
  });

  it('drops equipment values outside the canonical vocabulary when editing', async () => {
    const stale = makeProfile({
      equipment: ['dumbbell', 'Dumbbell', 'moon rock'],
      is_active: false,
    });
    mockProfiles = [stale];

    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        id: stale.id,
        payload: {
          name: 'Home',
          equipment: ['dumbbell'],
          apparatus: null,
          equipment_preference: null,
          load_limits: null,
        },
      });
    });
  });

  it('creates a profile with equipment items and a dumbbell ceiling', async () => {
    // The apparatus section folds into the item picker for detailed
    // profiles: a flat bench is an item, and the server derives the
    // `bench` apparatus from it.
    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Profile' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Basement' },
    });
    fireEvent.click(screen.getByLabelText('Dumbbells'));
    fireEvent.click(screen.getByLabelText('Flat bench'));
    fireEvent.change(screen.getByLabelText('Heaviest dumbbell (kg)'), {
      target: { value: '22.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith({
        name: 'Basement',
        equipment_items: ['dumbbells', 'flat-bench'],
        load_limits: { dumbbell: { max_kg: 22.5 } },
        is_active: true,
      });
    });
  });

  it('prefills the selection from a template', async () => {
    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Profile' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'PF' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Planet Fitness' }));
    // Editable after: the template is a prefill, not a lock.
    expect(screen.getByLabelText('Smith machine')).toBeChecked();
    expect(screen.getByLabelText('Barbell (Olympic)')).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('Smith machine'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith({
        name: 'PF',
        equipment_items: expect.not.arrayContaining(['smith-machine']),
        is_active: true,
      });
    });
    const payload = mockCreateProfile.mock.calls[0][0];
    expect(payload.equipment_items).toContain('fixed-barbells');
    expect(payload.equipment_items).not.toContain('barbell');
  });

  it('upgrades a legacy profile to detailed equipment, never silently', async () => {
    const legacy = makeProfile({
      equipment: ['dumbbell'],
      apparatus: ['bench'],
      is_active: false,
    });
    mockProfiles = [legacy];

    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    // A legacy profile still gets the coarse editor.
    expect(screen.getByLabelText('Dumbbell')).toBeChecked();
    fireEvent.click(
      screen.getByRole('button', { name: 'Upgrade to detailed equipment' })
    );
    // The expansion pre-selects items deriving the coarse values, stated
    // apparatus included, as a starting point to prune.
    expect(screen.getByLabelText('Dumbbells')).toBeChecked();
    expect(screen.getByLabelText('Flat bench')).toBeChecked();
    expect(screen.getByLabelText('Smith machine')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        id: legacy.id,
        payload: {
          name: 'Home',
          equipment_items: expect.arrayContaining(['dumbbells', 'flat-bench']),
          equipment_preference: null,
          load_limits: null,
        },
      });
    });
    const payload = mockUpdateProfile.mock.calls[0][0].payload;
    expect(payload).not.toHaveProperty('equipment');
    expect(payload).not.toHaveProperty('apparatus');
  });

  it('summarizes an item-stated profile as a count and edits it in detailed mode', async () => {
    const detailed = makeProfile({
      equipment: ['machine'],
      apparatus: [],
      equipment_items: ['smith-machine', 'leg-press', 'treadmill'],
      is_active: false,
    });
    mockProfiles = [detailed];

    render(<GymProfilesManager />);

    expect(screen.getByText('3 equipment items')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    expect(screen.getByLabelText('Smith machine')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Leg press'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        id: detailed.id,
        payload: {
          name: 'Home',
          equipment_items: ['smith-machine', 'treadmill'],
          equipment_preference: null,
          load_limits: null,
        },
      });
    });
  });

  it('converts the dumbbell ceiling from the display unit to kg', async () => {
    mockWeightUnit = 'lbs';

    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Profile' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Hotel' },
    });
    fireEvent.change(screen.getByLabelText('Heaviest dumbbell (lbs)'), {
      target: { value: '50' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith({
        name: 'Hotel',
        equipment_items: [],
        load_limits: { dumbbell: { max_kg: 22.68 } },
        is_active: true,
      });
    });
  });

  it('round-trips an untouched dumbbell ceiling without unit drift', async () => {
    // 22.5 kg displays as 49.6 lbs; saving without touching the field must
    // store 22.5 again, not the double-converted 22.4982.
    mockWeightUnit = 'lbs';
    const profile = makeProfile({
      is_active: false,
      load_limits: { dumbbell: { max_kg: 22.5 } },
    });
    mockProfiles = [profile];

    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    expect(screen.getByLabelText('Heaviest dumbbell (lbs)')).toHaveValue(49.6);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        id: profile.id,
        payload: {
          name: 'Home',
          equipment: ['dumbbell', 'bands'],
          apparatus: null,
          equipment_preference: null,
          load_limits: { dumbbell: { max_kg: 22.5 } },
        },
      });
    });
  });

  it('clearing the dumbbell ceiling keeps the profile’s other load limits', async () => {
    const profile = makeProfile({
      is_active: false,
      apparatus: ['bench'],
      load_limits: {
        barbell: { max_kg: 60 },
        dumbbell: { max_kg: 20, increment_kg: 2 },
      },
    });
    mockProfiles = [profile];

    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    // Stated apparatus opens the checkbox group pre-checked.
    expect(screen.getByLabelText('Bench')).toBeChecked();
    expect(screen.getByLabelText('Pull-Up Bar')).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Heaviest dumbbell (kg)'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        id: profile.id,
        payload: {
          name: 'Home',
          equipment: ['dumbbell', 'bands'],
          apparatus: ['bench'],
          equipment_preference: null,
          load_limits: { barbell: { max_kg: 60 } },
        },
      });
    });
  });

  it('clears stated apparatus back to unspecified as null', async () => {
    const profile = makeProfile({ is_active: false, apparatus: [] });
    mockProfiles = [profile];

    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Let Sparky assume' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        id: profile.id,
        payload: {
          name: 'Home',
          equipment: ['dumbbell', 'bands'],
          apparatus: null,
          equipment_preference: null,
          load_limits: null,
        },
      });
    });
  });

  // --- Preferred equipment -------------------------------------------------
  //
  // The control sits outside the detailed/coarse branch: a preference says what
  // to pick from whatever the gym has, so it is orthogonal to the derivation
  // contract rather than another field that contract owns.

  it('states a preference on a coarse profile without disturbing the equipment', async () => {
    const profile = makeProfile({ is_active: false });
    mockProfiles = [profile];

    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Machines' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        id: profile.id,
        payload: {
          name: 'Home',
          equipment: ['dumbbell', 'bands'],
          apparatus: null,
          equipment_preference: 'machines',
          load_limits: null,
        },
      });
    });
  });

  it('rides with the item-stated payload, which states nothing coarse', async () => {
    const detailed = makeProfile({
      apparatus: [],
      equipment_items: ['smith-machine', 'treadmill'],
      is_active: false,
    });
    mockProfiles = [detailed];

    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Free weights' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        id: detailed.id,
        payload: {
          name: 'Home',
          equipment_items: ['smith-machine', 'treadmill'],
          equipment_preference: 'free_weights',
          load_limits: null,
        },
      });
    });
    // A detailed payload carrying the coarse fields is a 400 by design, and
    // the preference must not be what drags them back in.
    const payload = mockUpdateProfile.mock.calls[0][0].payload;
    expect(payload).not.toHaveProperty('equipment');
    expect(payload).not.toHaveProperty('apparatus');
  });

  it('sends a stated preference on create, where unstated is omitted', async () => {
    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Profile' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Basement' },
    });
    fireEvent.click(screen.getByLabelText('Dumbbells'));
    fireEvent.click(screen.getByRole('button', { name: 'Machines' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The create schema takes an optional, not a null: the sibling create
    // tests assert the exact payload without the key, which is the other half
    // of this contract.
    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith({
        name: 'Basement',
        equipment_items: ['dumbbells'],
        equipment_preference: 'machines',
        is_active: true,
      });
    });
  });

  it('returns a stated preference to unstated as an explicit null', async () => {
    const stated = makeProfile({
      equipment_preference: 'machines',
      is_active: false,
    });
    mockProfiles = [stated];

    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    // The stored value prefills, which is what makes "No preference" a real
    // choice rather than the empty state it looks like.
    expect(screen.getByRole('button', { name: 'Machines' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'No preference' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        id: stated.id,
        payload: {
          name: 'Home',
          equipment: ['dumbbell', 'bands'],
          apparatus: null,
          equipment_preference: null,
          load_limits: null,
        },
      });
    });
  });

  it('reads a preference this build does not know as unstated, and never echoes it back', async () => {
    // The same stale-row defense the equipment, apparatus and item lists
    // already have: a value written by a newer build must not ride back out
    // through a request schema that would reject it.
    const drifted = makeProfile({
      equipment_preference:
        'kettlebells-only' as GymProfile['equipment_preference'],
      is_active: false,
    });
    mockProfiles = [drifted];

    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Home' }));
    expect(
      screen.getByRole('button', { name: 'No preference' })
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        id: drifted.id,
        payload: {
          name: 'Home',
          equipment: ['dumbbell', 'bands'],
          apparatus: null,
          equipment_preference: null,
          load_limits: null,
        },
      });
    });
  });

  it('blocks saving while the dumbbell ceiling is not a positive weight', () => {
    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Profile' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Garage' },
    });
    fireEvent.change(screen.getByLabelText('Heaviest dumbbell (kg)'), {
      target: { value: '-5' },
    });

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(
      screen.getByText('Enter a weight above zero, or leave it empty.')
    ).toBeInTheDocument();
  });

  it('deletes only after the confirmation is accepted', async () => {
    const profile = makeProfile();
    mockProfiles = [profile];

    render(<GymProfilesManager />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Home' }));
    expect(mockDeleteProfile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mockDeleteProfile).toHaveBeenCalledWith(profile.id);
    });
  });

  it('keeps a populated list visible when a refetch fails', () => {
    // isError is also true when a refetch fails over cached data, so the error
    // state must be gated on there being nothing to show.
    mockProfiles = [makeProfile()];
    mockQueryState = { isLoading: false, isError: true, hasData: true };

    render(<GymProfilesManager />);

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(
      screen.queryByText('Failed to load gym profiles.')
    ).not.toBeInTheDocument();
  });

  it('shows the error state when the read failed with no cached data', () => {
    mockQueryState = { isLoading: false, isError: true, hasData: false };

    render(<GymProfilesManager />);

    expect(
      screen.getByText('Failed to load gym profiles.')
    ).toBeInTheDocument();
  });
});
