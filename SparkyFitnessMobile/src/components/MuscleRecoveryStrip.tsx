import React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { useFreshnessToneColors } from '../hooks/useFreshnessToneColors';
import { useMuscleRecovery } from '../hooks/useMuscleRecovery';
import { titleCaseCanonical } from '../utils/workoutSession';

const TILE_WIDTH = 64;

/**
 * Per-muscle recovery for today, as a horizontally scrolled strip.
 *
 * Freshest first, in the order the server ranked them — the leading tiles are
 * the muscles a workout generated right now would reach for, which is the
 * question the tab exists to answer.
 *
 * Read-only for now. C3 gives the strip a destination (the muscle grid); until
 * that screen exists there is nowhere for a tap to go, and a tile that looks
 * pressable and does nothing is worse than one that does not.
 */
const MuscleRecoveryStrip: React.FC = () => {
  const { muscles, isLoading } = useMuscleRecovery();

  const [accentPrimary, trackColor, textMuted] = useCSSVariable([
    '--color-accent-primary',
    '--color-progress-track',
    '--color-text-muted',
  ]) as [string, string, string];

  const toneColors = useFreshnessToneColors();

  // Hidden only when there is nothing to draw — deliberately keyed on the data
  // rather than on `isError`. The error flag is also true when a *refetch*
  // fails over cached data (React Query's isRefetchError), and this hook
  // refetches on every tab focus, so hiding on the error would blank a
  // populated strip the moment the user opened the tab offline.
  if (muscles.length === 0 && !isLoading) return null;

  return (
    <View
      className="bg-surface rounded-xl p-4 mb-6 shadow-sm"
      testID="exercise-home-recovery-card"
    >
      <View className="flex-row items-center justify-between">
        <Text className="font-bold text-text-secondary">Recovery</Text>
        {isLoading ? <ActivityIndicator size="small" color={accentPrimary} /> : null}
      </View>

      <Text className="text-xs mt-1" style={{ color: textMuted }}>
        How fresh each muscle is today — most recovered first
      </Text>

      {muscles.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-3"
          contentContainerStyle={{ paddingRight: 4 }}
          testID="exercise-home-recovery-strip"
        >
          {muscles.map((muscle) => {
            const toneColor = toneColors[muscle.tone];
            return (
              <View
                key={muscle.muscle}
                className="mr-3 items-center"
                style={{ width: TILE_WIDTH }}
                testID={`exercise-home-recovery-${muscle.muscle}`}
              >
                <Text className="text-sm font-bold" style={{ color: toneColor }}>
                  {muscle.percent}%
                </Text>
                <View
                  className="mt-1.5 h-1.5 w-full rounded-full overflow-hidden"
                  style={{ backgroundColor: trackColor }}
                >
                  <View
                    className="h-1.5 rounded-full"
                    style={{ width: `${muscle.percent}%`, backgroundColor: toneColor }}
                  />
                </View>
                {/* The name sits under the bar so a two-word muscle
                    ("Lower Back") wraps without pushing its neighbours'
                    percentages out of line. */}
                <Text
                  className="text-xs text-center mt-1.5 text-text-primary"
                  numberOfLines={2}
                >
                  {titleCaseCanonical(muscle.muscle)}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
};

export default MuscleRecoveryStrip;
