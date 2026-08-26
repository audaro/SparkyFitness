import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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

function remainingLabel(t: TFunction, pack: ExercisePack): string {
  const remaining = pack.total - pack.alreadyImported;
  if (remaining <= 0) {
    return t('exercisePacks.allImported', {
      defaultValue: 'All of these are already in your library.',
    });
  }
  if (pack.alreadyImported === 0) {
    return t('exercisePacks.noneImported', {
      defaultValue: '{{total}} exercises, each with demonstration photos.',
      total: pack.total,
    });
  }
  return t('exercisePacks.someImported', {
    defaultValue:
      '{{remaining}} of {{total}} still to add — you already have {{alreadyImported}}.',
    remaining,
    total: pack.total,
    alreadyImported: pack.alreadyImported,
  });
}

const ExercisePacksScreen: React.FC<ExercisePacksScreenProps> = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const usesNativeHeader = useNativeIOSHeadersActive();

  const { packs, isLoading, isError, refetch } = useExercisePacks();
  const { progress, isImporting, importPack, cancel } = useExercisePackImport();

  const header = useScreenHeader({
    title: t('exercisePacks.title', { defaultValue: 'Exercise Packs' }),
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
      return (
        <StatusView
          loading
          title={t('exercisePacks.loading', { defaultValue: 'Loading packs…' })}
        />
      );
    }
    if (isError) {
      return (
        <StatusView
          icon="alert-circle"
          iconTone="danger"
          title={t('exercisePacks.loadFailed', { defaultValue: 'Could not load packs' })}
          subtitle={t('common.checkConnection', {
            defaultValue: 'Check your connection and try again.',
          })}
          action={{
            label: t('common.retry', { defaultValue: 'Retry' }),
            onPress: () => void refetch(),
          }}
        />
      );
    }
    if (packs.length === 0) {
      return (
        <StatusView
          icon="exercise-weights"
          iconTone="muted"
          title={t('exercisePacks.empty', { defaultValue: 'No packs available' })}
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
            {remainingLabel(t, pack)}
          </Text>

          {active && progress ? (
            <View className="mt-4">
              <View className="flex-row items-center">
                {running ? <ActivityIndicator size="small" /> : null}
                <Text
                  className={`text-sm text-text-secondary ${running ? 'ml-2' : ''}`}
                  testID={`pack-progress-${pack.id}`}
                >
                  {t('exercisePacks.progress', {
                    defaultValue: '{{processed}} of {{total}} · added {{imported}}',
                    processed: progress.processed,
                    total: progress.total,
                    imported: progress.imported,
                  })}
                  {progress.skipped > 0
                    ? t('exercisePacks.progressSkipped', {
                        defaultValue: ' · skipped {{skipped}}',
                        skipped: progress.skipped,
                      })
                    : ''}
                </Text>
              </View>
              {progress.failures.length > 0 ? (
                <Text className="mt-3 text-sm text-text-muted">
                  {t('exercisePacks.failures', {
                    defaultValue: '{{failed}} could not be added:',
                    failed: progress.failures.length,
                  })}{' '}
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
              accessibilityLabel={t('exercisePacks.stopImporting', {
                defaultValue: 'Stop importing',
              })}
              testID={`stop-pack-${pack.id}`}
            >
              {t('exercisePacks.stop', { defaultValue: 'Stop' })}
            </Button>
          ) : (
            <Button
              className={active ? 'mt-3' : 'mt-4'}
              onPress={() => handleImport(pack)}
              disabled={isImporting || complete}
              accessibilityLabel={t('exercisePacks.importA11y', {
                defaultValue: 'Import {{label}}',
                label: pack.label,
              })}
              testID={`import-pack-${pack.id}`}
            >
              {complete
                ? t('exercisePacks.alreadyAdded', { defaultValue: 'Already added' })
                : active
                  ? t('exercisePacks.addRest', { defaultValue: 'Add the rest' })
                  : t('exercisePacks.addAll', { defaultValue: 'Add to my exercises' })}
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
          {t('exercisePacks.intro', {
            defaultValue:
              'Add a ready-made set of exercises to your library. Anything you already have — by name or from an earlier import — is left alone, so adding a pack twice is safe.',
          })}
        </Text>
        {body()}
      </ScrollView>
    </View>
  );
};

export default ExercisePacksScreen;
