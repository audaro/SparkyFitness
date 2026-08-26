import { useTranslation } from 'react-i18next';
import React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { ON_DEMAND_WORKOUTS, onDemandGenerateRequest } from '@workspace/shared';

import SettingsRow, { SettingsRowGroup } from '../components/SettingsRow';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { useGenerateAndShowWorkout } from '../hooks/useGenerateAndShowWorkout';
import type { RootStackScreenProps } from '../types/navigation';

type OnDemandWorkoutsScreenProps = RootStackScreenProps<'OnDemandWorkouts'>;

/**
 * Themed one-tap workouts: pick a name, get a session built for it.
 *
 * A theme is a *bundle of generate parameters* and nothing more — a duration
 * and, usually, a set of canonical muscles (`ON_DEMAND_WORKOUTS` in shared).
 * There is no curated content behind a row and no endpoint of its own: the
 * engine programs the session exactly as it does everywhere else, and the
 * user's active gym profile still filters it. That is what makes this screen
 * pure client wiring.
 *
 * Same shape as `PickMusclesScreen`, and for the same reason: the picker owns
 * the generate and lands on the workout it built, rather than handing a
 * selection back to Up Next to act on.
 */
const OnDemandWorkoutsScreen: React.FC<OnDemandWorkoutsScreenProps> = ({
  navigation,
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const usesNativeHeader = useNativeIOSHeadersActive();
  const textMuted = useCSSVariable('--color-text-muted') as string;

  const { generateAndShow, pendingKey, isGenerating } =
    useGenerateAndShowWorkout(navigation);

  const header = useScreenHeader({
    title: t('upNext.onDemand', { defaultValue: 'On Demand' }),
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
          paddingBottom: insets.bottom + 80 + activeWorkoutBarPadding,
        }}
        contentInsetAdjustmentBehavior={usesNativeHeader ? 'automatic' : 'never'}
      >
        <Text className="text-sm mb-4" style={{ color: textMuted }}>
          {t('onDemand.intro', {
            defaultValue:
              'Pick a session and it is built for you. Your gym profile still applies; the length comes from the workout you choose.',
          })}
        </Text>

        <SettingsRowGroup>
          {ON_DEMAND_WORKOUTS.map((theme) => (
            <SettingsRow
              key={theme.id}
              title={theme.name}
              subtitle={theme.description}
              subtitleNumberOfLines={2}
              onPress={() =>
                void generateAndShow(onDemandGenerateRequest(theme), theme.id)
              }
              disabled={isGenerating}
              rightAccessory={
                pendingKey === theme.id ? <ActivityIndicator size="small" /> : null
              }
              testID={`on-demand-${theme.id}`}
            />
          ))}
        </SettingsRowGroup>
      </ScrollView>
    </View>
  );
};

export default OnDemandWorkoutsScreen;
