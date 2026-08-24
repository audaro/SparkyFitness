import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import Icon from './Icon';
import { useWorkoutRecommendation } from '../hooks/useWorkoutRecommendation';
import { formatDuration } from '../utils/workoutSession';
import type { RootStackParamList, TabParamList } from '../types/navigation';

// Not pinned to one tab: the card is the Exercise tab's first section and also
// still sits on Home until that move happens, and it only ever navigates to a
// root-stack route.
type UpNextCardNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

interface UpNextCardProps {
  navigation: UpNextCardNavigation;
}

/**
 * Dashboard entry point for the generated workout. Deliberately read-only: it
 * summarizes and navigates, and the generate/Swap controls all live on
 * UpNextScreen so there is one place where a workout can change.
 *
 * The empty state is a first-run affordance, not an error — a user who has
 * never generated a workout gets a prompt to build one, and tapping through
 * lands on the same screen's Generate CTA.
 */
const UpNextCard: React.FC<UpNextCardProps> = ({ navigation }) => {
  const { recommendation, isLoading, isError } = useWorkoutRecommendation();
  const [accentPrimary, textMuted] = useCSSVariable([
    '--color-accent-primary',
    '--color-text-muted',
  ]) as [string, string];

  // A failed read is not worth a dashboard error block — the card simply
  // stays out of the way and the Start Workout flow still reaches the screen.
  if (isError) return null;

  const payload = recommendation?.payload ?? null;
  const exerciseCount = payload?.exercises.length ?? 0;
  const muscleCount = payload?.muscle_groups.length ?? 0;

  return (
    <Pressable
      className="bg-surface rounded-xl p-4 mb-3 shadow-sm"
      onPress={() => navigation.navigate('UpNext')}
      accessibilityRole="button"
      accessibilityLabel="Open your next workout"
      testID="up-next-card"
    >
      <View className="flex-row items-center justify-between mb-2">
        <Text className="font-bold text-text-secondary">Up Next</Text>
        {isLoading ? (
          <ActivityIndicator size="small" color={accentPrimary} />
        ) : (
          <Icon name="chevron-forward" size={14} color={accentPrimary} />
        )}
      </View>

      {payload ? (
        <>
          <Text className="text-text-primary text-base font-medium">
            {payload.muscle_groups
              .map((muscle) => muscle.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()))
              .join(' · ')}
          </Text>
          <Text className="text-sm mt-1" style={{ color: textMuted }}>
            {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'} ·{' '}
            {muscleCount} {muscleCount === 1 ? 'muscle' : 'muscles'} ·{' '}
            {formatDuration(payload.estimated_duration_minutes)}
          </Text>
        </>
      ) : (
        !isLoading && (
          <Text className="text-sm" style={{ color: textMuted }}>
            Generate today&apos;s workout
          </Text>
        )
      )}
    </Pressable>
  );
};

export default UpNextCard;
