import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import Switch from '../components/ui/Switch';
import { usePreferences } from '../hooks/usePreferences';
import { updatePreferences } from '../services/api/preferencesApi';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { preferencesQueryKey } from '../hooks/queryKeys';
import type { UserPreferences } from '../types/preferences';
import type { RootStackScreenProps } from '../types/navigation';

type MedicationSettingsScreenProps = RootStackScreenProps<'MedicationSettings'>;

/**
 * Medication settings. One switch today: whether medication names may be looked up against the
 * US drug catalog.
 *
 * The copy below is longer than a settings row usually gets, deliberately. This is consent for
 * sending a medication name to a third party, and consent given without knowing what is sent is
 * not consent — so the row says what leaves, where it goes, and what does not leave with it. It
 * is worded the same as the web app's row, because a user reading one and toggling the other is
 * setting a single server-side preference.
 */
const MedicationSettingsScreen: React.FC<MedicationSettingsScreenProps> = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const usesNativeHeader = useNativeIOSHeadersActive();
  const queryClient = useQueryClient();
  const { preferences } = usePreferences();

  // Off unless the server says otherwise — including while the read is still in flight. A switch
  // that draws itself on before the answer arrives is claiming consent nobody gave.
  const lookupEnabled = preferences?.medication_catalog_lookup_enabled === true;

  const mutation = useMutation({
    mutationFn: (data: Partial<UserPreferences>) => updatePreferences(data),
    // Optimistic, then rolled back on failure. A switch reporting a state the server did not
    // record would be the worst kind of wrong here: the user would believe lookups were off.
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: preferencesQueryKey });
      const previous = queryClient.getQueryData<UserPreferences>(preferencesQueryKey);
      queryClient.setQueryData<UserPreferences>(preferencesQueryKey, (old) =>
        old ? { ...old, ...data } : (data as UserPreferences),
      );
      return { previous };
    },
    onError: (_err, _data, context) => {
      if (context?.previous) {
        queryClient.setQueryData(preferencesQueryKey, context.previous);
      }
      Toast.show({
        type: 'error',
        text1: t('common.error', { defaultValue: 'Error' }),
        text2: t('medicationSettings.saveFailed', {
          defaultValue: 'That setting could not be saved. It is unchanged.',
        }),
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: preferencesQueryKey });
    },
  });

  const handleToggle = useCallback(
    (value: boolean) => mutation.mutate({ medication_catalog_lookup_enabled: value }),
    [mutation],
  );

  const header = useScreenHeader({
    title: t('medicationSettings.title', { defaultValue: 'Medication Settings' }),
    left: { kind: 'back' },
  });

  return (
    <View
      className="flex-1 bg-background"
      style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
    >
      {header}
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingTop: 16,
          paddingBottom: insets.bottom + 80 + activeWorkoutBarPadding,
        }}
        contentInsetAdjustmentBehavior={usesNativeHeader ? 'automatic' : 'never'}
      >
        <View className="bg-surface rounded-xl p-3 mb-4 shadow-sm">
          <View className="flex-row justify-between items-center">
            <Text className="text-base font-semibold text-text-primary flex-shrink">
              {t('medicationSettings.catalogLookup.title', {
                defaultValue: 'Search the US drug catalog',
              })}
            </Text>
            <Switch
              testID="medication-catalog-lookup-switch"
              value={lookupEnabled}
              onValueChange={handleToggle}
            />
          </View>
          <Text className="text-text-secondary text-sm mt-4">
            {t('medicationSettings.catalogLookup.description', {
              defaultValue:
                'Adds around 20,000 US prescription products to the suggestions when you type a medication name, with their strengths and forms. Off by default.',
            })}
          </Text>
          <Text className="text-text-secondary text-sm mt-2">
            {t('medicationSettings.catalogLookup.privacy', {
              defaultValue:
                'What this sends: the name you are typing, from this server to the US National Library of Medicine. Your account, your medication list and everything else about you stay here. Your own medications and the built-in drug list are searched offline either way.',
            })}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

export default MedicationSettingsScreen;
