import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ENHANCEMENT_STATUSES,
  EXPERIENCE_LEVELS,
  MAX_PRIORITY_MUSCLE_GROUPS,
  MAX_TESTOSTERONE_MG_PER_DOSE,
  MUSCLE_GROUPS,
  PHYSIQUE_TARGETS,
  PRIMARY_GOALS,
  TESTOSTERONE_ESTERS,
  deriveDefaultWeeklySetTargets,
  type EnhancementStatus,
  type ExperienceLevel,
  type MuscleGroupValue,
  type PhysiqueTarget,
  type PrimaryGoal,
  type TestosteroneEster,
} from '@workspace/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCoachingContextAvailable } from '@/hooks/Exercises/useCoachingContextAvailable';
import {
  useCoachProfile,
  useSaveTrainingPlanMutation,
  type CoachProfile,
} from '@/hooks/Exercises/useCoachProfile';
import {
  useClearWeeklySetTargetsMutation,
  useWeeklySetTargets,
} from '@/hooks/Exercises/useWeeklySetTargets';

/** Radix Select cannot carry an empty value, so "not stated" needs a token. */
const UNSET = 'unset';

const MIN_TRAINING_DAYS = 1;
const MAX_TRAINING_DAYS = 7;
const MIN_SESSION_MINUTES = 20;
const MAX_SESSION_MINUTES = 120;

/**
 * Intervals offered for a long-ester protocol, in weeks. Undecanoate is the
 * reason this field exists: 1000 mg every ten weeks is ordinary, and storing
 * it as a 100 mg weekly average would reopen as a number nobody typed.
 */
const DOSE_INTERVAL_WEEKS = [1, 2, 3, 4, 6, 8, 10, 12, 14];
const DEFAULT_UNDECANOATE_INTERVAL_WEEKS = 10;

/**
 * Canonical storage stays literal, in English: `limitations` is prose the
 * generator and the chat coach both read, so a slug vocabulary here would
 * either mean nothing to them or need a second translation layer. Only the
 * labels are localized.
 */
const LIMITATION_PRESETS = [
  { value: 'Shoulder pain', key: 'shoulder' },
  { value: 'Knee pain', key: 'knee' },
  { value: 'Lower back pain', key: 'lowerBack' },
  { value: 'Wrist pain', key: 'wrist' },
  { value: 'No overhead pressing', key: 'noOverhead' },
] as const;

const PRESET_LIMITATION_VALUES: readonly string[] = LIMITATION_PRESETS.map(
  (preset) => preset.value
);

function primaryGoalLabel(t: TFunction, goal: PrimaryGoal): string {
  switch (goal) {
    case 'build_muscle':
      return t('trainingPlan.goal.buildMuscle', 'Build muscle');
    case 'lose_fat':
      return t('trainingPlan.goal.loseFat', 'Lose fat');
    case 'recomp':
      return t('trainingPlan.goal.recomp', 'Build muscle and lose fat');
    case 'strength':
      return t('trainingPlan.goal.strength', 'Get stronger');
    case 'general_fitness':
      return t('trainingPlan.goal.generalFitness', 'General fitness');
  }
}

function physiqueLabel(t: TFunction, target: PhysiqueTarget): string {
  switch (target) {
    case 'lean':
      return t('trainingPlan.physique.lean', 'Lean');
    case 'athletic':
      return t('trainingPlan.physique.athletic', 'Athletic');
    case 'muscular':
      return t('trainingPlan.physique.muscular', 'Muscular');
    case 'powerful':
      return t('trainingPlan.physique.powerful', 'Powerful');
    case 'maintain':
      return t('trainingPlan.physique.maintain', 'Keep what I have');
  }
}

function experienceLabel(t: TFunction, level: ExperienceLevel): string {
  switch (level) {
    case 'beginner':
      return t('trainingPlan.experience.beginner', 'Beginner');
    case 'intermediate':
      return t('trainingPlan.experience.intermediate', 'Intermediate');
    case 'expert':
      return t('trainingPlan.experience.expert', 'Expert');
  }
}

