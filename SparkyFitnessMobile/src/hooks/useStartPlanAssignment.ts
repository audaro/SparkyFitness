import { useCallback } from 'react';
import {
  isCardioModality,
  resolveExerciseModality,
  type PresetSessionExerciseRequest,
} from '@workspace/shared';

import { useWorkoutPresets } from './useWorkoutPresets';
import {
  useStartLiveWorkout,
  type StartLiveWorkoutNavigation,
} from './useStartLiveWorkout';
import { getWorkoutPresetById } from '../services/api/workoutPresetsApi';
import type {
  WorkoutPlanAssignment,
  WorkoutPlanTemplate,
} from '../types/workoutPlans';
import { makeDefaultStartSet } from '../utils/workoutSession';

/**
 * Starts the live workout a plan's day (weekly) or step (sequential) stands
 * for, expanding each assignment into the presets or single exercises behind
 * it and tagging the session with the assignment so the server can advance a
 * sequential plan on finish.
 *
 * Upstream defines this inside the Diary screen, next to the exercise list it
 * renders there. This fork shows logged exercise on the Exercise tab instead,
 * so the callback lives here and the tab owns it; the Diary screen only needs
 * to know whether a plan is pending, for the empty state.
 */
export function useStartPlanAssignment(
  navigation: StartLiveWorkoutNavigation
): {
  startPlanAssignment: (
    targetPlan: WorkoutPlanTemplate,
    assignment: WorkoutPlanAssignment
  ) => Promise<void>;
} {
  const { startLiveWorkout } = useStartLiveWorkout(navigation);
  const { presets: allPresets } = useWorkoutPresets();

  const startPlanAssignment = useCallback(
    async (
      targetPlan: WorkoutPlanTemplate,
      assignment: WorkoutPlanAssignment
    ) => {
      if (!targetPlan) return;

      const isSequential = targetPlan.schedule_type === 'sequential';
      const sessionAssignments = isSequential
        ? targetPlan.assignments?.filter(
            (a) => (a.session_index ?? 1) === (assignment.session_index ?? 1)
          ) || [assignment]
        : targetPlan.assignments?.filter(
            (a) => a.day_of_week === assignment.day_of_week
          ) || [assignment];

      const startExercises: PresetSessionExerciseRequest[] = [];

      for (let i = 0; i < sessionAssignments.length; i++) {
        const a = sessionAssignments[i]!;
        if (a.workout_preset_id) {
          let preset = allPresets.find(
            (p) => String(p.id) === String(a.workout_preset_id)
          );
          if (!preset) {
            try {
              preset = await getWorkoutPresetById(Number(a.workout_preset_id));
            } catch {
              // Ignore fetch error, fallback gracefully
            }
          }
          if (preset && preset.exercises) {
            preset.exercises.forEach((ex) => {
              const modality = resolveExerciseModality(
                ex.modality,
                ex.category
              );
              startExercises.push({
                exercise_id: ex.exercise_id,
                sort_order: startExercises.length,
                duration_minutes: 0,
                notes: null,
                superset_group: ex.superset_group ?? null,
                workout_plan_assignment_id: a.id ? Number(a.id) : null,
                sets:
                  ex.sets.length === 0
                    ? [makeDefaultStartSet(1, modality)]
                    : ex.sets.map((set, setIndex) => ({
                        set_number: setIndex + 1,
                        set_type: set.set_type ?? 'normal',
                        reps: set.reps ?? null,
                        weight: set.weight ?? null,
                        duration: set.duration ?? null,
                        distance: isCardioModality(modality)
                          ? (set.distance ?? null)
                          : null,
                        rest_time: isCardioModality(modality)
                          ? 0
                          : (set.rest_time ?? null),
                        notes: set.notes ?? null,
                        rpe: null,
                        completed_at: null,
                      })),
              });
            });
          }
        } else if (a.exercise_id) {
          const modality = resolveExerciseModality(a.modality, a.category);
          startExercises.push({
            exercise_id: a.exercise_id,
            sort_order: startExercises.length,
            duration_minutes: 0,
            notes: null,
            superset_group: null,
            workout_plan_assignment_id: a.id ? Number(a.id) : null,
            sets:
              a.sets.length === 0
                ? [makeDefaultStartSet(1, modality)]
                : a.sets.map((set, setIndex) => ({
                    set_number: setIndex + 1,
                    set_type: set.set_type ?? 'normal',
                    reps: set.reps ?? null,
                    weight: set.weight ?? null,
                    duration: set.duration ?? null,
                    distance: isCardioModality(modality)
                      ? (set.distance ?? null)
                      : null,
                    rest_time: isCardioModality(modality)
                      ? 0
                      : (set.rest_time ?? null),
                    notes: set.notes ?? null,
                    rpe: null,
                    completed_at: null,
                  })),
          });
        }
      }

      if (startExercises.length === 0) return;

      const sessionName =
        assignment.session_name ||
        targetPlan.sequence_position?.session_name ||
        assignment.workout_preset_name ||
        assignment.exercise_name ||
        targetPlan.plan_name;

      const singlePresetId =
        sessionAssignments.length === 1 &&
        sessionAssignments[0]?.workout_preset_id
          ? Number(sessionAssignments[0].workout_preset_id)
          : undefined;

      await startLiveWorkout({
        name: sessionName,
        exercises: startExercises,
        sourcePresetId: singlePresetId,
        workoutPlanAssignmentId: assignment.id
          ? Number(assignment.id)
          : undefined,
      });
    },
    [allPresets, startLiveWorkout]
  );

  return { startPlanAssignment };
}
