import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import {
  MUSCLES,
  MUSCLE_SPLITS,
  MUSCLE_SPLIT_MEMBERS,
  type Muscle,
  type MuscleSplit,
} from '@workspace/shared';

import MuscleTile from '../components/MuscleTile';
import SettingsRow, { SettingsRowGroup } from '../components/SettingsRow';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { useGenerateAndShowWorkout } from '../hooks/useGenerateAndShowWorkout';
import { useMuscleRecovery, type MuscleRecoveryItem } from '../hooks/useMuscleRecovery';
import { MUSCLE_TILE_SECTIONS, musclesForTiles, type MuscleTileDefinition } from '../constants/muscleTiles';
import { titleCaseCanonical } from '../utils/workoutSession';
import type { RootStackScreenProps } from '../types/navigation';

type PickMusclesScreenProps = RootStackScreenProps<'PickMuscles'>;

/** The freshness-ranked default: no muscle constraint at all. */
const RECOVERED_KEY = 'recovered';

/**
 * What a split row says it will train.
 *
 * Full body is named rather than enumerated: seventeen muscle names in a
 * one-line subtitle is a wall of text that says less than two words do.
 */
function splitSubtitle(split: MuscleSplit): string {
  const members = MUSCLE_SPLIT_MEMBERS[split];
  if (members.length === MUSCLES.length) return 'Every muscle';
  return members.map(titleCaseCanonical).join(', ');
}

/**
 * The recovery entry a tile should show.
 *
 * A tile covering two muscles (Back is `lats` + `middle back`) shows the more
 * fatigued of them, because training back trains both — claiming the fresher
 * one's number would tell the user a muscle is rested when half of what the
 * tile stands for is not.
 *
 * Returns the entry itself rather than a number so the caller reads the
 * `percent` the hook already derived. There is exactly one ×100 in the app and
 * it is not here.
 */
function tileRecovery(
  tile: MuscleTileDefinition,
  byMuscle: Map<string, MuscleRecoveryItem>,
): MuscleRecoveryItem | null {
  let lowest: MuscleRecoveryItem | null = null;
  for (const muscle of tile.muscles) {
    const entry = byMuscle.get(muscle);
    if (!entry) continue;
    if (!lowest || entry.freshness < lowest.freshness) lowest = entry;
  }
  return lowest;
}

/**
 * Choose what the next generated workout is built around: a named split, the
 * app's own freshness ranking, or an explicit set of muscles.
 *
 * Splits are resolved to canonical muscles here and the request carries the
 * muscles — the server has no split vocabulary, which keeps the split list and
 * the grid on one code path. "Recovered muscles" is the *absence* of a
 * constraint, so it omits `target_muscles` entirely: the field is `.min(1)`, so
 * an empty array is a 400, and omitting it is a different request from naming
 * every muscle — the first tracks recovery, the second overrides it.
 *
 * One screen, two modes, following `GymProfilesScreen`: the grid is a mode of
 * this screen rather than a route of its own, so Cancel returns to the split
 * list instead of dropping the user out of the picker entirely.
 */
