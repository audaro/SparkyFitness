// hooks/Exercises/useWorkoutPlanAssignments.ts
import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/hooks/use-toast';
import { debug } from '@/utils/logging';
import { generateClientId } from '@/utils/generateClientId';
import { arrayMove } from '@dnd-kit/sortable';
import type { DragEndEvent } from '@dnd-kit/core';
import type {
  WorkoutPlanTemplate,
  WorkoutPlanAssignment,
  WorkoutPreset,
  WorkoutPresetSet,
} from '@/types/workout';
import type { Exercise } from '@/types/exercises';
import { useWorkoutPresets } from '@/hooks/Exercises/useWorkoutPresets';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useAuth } from '@/hooks/useAuth';
import { resolveExerciseModality } from '@workspace/shared';
import { defaultSetForModality } from '@/constants/exercises';

export function useWorkoutPlanAssignments(
  initialData?: WorkoutPlanTemplate | null
) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { loggingLevel } = usePreferences();

  const [scheduleType, setScheduleType] = useState<'weekly' | 'sequential'>(
    () => initialData?.schedule_type || 'sequential'
  );
  const [entryMode, setEntryMode] = useState<'prompt' | 'prefill'>(
    () => initialData?.entry_mode || 'prompt'
  );

  const { data: presetData } = useWorkoutPresets(user?.id);
  const workoutPresets = useMemo(() => presetData?.presets ?? [], [presetData]);

  const [assignments, setAssignments] = useState<WorkoutPlanAssignment[]>(
    () =>
      initialData?.assignments?.map((a) => ({
        ...a,
        id: a.id ? String(a.id) : generateClientId(),
        day_of_week: a.day_of_week ?? null,
        session_index:
          a.session_index ??
          (initialData.schedule_type === 'sequential'
            ? a.day_of_week !== null && a.day_of_week !== undefined
              ? a.day_of_week + 1
              : 1
            : null),
        sort_order: a.sort_order ?? 0,
        sets:
          a.sets?.map((s) => ({
            ...s,
            id: s.id ? String(s.id) : generateClientId(),
            weight: s.weight != null ? Number(s.weight) : null,
          })) || [],
      })) || []
  );

  const initialSessions = useMemo(() => {
    if (!initialData?.assignments || initialData.assignments.length === 0)
      return [1];
    const sessionSet = new Set(
      initialData.assignments.map(
        (a) =>
          a.session_index ??
          (a.day_of_week !== null && a.day_of_week !== undefined
            ? a.day_of_week + 1
            : 1)
      )
    );
    const sorted = Array.from(sessionSet).sort((a, b) => a - b);
    return sorted.length > 0 ? sorted : [1];
  }, [initialData]);

  const initialSessionNames = useMemo(() => {
    const names: Record<number, string> = {};
    if (initialData?.assignments) {
      for (const a of initialData.assignments) {
        const sIdx =
          a.session_index ??
          (initialData.schedule_type === 'sequential'
            ? a.day_of_week !== null && a.day_of_week !== undefined
              ? a.day_of_week + 1
              : 1
            : 1);
        if (a.session_name && !names[sIdx]) {
          names[sIdx] = a.session_name;
        }
      }
    }
    return names;
  }, [initialData]);

  const [sessionList, setSessionList] = useState<number[]>(initialSessions);
  const [sessionNames, setSessionNames] =
    useState<Record<number, string>>(initialSessionNames);

  const setSessionName = useCallback((sessionNum: number, name: string) => {
    setSessionNames((prev) => ({
      ...prev,
      [sessionNum]: name,
    }));
  }, []);

  const addSession = useCallback(() => {
    setSessionList((prev) => {
      const nextNum = prev.length > 0 ? Math.max(...prev) + 1 : 1;
      return [...prev, nextNum];
    });
  }, []);

  const removeSession = useCallback((sessionNumToRemove: number) => {
    setAssignments((prev) => {
      const remaining = prev.filter(
        (a) => (a.session_index ?? 1) !== sessionNumToRemove
      );
      return remaining.map((a) => {
        const curr = a.session_index ?? 1;
        if (curr > sessionNumToRemove) {
          return { ...a, session_index: curr - 1 };
        }
        return a;
      });
    });
    setSessionNames((prev) => {
      const updated: Record<number, string> = {};
      Object.entries(prev).forEach(([key, val]) => {
        const k = Number(key);
        if (k < sessionNumToRemove) {
          updated[k] = val;
        } else if (k > sessionNumToRemove) {
          updated[k - 1] = val;
        }
      });
      return updated;
    });
    setSessionList((prev) => {
      const filtered = prev.filter((s) => s !== sessionNumToRemove);
      if (filtered.length === 0) return [1];
      return filtered.map((_, idx) => idx + 1);
    });
  }, []);

  const moveSession = useCallback(
    (sessionNum: number, direction: 'up' | 'down') => {
      const targetSessionNum =
        direction === 'up' ? sessionNum - 1 : sessionNum + 1;
      if (targetSessionNum < 1 || targetSessionNum > sessionList.length) return;

      setAssignments((prev) => {
        return prev.map((a) => {
          const curr = a.session_index ?? 1;
          if (curr === sessionNum) {
            return { ...a, session_index: targetSessionNum };
          }
          if (curr === targetSessionNum) {
            return { ...a, session_index: sessionNum };
          }
          return a;
        });
      });

      setSessionNames((prev) => {
        const name1 = prev[sessionNum] ?? '';
        const name2 = prev[targetSessionNum] ?? '';
        return {
          ...prev,
          [sessionNum]: name2,
          [targetSessionNum]: name1,
        };
      });
    },
    [sessionList.length]
  );

  const [copiedAssignment, setCopiedAssignment] =
    useState<WorkoutPlanAssignment | null>(null);

  const [isAddExerciseDialogOpen, setIsAddExerciseDialogOpen] = useState(false);
  const [selectedDayForAssignment, setSelectedDayForAssignment] = useState<
    number | null
  >(null);
  const [selectedSessionForAssignment, setSelectedSessionForAssignment] =
    useState<number | null>(null);

  const handleRemoveAssignment = useCallback((index: number) => {
    setAssignments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSetChangeInPlan = useCallback(
    (
      assignmentIndex: number,
      setIndex: number,
      field: keyof WorkoutPresetSet,
      value: WorkoutPresetSet[keyof WorkoutPresetSet]
    ) => {
      debug(
        loggingLevel,
        `[useWorkoutPlanAssignments] handleSetChangeInPlan: assignmentIndex=${assignmentIndex}, setIndex=${setIndex}, field=${field}, value=${value}`
      );
      setAssignments((prev) =>
        prev.map((assignment, aIndex) => {
          if (aIndex !== assignmentIndex || !assignment.sets) return assignment;
          return {
            ...assignment,
            sets: assignment.sets.map((set, sIndex) =>
              sIndex !== setIndex ? set : { ...set, [field]: value }
            ),
          };
        })
      );
    },
    [loggingLevel]
  );

  const handleAddSetInPlan = useCallback((assignmentIndex: number) => {
    setAssignments((prev) =>
      prev.map((assignment, aIndex) => {
        if (aIndex !== assignmentIndex || !assignment.sets?.length)
          return assignment;
        const lastSet = assignment.sets[assignment.sets.length - 1];
        if (!lastSet) return assignment;
        return {
          ...assignment,
          sets: [
            ...assignment.sets,
            {
              ...lastSet,
              id: generateClientId(),
              set_number: assignment.sets.length + 1,
            },
          ],
        };
      })
    );
  }, []);

  const handleDuplicateSetInPlan = useCallback(
    (assignmentIndex: number, setIndex: number) => {
      setAssignments((prev) =>
        prev.map((assignment, aIndex) => {
          if (aIndex !== assignmentIndex || !assignment.sets) return assignment;
          const setToDuplicate = assignment.sets[setIndex];
          if (!setToDuplicate) return assignment;
          const newSets = [
            ...assignment.sets.slice(0, setIndex + 1),
            { ...setToDuplicate, id: generateClientId() },
            ...assignment.sets.slice(setIndex + 1),
          ].map((s, i) => ({ ...s, set_number: i + 1 }));
          return { ...assignment, sets: newSets };
        })
      );
    },
    []
  );

  const handleRemoveSetInPlan = useCallback(
    (assignmentIndex: number, setIndex: number) => {
      setAssignments((prev) =>
        prev
          .map((assignment, aIndex) => {
            if (aIndex !== assignmentIndex || !assignment.sets)
              return assignment;
            return {
              ...assignment,
              sets: assignment.sets
                .filter((_, sIndex) => sIndex !== setIndex)
                .map((s, i) => ({ ...s, set_number: i + 1 })),
            };
          })
          .filter(
            (assignment) =>
              !assignment.exercise_id ||
              (assignment.sets && assignment.sets.length > 0)
          )
      );
    },
    []
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeId = String(active.id);
      const overId = String(over.id);

      // Assignment reordering
      const activeAssignmentIdx = assignments.findIndex(
        (a) => String(a.id) === activeId
      );
      if (activeAssignmentIdx !== -1) {
        const overAssignmentIdx = assignments.findIndex(
          (a) => String(a.id) === overId
        );
        if (overAssignmentIdx !== -1) {
          const activeAssignment = assignments[activeAssignmentIdx];
          const overAssignment = assignments[overAssignmentIdx];

          if (scheduleType === 'sequential') {
            if (
              (activeAssignment?.session_index ?? 1) !==
              (overAssignment?.session_index ?? 1)
            ) {
              setAssignments((prev) => {
                const sourceItem = prev[activeAssignmentIdx];
                if (!sourceItem) return prev;
                const newItems = [...prev];
                const item: WorkoutPlanAssignment = {
                  ...sourceItem,
                  session_index: overAssignment?.session_index ?? 1,
                  template_id: sourceItem.template_id ?? '',
                };
                newItems.splice(activeAssignmentIdx, 1);
                const newOverIdx = newItems.findIndex(
                  (a) => String(a.id) === overId
                );
                newItems.splice(newOverIdx, 0, item);
                return newItems;
              });
            } else {
              setAssignments((items) =>
                arrayMove(items, activeAssignmentIdx, overAssignmentIdx)
              );
            }
            return;
          }

          if (activeAssignment?.day_of_week !== overAssignment?.day_of_week) {
            setAssignments((prev) => {
              const sourceItem = prev[activeAssignmentIdx];
              if (!sourceItem) return prev;
              const newItems = [...prev];
              const item: WorkoutPlanAssignment = {
                ...sourceItem,
                day_of_week:
                  overAssignment?.day_of_week ?? sourceItem.day_of_week,
                template_id: sourceItem.template_id ?? '',
              };
              newItems.splice(activeAssignmentIdx, 1);
              const newOverIdx = newItems.findIndex(
                (a) => String(a.id) === overId
              );
              newItems.splice(newOverIdx, 0, item);
              return newItems;
            });
          } else {
            setAssignments((items) =>
              arrayMove(items, activeAssignmentIdx, overAssignmentIdx)
            );
          }
          return;
        }
      }

      // Set reordering within an assignment
      const setParentIdx = assignments.findIndex((a) =>
        a.sets?.some((s) => String(s.id) === activeId)
      );
      if (setParentIdx !== -1) {
        const overSetAssignmentIdx = assignments.findIndex((a) =>
          a.sets?.some((s) => String(s.id) === overId)
        );
        if (setParentIdx === overSetAssignmentIdx) {
          setAssignments((prev) =>
            prev.map((a, idx) => {
              if (idx !== setParentIdx) return a;
              const oldIndex = a.sets.findIndex(
                (s) => String(s.id) === activeId
              );
              const newIndex = a.sets.findIndex((s) => String(s.id) === overId);
              if (oldIndex === -1 || newIndex === -1) return a;
              return {
                ...a,
                sets: arrayMove(a.sets, oldIndex, newIndex).map((s, i) => ({
                  ...s,
                  set_number: i + 1,
                })),
              };
            })
          );
        }
      }
    },
    [assignments, scheduleType]
  );

  const handleAddExerciseOrPreset = useCallback(
    (
      item: Exercise | WorkoutPreset,
      sourceMode: 'internal' | 'external' | 'custom' | 'preset',
      customSessionIndex?: number | null
    ) => {
      const isSeq = scheduleType === 'sequential';
      const targetDay = isSeq ? null : selectedDayForAssignment;
      const targetSession = isSeq
        ? (customSessionIndex ?? selectedSessionForAssignment ?? 1)
        : null;

      if (!isSeq && targetDay === null) return;

      if (sourceMode === 'preset') {
        const preset = item as WorkoutPreset;
        setAssignments((prev) => [
          ...prev,
          {
            id: generateClientId(),
            day_of_week: targetDay,
            session_index: targetSession,
            sort_order: prev.length,
            template_id: '',
            workout_preset_id: preset.id as string,
            workout_preset_name: preset.name,
            exercise_id: undefined,
            sets: [],
          },
        ]);
      } else {
        const exercise = item as Exercise;
        const modality = resolveExerciseModality(
          exercise.modality,
          exercise.category
        );
        setAssignments((prev) => [
          ...prev,
          {
            id: generateClientId(),
            day_of_week: targetDay,
            session_index: targetSession,
            sort_order: prev.length,
            template_id: '',
            workout_preset_id: undefined,
            exercise_id: exercise.id,
            exercise_name: exercise.name,
            category: exercise.category ?? undefined,
            modality,
            sets: [
              { ...defaultSetForModality(modality), id: generateClientId() },
            ],
          },
        ]);
      }
      setIsAddExerciseDialogOpen(false);
      setSelectedDayForAssignment(null);
      setSelectedSessionForAssignment(null);
    },
    [scheduleType, selectedDayForAssignment, selectedSessionForAssignment]
  );

  const resolvePresetName = useCallback(
    (assignment: WorkoutPlanAssignment) =>
      assignment.workout_preset_name ??
      workoutPresets.find((p) => p.id === assignment.workout_preset_id)?.name,
    [workoutPresets]
  );

  const handleCopyAssignment = useCallback(
    (assignment: WorkoutPlanAssignment) => {
      setCopiedAssignment({ ...assignment });
      toast({
        title: t('addWorkoutPlanDialog.copiedToastTitle', 'Copied!'),
        description: t('addWorkoutPlanDialog.copiedToastDescription', {
          itemName:
            assignment.exercise_name ||
            `${t('addWorkoutPlanDialog.presetLabel', 'Preset:')} ${
              resolvePresetName(assignment) ?? ''
            }`,
        }),
      });
    },
    [t, resolvePresetName]
  );

  const handlePasteAssignment = useCallback(
    (targetDayOrSession: number | null) => {
      if (!copiedAssignment) return;
      const isSeq = scheduleType === 'sequential';
      const targetDay = isSeq ? null : targetDayOrSession;
      const targetSession = isSeq ? (targetDayOrSession ?? 1) : null;

      const newAssignment: WorkoutPlanAssignment = {
        ...copiedAssignment,
        id: generateClientId(),
        day_of_week: targetDay,
        session_index: targetSession,
        sort_order: assignments.length,
        template_id: '',
        sets:
          copiedAssignment.sets?.map((s) => ({
            ...s,
            id: generateClientId(),
          })) || [],
      };
      setAssignments((prev) => [...prev, newAssignment]);
      toast({
        title: t('addWorkoutPlanDialog.pastedToastTitle', 'Pasted!'),
        description: t('addWorkoutPlanDialog.pastedToastDescription', {
          itemName:
            newAssignment.exercise_name ||
            `${t('addWorkoutPlanDialog.presetLabel', 'Preset:')} ${
              resolvePresetName(newAssignment) ?? ''
            }`,
        }),
      });
    },
    [assignments.length, copiedAssignment, scheduleType, t, resolvePresetName]
  );

  const buildAssignmentsForSave = useCallback(() => {
    if (scheduleType === 'sequential') {
      return assignments
        .filter((a) => a.workout_preset_id || a.exercise_id)
        .map((a) => {
          const sIdx = a.session_index ?? 1;
          const sessionAssignments = assignments.filter(
            (sa) => (sa.session_index ?? 1) === sIdx
          );
          const sName = sessionNames[sIdx]?.trim() || a.session_name || null;
          return {
            ...a,
            day_of_week: null,
            session_index: sIdx,
            session_name: sName,
            sort_order: sessionAssignments.indexOf(a),
            sets: a.sets || [],
          };
        });
    }
    return assignments
      .filter((a) => a.workout_preset_id || a.exercise_id)
      .map((a) => {
        const dayAssignments = assignments.filter(
          (da) => da.day_of_week === a.day_of_week
        );
        return {
          ...a,
          session_index: null,
          session_name: null,
          sort_order: dayAssignments.indexOf(a),
          sets: a.sets || [],
        };
      });
  }, [assignments, scheduleType, sessionNames]);

  return {
    assignments,
    sessionList,
    sessionNames,
    setSessionName,
    addSession,
    removeSession,
    moveSession,
    scheduleType,
    setScheduleType,
    entryMode,
    setEntryMode,
    copiedAssignment,
    workoutPresets,
    isAddExerciseDialogOpen,
    setIsAddExerciseDialogOpen,
    selectedDayForAssignment,
    setSelectedDayForAssignment,
    selectedSessionForAssignment,
    setSelectedSessionForAssignment,
    handleRemoveAssignment,
    handleSetChangeInPlan,
    handleAddSetInPlan,
    handleDuplicateSetInPlan,
    handleRemoveSetInPlan,
    handleDragEnd,
    handleAddExerciseOrPreset,
    handleCopyAssignment,
    handlePasteAssignment,
    buildAssignmentsForSave,
  };
}
