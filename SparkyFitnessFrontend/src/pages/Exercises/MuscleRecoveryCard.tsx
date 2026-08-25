import React from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import {
  useMuscleRecovery,
  type FreshnessTone,
} from '@/hooks/Exercises/useMuscleRecovery';
import { titleCaseCanonical } from '@/utils/canonicalVocabulary';

/**
 * The band colours, as static hex values like the rest of the app's charts
 * (`src/utils/providerColor.ts` explains the convention).
 *
 * These are the semantic status colours, not the categorical palette the weekly
 * training groups use: "fatigued" is a caution, not a fourth category.
 */
const TONE_COLORS: Record<FreshnessTone, string> = {
  fresh: '#22c55e', // green-500
  moderate: '#f59e0b', // amber-500
  fatigued: '#ef4444', // red-500
};

/**
 * Per-muscle recovery for today.
 *
 * Freshest first, in the order the server ranked them — the leading tiles are
 * the muscles a workout generated right now would reach for, which is the same
 * ordering the generator uses, so the two cannot disagree.
 *
 * Read-only. There is nowhere for a tap to go on the web: muscle targeting is
 * mobile's Pick Muscles screen, and a tile that looks pressable and does
 * nothing is worse than one that does not.
 */
const MuscleRecoveryCard: React.FC = () => {
  const { t } = useTranslation();
  const { hasPermission } = useActiveUser();

  // Recovery is derived from logged exercise entries, so unlike the gym
  // profiles and weekly targets beside it, it *is* delegatable — the route
  // rides the `diary` permission rather than being owner-only. A delegate
  // without that permission would get a 403, so the query never starts.
  const enabled = hasPermission('diary');

  const { muscles, data, isLoading, isError } = useMuscleRecovery(enabled);

  if (!enabled) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-xl sm:text-2xl font-bold tracking-tight">
          {t('muscleRecovery.cardTitle', 'Recovery')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t(
            'muscleRecovery.cardDescription',
            'How fresh each muscle is today — most recovered first.'
          )}
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : /* `isError` is also true when a refetch fails over cached data, so
              the error state is gated on there being nothing to draw. */
        isError && !data ? (
          <p className="text-center text-gray-400 py-10 italic">
            {t('muscleRecovery.loadError', 'Failed to load your recovery.')}
          </p>
        ) : muscles.length === 0 ? (
          <p className="text-center text-gray-400 py-10 italic">
            {t(
              'muscleRecovery.empty',
              'Log a workout and your recovery will show up here.'
            )}
          </p>
        ) : (
          <ul
            className="grid gap-x-4 gap-y-5"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(5.5rem, 1fr))',
            }}
          >
            {muscles.map((muscle) => {
              const toneColor = TONE_COLORS[muscle.tone];
              return (
                <li key={muscle.muscle} className="min-w-0">
                  <span
                    className="text-sm font-bold"
                    style={{ color: toneColor }}
                  >
                    {t('muscleRecovery.percent', {
                      percent: muscle.percent,
                      defaultValue: '{{percent}}%',
                    })}
                  </span>
                  {/* A plain div rather than the Radix Progress primitive: the
                      bar is one of seventeen and needs a per-band fill colour,
                      which the primitive does not take. */}
                  <div
                    className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden"
                    role="progressbar"
                    aria-valuenow={muscle.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={titleCaseCanonical(muscle.muscle)}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${muscle.percent}%`,
                        backgroundColor: toneColor,
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-foreground break-words">
                    {titleCaseCanonical(muscle.muscle)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

export default MuscleRecoveryCard;
