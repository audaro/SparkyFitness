import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import type { ToolCallMessagePart } from '@assistant-ui/react-native';
import { useAui, useAuiState } from '@assistant-ui/react-native';
import { useCSSVariable } from 'uniwind';
import type { ProposedPresetExercise, ProposeWorkoutPresetInput } from '@workspace/shared';

import { usePreferences } from '../../hooks/usePreferences';
import { useCreateWorkoutPreset } from '../../hooks/useWorkoutPresetMutations';
import type { WorkoutPresetCreatePayload } from '../../services/api/workoutPresetsApi';
import { formatLocalizedNumber } from '../../localization';
import { weightFromKg } from '../../utils/unitConversions';
import { formatDuration, normalizeWeightUnit } from '../../utils/workoutSession';

/** An exercise is renderable once it has a name and at least one set. */
function isRenderable(exercise: Partial<ProposedPresetExercise> | undefined): exercise is ProposedPresetExercise {
  return (
    !!exercise?.exercise_name &&
    !!exercise.exercise_id &&
    Array.isArray(exercise.sets) &&
    exercise.sets.length > 0
  );
}

/**
 * The commit shape the server accepts. Display-only fields (`exercise_name`,
 * `modality`, `rationale`) fall away; sort order is the card's order so a
 * proposal streamed without one still saves in the order it was shown.
 */
function toCreatePayload(
  name: string,
  description: string | null | undefined,
  exercises: ProposedPresetExercise[],
): WorkoutPresetCreatePayload {
  return {
    name,
    description: description ?? null,
    is_public: false,
    exercises: exercises.map((exercise, index) => ({
      exercise_id: exercise.exercise_id,
      sort_order: index,
      superset_group: exercise.superset_group ?? null,
      sets: exercise.sets.map((set, setIndex) => ({
        set_number: setIndex + 1,
        set_type: set.set_type ?? 'Working Set',
        reps: set.reps ?? null,
        weight: set.weight ?? null,
        duration: set.duration ?? null,
        distance: set.distance ?? null,
        rest_time: set.rest_time ?? null,
        notes: set.notes ?? null,
      })),
    })),
  };
}

/**
 * Renders the `sparky_propose_workout_preset` tool call as a routine card with
 * Accept / Request changes — the mobile counterpart of the web's
 * WorkoutPresetProposalToolUI. Until this existed the chat could *describe* a
 * routine it had built but the phone had no way to keep it.
 *
 * Accept creates the preset through the ordinary mutation and tells the model
 * so as a plain user message; Request changes asks for one line of feedback
 * and sends it the same way, so the model revises in the same thread.
 */
