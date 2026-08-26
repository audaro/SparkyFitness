import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { useTranslation } from 'react-i18next';
import {
  fetchCoachProfile,
  updateCoachProfile,
  type CoachProfile,
  type CoachProfilePatch,
} from '../services/api/coachProfileApi';
import { coachProfileQueryKey } from './queryKeys';
import { useRefetchOnFocus } from './useRefetchOnFocus';

export type { CoachProfile, CoachProfilePatch } from '../services/api/coachProfileApi';

/**
 * The coach profile the workout engine reads. The chat coach edits the same
 * row, and the default stale time is infinite, so refetch on focus or a level
 * set in conversation would never reach this screen until an app restart.
 */
export function useCoachProfile() {
  const query = useQuery<CoachProfile>({
    queryKey: coachProfileQueryKey,
    queryFn: fetchCoachProfile,
  });

  useRefetchOnFocus(query.refetch, true);

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/**
 * Saves a partial patch and replaces the cached profile with what the server
 * stored — the response is authoritative, so there is nothing to refetch.
 * A profile edit changes what the *next* generation reads; the stored
 * workout deliberately does not move until the user regenerates.
 */
export function useUpdateCoachProfile() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: CoachProfilePatch) => updateCoachProfile(patch),
    onSuccess: (profile) => {
      queryClient.setQueryData(coachProfileQueryKey, profile);
      Toast.show({
        type: 'success',
        text1: t('coachProfile.saved', {
          defaultValue: 'Training profile saved',
        }),
      });
    },
    onError: () => {
      Toast.show({
        type: 'error',
        text1: t('coachProfile.saveFailed', {
          defaultValue: 'Could not save training profile',
        }),
        text2: t('common.connectionRetry', {
          defaultValue: 'Please check your connection and try again.',
        }),
      });
    },
  });
}