function groupLabel(t: TFunction, group: MuscleGroupValue): string {
  switch (group) {
    case 'push':
      return t('weeklySetTargets.group.push', 'Push Muscles');
    case 'pull':
      return t('weeklySetTargets.group.pull', 'Pull Muscles');
    case 'legs':
      return t('weeklySetTargets.group.legs', 'Leg Muscles');
    case 'core':
      return t('weeklySetTargets.group.core', 'Core Muscles');
  }
}

function enhancementLabel(t: TFunction, status: EnhancementStatus): string {
  switch (status) {
    case 'natural':
      return t('trainingPlan.enhancement.natural', 'Natural');
    case 'trt':
      return t('trainingPlan.enhancement.trt', 'On TRT');
    case 'enhanced':
      return t('trainingPlan.enhancement.enhanced', 'Above replacement');
  }
}

function esterLabel(t: TFunction, ester: TestosteroneEster): string {
  switch (ester) {
    case 'enanthate':
      return t('trainingPlan.ester.enanthate', 'Enanthate');
    case 'cypionate':
      return t('trainingPlan.ester.cypionate', 'Cypionate');
    case 'propionate':
      return t('trainingPlan.ester.propionate', 'Propionate');
    case 'undecanoate':
      return t('trainingPlan.ester.undecanoate', 'Undecanoate');
    case 'other':
      return t('trainingPlan.ester.other', 'Something else');
  }
}

function limitationLabel(
  t: TFunction,
  key: (typeof LIMITATION_PRESETS)[number]['key']
): string {
  switch (key) {
    case 'shoulder':
      return t('trainingPlan.limitation.shoulder', 'Shoulder pain');
    case 'knee':
      return t('trainingPlan.limitation.knee', 'Knee pain');
    case 'lowerBack':
      return t('trainingPlan.limitation.lowerBack', 'Lower back pain');
    case 'wrist':
      return t('trainingPlan.limitation.wrist', 'Wrist pain');
    case 'noOverhead':
      return t('trainingPlan.limitation.noOverhead', 'No overhead pressing');
  }
}

interface PlanDraft {
  primaryGoal: PrimaryGoal | null;
  physiqueTarget: PhysiqueTarget | null;
  goalsNote: string;
  trainingDays: number;
  sessionMinutes: number;
  experienceLevel: ExperienceLevel | null;
  priorities: MuscleGroupValue[];
  limitations: string[];
  limitationsNote: string;
  enhancementStatus: EnhancementStatus;
  doseText: string;
  ester: TestosteroneEster;
  intervalWeeks: number;
}

/**
 * Seeds the form from the stored profile. Done once, when the editor opens,
 * rather than on every render — a background refetch landing mid-edit would
 * otherwise overwrite what the user is typing.
 */
function draftFromProfile(profile: CoachProfile | undefined): PlanDraft {
  const stated = profile?.enhancement ?? null;
  return {
    primaryGoal: profile?.primary_goal ?? null,
    physiqueTarget: profile?.physique_target ?? null,
    goalsNote: profile?.goals ?? '',
    trainingDays: profile?.training_days_per_week ?? 4,
    sessionMinutes: profile?.session_minutes ?? 60,
    experienceLevel: profile?.experience_level ?? null,
    priorities: profile?.priority_muscle_groups ?? [],
    limitations: (profile?.limitations ?? []).filter((item) =>
      PRESET_LIMITATION_VALUES.includes(item)
    ),
    // Anything the user wrote rather than picked comes back as the free-text
    // line it was typed on.
    limitationsNote: (profile?.limitations ?? [])
      .filter((item) => !PRESET_LIMITATION_VALUES.includes(item))
      .join(', '),
    enhancementStatus: stated?.status ?? 'natural',
    doseText:
      stated?.testosterone_mg_per_dose === undefined
        ? ''
        : String(stated.testosterone_mg_per_dose),
    ester: stated?.ester ?? 'enanthate',
    intervalWeeks: stated?.dose_interval_weeks ?? 1,
  };
}