export default function WorkoutProposalCard({ part }: { part: ToolCallMessagePart }) {
  const { t } = useTranslation();
  const aui = useAui();
  const isLast = useAuiState((s) => s.message.isLast);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const { preferences } = usePreferences();
  const weightUnit = normalizeWeightUnit(preferences?.default_weight_unit);
  const { createPresetAsync, isPending } = useCreateWorkoutPreset();
  const accentPrimary = String(useCSSVariable('--color-accent-primary'));

  const [createdName, setCreatedName] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState('');

  const args = part.args as Partial<ProposeWorkoutPresetInput> | undefined;
  const name = typeof args?.name === 'string' ? args.name : '';
  const exercises = (Array.isArray(args?.exercises) ? args.exercises : []).filter(isRenderable);
  // The input streams in as partial JSON — nothing to show until the routine
  // has a name and one complete exercise.
  if (!name || exercises.length === 0) return null;

  const totalSets = exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
  // A card on an older message would act on a proposal the chat has moved
  // past; only the last message keeps its buttons live.
  const stale = !isLast || isRunning;
  const disabled = stale || isPending || createdName != null;

  const formatSet = (set: ProposedPresetExercise['sets'][number]): string => {
    const parts: string[] = [];
    if (set.reps != null) parts.push(`${set.reps} ${t('workoutProposal.reps', { defaultValue: 'reps' })}`);
    if (set.weight != null && set.weight > 0) {
      parts.push(`${formatLocalizedNumber(weightFromKg(set.weight, weightUnit), { maximumFractionDigits: 1 })} ${weightUnit}`);
    }
    if (set.duration != null && set.duration > 0) parts.push(formatDuration(Math.round(set.duration / 60)));
    if (set.distance != null && set.distance > 0) parts.push(`${formatLocalizedNumber(set.distance, { maximumFractionDigits: 2 })} km`);
    return parts.join(' · ');
  };

  /** "3 × 10 reps · 40 kg" when every set matches, else one line per set. */
  const summarizeSets = (sets: ProposedPresetExercise['sets']): string[] => {
    const lines = sets.map(formatSet);
    if (lines.every((line) => line === lines[0])) {
      return [`${sets.length} × ${lines[0] || t('workoutProposal.setNoun', { defaultValue: 'set' })}`];
    }
    return lines.map((line, index) => `${index + 1}. ${line}`);
  };

  const handleAccept = async () => {
    try {
      await createPresetAsync(toCreatePayload(name, args?.description, exercises));
      setCreatedName(name);
      aui.thread().append(
        t('workoutProposal.acceptedMessage', {
          defaultValue: 'I accepted the proposed routine "{{name}}".',
          name,
        }),
      );
    } catch {
      // useCreateWorkoutPreset already showed the failure toast.
    }
  };

  const handleSendRevision = () => {
    const trimmed = feedback.trim();
    if (!trimmed) return;
    aui.thread().append(
      t('workoutProposal.reviseMessage', {
        defaultValue: 'Please revise the proposal: {{feedback}}',
        feedback: trimmed,
      }),
    );
    setRevising(false);
    setFeedback('');
  };

  return (
    <View
      className="my-1 bg-background border border-border-subtle rounded-xl px-3 py-3 gap-2"
      testID="workout-proposal-card"
    >
      <View className="flex-row items-center gap-2">
        <View className="border border-border-subtle rounded-full px-2 py-0.5">
          <Text className="text-text-secondary text-xs">
            {createdName != null
              ? t('workoutProposal.createdBadge', { defaultValue: 'Saved ✓' })
              : t('workoutProposal.proposalBadge', { defaultValue: 'Proposed routine' })}
          </Text>
        </View>
        <Text className="text-text-muted text-xs">
          {t('workoutProposal.summary', {
            defaultValue: '{{exercises}} exercises · {{sets}} sets',
            exercises: exercises.length,
            sets: totalSets,
          })}
        </Text>
      </View>
      <Text className="text-text-primary text-base font-semibold">{name}</Text>
      {typeof args?.description === 'string' && args.description.length > 0 && (
        <Text className="text-text-secondary text-sm">{args.description}</Text>
      )}
      {typeof args?.rationale === 'string' && args.rationale.length > 0 && (
        <Text className="text-text-muted text-xs">{args.rationale}</Text>
      )}

      <View className="gap-1.5 mt-1">
        {exercises.map((exercise, index) => (
          <View key={`${exercise.exercise_id}-${index}`} className="gap-0.5">
            <View className="flex-row items-center gap-2">
              <Text className="text-text-primary text-sm font-medium shrink">
                {exercise.exercise_name}
              </Text>
              {exercise.superset_group != null && (
                <Text className="text-text-muted text-xs">
                  {t('workoutProposal.supersetBadge', {
                    defaultValue: 'Superset {{group}}',
                    group: exercise.superset_group,
                  })}
                </Text>
              )}
            </View>
            {summarizeSets(exercise.sets).map((line, lineIndex) => (
              <Text key={lineIndex} className="text-text-muted text-xs">
                {line}
              </Text>
            ))}
          </View>
        ))}
      </View>

      {createdName == null && !revising && (
        <View className="flex-row gap-2 mt-1">
          <Pressable
            disabled={disabled}
            onPress={() => void handleAccept()}
            accessibilityRole="button"
            className={`flex-1 rounded-lg py-2 items-center ${disabled ? 'opacity-50' : ''}`}
            style={{ backgroundColor: accentPrimary }}
            testID="workout-proposal-accept"
          >
            {isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text className="text-white text-sm font-semibold">
                {t('workoutProposal.accept', { defaultValue: 'Save routine' })}
              </Text>
            )}
          </Pressable>
          <Pressable
            disabled={disabled}
            onPress={() => setRevising(true)}
            accessibilityRole="button"
            className={`flex-1 rounded-lg py-2 items-center border border-border-subtle ${disabled ? 'opacity-50' : ''}`}
            testID="workout-proposal-revise"
          >
            <Text className="text-text-primary text-sm font-semibold">
              {t('workoutProposal.regenerate', { defaultValue: 'Request changes' })}
            </Text>
          </Pressable>
        </View>
      )}

      {revising && (
        <View className="gap-2 mt-1">
          <TextInput
            value={feedback}
            onChangeText={setFeedback}
            placeholder={t('workoutProposal.revisionPlaceholder', {
              defaultValue: 'What should change? e.g. less volume, no barbell work',
            })}
            className="border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary"
            multiline
            autoFocus
            testID="workout-proposal-feedback"
          />
          <View className="flex-row gap-2">
            <Pressable
              disabled={stale || feedback.trim().length === 0}
              onPress={handleSendRevision}
              accessibilityRole="button"
              className={`flex-1 rounded-lg py-2 items-center ${stale || feedback.trim().length === 0 ? 'opacity-50' : ''}`}
              style={{ backgroundColor: accentPrimary }}
              testID="workout-proposal-send-revision"
            >
              <Text className="text-white text-sm font-semibold">
                {t('workoutProposal.sendRevision', { defaultValue: 'Send' })}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setRevising(false);
                setFeedback('');
              }}
              accessibilityRole="button"
              className="flex-1 rounded-lg py-2 items-center border border-border-subtle"
            >
              <Text className="text-text-primary text-sm font-semibold">
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}
