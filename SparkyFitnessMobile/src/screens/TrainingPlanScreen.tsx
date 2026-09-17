import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import Button from '../components/ui/Button';
import FormInput from '../components/FormInput';
import Icon from '../components/Icon';
import SettingsRow, { SettingsRowGroup } from '../components/SettingsRow';
import StepperInput, { useStepperDraft } from '../components/StepperInput';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { usePreferences } from '../hooks';
import {
  useCoachProfile,
  useUpdateCoachProfile,
  type CoachProfile,
} from '../hooks/useCoachProfile';
import { useLatestCheckIn } from '../hooks/useLatestCheckIn';
import { useMuscleGainProjection } from '../hooks/useMuscleGainProjection';
import { useProfile } from '../hooks/useProfile';
import { clearWeeklySetTargets } from '../services/api/weeklySetTargetsApi';
import {
  WEEKLY_SET_HISTORY_WEEKS,
  useWeeklySetTargets,
} from '../hooks/useWeeklySetTargets';
import {
  muscleGainProjectionRootQueryKey,
  weeklySetTargetsQueryKey,
  weeklySetTargetsRootQueryKey,
  workoutRecommendationQueryKey,
} from '../hooks/queryKeys';
import { weightFromKg } from '../utils/unitConversions';
import { formatLocalizedNumber } from '../localization/i18n';
import { normalizeWeightUnit } from '../utils/workoutSession';
import { addLog } from '../services/LogService';
import type { RootStackScreenProps } from '../types/navigation';

import {
  ENHANCEMENT_STATUSES,
  EXPERIENCE_LEVELS,
  MAX_PRIORITY_MUSCLE_GROUPS,
  MUSCLE_GROUPS,
  PHYSIQUE_TARGETS,
  PRIMARY_GOALS,
  TESTOSTERONE_ESTERS,
  deriveDefaultWeeklySetTargets,
  type EnhancementStatus,
  type ExperienceLevel,
  type MuscleGroup,
  type PhysiqueTarget,
  type PrimaryGoal,
  type TestosteroneEster,
} from '@workspace/shared';

type TrainingPlanScreenProps = RootStackScreenProps<'TrainingPlan'>;

const TOTAL_STEPS = 6;

/**
 * The review step, for callers that want to land on it — the Exercise tab's
 * projection card opens the plan here. Exported so the step number lives in
 * one place; a seventh question would otherwise move the review out from under
 * every deep link to it.
 */
export const TRAINING_PLAN_REVIEW_STEP = TOTAL_STEPS;

const MIN_TRAINING_DAYS = 1;
const MAX_TRAINING_DAYS = 7;
const MIN_SESSION_MINUTES = 20;
const MAX_SESSION_MINUTES = 120;
const SESSION_MINUTES_STEP = 5;

/**
 * Intervals the questionnaire offers, in weeks.
 *
 * Only shown for undecanoate, which is the ester long protocols actually use
 * (Nebido is 1000 mg every 10-14 weeks). Every other ester defaults to weekly,
 * which is what the field means when no interval is stated.
 */
const DOSE_INTERVAL_WEEKS = [1, 2, 3, 4, 6, 8, 10, 12, 14] as const;
const DEFAULT_UNDECANOATE_INTERVAL_WEEKS = 10;

