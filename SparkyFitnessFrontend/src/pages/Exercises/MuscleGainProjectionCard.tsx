import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useCoachingContextAvailable } from '@/hooks/Exercises/useCoachingContextAvailable';
import { useCoachProfile } from '@/hooks/Exercises/useCoachProfile';
import { useMuscleGainProjection } from '@/hooks/Exercises/useMuscleGainProjection';

/**
 * The horizons the card offers.
 *
 * Twelve weeks is the default because it is roughly the length of the trials
 * the estimate is anchored on, so it is the one figure that is interpolation
 * rather than extrapolation. A year is what people actually want to know, and
 * it is labelled for what it is rather than left to look equally solid.
 */
const TWELVE_WEEKS = 12;
const ONE_YEAR_WEEKS = 52;

/**
 * What the weekly set targets are worth, over a horizon.
 *
 * The estimate is entirely the server's: this renders `total_kg` for the
 * selected horizon and does no arithmetic on it, because a year is not twelve
 * weeks times four and the natural and enhanced components are not additive in
 * any way a client could reconstruct.
 *
 * It renders the total alone. The response says only *whether* a stated dose
 * was part of the estimate, never what it was, and a card that split the two
 * out would put that on a shared screen.
 */
const MuscleGainProjectionCard: React.FC = () => {
  const { t } = useTranslation();
  const available = useCoachingContextAvailable();
  const { weightUnit, convertWeight } = usePreferences();
  const [weeks, setWeeks] = useState<number>(TWELVE_WEEKS);

  const { data: coachProfile } = useCoachProfile(available);
  // A profile that has not answered the questionnaire is being offered the
  // questionnaire elsewhere on this page; estimating from defaults underneath
  // that offer would put a number on screen that no answer of theirs produced.
  const planAnswered =
    coachProfile !== undefined && coachProfile.plan_completed_at !== null;

  const { data, isPlaceholderData } = useMuscleGainProjection(
    weeks,
    available && planAnswered
  );

  // Nothing to say, so nothing on screen. Several cases converge here and none
  // wants an error block on a page with plenty else on it: a delegate context,
  // an unanswered plan, a read that has not landed or failed, and — the common
  // one — no weigh-in on file, which makes every figure null. Keyed on the data
  // rather than on `isError`, which is also true for a failed refetch over
  // cached data.
  const projection = data ?? null;
  const range = projection?.projection.total_kg ?? null;
  if (projection === null || range === null) return null;

  const format = (kg: number) => convertWeight(kg, 'kg', weightUnit).toFixed(1);

  const horizons = [
    {
      weeks: TWELVE_WEEKS,
      label: t('muscleGainProjection.twelveWeeks', '12 weeks'),
    },
    {
      weeks: ONE_YEAR_WEEKS,
      label: t('muscleGainProjection.oneYear', '1 year'),
    },
  ];

  return (
    <Card data-testid="muscle-gain-projection-card">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-xl sm:text-2xl font-bold tracking-tight">
            {t('muscleGainProjection.cardTitle', 'What your plan could add')}
          </CardTitle>
          <div className="flex gap-2">
            {horizons.map((horizon) => (
              <Button
                key={horizon.weeks}
                size="sm"
                variant={weeks === horizon.weeks ? 'default' : 'outline'}
                aria-pressed={weeks === horizon.weeks}
                onClick={() => setWeeks(horizon.weeks)}
              >
                {horizon.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* `keepPreviousData` keeps the card on screen across a horizon
            change, but what it keeps is the *other* horizon's figure — and the
            buttons above have already moved, so rendering it would put twelve
            weeks of growth under a label reading "1 year". The figure waits;
            the card does not have to. */}
        <p
          className="text-3xl font-bold tracking-tight"
          data-testid="muscle-gain-projection-range"
        >
          {isPlaceholderData
            ? t('muscleGainProjection.pending', 'Working it out…')
            : t('muscleGainProjection.range', {
                low: format(range.low_kg),
                high: format(range.high_kg),
                unit: weightUnit,
                defaultValue: '+{{low}}–{{high}} {{unit}} of lean mass',
              })}
        </p>

        <p className="text-sm text-muted-foreground">
          {t(
            'muscleGainProjection.leanMass',
            'Lean mass, not scale weight — in a deficit you can gain all of it and weigh less.'
          )}
        </p>

        {projection.inputs.adherence_basis === 'no_history' ? (
          <p className="text-sm text-muted-foreground">
            {t(
              'muscleGainProjection.noHistory',
              'Assumes you hit every target, because there is nothing logged yet to measure against.'
            )}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('muscleGainProjection.adherence', {
              percent: Math.round(projection.inputs.adherence * 100),
              defaultValue:
                'At the {{percent}}% of your targets you have been hitting.',
            })}
          </p>
        )}

        {/* The year is the model run four times further than the trials behind
            it ever ran, and it compounds a single adherence figure across
            seasons, injuries and holidays. Saying so is the price of offering
            it at all. */}
        {weeks === ONE_YEAR_WEEKS && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="muscle-gain-projection-extrapolation"
          >
            {t(
              'muscleGainProjection.yearCaveat',
              'A year is an extrapolation — the trials behind this ran about twelve weeks, and nobody trains a year without a break.'
            )}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          {t(
            'muscleGainProjection.estimate',
            'An estimate from published trials, not a promise.'
          )}
        </p>
      </CardContent>
    </Card>
  );
};

export default MuscleGainProjectionCard;
