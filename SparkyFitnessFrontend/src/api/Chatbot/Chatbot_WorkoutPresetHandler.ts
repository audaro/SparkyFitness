import { apiCall } from '@/api/api';
import { debug, error, type UserLoggingLevel } from '@/utils/logging';
import type { CoachResponse } from '@/types/Chatbot_types';
import { createWorkoutPreset } from '@/api/Exercises/workoutPresets';
import { searchExercises } from '@/api/Exercises/exerciseSearchService';
import type { WorkoutPresetSet } from '@/types/workout';

export interface WorkoutRoutineSetInput {
  set_number?: number;
  set_type?: string;
  reps?: number | null;
  weight?: number | null;
  duration?: number | null;
  rest_time?: number | null;
  notes?: string | null;
}

export interface WorkoutRoutineExerciseInput {
  exercise_name: string;
  category?: string;
  sets?: WorkoutRoutineSetInput[];
}

export interface WorkoutRoutineInput {
  name: string;
  description?: string;
  is_public?: boolean;
  exercises: WorkoutRoutineExerciseInput[];
}

interface ResolvedExercise {
  id: string;
  name: string;
  isNew: boolean;
}

const normalizeCategory = (exerciseName: string, category?: string): string => {
  const lower = (category || '').toLowerCase();
  if (
    lower === 'strength' ||
    lower === 'cardio' ||
    lower === 'flexibility' ||
    lower === 'sports'
  ) {
    return lower;
  }
  const name = exerciseName.toLowerCase();
  if (
    name.includes('run') ||
    name.includes('jog') ||
    name.includes('cycle') ||
    name.includes('bike') ||
    name.includes('swim') ||
    name.includes('walk') ||
    name.includes('row') ||
    name.includes('elliptical')
  ) {
    return 'cardio';
  }
  return 'strength';
};

const resolveExercise = async (
  exerciseName: string,
  category: string | undefined,
  userLoggingLevel: UserLoggingLevel
): Promise<ResolvedExercise | null> => {
  try {
    const matches = await searchExercises(exerciseName);
    const exact = matches.find(
      (e) => e.name.toLowerCase() === exerciseName.toLowerCase()
    );
    const chosen = exact ?? matches[0];
    if (chosen) {
      return { id: chosen.id, name: chosen.name, isNew: false };
    }
  } catch (err) {
    debug(
      userLoggingLevel,
      `[WorkoutPresetHandler] Exercise search failed for "${exerciseName}", will create`,
      err
    );
  }

  const resolvedCategory = normalizeCategory(exerciseName, category);

  try {
    const formData = new FormData();
    formData.append(
      'exerciseData',
      JSON.stringify({
        name: exerciseName,
        category: resolvedCategory,
        calories_per_hour: resolvedCategory === 'cardio' ? 500 : 300,
        is_custom: true,
        source: 'chatbot',
      })
    );
    const created = await apiCall('/exercises', {
      method: 'POST',
      body: formData,
      isFormData: true,
    });
    return { id: created.id, name: created.name, isNew: true };
  } catch (err) {
    error(
      userLoggingLevel,
      `[WorkoutPresetHandler] Failed to create exercise "${exerciseName}"`,
      err
    );
    return null;
  }
};

const buildSets = (
  inputSets: WorkoutRoutineSetInput[] | undefined,
  category: string
): WorkoutPresetSet[] => {
  const sets = inputSets && inputSets.length > 0 ? inputSets : [{}];
  return sets.map((s, idx) => {
    const isCardio = category === 'cardio';
    const set: WorkoutPresetSet = {
      set_number: s.set_number ?? idx + 1,
      set_type: s.set_type ?? 'Working Set',
      reps: isCardio ? null : (s.reps ?? null),
      weight: isCardio ? null : (s.weight ?? null),
      duration: s.duration ?? null,
      rest_time: s.rest_time ?? null,
      notes: s.notes ?? null,
    } as WorkoutPresetSet;
    return set;
  });
};

export const processWorkoutRoutineInput = async (
  data: WorkoutRoutineInput,
  userId: string | undefined,
  userLoggingLevel: UserLoggingLevel
): Promise<CoachResponse> => {
  try {
    debug(
      userLoggingLevel,
      '[WorkoutPresetHandler] Processing workout routine input:',
      data
    );

    if (!userId) {
      return {
        action: 'none',
        response:
          "I couldn't identify your account to save the routine. Please refresh and try again.",
      };
    }

    if (
      !data?.name ||
      !Array.isArray(data?.exercises) ||
      data.exercises.length === 0
    ) {
      return {
        action: 'none',
        response:
          'I couldn\'t read that workout routine. Please tell me a name and at least one exercise (e.g., "Create a push day routine with bench press 3x8, overhead press 3x10, dips 3x12").',
      };
    }

    const presetExercises: Array<{
      exercise_id: string;
      sort_order: number;
      sets: WorkoutPresetSet[];
    }> = [];
    const createdExerciseNames: string[] = [];

    for (let i = 0; i < data.exercises.length; i++) {
      const ex = data.exercises[i];
      if (!ex?.exercise_name) continue;

      const resolved = await resolveExercise(
        ex.exercise_name,
        ex.category,
        userLoggingLevel
      );
      if (!resolved) {
        return {
          action: 'none',
          response: `Sorry, I couldn't add "${ex.exercise_name}" to the routine. Please try again or rephrase.`,
        };
      }
      if (resolved.isNew) {
        createdExerciseNames.push(resolved.name);
      }

      const category = normalizeCategory(ex.exercise_name, ex.category);
      presetExercises.push({
        exercise_id: resolved.id,
        sort_order: i,
        sets: buildSets(ex.sets, category),
      });
    }

    if (presetExercises.length === 0) {
      return {
        action: 'none',
        response:
          "I couldn't find any valid exercises in that routine. Please try again.",
      };
    }

    try {
      const created = await createWorkoutPreset({
        user_id: userId,
        name: data.name,
        description: data.description ?? '',
        is_public: data.is_public ?? false,
        // @ts-expect-error full WorkoutPreset shape vs the nested create payload
        exercises: presetExercises,
      });

      const exerciseSummary = data.exercises
        .map((ex) => {
          const sets = ex.sets ?? [];
          const setCount = sets.length || 1;
          const firstSet = sets[0];
          if (firstSet?.reps != null) {
            return `• ${ex.exercise_name} — ${setCount} × ${firstSet.reps}`;
          }
          if (firstSet?.duration != null) {
            return `• ${ex.exercise_name} — ${firstSet.duration} min`;
          }
          return `• ${ex.exercise_name}`;
        })
        .join('\n');

      let response = `💪 **Routine saved: ${created.name}**\n\n${exerciseSummary}\n\n📋 You can find it in Workout Presets and start it anytime.`;
      if (createdExerciseNames.length > 0) {
        response += `\n\n_Added ${createdExerciseNames.length} new exercise${createdExerciseNames.length === 1 ? '' : 's'} to your library: ${createdExerciseNames.join(', ')}._`;
      }

      return {
        action: 'workout_routine_created',
        response,
      };
    } catch (err) {
      error(
        userLoggingLevel,
        '[WorkoutPresetHandler] Failed to create workout preset',
        err
      );
      return {
        action: 'none',
        response:
          "Sorry, I couldn't save that workout routine. Please try again.",
      };
    }
  } catch (err) {
    error(userLoggingLevel, '[WorkoutPresetHandler] Unexpected error', err);
    return {
      action: 'none',
      response:
        'Sorry, I had trouble creating that workout routine. Could you rephrase it?',
    };
  }
};