/**
 * Limitations the chips offer, stored as the English phrases they read as.
 *
 * `coach_profiles.limitations` is free text that the chat coach also writes and
 * reads back in prose, so a slug vocabulary here would either be meaningless to
 * the model or need a second translation layer. Canonical storage stays
 * literal; only the chip labels are localized.
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
      return t('trainingPlan.goal.buildMuscle', {
        defaultValue: 'Build muscle',
      });
    case 'lose_fat':
      return t('trainingPlan.goal.loseFat', { defaultValue: 'Lose fat' });
    case 'recomp':
      return t('trainingPlan.goal.recomp', {
        defaultValue: 'Build muscle and lose fat',
      });
    case 'strength':
      return t('trainingPlan.goal.strength', { defaultValue: 'Get stronger' });
    case 'general_fitness':
      return t('trainingPlan.goal.generalFitness', {
        defaultValue: 'Stay generally fit',
      });
  }
}

function primaryGoalDetail(t: TFunction, goal: PrimaryGoal): string {
  switch (goal) {
    case 'build_muscle':
      return t('trainingPlan.goalDetail.buildMuscle', {
        defaultValue: 'Full volume, rep ranges built for size.',
      });
    case 'lose_fat':
      return t('trainingPlan.goalDetail.loseFat', {
        defaultValue: 'Slightly less volume, more core work.',
      });
    case 'recomp':
      return t('trainingPlan.goalDetail.recomp', {
        defaultValue:
          'Trained like a muscle-building block, eaten differently.',
      });
    case 'strength':
      return t('trainingPlan.goalDetail.strength', {
        defaultValue: 'Fewer, heavier sets on the main lifts.',
      });
    case 'general_fitness':
      return t('trainingPlan.goalDetail.generalFitness', {
        defaultValue: 'A lighter, sustainable week.',
      });
  }
}

function physiqueLabel(t: TFunction, target: PhysiqueTarget): string {
  switch (target) {
    case 'lean':
      return t('trainingPlan.physique.lean', { defaultValue: 'Lean' });
    case 'athletic':
      return t('trainingPlan.physique.athletic', { defaultValue: 'Athletic' });
    case 'muscular':
      return t('trainingPlan.physique.muscular', { defaultValue: 'Muscular' });
    case 'powerful':
      return t('trainingPlan.physique.powerful', { defaultValue: 'Powerful' });
    case 'maintain':
      return t('trainingPlan.physique.maintain', {
        defaultValue: 'Keep what I have',
      });
  }
}

function experienceLabel(t: TFunction, level: ExperienceLevel): string {
  switch (level) {
    case 'beginner':
      return t('trainingPlan.experience.beginner', {
        defaultValue: 'Beginner',
      });
    case 'intermediate':
      return t('trainingPlan.experience.intermediate', {
        defaultValue: 'Intermediate',
      });
    case 'expert':
      return t('trainingPlan.experience.expert', { defaultValue: 'Advanced' });
  }
}

function experienceDetail(t: TFunction, level: ExperienceLevel): string {
  switch (level) {
    case 'beginner':
      return t('trainingPlan.experienceDetail.beginner', {
        defaultValue: 'Under a year of consistent lifting.',
      });
    case 'intermediate':
      return t('trainingPlan.experienceDetail.intermediate', {
        defaultValue: 'A year or two in, still adding weight.',
      });
    case 'expert':
      return t('trainingPlan.experienceDetail.expert', {
        defaultValue: 'Several years, progress comes slowly.',
      });
  }
}

function groupLabel(t: TFunction, group: MuscleGroup): string {
  switch (group) {
    case 'push':
      return t('weeklySetTargets.groups.push', {
        defaultValue: 'Push Muscles',
      });
    case 'pull':
      return t('weeklySetTargets.groups.pull', {
        defaultValue: 'Pull Muscles',
      });
    case 'legs':
      return t('weeklySetTargets.groups.legs', { defaultValue: 'Leg Muscles' });
    case 'core':
      return t('weeklySetTargets.groups.core', {
        defaultValue: 'Core Muscles',
      });
  }
}

function enhancementLabel(t: TFunction, status: EnhancementStatus): string {
  switch (status) {
    case 'natural':
      return t('trainingPlan.enhancement.natural', { defaultValue: 'Natural' });
    case 'trt':
      return t('trainingPlan.enhancement.trt', {
        defaultValue: 'Testosterone replacement',
      });
    case 'enhanced':
      return t('trainingPlan.enhancement.enhanced', {
        defaultValue: 'Above replacement',
      });
  }
}

function esterLabel(t: TFunction, ester: TestosteroneEster): string {
  switch (ester) {
    case 'enanthate':
      return t('trainingPlan.ester.enanthate', { defaultValue: 'Enanthate' });
    case 'cypionate':
      return t('trainingPlan.ester.cypionate', { defaultValue: 'Cypionate' });
    case 'propionate':
      return t('trainingPlan.ester.propionate', { defaultValue: 'Propionate' });
    case 'undecanoate':
      return t('trainingPlan.ester.undecanoate', {
        defaultValue: 'Undecanoate (Nebido)',
      });
    case 'other':
      return t('trainingPlan.ester.other', { defaultValue: 'Something else' });
  }
}

function limitationLabel(
  t: TFunction,
  key: (typeof LIMITATION_PRESETS)[number]['key']
): string {
  switch (key) {
    case 'shoulder':
      return t('trainingPlan.limitation.shoulder', {
        defaultValue: 'Shoulder pain',
      });
    case 'knee':
      return t('trainingPlan.limitation.knee', { defaultValue: 'Knee pain' });
    case 'lowerBack':
      return t('trainingPlan.limitation.lowerBack', {
        defaultValue: 'Lower back pain',
      });
    case 'wrist':
      return t('trainingPlan.limitation.wrist', { defaultValue: 'Wrist pain' });
    case 'noOverhead':
      return t('trainingPlan.limitation.noOverhead', {
        defaultValue: 'No overhead pressing',
      });
  }
}

/** Whole years between a stored `YYYY-MM-DD` birth date and today. */
function ageFromBirthDate(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const [year, month, day] = birthDate.split('-').map(Number);
  if (!year || !month || !day) return null;
  const now = new Date();
  let age = now.getFullYear() - year;
  const beforeBirthday =
    now.getMonth() + 1 < month ||
    (now.getMonth() + 1 === month && now.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** A numeric text field's value, or null when it is empty or unusable. */
function positiveNumberFrom(text: string): number | null {
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The stored profile rendered in the same shape the draft patch takes, so the
 * two can be compared for "is what is on screen what is saved".
 *
 * Kept next to the patch it mirrors: any field added to one has to be added to
 * the other, or step 6 starts showing a projection for answers the server has
 * never seen.
 */
function storedSignature(profile: CoachProfile): string {
  const stored = profile.enhancement;
  return JSON.stringify({
    primary_goal: profile.primary_goal,
    physique_target: profile.physique_target,
    goals:
      profile.goals !== null && profile.goals.length > 0 ? profile.goals : null,
    training_days_per_week: profile.training_days_per_week,
    session_minutes: profile.session_minutes,
    experience_level: profile.experience_level,
    priority_muscle_groups: profile.priority_muscle_groups ?? [],
    limitations: profile.limitations,
    // A profile that has never stated one means the same thing as `natural`,
    // which is what the questionnaire opens on.
    enhancement: stored ?? { status: 'natural' },
  });
}

const TrainingPlanScreen: React.FC<TrainingPlanScreenProps> = ({
  navigation,
  route,
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const usesNativeHeader = useNativeIOSHeadersActive();
  const queryClient = useQueryClient();

  const accentColor = useCSSVariable('--color-accent-primary') as string;
  const mutedColor = useCSSVariable('--color-text-muted') as string;

  const { data: profile, isLoading } = useCoachProfile();
  const { profile: identity } = useProfile();
  const { measurement } = useLatestCheckIn();
  const { data: weeklyTargets } = useWeeklySetTargets();
  const updateProfile = useUpdateCoachProfile();
  const { preferences } = usePreferences();
  const weightUnit = normalizeWeightUnit(preferences?.default_weight_unit);

  const [step, setStep] = useState(route.params?.initialStep ?? 1);
  const [saving, setSaving] = useState(false);
  /**
   * What the last successful save wrote, so step 6 can tell "this is your
   * plan" from "this is a draft you have not saved yet" without re-reading a
   * cache the mutation has already updated.
   */
  const [savedSignature, setSavedSignature] = useState<string | null>(null);

  // The draft. Seeded once from the loaded profile: re-seeding on every render
  // would fight the user's edits as soon as the focus refetch lands.
  const [seeded, setSeeded] = useState(false);
  const [primaryGoal, setPrimaryGoal] = useState<PrimaryGoal | null>(null);
  const [physiqueTarget, setPhysiqueTarget] = useState<PhysiqueTarget | null>(
    null
  );
  const [goalsNote, setGoalsNote] = useState('');
  const [trainingDays, setTrainingDays] = useState(4);
  const [sessionMinutes, setSessionMinutes] = useState(60);
  const [experienceLevel, setExperienceLevel] =
    useState<ExperienceLevel | null>(null);
  const [priorities, setPriorities] = useState<MuscleGroup[]>([]);
  const [limitations, setLimitations] = useState<string[]>([]);
  const [limitationsNote, setLimitationsNote] = useState('');
  const [enhancementStatus, setEnhancementStatus] =
    useState<EnhancementStatus>('natural');
  const [doseText, setDoseText] = useState('');
  const [ester, setEster] = useState<TestosteroneEster>('enanthate');
  const [intervalWeeks, setIntervalWeeks] = useState(1);

  if (!seeded && profile !== undefined) {
    setSeeded(true);
    setPrimaryGoal(profile.primary_goal);
    setPhysiqueTarget(profile.physique_target);
    setGoalsNote(profile.goals ?? '');
    if (profile.training_days_per_week !== null) {
      setTrainingDays(profile.training_days_per_week);
    }
    if (profile.session_minutes !== null) {
      setSessionMinutes(profile.session_minutes);
    }
    setExperienceLevel(profile.experience_level);
    setPriorities(profile.priority_muscle_groups ?? []);
    setLimitations(
      profile.limitations.filter((item) =>
        PRESET_LIMITATION_VALUES.includes(item)
      )
    );
    setLimitationsNote(
      profile.limitations
        .filter((item) => !PRESET_LIMITATION_VALUES.includes(item))
        .join(', ')
    );
    const stated = profile.enhancement;
    if (stated) {
      setEnhancementStatus(stated.status);
      if (stated.testosterone_mg_per_dose !== undefined) {
        setDoseText(String(stated.testosterone_mg_per_dose));
      }
      if (stated.ester !== undefined) setEster(stated.ester);
      if (stated.dose_interval_weeks !== undefined) {
        setIntervalWeeks(stated.dose_interval_weeks);
      }
    }
  }

  const daysDraft = useStepperDraft({
    value: trainingDays,
    min: MIN_TRAINING_DAYS,
    max: MAX_TRAINING_DAYS,
    onCommit: setTrainingDays,
  });
  const minutesDraft = useStepperDraft({
    value: sessionMinutes,
    min: MIN_SESSION_MINUTES,
    max: MAX_SESSION_MINUTES,
    step: SESSION_MINUTES_STEP,
    onCommit: setSessionMinutes,
  });

  const isNatural = enhancementStatus === 'natural';
  const dosePerDose = isNatural ? null : positiveNumberFrom(doseText);
  // Shown for undecanoate, which is the ester long protocols use — and for a
  // profile that already states one, so re-opening the questionnaire can never
  // quietly rewrite an interval the user gave.
  const showsInterval =
    !isNatural && (ester === 'undecanoate' || intervalWeeks !== 1);

  const derivedTargets = deriveDefaultWeeklySetTargets({
    trainingDaysPerWeek: trainingDays,
    primaryGoal,
    physiqueTarget,
    experienceLevel,
    priorityGroups: priorities,
  });

  const enhancementPatch = isNatural
    ? { status: 'natural' as const }
    : {
        status: enhancementStatus,
        ...(dosePerDose === null
          ? {}
          : { testosterone_mg_per_dose: dosePerDose }),
        ...(dosePerDose !== null && showsInterval
          ? { dose_interval_weeks: intervalWeeks }
          : {}),
        ...(dosePerDose === null ? {} : { ester }),
      };

  const extraLimitations = limitationsNote
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const patch = {
    primary_goal: primaryGoal,
    physique_target: physiqueTarget,
    goals: goalsNote.trim().length > 0 ? goalsNote.trim() : null,
    training_days_per_week: trainingDays,
    session_minutes: sessionMinutes,
    experience_level: experienceLevel,
    priority_muscle_groups: priorities,
    limitations: [...limitations, ...extraLimitations],
    enhancement: enhancementPatch,
  };
  const signature = JSON.stringify(patch);

  // The projection is computed from the *stored* profile, so it can only be
  // shown once the draft on screen is the profile. Otherwise a user who had
  // just switched to "above replacement" would read an estimate that knows
  // nothing about it — and a projection that quietly answers a different
  // question than the one on screen is worse than no projection.
  const planIsSaved =
    savedSignature === signature ||
    (profile !== undefined &&
      profile.plan_completed_at !== null &&
      signature === storedSignature(profile));

  const { projection, isLoading: projectionLoading } = useMuscleGainProjection(
    12,
    step === TOTAL_STEPS && planIsSaved
  );

  const header = useScreenHeader({
    title: t('trainingPlan.stepTitle', {
      defaultValue: 'Training plan: Step {{step}} of {{total}}',
      step,
      total: TOTAL_STEPS,
    }),
    left: {
      kind: 'primary',
      label: t('common.back', { defaultValue: 'Back' }),
      onPress: () =>
        step > 1
          ? setStep((current: number) => current - 1)
          : navigation.goBack(),
    },
  });

  const togglePriority = (group: MuscleGroup) => {
    setPriorities((current) => {
      if (current.includes(group)) {
        return current.filter((item) => item !== group);
      }
      // Capped rather than rejected: past two, each priority stops taking
      // share from the others, so the oldest pick drops out.
      const next = [...current, group];
      return next.slice(Math.max(0, next.length - MAX_PRIORITY_MUSCLE_GROUPS));
    });
  };

  const toggleLimitation = (value: string) => {
    setLimitations((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  };

  const writePlan = async (alsoClearTargets: boolean) => {
    setSaving(true);
    try {
      await updateProfile.mutateAsync({
        ...patch,
        plan_completed_at: new Date().toISOString(),
      });
      if (alsoClearTargets) {
        const cleared = await clearWeeklySetTargets(WEEKLY_SET_HISTORY_WEEKS);
        queryClient.setQueryData(
          weeklySetTargetsQueryKey(WEEKLY_SET_HISTORY_WEEKS),
          cleared
        );
      }
      setSavedSignature(signature);
      // The plan changes what the ring derives and what the next generate
      // reads; the stored workout deliberately stays put until regenerated,
      // but its card has to stop claiming the old plan produced it.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: weeklySetTargetsRootQueryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: workoutRecommendationQueryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: muscleGainProjectionRootQueryKey,
        }),
      ]);
    } catch (error) {
      addLog(
        'Failed to save training plan',
        'ERROR',
        error instanceof Error ? [error.message] : undefined
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    // A target set by hand months ago silently overrides everything the new
    // plan derives, so the ring would keep showing the old number while every
    // other surface moved. Asking is the only honest way through it.
    if (weeklyTargets?.targets_are_custom === true) {
      Alert.alert(
        t('trainingPlan.replaceTargetsTitle', {
          defaultValue: 'Use the plan’s set targets?',
        }),
        t('trainingPlan.replaceTargetsMessage', {
          defaultValue:
            'You have set weekly set targets by hand. They will keep overriding this plan unless you replace them.',
        }),
        [
          {
            text: t('trainingPlan.keepMyTargets', {
              defaultValue: 'Keep mine',
            }),
            onPress: () => void writePlan(false),
          },
          {
            text: t('trainingPlan.usePlanTargets', {
              defaultValue: 'Use the plan',
            }),
            onPress: () => void writePlan(true),
          },
        ]
      );
      return;
    }
    void writePlan(false);
  };

  const bodyweightKg = measurement?.weight ?? null;
  const age = ageFromBirthDate(identity?.date_of_birth);

  const renderRadioRow = <T extends string>(
    value: T,
    selected: T | null,
    title: string,
    subtitle: string | undefined,
    onPress: () => void,
    testID: string
  ) => (
    <SettingsRow
      key={value}
      title={title}
      subtitle={subtitle}
      subtitleNumberOfLines={0}
      onPress={onPress}
      testID={testID}
      rightAccessory={
        <Icon
          name={selected === value ? 'radio-button-on' : 'radio-button-off'}
          size={24}
          color={selected === value ? accentColor : mutedColor}
        />
      }
    />
  );

  return (
    <View
      className="flex-1 bg-background"
      style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
    >
      {header}
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 100,
        }}
        contentInsetAdjustmentBehavior={
          usesNativeHeader ? 'automatic' : 'never'
        }
      >
        {step === 1 && (
          <View className="gap-4">
            <Text className="text-xl font-bold text-text-primary">
              {t('trainingPlan.aboutTitle', { defaultValue: 'About you' })}
            </Text>
            <Text className="text-sm text-text-secondary">
              {t('trainingPlan.aboutDescription', {
                defaultValue:
                  'What the plan already knows from your profile and check-ins. Nothing on this step is saved here.',
              })}
            </Text>
            <SettingsRowGroup>
              <SettingsRow
                title={t('trainingPlan.aboutSex', { defaultValue: 'Sex' })}
                subtitle={
                  identity?.gender === 'male'
                    ? t('trainingPlan.sexMale', { defaultValue: 'Male' })
                    : identity?.gender === 'female'
                      ? t('trainingPlan.sexFemale', { defaultValue: 'Female' })
                      : t('trainingPlan.notStated', {
                          defaultValue: 'Not stated',
                        })
                }
                testID="training-plan-about-sex"
              />
              <SettingsRow
                title={t('trainingPlan.aboutAge', { defaultValue: 'Age' })}
                subtitle={
                  age === null
                    ? t('trainingPlan.notStated', {
                        defaultValue: 'Not stated',
                      })
                    : t('trainingPlan.years', {
                        count: age,
                        formattedCount: formatLocalizedNumber(age),
                        defaultValue: '{{formattedCount}} years',
                        defaultValue_one: '{{formattedCount}} year',
                        defaultValue_other: '{{formattedCount}} years',
                      })
                }
                testID="training-plan-about-age"
              />
              <SettingsRow
                title={t('trainingPlan.aboutWeight', {
                  defaultValue: 'Weight',
                })}
                subtitle={
                  bodyweightKg === null || bodyweightKg === undefined
                    ? t('trainingPlan.noWeighIn', {
                        defaultValue: 'No weigh-in yet',
                      })
                    : `${formatLocalizedNumber(weightFromKg(bodyweightKg, weightUnit), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${weightUnit}`
                }
                onPress={() => navigation.navigate('MeasurementsAdd')}
                testID="training-plan-about-weight"
              />
              <SettingsRow
                title={t('trainingPlan.aboutBodyFat', {
                  defaultValue: 'Body fat',
                })}
                subtitle={
                  measurement?.body_fat_percentage === null ||
                  measurement?.body_fat_percentage === undefined
                    ? t('trainingPlan.notStated', {
                        defaultValue: 'Not stated',
                      })
                    : `${formatLocalizedNumber(measurement.body_fat_percentage)}%`
                }
                onPress={() => navigation.navigate('MeasurementsAdd')}
                testID="training-plan-about-body-fat"
              />
            </SettingsRowGroup>
            <Text className="text-xs text-text-muted">
              {t('trainingPlan.aboutUsage', {
                defaultValue:
                  'Your sex and your latest weigh-in are what the gain estimate is built from. Age and body fat are shown for context only.',
              })}
            </Text>
          </View>
        )}

        {step === 2 && (
          <View className="gap-4">
            <Text className="text-xl font-bold text-text-primary">
              {t('trainingPlan.goalTitle', {
                defaultValue: 'What are you training for?',
              })}
            </Text>
            <SettingsRowGroup>
              {PRIMARY_GOALS.map((goal) =>
                renderRadioRow(
                  goal,
                  primaryGoal,
                  primaryGoalLabel(t, goal),
                  primaryGoalDetail(t, goal),
                  () => setPrimaryGoal(goal),
                  `training-plan-goal-${goal}`
                )
              )}
            </SettingsRowGroup>

            <Text className="mt-2 text-base font-semibold text-text-primary">
              {t('trainingPlan.physiqueTitle', {
                defaultValue: 'What do you want to look like?',
              })}
            </Text>
            <SettingsRowGroup>
              {PHYSIQUE_TARGETS.map((target) =>
                renderRadioRow(
                  target,
                  physiqueTarget,
                  physiqueLabel(t, target),
                  undefined,
                  () => setPhysiqueTarget(target),
                  `training-plan-physique-${target}`
                )
              )}
            </SettingsRowGroup>

            <Text className="mt-2 text-base font-semibold text-text-primary">
              {t('trainingPlan.notesTitle', {
                defaultValue: 'Anything else worth knowing?',
              })}
            </Text>
            <FormInput
              multiline
              value={goalsNote}
              onChangeText={setGoalsNote}
              placeholder={t('trainingPlan.notesPlaceholder', {
                defaultValue:
                  'A race you are training for, a lift you want back, anything the plan should account for.',
              })}
              style={{ minHeight: 96, textAlignVertical: 'top' }}
              testID="training-plan-notes"
            />
          </View>
        )}

        {step === 3 && (
          <View className="gap-4">
            <Text className="text-xl font-bold text-text-primary">
              {t('trainingPlan.scheduleTitle', {
                defaultValue: 'How do you train?',
              })}
            </Text>
            <SettingsRowGroup>
              <SettingsRow
                title={t('trainingPlan.daysPerWeek', {
                  defaultValue: 'Days per week',
                })}
                rightAccessory={<StepperInput {...daysDraft} />}
              />
              <SettingsRow
                title={t('trainingPlan.sessionMinutes', {
                  defaultValue: 'Minutes per session',
                })}
                rightAccessory={<StepperInput {...minutesDraft} />}
              />
            </SettingsRowGroup>

            <Text className="mt-2 text-base font-semibold text-text-primary">
              {t('trainingPlan.experienceTitle', {
                defaultValue: 'How long have you been lifting?',
              })}
            </Text>
            <SettingsRowGroup>
              {EXPERIENCE_LEVELS.map((level) =>
                renderRadioRow(
                  level,
                  experienceLevel,
                  experienceLabel(t, level),
                  experienceDetail(t, level),
                  () => setExperienceLevel(level),
                  `training-plan-experience-${level}`
                )
              )}
            </SettingsRowGroup>

            <Text className="mt-2 text-base font-semibold text-text-primary">
              {t('trainingPlan.priorityTitle', {
                defaultValue: 'Anything you want to bring up?',
              })}
            </Text>
            <Text className="text-sm text-text-secondary">
              {t('trainingPlan.priorityDescription', {
                defaultValue:
                  'Pick up to two. Extra volume for these comes out of the others, so picking everything picks nothing.',
              })}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {MUSCLE_GROUPS.map((group) => {
                const selected = priorities.includes(group);
                return (
                  <Pressable
                    key={group}
                    onPress={() => togglePriority(group)}
                    className={`rounded-full px-4 py-2 ${selected ? 'bg-accent-primary' : 'bg-surface'}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    testID={`training-plan-priority-${group}`}
                  >
                    <Text
                      className={
                        selected
                          ? 'text-sm font-semibold text-white'
                          : 'text-sm text-text-primary'
                      }
                    >
                      {groupLabel(t, group)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {step === 4 && (
          <View className="gap-4">
            <Text className="text-xl font-bold text-text-primary">
              {t('trainingPlan.limitationsTitle', {
                defaultValue: 'Anything the plan should work around?',
              })}
            </Text>
            <Text className="text-sm text-text-secondary">
              {t('trainingPlan.limitationsDescription', {
                defaultValue:
                  'Injuries and movements you would rather avoid. Leave it empty if nothing applies.',
              })}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {LIMITATION_PRESETS.map((preset) => {
                const selected = limitations.includes(preset.value);
                return (
                  <Pressable
                    key={preset.key}
                    onPress={() => toggleLimitation(preset.value)}
                    className={`rounded-full px-4 py-2 ${selected ? 'bg-accent-primary' : 'bg-surface'}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    testID={`training-plan-limitation-${preset.key}`}
                  >
                    <Text
                      className={
                        selected
                          ? 'text-sm font-semibold text-white'
                          : 'text-sm text-text-primary'
                      }
                    >
                      {limitationLabel(t, preset.key)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <FormInput
              multiline
              value={limitationsNote}
              onChangeText={setLimitationsNote}
              placeholder={t('trainingPlan.limitationsPlaceholder', {
                defaultValue: 'Anything else, separated by commas.',
              })}
              style={{ minHeight: 96, textAlignVertical: 'top' }}
              testID="training-plan-limitations-note"
            />
          </View>
        )}

        {step === 5 && (
          <View className="gap-4">
            <Text className="text-xl font-bold text-text-primary">
              {t('trainingPlan.enhancementTitle', {
                defaultValue: 'Are you on anything?',
              })}
            </Text>
            <Text className="text-sm text-text-secondary">
              {t('trainingPlan.enhancementDescription', {
                defaultValue:
                  'Only used to estimate what you could gain. It stays on your server and is never sent to the AI coach.',
              })}
            </Text>
            <SettingsRowGroup>
              {ENHANCEMENT_STATUSES.map((status) =>
                renderRadioRow(
                  status,
                  enhancementStatus,
                  enhancementLabel(t, status),
                  undefined,
                  () => setEnhancementStatus(status),
                  `training-plan-enhancement-${status}`
                )
              )}
            </SettingsRowGroup>

            {!isNatural && (
              <View className="gap-4">
                <Text className="text-base font-semibold text-text-primary">
                  {showsInterval
                    ? t('trainingPlan.dosePerInjection', {
                        defaultValue: 'Milligrams per injection',
                      })
                    : t('trainingPlan.dosePerWeek', {
                        defaultValue: 'Milligrams per week',
                      })}
                </Text>
                <FormInput
                  keyboardType="numeric"
                  value={doseText}
                  onChangeText={setDoseText}
                  placeholder={t('trainingPlan.dosePlaceholder', {
                    defaultValue: 'mg',
                  })}
                  testID="training-plan-dose"
                />

                <Text className="text-base font-semibold text-text-primary">
                  {t('trainingPlan.esterTitle', {
                    defaultValue: 'Which ester?',
                  })}
                </Text>
                <SettingsRowGroup>
                  {TESTOSTERONE_ESTERS.map((option) =>
                    renderRadioRow(
                      option,
                      ester,
                      esterLabel(t, option),
                      undefined,
                      () => {
                        setEster(option);
                        // Nebido is dosed every 10-14 weeks, so switching to it
                        // from a weekly ester should not leave the interval
                        // saying "weekly" under a four-figure dose.
                        if (option === 'undecanoate' && intervalWeeks === 1) {
                          setIntervalWeeks(DEFAULT_UNDECANOATE_INTERVAL_WEEKS);
                        }
                      },
                      `training-plan-ester-${option}`
                    )
                  )}
                </SettingsRowGroup>

                {showsInterval && (
                  <View className="gap-2">
                    <Text className="text-base font-semibold text-text-primary">
                      {t('trainingPlan.intervalTitle', {
                        defaultValue: 'How often?',
                      })}
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      {DOSE_INTERVAL_WEEKS.map((weeks) => {
                        const selected = intervalWeeks === weeks;
                        return (
                          <Pressable
                            key={weeks}
                            onPress={() => setIntervalWeeks(weeks)}
                            className={`rounded-full px-4 py-2 ${selected ? 'bg-accent-primary' : 'bg-surface'}`}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            testID={`training-plan-interval-${weeks}`}
                          >
                            <Text
                              className={
                                selected
                                  ? 'text-sm font-semibold text-white'
                                  : 'text-sm text-text-primary'
                              }
                            >
                              {t('trainingPlan.everyWeeks', {
                                count: weeks,
                                formattedCount: formatLocalizedNumber(weeks),
                                defaultValue: 'every {{formattedCount}} weeks',
                                defaultValue_one:
                                  'every {{formattedCount}} week',
                                defaultValue_other:
                                  'every {{formattedCount}} weeks',
                              })}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {step === TOTAL_STEPS && (
          <View className="gap-4">
            <Text className="text-xl font-bold text-text-primary">
              {t('trainingPlan.planTitle', { defaultValue: 'Your plan' })}
            </Text>
            <Text className="text-sm text-text-secondary">
              {t('trainingPlan.planDescription', {
                defaultValue:
                  'Weekly working sets per group, from your answers. You can still change any of them on the Weekly Set Targets screen.',
              })}
            </Text>
            <View className="rounded-2xl bg-surface p-4">
              {MUSCLE_GROUPS.map((group) => (
                <View
                  key={group}
                  className="flex-row items-center justify-between py-2"
                  testID={`training-plan-target-${group}`}
                >
                  <Text className="text-base text-text-primary">
                    {groupLabel(t, group)}
                  </Text>
                  <Text className="text-base font-semibold text-text-primary">
                    {t('trainingPlan.setsPerWeek', {
                      count: derivedTargets[group],
                      formattedCount: formatLocalizedNumber(
                        derivedTargets[group]
                      ),
                      defaultValue: '{{formattedCount}} sets / week',
                      defaultValue_one: '{{formattedCount}} set / week',
                      defaultValue_other: '{{formattedCount}} sets / week',
                    })}
                  </Text>
                </View>
              ))}
            </View>

            <Text className="mt-2 text-base font-semibold text-text-primary">
              {t('trainingPlan.projectionTitle', {
                defaultValue: 'What twelve weeks could add',
              })}
            </Text>
            <View
              className="rounded-2xl bg-surface p-4"
              testID="training-plan-projection"
            >
              {!planIsSaved ? (
                <Text className="text-sm text-text-secondary">
                  {t('trainingPlan.projectionNeedsSave', {
                    defaultValue:
                      'Save your plan to see what hitting these targets is worth.',
                  })}
                </Text>
              ) : projectionLoading || projection === undefined ? (
                <Text className="text-sm text-text-secondary">
                  {t('trainingPlan.projectionLoading', {
                    defaultValue: 'Working it out…',
                  })}
                </Text>
              ) : projection.projection.total_kg === null ? (
                <Text className="text-sm text-text-secondary">
                  {t('trainingPlan.projectionNoWeight', {
                    defaultValue:
                      'Log a weigh-in and the estimate can be built from it.',
                  })}
                </Text>
              ) : (
                <View className="gap-2">
                  <Text className="text-2xl font-bold text-text-primary">
                    {t('trainingPlan.projectionRange', {
                      defaultValue: '+{{low}}–{{high}} {{unit}} of lean mass',
                      low: formatLocalizedNumber(
                        weightFromKg(
                          projection.projection.total_kg.low_kg,
                          weightUnit
                        ),
                        { minimumFractionDigits: 1, maximumFractionDigits: 1 }
                      ),
                      high: formatLocalizedNumber(
                        weightFromKg(
                          projection.projection.total_kg.high_kg,
                          weightUnit
                        ),
                        { minimumFractionDigits: 1, maximumFractionDigits: 1 }
                      ),
                      unit: weightUnit,
                    })}
                  </Text>
                  <Text className="text-sm text-text-secondary">
                    {t('trainingPlan.projectionLeanMass', {
                      defaultValue:
                        'Lean mass, not scale weight — in a deficit you can gain all of it and weigh less.',
                    })}
                  </Text>
                  {projection.inputs.adherence_basis === 'no_history' ? (
                    <Text className="text-sm text-text-muted">
                      {t('trainingPlan.projectionNoHistory', {
                        defaultValue:
                          'Assumes you hit every target, because there is nothing logged yet to measure against.',
                      })}
                    </Text>
                  ) : (
                    <Text className="text-sm text-text-muted">
                      {t('trainingPlan.projectionAdherence', {
                        defaultValue:
                          'At the {{percent}}% of your targets you have been hitting.',
                        percent: formatLocalizedNumber(
                          Math.round(projection.inputs.adherence * 100)
                        ),
                      })}
                    </Text>
                  )}
                  <Text className="text-xs text-text-muted">
                    {t('trainingPlan.projectionEstimate', {
                      defaultValue:
                        'An estimate from published trials, not a promise.',
                    })}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: 16,
          paddingBottom: Math.max(insets.bottom, 16),
        }}
      >
        {step < TOTAL_STEPS ? (
          <Button
            variant="primary"
            onPress={() => setStep((current: number) => current + 1)}
            testID="training-plan-next"
          >
            {t('common.next', { defaultValue: 'Next' })}
          </Button>
        ) : (
          <Button
            variant="primary"
            onPress={handleSave}
            disabled={saving || isLoading}
            testID="training-plan-save"
          >
            {saving
              ? t('common.saving', { defaultValue: 'Saving…' })
              : planIsSaved
                ? t('common.done', { defaultValue: 'Done' })
                : t('trainingPlan.savePlan', { defaultValue: 'Save my plan' })}
          </Button>
        )}
      </View>
    </View>
  );
};

export default TrainingPlanScreen;
