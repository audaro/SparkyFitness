import { useMutation, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import i18n from '../localization/i18n';
import {
  updateFoodEntry,
  type UpdateFoodEntryPayload,
} from '../services/api/foodEntriesApi';
import { hasApiStatus } from '../services/api/errors';
import { normalizeDate } from '../utils/dateUtils';
import { invalidateFoodCache } from './invalidateFoodCache';
import type { FoodEntry } from '../types/foodEntries';

interface UseUpdateFoodEntryOptions {
  entryId: string;
  entryDate: string;
  onSuccess?: (updatedEntry: FoodEntry) => void;
}

export function useUpdateFoodEntry({
  entryId,
  entryDate,
  onSuccess,
}: UseUpdateFoodEntryOptions) {
  const queryClient = useQueryClient();
  const normalizedDate = normalizeDate(entryDate);

  const mutation = useMutation({
    mutationFn: (payload: UpdateFoodEntryPayload) =>
      updateFoodEntry(entryId, payload),
    onSuccess: (updatedEntry) => {
      onSuccess?.(updatedEntry);
    },
    onError: (error) => {
      const message = hasApiStatus(error, 403)
        ? i18n.t('foodEntryView.errors.permission', {
            defaultValue: "You don't have permission to edit this entry.",
          })
        : i18n.t('common.tryAgain', { defaultValue: 'Please try again.' });
      Toast.show({
        type: 'error',
        text1: i18n.t('foodEntryView.errors.saveFailed', {
          defaultValue: 'Failed to save changes',
        }),
        text2: message,
      });
    },
  });

  const invalidateCache = (newDate?: string) => {
    invalidateFoodCache(queryClient, normalizedDate);
    if (newDate && newDate !== normalizedDate) {
      invalidateFoodCache(queryClient, newDate);
    }
  };

  return {
    updateEntry: mutation.mutate,
    isPending: mutation.isPending,
    invalidateCache,
  };
}
