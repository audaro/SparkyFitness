import React, { useRef } from 'react';
import { View, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import RestPeriodSheet, { type RestPeriodSheetRef } from '../components/RestPeriodSheet';
import { PickerTrigger } from '../components/BottomSheetPicker';
import { formatRestLabel } from '../components/RestPeriodChip';
import SettingsRow from '../components/SettingsRow';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import Switch from '../components/ui/Switch';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { useGymProfiles } from '../hooks/useGymProfiles';
import type { RootStackScreenProps } from '../types/navigation';

type WorkoutSettingsScreenProps = RootStackScreenProps<'WorkoutSettings'>;

const WorkoutSettingsScreen: React.FC<WorkoutSettingsScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const usesNativeHeader = useNativeIOSHeadersActive();

  const defaultRestSec = useAppPreferencesStore((s) => s.defaultRestSec);
  const setDefaultRestSec = useAppPreferencesStore((s) => s.setDefaultRestSec);
  const restTimerSoundEnabled = useAppPreferencesStore((s) => s.restTimerSoundEnabled);
  const setRestTimerSoundEnabled = useAppPreferencesStore((s) => s.setRestTimerSoundEnabled);
  const workoutKeepAwakeEnabled = useAppPreferencesStore((s) => s.workoutKeepAwakeEnabled);
  const setWorkoutKeepAwakeEnabled = useAppPreferencesStore((s) => s.setWorkoutKeepAwakeEnabled);
  const { activeProfile } = useGymProfiles();
  const restSheetRef = useRef<RestPeriodSheetRef>(null);
  const header = useScreenHeader({ title: 'Workout Settings', left: { kind: 'back' } });

  return (
    <View className="flex-1 bg-background" style={usesNativeHeader ? undefined : { paddingTop: insets.top }}>
      {header}
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 80 + activeWorkoutBarPadding,
        }}
        contentInsetAdjustmentBehavior={usesNativeHeader ? 'automatic' : 'never'}
      >
        <SettingsRow
          title="Gym profiles"
          subtitle={
            activeProfile
              ? `Active: ${activeProfile.name}`
              : 'No active profile — every exercise is available.'
          }
          subtitleNumberOfLines={0}
          onPress={() => navigation.navigate('GymProfiles')}
          accessibilityLabel="Gym profiles"
          testID="workout-settings-gym-profiles"
        />

        <SettingsRow
          title="Weekly set targets"
          subtitle="Track working sets per muscle group against a weekly goal."
          subtitleNumberOfLines={0}
          onPress={() => navigation.navigate('WeeklySetTargets')}
          accessibilityLabel="Weekly set targets"
          testID="workout-settings-weekly-set-targets"
        />

        <SettingsRow
          title="Exercise packs"
          subtitle="Add a ready-made set of exercises, photos included."
          subtitleNumberOfLines={0}
          onPress={() => navigation.navigate('ExercisePacks')}
          accessibilityLabel="Exercise packs"
          testID="workout-settings-exercise-packs"
        />

        <SettingsRow
          title="Default rest period"
          subtitle="Rest between sets for newly added exercises."
          subtitleNumberOfLines={0}
          rightAccessory={
            <PickerTrigger
              label={formatRestLabel(defaultRestSec)}
              onPress={() => restSheetRef.current?.present(defaultRestSec)}
              accessibilityLabel={`Default rest period, ${formatRestLabel(defaultRestSec)}`}
              containerStyle={{ width: 110 }}
            />
          }
        />

        <SettingsRow
          title="Rest timer sound"
          subtitle="Play a sound when the rest timer ends while the app is open."
          subtitleNumberOfLines={0}
          rightAccessory={
            <Switch
              value={restTimerSoundEnabled}
              onValueChange={setRestTimerSoundEnabled}
              accessibilityLabel="Rest timer sound"
            />
          }
        />

        <SettingsRow
          title="Keep screen awake"
          subtitle="Prevent the screen from sleeping while a workout is active."
          subtitleNumberOfLines={0}
          rightAccessory={
            <Switch
              value={workoutKeepAwakeEnabled}
              onValueChange={setWorkoutKeepAwakeEnabled}
              accessibilityLabel="Keep screen awake"
            />
          }
        />
      </ScrollView>

      <RestPeriodSheet ref={restSheetRef} onChange={setDefaultRestSec} />
    </View>
  );
};

export default WorkoutSettingsScreen;
