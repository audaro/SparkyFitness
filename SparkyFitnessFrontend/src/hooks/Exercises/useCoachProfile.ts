import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getCoachProfile,
  updateCoachProfile,
  type CoachProfile,
  type CoachProfilePatch,
} from '@/api/Exercises/coachProfile';
import { coachProfileKeys } from '@/api/keys/exercises';

// Pages may not import from `@/api` (enforced by no-restricted-imports), so the
// domain types reach them through this hook module.
export type {
  CoachProfile,
  CoachProfilePatch,
} from '@/api/Exercises/coachProfile';

/**
 * The coach profile the workout engine reads. Owner-only — pass
 * `useCoachingContextAvailable()` as `enabled` so a delegate context makes no
 * request instead of collecting a 403.
 */
export const useCoachProfile = (enabled: boolean = true) => {
  const { t } = useTranslation();

  return useQuery<CoachProfile>({
    queryKey: coachProfileKeys.current(),
    queryFn: getCoachProfile,
    enabled,
    meta: {
      errorMessage: t(
        'coachProfile.loadError',
        'Failed to load your training profile.'
      ),
    },
  });
};

/**
 * Saves a partial patch and replaces the cached profile with what the server
 * stored — the response is authoritative, so there is nothing to refetch.
 * A profile edit changes what the *next* generation reads; the stored
 * workout deliberately does not move until the user regenerates.
 */
export const useUpdateCoachProfileMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (patch: CoachProfilePatch) => updateCoachProfile(patch),
    onSuccess: (profile) => {
      queryClient.setQueryData(coachProfileKeys.current(), profile);
    },
    meta: {
      successMessage: t('coachProfile.saveSuccess', 'Training profile saved.'),
      errorMessage: t(
        'coachProfile.saveError',
        'Failed to save your training profile.'
      ),
    },
  });
};
