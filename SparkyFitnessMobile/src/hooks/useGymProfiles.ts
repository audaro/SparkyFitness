import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import {
  activateGymProfile,
  createGymProfile,
  deleteGymProfile,
  fetchGymProfiles,
  updateGymProfile,
  type GymProfile,
  type GymProfileCreatePayload,
  type GymProfileUpdatePayload,
} from '../services/api/gymProfilesApi';
import { gymProfilesQueryKey } from './queryKeys';

/**
 * A duplicate profile name is the one failure the user can fix themselves, so
 * it gets its own message instead of the generic retry copy.
 */
function isDuplicateNameError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('409');
}

function errorToast(title: string, error: unknown): void {
  Toast.show({
    type: 'error',
    text1: title,
    text2: isDuplicateNameError(error)
      ? 'You already have a profile with that name.'
      : 'Please try again.',
  });
}

export function useGymProfiles() {
  const query = useQuery<GymProfile[]>({
    queryKey: gymProfilesQueryKey,
    queryFn: fetchGymProfiles,
  });

  return {
    profiles: query.data ?? [],
    // The active profile, or null for "no constraint" — the same meaning the
    // server gives an absent row.
    activeProfile: query.data?.find((profile) => profile.is_active) ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function useGymProfileMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: gymProfilesQueryKey });
  };

  const create = useMutation({
    mutationFn: (body: GymProfileCreatePayload) => createGymProfile(body),
    onSuccess: invalidate,
    onError: (error) => errorToast('Could not create gym profile', error),
  });

  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: GymProfileUpdatePayload }) =>
      updateGymProfile(id, payload),
    onSuccess: invalidate,
    onError: (error) => errorToast('Could not save gym profile', error),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteGymProfile(id),
    onSuccess: invalidate,
    onError: (error) => errorToast('Could not delete gym profile', error),
  });

  // Activation flips two rows server-side, so refetch rather than patching the
  // cache — the previously active profile's flag changed too.
  const activate = useMutation({
    mutationFn: (id: string) => activateGymProfile(id),
    onSuccess: invalidate,
    onError: (error) => errorToast('Could not switch gym profile', error),
  });

  return {
    createProfileAsync: create.mutateAsync,
    updateProfileAsync: update.mutateAsync,
    deleteProfileAsync: remove.mutateAsync,
    activateProfileAsync: activate.mutateAsync,
    isSaving: create.isPending || update.isPending,
    isActivating: activate.isPending,
  };
}
