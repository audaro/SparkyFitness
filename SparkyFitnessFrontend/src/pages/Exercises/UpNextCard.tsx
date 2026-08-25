import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dumbbell,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Timer,
} from 'lucide-react';
import {
  isCardioModality,
  isWarmupSetType,
  todayInZone,
  type RecommendedExercise,
} from '@workspace/shared';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useCoachingContextAvailable } from '@/hooks/Exercises/useCoachingContextAvailable';
import {
  useGenerateWorkoutRecommendationMutation,
  useUpdateWorkoutRecommendationStatusMutation,
  useWorkoutRecommendation,
} from '@/hooks/Exercises/useWorkoutRecommendation';
import { useGymProfiles } from '@/hooks/Exercises/useGymProfiles';
import { useWorkoutPlaybackStart } from '@/hooks/Exercises/useWorkoutPlaybackStart';
import { titleCaseCanonical } from '@/utils/canonicalVocabulary';
import { createWorkoutPlaybackDraftFromRecommendation } from '@/utils/workoutPlayback';

/** The durations the engine accepts, inside the wire's 15–180 bound. */
const DURATION_CHOICES = [20, 30, 45, 60, 90, 120] as const;
const FALLBACK_DURATION_MINUTES = 60;

function formatSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

interface SetLineUnits {
  weightUnit: string;
  toDisplayWeight: (kg: number) => number;
  distanceUnit: string;
  toDisplayDistance: (km: number) => number;
}

/**
 * The programmed-set line on an Up Next row — `3 sets · 8 reps · 60 kg`,
 * `3 sets · 45s`, `30:00 · 5.2 km`.
 *
 * Counts WORKING sets only: the warm-up ramp is part of the prescription, but
 * "5 sets" would misread as five hard sets. Weight and distance are stored
 * metric and converted for display only, and a null measure drops its segment
 * rather than printing a zero — the engine leaves a field null precisely when
 * the modality gives it no meaning.
 */
function formatRecommendedSets(
  exercise: Pick<RecommendedExercise, 'modality' | 'sets'>,
  units: SetLineUnits
): string {
  const working = exercise.sets.filter((set) => !isWarmupSetType(set.set_type));
  const first = working[0];
  if (!first) return '';

  const { modality } = exercise;

  if (isCardioModality(modality)) {
    const parts: string[] = [];
    if (first.duration != null) parts.push(formatSeconds(first.duration));
    if (first.distance != null) {
      const distance = Number(
        units.toDisplayDistance(first.distance).toFixed(2)
      );
      parts.push(`${distance} ${units.distanceUnit}`);
    }
    return parts.join(' · ');
  }

  const parts = [`${working.length} ${working.length === 1 ? 'set' : 'sets'}`];
  if (modality === 'duration') {
    if (first.duration != null) parts.push(formatSeconds(first.duration));
    return parts.join(' · ');
  }
  if (first.reps != null) parts.push(`${first.reps} reps`);
  if (first.weight != null) {
    const weight = Number(units.toDisplayWeight(first.weight).toFixed(1));
    parts.push(`${weight} ${units.weightUnit}`);
  }
  return parts.join(' · ');
}

/**
 * The web's entry point into the generated workout: what the engine programmed,
 * and the controls to build or rebuild it.
 *
 * Nothing about a workout's *content* is decided here. Duration and the active
 * gym profile are request parameters; sets, loads, rests and the warm-up ramp
 * all come back from the server, so the card renders the payload it was handed
 * and never computes a prescription of its own.
 */