const PickMusclesScreen: React.FC<PickMusclesScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const usesNativeHeader = useNativeIOSHeadersActive();
  const textMuted = useCSSVariable('--color-text-muted') as string;

  const [mode, setMode] = useState<'splits' | 'grid'>('splits');
  const [selectedTileIds, setSelectedTileIds] = useState<string[]>([]);

  const { muscles: recovery } = useMuscleRecovery();

  const recoveryByMuscle = new Map(recovery.map((entry) => [entry.muscle, entry]));

  // Set the moment a generate succeeds, so the `beforeRemove` guard below lets
  // the screen go when *we* are the ones leaving.
  const leavingRef = useRef(false);
  const markLeaving = useCallback(() => {
    leavingRef.current = true;
  }, []);

  const { generateAndShow, pendingKey, isGenerating } = useGenerateAndShowWorkout(
    navigation,
    { onBeforeNavigate: markLeaving },
  );

  /**
   * Android's hardware back does not go through the header, so without this it
   * would pop the whole picker out from under a half-made selection instead of
   * doing what Cancel does. iOS's swipe-back is turned off in grid mode
   * through `gestureEnabled` — native-stack does not route that gesture
   * through this event, which is why both guards are needed.
   */
  useEffect(() => {
    if (mode !== 'grid') return;
    return navigation.addListener('beforeRemove', (event) => {
      if (leavingRef.current) return;
      event.preventDefault();
      setMode('splits');
    });
  }, [navigation, mode]);

  /**
   * Naming no muscles is not the same request as naming every muscle: the
   * field is `.min(1)`, so an empty selection omits it entirely and asks the
   * engine for its own freshness ranking.
   */
  const runGenerate = useCallback(
    (targetMuscles: readonly Muscle[] | null, key: string) =>
      generateAndShow(
        targetMuscles && targetMuscles.length > 0
          ? { target_muscles: [...targetMuscles] }
          : {},
        key,
      ),
    [generateAndShow],
  );

  const toggleTile = useCallback((tileId: string) => {
    setSelectedTileIds((current) =>
      current.includes(tileId)
        ? current.filter((id) => id !== tileId)
        : [...current, tileId],
    );
  }, []);

  const handleSaveGrid = useCallback(() => {
    const targetMuscles = musclesForTiles(selectedTileIds);
    if (targetMuscles.length === 0) return;
    void runGenerate(targetMuscles, 'grid');
  }, [runGenerate, selectedTileIds]);

  const header = useScreenHeader({
    title: mode === 'grid' ? 'Individual Muscles' : 'Pick Muscles',
    nativeTitle: mode === 'grid' ? 'Individual Muscles' : 'Pick Muscles',
    animateKey: mode,
    nativeOptions: {
      gestureEnabled: mode === 'splits',
      headerBackVisible: mode === 'splits',
    },
    left:
      mode === 'grid'
        ? {
            kind: 'dismiss',
            onPress: () => setMode('splits'),
            disabled: isGenerating,
            accessibilityLabel: 'Cancel',
            identifier: 'pick-muscles-cancel',
          }
        : { kind: 'back' },
    right:
      mode === 'grid'
        ? {
            kind: 'primary',
            label: 'Save',
            onPress: handleSaveGrid,
            disabled: selectedTileIds.length === 0,
            busy: pendingKey === 'grid',
            identifier: 'pick-muscles-save',
          }
        : null,
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
        {mode === 'splits' ? (
          <View testID="pick-muscles-splits">
            <Text className="text-sm mb-4" style={{ color: textMuted }}>
              Pick what the next workout is built around. Your gym profile and
              session length still apply.
            </Text>

            <SettingsRowGroup>
              <SettingsRow
                title="Recovered muscles"
                subtitle="Let the app pick whatever is freshest today"
                subtitleNumberOfLines={2}
                onPress={() => void runGenerate(null, RECOVERED_KEY)}
                disabled={isGenerating}
                rightAccessory={
                  pendingKey === RECOVERED_KEY ? <ActivityIndicator size="small" /> : null
                }
                testID="pick-muscles-recovered"
              />
              {MUSCLE_SPLITS.map((split) => (
                <SettingsRow
                  key={split}
                  title={titleCaseCanonical(split)}
                  subtitle={splitSubtitle(split)}
                  subtitleNumberOfLines={2}
                  onPress={() => void runGenerate(MUSCLE_SPLIT_MEMBERS[split], split)}
                  disabled={isGenerating}
                  rightAccessory={
                    pendingKey === split ? <ActivityIndicator size="small" /> : null
                  }
                  testID={`pick-muscles-split-${split.replace(/\s+/g, '-')}`}
                />
              ))}
            </SettingsRowGroup>

            <SettingsRowGroup>
              <SettingsRow
                icon="exercise-weights"
                title="Choose muscles"
                subtitle="Pick them one by one, with how recovered each is"
                subtitleNumberOfLines={2}
                onPress={() => setMode('grid')}
                disabled={isGenerating}
                testID="pick-muscles-open-grid"
              />
            </SettingsRowGroup>
          </View>
        ) : (
          <View testID="pick-muscles-grid">
            <Text className="text-sm mb-4" style={{ color: textMuted }}>
              Pick every muscle you want to train. The percentage is how
              recovered it is today.
            </Text>

            {MUSCLE_TILE_SECTIONS.map((section) => (
              <View key={section.title} className="mb-6">
                <Text className="text-xs font-bold text-text-secondary uppercase tracking-wider">
                  {section.title}
                </Text>
                <Text className="text-xs mt-0.5 mb-3" style={{ color: textMuted }}>
                  {section.subtitle}
                </Text>

                <View className="flex-row flex-wrap gap-3">
                  {section.tiles.map((tile) => {
                    const entry = tileRecovery(tile, recoveryByMuscle);
                    return (
                      <MuscleTile
                        key={tile.id}
                        label={tile.label}
                        percent={entry?.percent ?? null}
                        tone={entry?.tone ?? null}
                        selected={selectedTileIds.includes(tile.id)}
                        onPress={() => toggleTile(tile.id)}
                        className="w-[30%]"
                        testID={`pick-muscles-tile-${tile.id}`}
                      />
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

export default PickMusclesScreen;
