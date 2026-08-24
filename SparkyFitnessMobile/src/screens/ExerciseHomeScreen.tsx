import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import { useNativeIOSTabsActive } from '../services/nativeTabBarPreference';
import type { RootStackParamList, TabParamList } from '../types/navigation';

type ExerciseHomeScreenProps = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'Exercise'>,
  NativeStackScreenProps<RootStackParamList>
>;

/**
 * Home for everything training-related. Its sections — Up Next, the weekly set
 * target ring, recovery, quick access and setup — arrive in later steps; this
 * is the tab host, added on its own so the navigation rename stays reviewable.
 */
const ExerciseHomeScreen: React.FC<ExerciseHomeScreenProps> = () => {
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding();
  const usesNativeTabs = useNativeIOSTabsActive();

  return (
    <ScrollView
      className="flex-1 bg-background"
      style={[{ flex: 1 }, usesNativeTabs ? undefined : { paddingTop: insets.top }]}
      contentContainerStyle={{
        paddingHorizontal: 16,
        ...(!usesNativeTabs ? { paddingTop: 16 } : null),
        paddingBottom: insets.bottom + activeWorkoutBarPadding + 16,
      }}
      contentInsetAdjustmentBehavior={usesNativeTabs ? 'automatic' : 'never'}
      automaticallyAdjustsScrollIndicatorInsets={usesNativeTabs}
    >
      {!usesNativeTabs && (
        <View className="mb-6">
          <Text className="text-2xl font-bold text-text-primary">Exercise</Text>
        </View>
      )}
    </ScrollView>
  );
};

export default ExerciseHomeScreen;