function positiveNumberFrom(text: string): number | null {
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(parsed, MAX_TESTOSTERONE_MG_PER_DOSE);
}

/**
 * The stated training plan, on the web.
 *
 * Mobile asks the same questions as a six-step wizard; a page with room for
 * the whole form asks them at once. What must not differ is the patch: one
 * PATCH carrying every answer plus `plan_completed_at`, which is the only
 * thing that says the plan has been answered — a partially filled profile is
 * not a completed plan, and nothing infers completion from the fields.
 */
const TrainingPlanCard: React.FC = () => {
  const { t } = useTranslation();
  const available = useCoachingContextAvailable();

  const { data: profile } = useCoachProfile(available);
  const { data: weeklyTargets } = useWeeklySetTargets(available);
  const { mutate: savePlan, isPending: isSaving } =
    useSaveTrainingPlanMutation();
  const { mutate: clearTargets } = useClearWeeklySetTargetsMutation();

  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [confirmingReplace, setConfirmingReplace] = useState(false);

  if (!available) return null;

  const edit = (patch: Partial<PlanDraft>) =>
    setDraft((current) =>
      current === null ? current : { ...current, ...patch }
    );

  const togglePriority = (group: MuscleGroupValue) => {
    setDraft((current) => {
      if (current === null) return current;
      if (current.priorities.includes(group)) {
        return {
          ...current,
          priorities: current.priorities.filter((item) => item !== group),
        };
      }
      // Capped rather than rejected: past two, each priority stops taking
      // share from the others, so the oldest pick drops out.
      const next = [...current.priorities, group];
      return {
        ...current,
        priorities: next.slice(
          Math.max(0, next.length - MAX_PRIORITY_MUSCLE_GROUPS)
        ),
      };
    });
  };

  const toggleLimitation = (value: string) => {
    setDraft((current) => {
      if (current === null) return current;
      return {
        ...current,
        limitations: current.limitations.includes(value)
          ? current.limitations.filter((item) => item !== value)
          : [...current.limitations, value],
      };
    });
  };

  const buildPatch = (current: PlanDraft) => {
    const isNatural = current.enhancementStatus === 'natural';
    const dose = isNatural ? null : positiveNumberFrom(current.doseText);
    // Shown for undecanoate, which is the ester long protocols use — and for a
    // profile that already states an interval, so reopening the form can never
    // quietly rewrite one the user gave.
    const usesInterval =
      !isNatural &&
      (current.ester === 'undecanoate' || current.intervalWeeks !== 1);
    const extras = current.limitationsNote
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    return {
      primary_goal: current.primaryGoal,
      physique_target: current.physiqueTarget,
      goals:
        current.goalsNote.trim().length > 0 ? current.goalsNote.trim() : null,
      training_days_per_week: current.trainingDays,
      session_minutes: current.sessionMinutes,
      experience_level: current.experienceLevel,
      priority_muscle_groups: current.priorities,
      limitations: [...current.limitations, ...extras],
      enhancement: isNatural
        ? { status: 'natural' as const }
        : {
            status: current.enhancementStatus,
            ...(dose === null ? {} : { testosterone_mg_per_dose: dose }),
            ...(dose !== null && usesInterval
              ? { dose_interval_weeks: current.intervalWeeks }
              : {}),
            ...(dose === null ? {} : { ester: current.ester }),
          },
    };
  };

  const writePlan = (alsoClearTargets: boolean) => {
    if (draft === null) return;
    setConfirmingReplace(false);
    savePlan(buildPatch(draft), {
      onSuccess: () => {
        // The plan only reaches the ring once the hand-set overrides are out
        // of the way; a merge cannot remove them, so this is a separate verb.
        if (alsoClearTargets) clearTargets();
        setDraft(null);
      },
    });
  };

  const handleSave = () => {
    // A target set by hand months ago silently overrides everything the new
    // plan derives, so the ring would keep showing the old number while every
    // other surface moved. Asking is the only honest way through it.
    if (weeklyTargets?.targets_are_custom === true) {
      setConfirmingReplace(true);
      return;
    }
    writePlan(false);
  };

  const answered = profile !== undefined && profile.plan_completed_at !== null;

  const summaryLine = (): string => {
    const parts: string[] = [];
    if (profile?.primary_goal) {
      parts.push(primaryGoalLabel(t, profile.primary_goal));
    }
    if (profile?.physique_target) {
      parts.push(physiqueLabel(t, profile.physique_target));
    }
    if (
      profile?.training_days_per_week !== null &&
      profile?.training_days_per_week !== undefined
    ) {
      parts.push(
        t('trainingPlan.daysSummary', {
          count: profile.training_days_per_week,
          defaultValue: '{{count}} days a week',
        })
      );
    }
    if (profile?.experience_level) {
      parts.push(experienceLabel(t, profile.experience_level));
    }
    return parts.join(' · ');
  };

  const renderEditor = (current: PlanDraft) => {
    const derived = deriveDefaultWeeklySetTargets({
      trainingDaysPerWeek: current.trainingDays,
      primaryGoal: current.primaryGoal,
      physiqueTarget: current.physiqueTarget,
      experienceLevel: current.experienceLevel,
      priorityGroups: current.priorities,
    });
    const isNatural = current.enhancementStatus === 'natural';
    const showsInterval =
      !isNatural &&
      (current.ester === 'undecanoate' || current.intervalWeeks !== 1);

    return (
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="training-plan-goal">
              {t('trainingPlan.goalLabel', 'What are you training for?')}
            </Label>
            <Select
              value={current.primaryGoal ?? UNSET}
              onValueChange={(value) =>
                edit({
                  primaryGoal: value === UNSET ? null : (value as PrimaryGoal),
                })
              }
            >
              <SelectTrigger id="training-plan-goal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>
                  {t('trainingPlan.unset', 'Not set')}
                </SelectItem>
                {PRIMARY_GOALS.map((goal) => (
                  <SelectItem key={goal} value={goal}>
                    {primaryGoalLabel(t, goal)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="training-plan-physique">
              {t('trainingPlan.physiqueLabel', 'What are you building toward?')}
            </Label>
            <Select
              value={current.physiqueTarget ?? UNSET}
              onValueChange={(value) =>
                edit({
                  physiqueTarget:
                    value === UNSET ? null : (value as PhysiqueTarget),
                })
              }
            >
              <SelectTrigger id="training-plan-physique">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>
                  {t('trainingPlan.unset', 'Not set')}
                </SelectItem>
                {PHYSIQUE_TARGETS.map((target) => (
                  <SelectItem key={target} value={target}>
                    {physiqueLabel(t, target)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="training-plan-experience">
              {t('trainingPlan.experienceLabel', 'How long have you trained?')}
            </Label>
            <Select
              value={current.experienceLevel ?? UNSET}
              onValueChange={(value) =>
                edit({
                  experienceLevel:
                    value === UNSET ? null : (value as ExperienceLevel),
                })
              }
            >
              <SelectTrigger id="training-plan-experience">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>
                  {t('trainingPlan.unset', 'Not set')}
                </SelectItem>
                {EXPERIENCE_LEVELS.map((level) => (
                  <SelectItem key={level} value={level}>
                    {experienceLabel(t, level)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="training-plan-days">
                {t('trainingPlan.daysPerWeek', 'Training days a week')}
              </Label>
              <Input
                id="training-plan-days"
                type="number"
                min={MIN_TRAINING_DAYS}
                max={MAX_TRAINING_DAYS}
                value={current.trainingDays}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  if (!Number.isFinite(parsed)) return;
                  edit({
                    trainingDays: Math.max(
                      MIN_TRAINING_DAYS,
                      Math.min(MAX_TRAINING_DAYS, Math.round(parsed))
                    ),
                  });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="training-plan-minutes">
                {t('trainingPlan.sessionMinutes', 'Minutes a session')}
              </Label>
              <Input
                id="training-plan-minutes"
                type="number"
                min={MIN_SESSION_MINUTES}
                max={MAX_SESSION_MINUTES}
                step={5}
                value={current.sessionMinutes}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  if (!Number.isFinite(parsed)) return;
                  edit({
                    sessionMinutes: Math.max(
                      MIN_SESSION_MINUTES,
                      Math.min(MAX_SESSION_MINUTES, Math.round(parsed))
                    ),
                  });
                }}
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>
            {t('trainingPlan.priorityLabel', 'Anything to prioritise?')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t(
              'trainingPlan.priorityHint',
              'Up to two. A priority group takes volume from the others, so past two nothing is prioritised.'
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {MUSCLE_GROUPS.map((group) => {
              const selected = current.priorities.includes(group);
              return (
                <Button
                  key={group}
                  type="button"
                  size="sm"
                  variant={selected ? 'default' : 'outline'}
                  aria-pressed={selected}
                  onClick={() => togglePriority(group)}
                >
                  {groupLabel(t, group)}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label>
            {t('trainingPlan.limitationsLabel', 'Anything to work around?')}
          </Label>
          <div className="flex flex-wrap gap-2">
            {LIMITATION_PRESETS.map((preset) => {
              const selected = current.limitations.includes(preset.value);
              return (
                <Button
                  key={preset.key}
                  type="button"
                  size="sm"
                  variant={selected ? 'default' : 'outline'}
                  aria-pressed={selected}
                  onClick={() => toggleLimitation(preset.value)}
                >
                  {limitationLabel(t, preset.key)}
                </Button>
              );
            })}
          </div>
          <Input
            id="training-plan-limitations-note"
            value={current.limitationsNote}
            onChange={(event) => edit({ limitationsNote: event.target.value })}
            placeholder={t(
              'trainingPlan.limitationsNotePlaceholder',
              'Anything else, separated by commas'
            )}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="training-plan-notes">
            {t('trainingPlan.notesLabel', 'Anything else worth knowing?')}
          </Label>
          <Textarea
            id="training-plan-notes"
            value={current.goalsNote}
            onChange={(event) => edit({ goalsNote: event.target.value })}
            placeholder={t(
              'trainingPlan.notesPlaceholder',
              'A race you are training for, a lift you want back, anything the plan should account for.'
            )}
          />
        </div>

        <div className="space-y-2 rounded-lg border p-3">
          <Label htmlFor="training-plan-enhancement">
            {t('trainingPlan.enhancementLabel', 'Are you on testosterone?')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t(
              'trainingPlan.enhancementHint',
              'Only used to estimate what your training can add. It is never sent to the AI coach.'
            )}
          </p>
          <Select
            value={current.enhancementStatus}
            onValueChange={(value) =>
              edit({ enhancementStatus: value as EnhancementStatus })
            }
          >
            <SelectTrigger id="training-plan-enhancement">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENHANCEMENT_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {enhancementLabel(t, status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {!isNatural && (
            <div className="grid gap-4 sm:grid-cols-2 pt-2">
              <div className="space-y-2">
                <Label htmlFor="training-plan-dose">
                  {t('trainingPlan.doseLabel', 'Milligrams per injection')}
                </Label>
                <Input
                  id="training-plan-dose"
                  type="number"
                  min={0}
                  max={MAX_TESTOSTERONE_MG_PER_DOSE}
                  value={current.doseText}
                  onChange={(event) => edit({ doseText: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="training-plan-ester">
                  {t('trainingPlan.esterLabel', 'Ester')}
                </Label>
                <Select
                  value={current.ester}
                  onValueChange={(value) => {
                    const ester = value as TestosteroneEster;
                    edit({
                      ester,
                      // A long ester is not injected weekly, so switching to
                      // one without moving the interval would store a protocol
                      // nobody runs.
                      ...(ester === 'undecanoate' && current.intervalWeeks === 1
                        ? { intervalWeeks: DEFAULT_UNDECANOATE_INTERVAL_WEEKS }
                        : {}),
                    });
                  }}
                >
                  <SelectTrigger id="training-plan-ester">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TESTOSTERONE_ESTERS.map((ester) => (
                      <SelectItem key={ester} value={ester}>
                        {esterLabel(t, ester)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {showsInterval && (
                <div className="space-y-2">
                  <Label htmlFor="training-plan-interval">
                    {t('trainingPlan.intervalLabel', 'How often?')}
                  </Label>
                  <Select
                    value={String(current.intervalWeeks)}
                    onValueChange={(value) =>
                      edit({ intervalWeeks: Number(value) })
                    }
                  >
                    <SelectTrigger id="training-plan-interval">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DOSE_INTERVAL_WEEKS.map((weeks) => (
                        <SelectItem key={weeks} value={String(weeks)}>
                          {t('trainingPlan.everyWeeks', {
                            count: weeks,
                            defaultValue: 'Every {{count}} weeks',
                          })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">
            {t('trainingPlan.derivedTitle', 'Your weekly set targets')}
          </p>
          <ul
            className="flex flex-wrap gap-2"
            data-testid="training-plan-derived"
          >
            {MUSCLE_GROUPS.map((group) => (
              <li key={group} className="rounded-lg border px-3 py-2 text-sm">
                <span className="font-medium">{groupLabel(t, group)}</span>{' '}
                <span className="text-muted-foreground">
                  {t('trainingPlan.setsPerWeek', {
                    count: derived[group],
                    defaultValue: '{{count}} sets / week',
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving
              ? t('common.saving', 'Saving…')
              : t('trainingPlan.savePlan', 'Save my plan')}
          </Button>
          <Button variant="outline" onClick={() => setDraft(null)}>
            {t('common.cancel', 'Cancel')}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Card data-testid="training-plan-card">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl sm:text-2xl font-bold tracking-tight">
          {t('trainingPlan.cardTitle', 'Training plan')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t(
            'trainingPlan.cardDescription',
            'What you are training for, and what the weekly targets are built from.'
          )}
        </p>
      </CardHeader>
      <CardContent>
        {draft !== null ? (
          renderEditor(draft)
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {answered
                ? summaryLine()
                : t(
                    'trainingPlan.unanswered',
                    'Not set yet — your targets are a default based on how often you train.'
                  )}
            </p>
            <Button
              variant={answered ? 'outline' : 'default'}
              onClick={() => setDraft(draftFromProfile(profile))}
            >
              {answered
                ? t('trainingPlan.editPlan', 'Edit plan')
                : t('trainingPlan.setUpRow', 'Set up your training plan')}
            </Button>
          </div>
        )}
      </CardContent>

      <ConfirmationDialog
        open={confirmingReplace}
        onOpenChange={setConfirmingReplace}
        title={t(
          'trainingPlan.replaceTargetsTitle',
          'Use the plan’s set targets?'
        )}
        description={t(
          'trainingPlan.replaceTargetsMessage',
          'You have set weekly set targets by hand. They will keep overriding this plan unless you replace them.'
        )}
        confirmLabel={t('trainingPlan.usePlanTargets', 'Use the plan')}
        secondaryActionLabel={t('trainingPlan.keepMyTargets', 'Keep mine')}
        onSecondaryAction={() => writePlan(false)}
        onConfirm={() => writePlan(true)}
      />
    </Card>
  );
};

export default TrainingPlanCard;
