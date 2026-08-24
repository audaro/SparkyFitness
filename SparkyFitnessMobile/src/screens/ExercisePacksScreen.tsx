import React, { useCallback } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '../components/ui/Button';
import StatusView from '../components/StatusView';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { useScreenHeader } from '../hooks/useScreenHeader';
import {
  useExercisePacks,
  useExercisePackImport,
} from '../hooks/useExercisePacks';
import type { ExercisePack } from '../services/api/exercisePacksApi';
import type { RootStackScreenProps } from '../types/navigation';

type ExercisePacksScreenProps = RootStackScreenProps<'ExercisePacks'>;

function remainingLabel(pack: ExercisePack): string {
  const remaining = pack.total - pack.alreadyImported;
  if (remaining <= 0) return 'All of these are already in your library.';
  if (pack.alreadyImported === 0) {
    return `${pack.total} exercises, each with demonstration photos.`;
  }
  return `${remaining} of ${pack.total} still to add — you already have ${pack.alreadyImported}.`;
}

const ExercisePacksScreen: React.FC<ExercisePacksScreenProps> = () => {
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const usesNativeHeader = useNativeIOSHeadersActive();

  const { packs, isLoading, isError, refetch } = useExercisePacks();
  const { progress, isImporting, importPack, cancel } = useExercisePackImport();

  const header = useScreenHeader({
    title: 'Exercise Packs',
    left: { kind: 'back' },
  });

  const handleImport = useCallback(
    (pack: ExercisePack) => {
      void importPack(pack);
    },
    [importPack],
  );

  const body = () => {
    if (isLoading) {
      return <StatusView loading title="Loading packs…" />;
    }
    if (isError) {
      return (
        <StatusView
          icon="alert-circle"
          iconTone="danger"
          title="Could not load packs"
          subtitle="Check your connection and try again."
          action={{ label: 'Retry', onPress: () => void refetch() }}
        />
      );
    }
    if (packs.length === 0) {
      return (
        <StatusView
          icon="exercise-weights"
          iconTone="muted"
          title="No packs available"
        />
      );
    }

    return packs.map((pack) => {
      const active = progress?.packId === pack.id;
      // Progress survives the run that produced it so the outcome stays on
      // screen, which means "this pack has progress" is not the same question
      // as "this pack is importing right now".
      const running = active && isImporting;
      const complete = pack.alreadyImported >= pack.total;
      return (
        <View
          key={pack.id}
          className="mb-4 rounded-2xl bg-surface p-4"
          testID={`exercise-pack-${pack.id}`}
        >
          <Text className="text-base font-semibold text-text-primary">
            {pack.label}
          </Text>
          <Text className="mt-1 text-sm text-text-secondary">
            {pack.description}
          </Text>
          <Text className="mt-2 text-sm text-text-muted">
            {remainingLabel(pack)}
          </Text>

          {active && progress ? (
            <View className="mt-4">
              <View className="flex-row items-center">
                {running ? <ActivityIndicator size="small" /> : null}
                <Text
                  className={`text-sm text-text-secondary ${running ? 'ml-2' : ''}`}
                  testID={`pack-progress-${pack.id}`}
                >
                  {progress.processed} of {progress.total} · added{' '}
                  {progress.imported}
                  {progress.skipped > 0
                    ? ` · skipped ${progress.skipped}`
                    : ''}
                </Text>
              </View>
              {progress.failures.length > 0 ? (
                <Text className="mt-3 text-sm text-text-muted">
                  {progress.failures.length} could not be added:{' '}
                  {progress.failures
                    .slice(0, 3)
                    .map((failure) => failure.name)
                    .join(', ')}
                  {progress.failures.length > 3 ? '…' : ''}
                </Text>
              ) : null}
            </View>
          ) : null}

          {running ? (
            <Button
              className="mt-3"
              variant="secondary"
              onPress={cancel}
              accessibilityLabel="Stop importing"
              testID={`stop-pack-${pack.id}`}
            >
              Stop
            </Button>
          ) : (
            <Button
              className={active ? 'mt-3' : 'mt-4'}
              onPress={() => handleImport(pack)}
              disabled={isImporting || complete}
              accessibilityLabel={`Import ${pack.label}`}
              testID={`import-pack-${pack.id}`}
            >
              {complete
                ? 'Already added'
                : active
                  ? 'Add the rest'
                  : 'Add to my exercises'}
            </Button>
          )}
        </View>
      );
    });
  };

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
        <Text className="mb-4 text-sm text-text-secondary">
          Add a ready-made set of exercises to your library. Anything you
          already have — by name or from an earlier import — is left alone, so
          adding a pack twice is safe.
        </Text>
        {body()}
      </ScrollView>
    </View>
  );
};

export default ExercisePacksScreen;
