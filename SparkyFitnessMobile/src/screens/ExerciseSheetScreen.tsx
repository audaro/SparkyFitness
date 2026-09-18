import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ExerciseHeroMedia from '../components/ExerciseHeroMedia';
import { useScreenHeader, type HeaderItem } from '../hooks/useScreenHeader';
import { localizeExerciseTaxonomyValue } from '../localization/exerciseTaxonomy';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import type { RootStackScreenProps } from '../types/navigation';

type ExerciseSheetScreenProps = RootStackScreenProps<'ExerciseSheet'>;

/** Title-cases one taxonomy word for the subtitle line. */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * The per-exercise sheet: everything about one exercise *in this workout*,
 * on one screen — what it is, how it is programmed, and the control that
 * starts it.
 *
 * Deliberately a separate route from `ExerciseDetailScreen` rather than a mode
 * of it. That screen is the catalog page: it answers "what is this movement"
 * for an exercise that may not be in any workout, and its tabs, library
 * actions and edit/delete belong to that job. This one answers "what am I
 * doing with it right now", and its content is owned by a session or a plan.
 * Merging them would mean a screen where half the chrome is wrong in either
 * context. The ⋯ menu keeps a route to the catalog page so nothing that used
 * to be reachable stops being reachable.
 *
 * Two contexts, two owners of the sets — see `RootStackParamList`:
 * `active-workout` edits the live session entry through the store;
 * `up-next` edits a copy and hands it back to the Up Next screen, because a
 * generated recommendation has no session entries and nothing to persist to.
 */
function ExerciseSheetScreen({ navigation, route }: ExerciseSheetScreenProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const usesNativeHeader = useNativeIOSHeadersActive();
  const exercise = route.params.item;

  // Equipment · primary muscles · level, skipping whatever this exercise has
  // nothing for, so a sparse custom exercise gets a short line and not a line
  // of separators.
  const taxonomyLine = useMemo(() => {
    const equipment = (exercise.equipment ?? [])
      .filter((value) => value?.trim().length > 0)
      .map(capitalize)
      .join(', ');
    const muscles = (exercise.primary_muscles ?? [])
      .filter((value) => value?.trim().length > 0)
      .map(capitalize)
      .join(', ');
    const level = localizeExerciseTaxonomyValue(t, 'level', exercise.level);
    return [equipment, muscles, level].filter((part) => part.length > 0);
  }, [exercise.equipment, exercise.primary_muscles, exercise.level, t]);

  const handleOpenCatalog = useCallback(() => {
    navigation.navigate('ExerciseDetail', {
      item: exercise,
      hideWorkoutActions: true,
    });
  }, [navigation, exercise]);

  const rightItems = useMemo<HeaderItem[]>(
    () => [
      {
        kind: 'menu',
        accessibilityLabel: t('exerciseSheet.moreOptions', {
          defaultValue: 'More options',
        }),
        items: [
          {
            label: t('exerciseSheet.exerciseDetails', {
              defaultValue: 'Exercise details',
            }),
            sfSymbol: 'info.circle',
            icon: 'info-circle',
            onPress: handleOpenCatalog,
          },
        ],
      },
    ],
    [t, handleOpenCatalog]
  );

  const header = useScreenHeader({
    title: exercise.name,
    nativeTitle: exercise.name,
    borderless: true,
    left: { kind: 'back' },
    right: rightItems,
  });

  return (
    <View
      className="flex-1 bg-background"
      style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
    >
      {header}

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 16,
        }}
      >
        <ExerciseHeroMedia exercise={exercise} />

        <View className="mt-4">
          <Text
            className="text-text-primary font-bold"
            style={{ fontSize: 24 }}
            testID="exercise-sheet-name"
          >
            {exercise.name}
          </Text>
          {taxonomyLine.length > 0 ? (
            <Text
              className="text-text-secondary mt-1"
              style={{ fontSize: 13 }}
              testID="exercise-sheet-taxonomy"
            >
              {taxonomyLine.join(' · ')}
            </Text>
          ) : null}
        </View>

        {/* Chips, coach note, set rows and the footer action land in C2 —
            this commit registers the route and the shared chrome. */}
      </ScrollView>
    </View>
  );
}

export default ExerciseSheetScreen;
