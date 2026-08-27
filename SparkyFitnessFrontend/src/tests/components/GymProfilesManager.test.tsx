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
    fireEvent.click(screen.getByLabelText('Dumbbell'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockCreateProfile).toHaveBeenCalledWith({
        name: 'Garage',
        equipment: ['dumbbell'],
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
        payload: { name: 'Commercial Gym', equipment: ['barbell'] },
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
        payload: { name: 'Home', equipment: ['dumbbell'] },
      });
    });
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
