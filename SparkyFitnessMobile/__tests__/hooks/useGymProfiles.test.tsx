import { act, renderHook, waitFor } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';

import { useGymProfileMutations, useGymProfiles } from '../../src/hooks/useGymProfiles';
import {
  activateGymProfile,
  createGymProfile,
  deleteGymProfile,
  fetchGymProfiles,
  updateGymProfile,
  type GymProfile,
} from '../../src/services/api/gymProfilesApi';
import { gymProfilesQueryKey } from '../../src/hooks/queryKeys';
import { apiError as serverError } from '../helpers/apiError';
import { createQueryWrapper, createTestQueryClient, type QueryClient } from './queryTestUtils';

jest.mock('../../src/services/api/gymProfilesApi', () => ({
  fetchGymProfiles: jest.fn(),
  createGymProfile: jest.fn(),
  updateGymProfile: jest.fn(),
  deleteGymProfile: jest.fn(),
  activateGymProfile: jest.fn(),
}));

jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

const mockFetch = fetchGymProfiles as jest.MockedFunction<typeof fetchGymProfiles>;
const mockCreate = createGymProfile as jest.MockedFunction<typeof createGymProfile>;
const mockUpdate = updateGymProfile as jest.MockedFunction<typeof updateGymProfile>;
const mockDelete = deleteGymProfile as jest.MockedFunction<typeof deleteGymProfile>;
const mockActivate = activateGymProfile as jest.MockedFunction<typeof activateGymProfile>;
const mockToast = Toast.show as jest.MockedFunction<typeof Toast.show>;

const profile = (overrides?: Partial<GymProfile>): GymProfile => ({
  id: '11111111-1111-4111-8111-111111111111',
  user_id: '99999999-9999-4999-8999-999999999999',
  name: 'Home Gym',
  // Canonical lowercase: the catalog filter (`equipment::jsonb ?|`) is exact
  // and case-sensitive, so a capitalized value matches no exercise.
  equipment: ['barbell', 'dumbbell'],
  // Unstated (null) rather than empty: an apparatus list of [] is the
  // authoritative "none", which is a different profile.
  apparatus: null,
  equipment_items: null,
  load_limits: null,
  equipment_preference: null,
  is_active: false,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  ...overrides,
});

function renderWithClient<T>(hook: () => T, client: QueryClient = createTestQueryClient()) {
  const rendered = renderHook(hook, { wrapper: createQueryWrapper(client) });
  return { ...rendered, client };
}

/** Mount both hooks on one client so a mutation's invalidation is observable. */
function renderBoth() {
  const client = createTestQueryClient();
  const list = renderHook(() => useGymProfiles(), { wrapper: createQueryWrapper(client) });
  const mutations = renderHook(() => useGymProfileMutations(), {
    wrapper: createQueryWrapper(client),
  });
  return { client, list, mutations };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useGymProfiles', () => {
  test('surfaces the active profile out of the list', async () => {
    const active = profile({ id: 'p-2', name: 'Commercial Gym', is_active: true });
    mockFetch.mockResolvedValue([profile(), active]);

    const { result } = renderWithClient(() => useGymProfiles());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profiles).toHaveLength(2);
    expect(result.current.activeProfile).toEqual(active);
  });

  test('no active row means no constraint, not an error', async () => {
    // Null is the same meaning the server gives an absent row: the generator
    // filters on nothing rather than on an empty equipment set.
    mockFetch.mockResolvedValue([profile(), profile({ id: 'p-2' })]);

    const { result } = renderWithClient(() => useGymProfiles());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.activeProfile).toBeNull();
  });

  test('an empty list reads the same way', async () => {
    mockFetch.mockResolvedValue([]);

    const { result } = renderWithClient(() => useGymProfiles());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profiles).toEqual([]);
    expect(result.current.activeProfile).toBeNull();
  });

  test('a failed read reports isError with an empty list rather than throwing', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));

    const { result } = renderWithClient(() => useGymProfiles());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.profiles).toEqual([]);
    expect(result.current.activeProfile).toBeNull();
  });
});