const UpNextCard: React.FC = () => {
  const { t } = useTranslation();
  const available = useCoachingContextAvailable();
  const { weightUnit, convertWeight, distanceUnit, convertDistance, timezone } =
    usePreferences();

  const { data, isLoading, isError, refetch } =
    useWorkoutRecommendation(available);
  const { profiles } = useGymProfiles(available);
  const { mutate: generate, isPending: isGenerating } =
    useGenerateWorkoutRecommendationMutation();
  const { mutate: markStatus } = useUpdateWorkoutRecommendationStatusMutation();
  const { requestStart, guardDialog } = useWorkoutPlaybackStart();

  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);

  // A `disabled` prop follows a render and loses to a fast double-tap, so the
  // in-flight check is a ref — the same guard the mobile pickers use.
  const generateInFlight = useRef(false);

  const recommendation = data ?? null;
  const payload = recommendation?.payload ?? null;

  // What the workout was built with, defaulting to what the next one would use.
  // Not the currently-active gym profile: a stale card must not misdescribe the
  // plan it is showing.
  const effectiveDuration =
    durationMinutes ??
    recommendation?.target_duration_minutes ??
    FALLBACK_DURATION_MINUTES;

  const gymLabel = useMemo(() => {
    if (!recommendation) return null;
    if (recommendation.gym_profile_id === null) {
      return t('upNext.anyEquipment', 'Any equipment');
    }
    const profile = profiles.find(
      (candidate) => candidate.id === recommendation.gym_profile_id
    );
    // The profile can have been deleted since the workout was built; the
    // workout is still valid, so say nothing rather than guess a name.
    return profile?.name ?? null;
  }, [recommendation, profiles, t]);

  const units: SetLineUnits = useMemo(
    () => ({
      weightUnit,
      toDisplayWeight: (kg: number) => convertWeight(kg, 'kg', weightUnit),
      distanceUnit,
      toDisplayDistance: (km: number) =>
        convertDistance(km, 'km', distanceUnit),
    }),
    [weightUnit, convertWeight, distanceUnit, convertDistance]
  );

  const runGenerate = (swap: boolean) => {
    if (generateInFlight.current) return;
    generateInFlight.current = true;
    generate(
      { duration_minutes: effectiveDuration, ...(swap ? { swap: true } : {}) },
      {
        onSettled: () => {
          generateInFlight.current = false;
        },
      }
    );
  };

  /**
   * Start the generated workout.
   *
   * The day is today in the user's timezone, never the `?date=` this page uses
   * for browsing past days: the workout was programmed against today's recovery,
   * so starting it while looking back at last Tuesday would log it to a day it
   * was not built for.
   */
  const handleStart = () => {
    if (!payload || !recommendation) return;

    requestStart({
      entryDate: todayInZone(timezone),
      createDraft: () =>
        createWorkoutPlaybackDraftFromRecommendation(
          payload,
          todayInZone(timezone),
          t('upNext.sessionName', 'Up Next workout')
        ),
      // Best-effort lifecycle marker, fired after the navigation and waited on
      // by nothing — see the hook. A start the marker never records is still a
      // start, and it must never unwind one.
      onStarted: () => markStatus({ id: recommendation.id, status: 'started' }),
    });
  };

  if (!available) {
    return null;
  }

  const durationSelect = (
    <Select
      value={String(effectiveDuration)}
      onValueChange={(value) => setDurationMinutes(Number(value))}
    >
      <SelectTrigger
        className="w-[9rem]"
        aria-label={t('upNext.durationLabel', 'Workout length')}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {/* A stored workout can carry a duration this list does not offer (the
            chat coach and mobile can send any value in 15–180), so it is added
            rather than silently snapping the selector to a different number. */}
        {Array.from(new Set<number>([...DURATION_CHOICES, effectiveDuration]))
          .sort((a, b) => a - b)
          .map((minutes) => (
            <SelectItem key={minutes} value={String(minutes)}>
              {t('upNext.durationOption', {
                minutes,
                defaultValue: '{{minutes}} min',
              })}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );

  const renderBody = () => {
    if (isLoading) {
      return (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    // `isError` is also true when a refetch fails over cached data, so the
    // error state is gated on there being no workout to show — blanking one the
    // user can still read would be a worse offline story than a stale one.
    if (isError && !payload) {
      return (
        <div className="flex flex-col items-center gap-3 py-10">
          <p className="text-center text-gray-400 italic">
            {t('upNext.loadError', 'Failed to load your suggested workout.')}
          </p>
          <Button variant="outline" onClick={() => refetch()}>
            {t('upNext.retry', 'Retry')}
          </Button>
        </div>
      );
    }

    if (!payload) {
      return (
        <div className="flex flex-col items-center gap-4 py-10">
          <p className="text-center text-gray-400 italic max-w-md">
            {t(
              'upNext.emptyDescription',
              'No workout yet. Generate one and the engine programs it from your recovery, your history, and the equipment your active gym profile says you have.'
            )}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {durationSelect}
            <Button onClick={() => runGenerate(false)} disabled={isGenerating}>
              {isGenerating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              {t('upNext.generate', 'Generate workout')}
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div>
          <p className="text-lg font-semibold">
            {payload.muscle_groups.map(titleCaseCanonical).join(' · ')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-normal">
              {t('upNext.exerciseCount', {
                count: payload.exercises.length,
                defaultValue_one: '{{count}} exercise',
                defaultValue_other: '{{count}} exercises',
              })}
            </Badge>
            <Badge variant="secondary" className="font-normal">
              <Timer className="h-3 w-3 mr-1" />
              {t('upNext.estimatedMinutes', {
                minutes: payload.estimated_duration_minutes,
                defaultValue: '~{{minutes}} min',
              })}
            </Badge>
            {gymLabel && (
              <Badge variant="secondary" className="font-normal">
                <Dumbbell className="h-3 w-3 mr-1" />
                {gymLabel}
              </Badge>
            )}
          </div>
        </div>

        <ol className="divide-y rounded-lg border">
          {payload.exercises.map((exercise, index) => (
            <li
              key={exercise.exercise_id}
              className="flex items-start gap-3 p-3"
            >
              <span className="text-sm font-semibold text-muted-foreground w-5 shrink-0 text-right">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{exercise.exercise_name}</p>
                {/* Joined rather than concatenated with a literal separator:
                    the rationale is a plain string on the wire and an empty
                    one would otherwise render a leading " · ". */}
                <p className="text-xs text-muted-foreground">
                  {[
                    exercise.rationale,
                    exercise.rest_seconds > 0
                      ? t('upNext.restChip', {
                          rest: formatSeconds(exercise.rest_seconds),
                          defaultValue: '{{rest}} rest',
                        })
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <span className="text-sm text-right shrink-0">
                {formatRecommendedSets(exercise, units)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4 gap-2">
        <CardTitle className="text-xl sm:text-2xl font-bold tracking-tight">
          {t('upNext.cardTitle', 'Up Next')}
        </CardTitle>
        {payload && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {durationSelect}
            {/* Regenerating always passes swap: the engine is deterministic, so
                a plain regenerate at the same duration would hand back the
                identical workout. */}
            <Button
              variant="outline"
              onClick={() => runGenerate(true)}
              disabled={isGenerating}
              className="shrink-0"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {t('upNext.refresh', 'New workout')}
            </Button>
            <Button
              onClick={handleStart}
              disabled={isGenerating}
              className="shrink-0"
            >
              <Play className="h-4 w-4 mr-2" />
              {t('upNext.start', 'Start workout')}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>{renderBody()}</CardContent>
      {guardDialog}
    </Card>
  );
};

export default UpNextCard;
