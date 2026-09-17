import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { useTranslation } from 'react-i18next';

import Icon from './Icon';
import SegmentedControl from './SegmentedControl';
import { usePreferences } from '../hooks/usePreferences';
import { useMuscleGainProjection } from '../hooks/useMuscleGainProjection';
import { formatLocalizedNumber } from '../localization/i18n';
import { weightFromKg } from '../utils/unitConversions';
import { normalizeWeightUnit } from '../utils/workoutSession';

/**
 * The horizons the card offers.
 *
 * Twelve weeks is the default because it is roughly the length of the trials
 * the model is anchored on, so it is the one figure that is interpolation
 * rather than extrapolation. A year is what people actually want to know, and
 * it is labelled for what it is rather than left to look equally solid.
 */
const HORIZON_WEEKS = { twelve: 12, year: 52 } as const;
type HorizonKey = keyof typeof HORIZON_WEEKS;

type Props = {
  /** Opens the questionnaire at its review step. */
  onPress: () => void;
  /**
   * False until the questionnaire has been answered. The endpoint would
   * happily estimate from an unanswered profile, but the tab is already
   * offering the questionnaire at that point and a number derived from
   * defaults would undercut it.
   */
  enabled: boolean;
};

/**
 * What the plan is worth, on the Exercise tab.
 *
 * The estimate itself is entirely the server's: this renders `total_kg` for
 * the selected horizon and never does arithmetic on it, because the natural
 * and enhanced components are not additive in any way a client could
 * reconstruct, and a year is not twelve weeks times four.
 *
 * Deliberately shows the total alone. The response says only whether a dose
 * was part of the estimate, never what it was, and a card that split the two
 * out would put that on a screen anyone glancing at the phone can read.
 */
const MuscleGainProjectionCard: React.FC<Props> = ({ onPress, enabled }) => {
  const { t } = useTranslation();
  const [horizon, setHorizon] = useState<HorizonKey>('twelve');
  const { preferences } = usePreferences();
  const weightUnit = normalizeWeightUnit(preferences?.default_weight_unit);

  const { projection, isPlaceholderData, isLoading } = useMuscleGainProjection(
    HORIZON_WEEKS[horizon],
    enabled
  );

  const [accentPrimary, textMuted] = useCSSVariable([
    '--color-accent-primary',
    '--color-text-muted',
  ]) as [string, string];

  // Nothing to say, so nothing on screen. Three cases converge here and none
  // of them wants an error block on a tab full of other things to do: the plan
  // is unanswered, the read has not landed (or failed), and — the common one —
  // there is no weigh-in on file, which makes every figure null. Keyed on the
  // data rather than on `isError` for the same reason the recovery strip is.
  const range = projection?.projection.total_kg ?? null;
  if (range === null) return null;

  const formatKg = (kg: number) =>
    formatLocalizedNumber(weightFromKg(kg, weightUnit), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });

  return (
    <View
      className="bg-surface rounded-xl p-4 mb-6 shadow-sm"
      testID="exercise-home-projection-card"
    >
      <View className="flex-row items-center justify-between">
        <Text className="font-bold text-text-secondary">
          {t('trainingPlan.projectionCardTitle', {
            defaultValue: 'What your plan could add',
          })}
        </Text>
        {isLoading ? (
          <ActivityIndicator size="small" color={accentPrimary} />
        ) : null}
      </View>

      <View className="mt-3">
        <SegmentedControl<HorizonKey>
          segments={[
            {
              key: 'twelve',
              label: t('trainingPlan.projectionTwelveWeeks', {
                defaultValue: '12 weeks',
              }),
            },
            {
              key: 'year',
              label: t('trainingPlan.projectionOneYear', {
                defaultValue: '1 year',
              }),
            },
          ]}
          activeKey={horizon}
          onSelect={setHorizon}
        />
      </View>

      {/* `keepPreviousData` is what keeps this card mounted across a tap on
          the other segment, but what it keeps is the *other* horizon's figure
          — and the control above has already moved, so drawing it would put
          twelve weeks of growth under a segment reading "1 year". The figure
          waits; the card does not have to. */}
      <Text
        className="mt-3 text-2xl font-bold text-text-primary"
        testID="exercise-home-projection-range"
      >
        {isPlaceholderData
          ? t('trainingPlan.projectionLoading', {
              defaultValue: 'Working it out…',
            })
          : t('trainingPlan.projectionRange', {
              defaultValue: '+{{low}}–{{high}} {{unit}} of lean mass',
              low: formatKg(range.low_kg),
              high: formatKg(range.high_kg),
              unit: weightUnit,
            })}
      </Text>

      <Text className="mt-1 text-sm text-text-secondary">
        {t('trainingPlan.projectionLeanMass', {
          defaultValue:
            'Lean mass, not scale weight — in a deficit you can gain all of it and weigh less.',
        })}
      </Text>

      {projection !== undefined &&
      projection.inputs.adherence_basis === 'no_history' ? (
        <Text className="mt-1 text-sm" style={{ color: textMuted }}>
          {t('trainingPlan.projectionNoHistory', {
            defaultValue:
              'Assumes you hit every target, because there is nothing logged yet to measure against.',
          })}
        </Text>
      ) : (
        <Text className="mt-1 text-sm" style={{ color: textMuted }}>
          {t('trainingPlan.projectionAdherence', {
            defaultValue:
              'At the {{percent}}% of your targets you have been hitting.',
            percent: formatLocalizedNumber(
              Math.round((projection?.inputs.adherence ?? 0) * 100)
            ),
          })}
        </Text>
      )}

      {/* The year is the model run four times further than the trials behind
          it ever ran, and it compounds a single adherence figure across
          seasons, injuries and holidays. Saying so is the price of offering
          it at all. */}
      {horizon === 'year' && (
        <Text
          className="mt-1 text-xs"
          style={{ color: textMuted }}
          testID="exercise-home-projection-extrapolation"
        >
          {t('trainingPlan.projectionYearCaveat', {
            defaultValue:
              'A year is an extrapolation — the trials behind this ran about twelve weeks, and nobody trains a year without a break.',
          })}
        </Text>
      )}

      {/* A separate press target rather than a pressable card: a Pressable is
          an accessibility element and collapses everything inside it, which
          would put the horizon control out of VoiceOver's reach. */}
      <Pressable
        className="mt-3 flex-row items-center"
        onPress={onPress}
        accessibilityRole="button"
        testID="exercise-home-projection-review"
      >
        <Text className="flex-1 text-sm font-semibold text-text-primary">
          {t('trainingPlan.projectionReview', {
            defaultValue: 'Review your plan',
          })}
        </Text>
        <Icon name="chevron-forward" size={14} color={accentPrimary} />
      </Pressable>
    </View>
  );
};

export default MuscleGainProjectionCard;
