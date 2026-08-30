import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { getSettings, putSettings } from '../services/api/cycleApi';
import { cycleSettingsQueryKey } from './queryKeys';
import { addLog } from '../services/LogService';
import { UNCONFIGURED_CYCLE_SETTINGS } from '../utils/cycleDisplayUtils';
import type { SharedCycleSettings } from '../types/womensHealth';

export function useCycleSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: cycleSettingsQueryKey,
    queryFn: getSettings,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: true,
  });

  const mutation = useMutation({
    mutationFn: (
      body: Partial<SharedCycleSettings> & {
        mark_onboarded?: boolean;
        reset_onboarding?: boolean;
      }
    ) => putSettings(body),
    onMutate: async (newVars) => {
      // Cancel outgoing refetches so they don't overwrite optimistic update
      await queryClient.cancelQueries({ queryKey: cycleSettingsQueryKey });

      // Snapshot previous value
      const previousSettings = queryClient.getQueryData<SharedCycleSettings | null>(cycleSettingsQueryKey);

      // Optimistically update to new value immediately. An account that has
      // never written cycle settings has no row, so the server answers null and
      // there is nothing to spread: the first write — turning the feature on —
      // would otherwise leave the switch visibly off for a whole round trip.
      // Seeding from the unconfigured defaults gives that tap the same
      // immediate response every later one gets.
      const base = previousSettings ?? UNCONFIGURED_CYCLE_SETTINGS;
      queryClient.setQueryData<SharedCycleSettings | null>(cycleSettingsQueryKey, {
        ...base,
        ...newVars,
        onboarded_at: newVars.mark_onboarded ? new Date().toISOString() : base.onboarded_at,
      });

      return { previousSettings: previousSettings ?? null };
    },
    onSuccess: (data) => {
      queryClient.setQueryData<SharedCycleSettings | null>(cycleSettingsQueryKey, data);
    },
    onError: (error, _variables, context) => {
      // Roll back to previous settings on error. `context` is checked rather
      // than `context.previousSettings`, because null is now a value we
      // optimistically wrote over and therefore have to restore — testing the
      // snapshot for truthiness would leave a failed first write showing the
      // feature as on.
      if (context) {
        queryClient.setQueryData<SharedCycleSettings | null>(cycleSettingsQueryKey, context.previousSettings);
      }
      addLog(`Failed to update cycle settings: ${error}`, 'ERROR');
      Toast.show({
        type: 'error',
        text1: t('cycleSettings.updateFailed', { defaultValue: 'Update failed' }),
        text2: t('cycleSettings.saveFailed', { defaultValue: 'Could not save cycle settings. Please try again.' }),
      });
    },
  });

  return {
    settings: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    updateSettings: mutation.mutate,
    updateSettingsAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
}