describe('useGymProfileMutations', () => {
  test('creating refetches the list', async () => {
    mockFetch.mockResolvedValue([]);
    mockCreate.mockResolvedValue(profile());

    const { list, mutations } = renderBoth();
    await waitFor(() => expect(list.result.current.isLoading).toBe(false));
    mockFetch.mockResolvedValue([profile()]);

    await act(async () => {
      await mutations.result.current.createProfileAsync({
        name: 'Home Gym',
        equipment: ['barbell'],
      });
    });

    await waitFor(() => expect(list.result.current.profiles).toHaveLength(1));
    expect(mockCreate).toHaveBeenCalledWith({ name: 'Home Gym', equipment: ['barbell'] });
  });

  test('updating sends only the fields it was given', async () => {
    mockFetch.mockResolvedValue([profile()]);
    mockUpdate.mockResolvedValue(profile({ name: 'Renamed' }));

    const { mutations, list } = renderBoth();
    await waitFor(() => expect(list.result.current.isLoading).toBe(false));

    await act(async () => {
      await mutations.result.current.updateProfileAsync({
        id: 'p-1',
        payload: { name: 'Renamed' },
      });
    });

    expect(mockUpdate).toHaveBeenCalledWith('p-1', { name: 'Renamed' });
  });

  test('activating goes through the dedicated endpoint, never a PUT', async () => {
    // Activation is a cross-row transaction (the previously active profile is
    // cleared in the same statement pair), which is why `is_active` is not a
    // field on the update payload at all.
    mockFetch.mockResolvedValue([profile()]);
    mockActivate.mockResolvedValue(profile({ is_active: true }));

    const { mutations, list } = renderBoth();
    await waitFor(() => expect(list.result.current.isLoading).toBe(false));

    await act(async () => {
      await mutations.result.current.activateProfileAsync('p-2');
    });

    expect(mockActivate).toHaveBeenCalledWith('p-2');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('activating refetches rather than patching the cache', async () => {
    // Two rows change, not one: the profile that was active is now not. A
    // cache patch would leave the old one still flagged active.
    const first = profile({ id: 'p-1', is_active: true });
    const second = profile({ id: 'p-2', is_active: false });
    mockFetch.mockResolvedValue([first, second]);
    mockActivate.mockResolvedValue({ ...second, is_active: true });

    const { client, list, mutations } = renderBoth();
    await waitFor(() => expect(list.result.current.activeProfile?.id).toBe('p-1'));

    mockFetch.mockResolvedValue([
      { ...first, is_active: false },
      { ...second, is_active: true },
    ]);

    await act(async () => {
      await mutations.result.current.activateProfileAsync('p-2');
    });

    await waitFor(() => expect(list.result.current.activeProfile?.id).toBe('p-2'));
    expect(
      (client.getQueryData(gymProfilesQueryKey) as GymProfile[]).filter((p) => p.is_active),
    ).toHaveLength(1);
  });

  test('deleting refetches the list', async () => {
    mockFetch.mockResolvedValue([profile()]);
    mockDelete.mockResolvedValue({ message: 'deleted' });

    const { list, mutations } = renderBoth();
    await waitFor(() => expect(list.result.current.profiles).toHaveLength(1));
    mockFetch.mockResolvedValue([]);

    await act(async () => {
      await mutations.result.current.deleteProfileAsync('p-1');
    });

    await waitFor(() => expect(list.result.current.profiles).toEqual([]));
    expect(mockDelete).toHaveBeenCalledWith('p-1');
  });

  test('isSaving covers create and update but not activate', async () => {
    mockFetch.mockResolvedValue([]);
    let settle: (value: GymProfile) => void = () => {};
    mockCreate.mockReturnValue(
      new Promise<GymProfile>((resolve) => {
        settle = resolve;
      }),
    );

    const { mutations } = renderBoth();
    expect(mutations.result.current.isSaving).toBe(false);

    act(() => {
      void mutations.result.current.createProfileAsync({ name: 'X', equipment: [] });
    });
    await waitFor(() => expect(mutations.result.current.isSaving).toBe(true));
    // The two flags drive different controls: a footer Save button and the
    // row spinner on the profile being switched to.
    expect(mutations.result.current.isActivating).toBe(false);

    await act(async () => {
      settle(profile());
    });
    await waitFor(() => expect(mutations.result.current.isSaving).toBe(false));
  });

  test('isActivating tracks the activate mutation alone', async () => {
    mockFetch.mockResolvedValue([]);
    let settle: (value: GymProfile) => void = () => {};
    mockActivate.mockReturnValue(
      new Promise<GymProfile>((resolve) => {
        settle = resolve;
      }),
    );

    const { mutations } = renderBoth();

    act(() => {
      void mutations.result.current.activateProfileAsync('p-1');
    });
    await waitFor(() => expect(mutations.result.current.isActivating).toBe(true));
    expect(mutations.result.current.isSaving).toBe(false);

    await act(async () => {
      settle(profile({ is_active: true }));
    });
    await waitFor(() => expect(mutations.result.current.isActivating).toBe(false));
  });
});

describe('mutation failures', () => {
  const expectToast = (text1: string, text2: string) =>
    waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text1, text2 })),
    );

  test('a 409 on create is reported as a duplicate name, which the user can fix', async () => {
    mockFetch.mockResolvedValue([]);
    mockCreate.mockRejectedValue(serverError(409));

    const { mutations } = renderBoth();

    await act(async () => {
      await expect(
        mutations.result.current.createProfileAsync({ name: 'Home Gym', equipment: [] }),
      ).rejects.toThrow();
    });

    await expectToast('Could not create gym profile', 'You already have a profile with that name.');
  });

  test('any other create failure gets the generic retry copy', async () => {
    mockFetch.mockResolvedValue([]);
    mockCreate.mockRejectedValue(serverError(500));

    const { mutations } = renderBoth();

    await act(async () => {
      await expect(
        mutations.result.current.createProfileAsync({ name: 'Home Gym', equipment: [] }),
      ).rejects.toThrow();
    });

    await expectToast('Could not create gym profile', 'Please try again.');
  });

  test('a non-409 whose body merely contains "409" is not a duplicate name', async () => {
    // The regression this classifier was rewritten for. It used to test
    // `error.message.includes('409')` against `Server error: ${status} -
    // ${body}`, so a body carrying those digits — an id, a count, a quoted
    // value — told the user to rename a profile that was fine.
    mockFetch.mockResolvedValue([]);
    mockCreate.mockRejectedValue(serverError(500, 'profile 409abc-dead-beef could not be written'));

    const { mutations } = renderBoth();

    await act(async () => {
      await expect(
        mutations.result.current.createProfileAsync({ name: 'Home Gym', equipment: [] }),
      ).rejects.toThrow();
    });

    await expectToast('Could not create gym profile', 'Please try again.');
  });

  test('a plain Error is never mistaken for a status the classifier screens for', async () => {
    // Nothing below `apiFetch` promises an ApiError — a timeout or a thrown
    // parse failure arrives as a bare Error, and must land on the generic copy.
    mockFetch.mockResolvedValue([]);
    mockCreate.mockRejectedValue(new Error('Server error: 409 - duplicate'));

    const { mutations } = renderBoth();

    await act(async () => {
      await expect(
        mutations.result.current.createProfileAsync({ name: 'Home Gym', equipment: [] }),
      ).rejects.toThrow();
    });

    await expectToast('Could not create gym profile', 'Please try again.');
  });

  test('each mutation names the operation that failed', async () => {
    mockFetch.mockResolvedValue([]);
    mockUpdate.mockRejectedValue(serverError(500));
    mockDelete.mockRejectedValue(serverError(500));
    mockActivate.mockRejectedValue(serverError(500));

    const { mutations } = renderBoth();

    await act(async () => {
      await expect(
        mutations.result.current.updateProfileAsync({ id: 'p-1', payload: { name: 'X' } }),
      ).rejects.toThrow();
      await expect(mutations.result.current.deleteProfileAsync('p-1')).rejects.toThrow();
      await expect(mutations.result.current.activateProfileAsync('p-1')).rejects.toThrow();
    });

    const titles = mockToast.mock.calls.map(([options]) => options.text1);
    expect(titles).toEqual([
      'Could not save gym profile',
      'Could not delete gym profile',
      'Could not switch gym profile',
    ]);
  });

  test('a failed mutation leaves the cached list untouched', async () => {
    const existing = [profile()];
    mockFetch.mockResolvedValue(existing);
    mockDelete.mockRejectedValue(serverError(500));

    const { list, mutations } = renderBoth();
    await waitFor(() => expect(list.result.current.profiles).toEqual(existing));

    await act(async () => {
      await expect(mutations.result.current.deleteProfileAsync('p-1')).rejects.toThrow();
    });

    expect(list.result.current.profiles).toEqual(existing);
  });
});
