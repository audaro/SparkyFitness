import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  activateGymProfile,
  createGymProfile,
  deleteGymProfile,
  getGymProfiles,
  updateGymProfile,
  type GymProfile,
  type GymProfileCreatePayload,
  type GymProfileUpdatePayload,
} from '@/api/Exercises/gymProfiles';
import { gymProfileKeys } from '@/api/keys/exercises';

// Pages may not import from `@/api` (enforced by no-restricted-imports), so the
// domain types reach them through this hook module.
export type {
  GymProfile,
  GymProfileCreatePayload,
  GymProfileUpdatePayload,
} from '@/api/Exercises/gymProfiles';

// --- Queries ---

export const useGymProfiles = (enabled: boolean = true) => {
  const { t } = useTranslation();

  const query = useQuery<GymProfile[]>({
    queryKey: gymProfileKeys.lists(),
    queryFn: getGymProfiles,
    enabled,
    meta: {
      errorMessage: t(
        'gymProfilesManager.loadError',
        'Failed to load gym profiles.'
      ),
    },
  });

  return {
    ...query,
    profiles: query.data ?? [],
    // The active profile, or null for "no constraint" — the same meaning the
    // server gives when no row is active.
    activeProfile: query.data?.find((profile) => profile.is_active) ?? null,
  };
};

// --- Mutations ---
//
// Every mutation invalidates the single list key rather than patching the
// cache. Activation in particular flips two rows server-side (the previously
// active profile is deactivated in the same transaction), so a local patch
// would leave two profiles looking active.

const useInvalidateGymProfiles = () => {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: gymProfileKeys.lists() });
  };
};

export const useCreateGymProfileMutation = () => {
  const invalidate = useInvalidateGymProfiles();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (payload: GymProfileCreatePayload) => createGymProfile(payload),
    onSuccess: invalidate,
    meta: {
      successMessage: t(
        'gymProfilesManager.createSuccess',
        'Gym profile created.'
      ),
      errorMessage: t(
        'gymProfilesManager.createError',
        'Failed to create gym profile.'
      ),
    },
  });
};

export const useUpdateGymProfileMutation = () => {
  const invalidate = useInvalidateGymProfiles();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: GymProfileUpdatePayload;
    }) => updateGymProfile(id, payload),
    onSuccess: invalidate,
    meta: {
      successMessage: t(
        'gymProfilesManager.updateSuccess',
        'Gym profile saved.'
      ),
      errorMessage: t(
        'gymProfilesManager.updateError',
        'Failed to save gym profile.'
      ),
    },
  });
};

export const useDeleteGymProfileMutation = () => {
  const invalidate = useInvalidateGymProfiles();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (id: string) => deleteGymProfile(id),
    onSuccess: invalidate,
    meta: {
      successMessage: t(
        'gymProfilesManager.deleteSuccess',
        'Gym profile deleted.'
      ),
      errorMessage: t(
        'gymProfilesManager.deleteError',
        'Failed to delete gym profile.'
      ),
    },
  });
};

export const useActivateGymProfileMutation = () => {
  const invalidate = useInvalidateGymProfiles();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (id: string) => activateGymProfile(id),
    onSuccess: invalidate,
    meta: {
      successMessage: t(
        'gymProfilesManager.activateSuccess',
        'Gym profile switched.'
      ),
      errorMessage: t(
        'gymProfilesManager.activateError',
        'Failed to switch gym profile.'
      ),
    },
  });
};
