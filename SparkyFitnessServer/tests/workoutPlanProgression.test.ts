import { describe, it, expect } from 'vitest';
import {
  computeSequentialPlanProgression,
  type AssignmentProgressionInput,
  type LoggedEntryProgressionInput,
} from '../services/workoutPlanProgression.js';

describe('computeSequentialPlanProgression', () => {
  it('returns empty result when assignments list is empty', () => {
    const result = computeSequentialPlanProgression([], []);
    expect(result.nextAssignments).toEqual([]);
    expect(result.nextAssignment).toBeNull();
    expect(result.sequencePosition).toBeNull();
  });

  it('handles single-session plan with no logs', () => {
    const assignments: AssignmentProgressionInput[] = [
      {
        id: 101,
        session_index: 1,
        session_name: 'Full Body A',
        workout_preset_id: 10,
      },
    ];
    const logs: LoggedEntryProgressionInput[] = [];

    const result = computeSequentialPlanProgression(assignments, logs);
    expect(result.nextAssignments).toHaveLength(1);
    expect(result.nextAssignment?.id).toBe(101);
    expect(result.sequencePosition).toEqual({
      current: 1,
      total: 1,
      session_name: 'Full Body A',
    });
  });

  it('wraps back to Session 1 when single-session plan is completed', () => {
    const assignments: AssignmentProgressionInput[] = [
      {
        id: 101,
        session_index: 1,
        session_name: 'Full Body A',
        workout_preset_id: 10,
      },
    ];
    const logs: LoggedEntryProgressionInput[] = [
      { id: 1, workout_plan_assignment_id: 101, entry_date: '2026-09-20' },
    ];

    const result = computeSequentialPlanProgression(assignments, logs);
    expect(result.nextAssignments).toHaveLength(1);
    expect(result.nextAssignment?.id).toBe(101);
    expect(result.sequencePosition).toEqual({
      current: 1,
      total: 1,
      session_name: 'Full Body A',
    });
  });

  it('progresses through multi-session plans sequentially', () => {
    const assignments: AssignmentProgressionInput[] = [
      { id: 1, session_index: 1, session_name: 'Push Day' },
      { id: 2, session_index: 2, session_name: 'Pull Day' },
      { id: 3, session_index: 3, session_name: 'Legs Day' },
    ];

    // 0 logs -> Session 1 (Push Day)
    const result0 = computeSequentialPlanProgression(assignments, []);
    expect(result0.sequencePosition).toEqual({
      current: 1,
      total: 3,
      session_name: 'Push Day',
    });

    // Push Day completed -> Session 2 (Pull Day)
    const logs1: LoggedEntryProgressionInput[] = [
      { id: 'log-1', workout_plan_assignment_id: 1, entry_date: '2026-09-20' },
    ];
    const result1 = computeSequentialPlanProgression(assignments, logs1);
    expect(result1.sequencePosition).toEqual({
      current: 2,
      total: 3,
      session_name: 'Pull Day',
    });
    expect(result1.nextAssignment?.id).toBe(2);

    // Pull Day completed -> Session 3 (Legs Day)
    const logs2: LoggedEntryProgressionInput[] = [
      { id: 'log-1', workout_plan_assignment_id: 1, entry_date: '2026-09-20' },
      { id: 'log-2', workout_plan_assignment_id: 2, entry_date: '2026-09-21' },
    ];
    const result2 = computeSequentialPlanProgression(assignments, logs2);
    expect(result2.sequencePosition).toEqual({
      current: 3,
      total: 3,
      session_name: 'Legs Day',
    });
    expect(result2.nextAssignment?.id).toBe(3);

    // Legs Day completed -> Wraps back to Session 1 (Push Day)
    const logs3: LoggedEntryProgressionInput[] = [
      { id: 'log-1', workout_plan_assignment_id: 1, entry_date: '2026-09-20' },
      { id: 'log-2', workout_plan_assignment_id: 2, entry_date: '2026-09-21' },
      { id: 'log-3', workout_plan_assignment_id: 3, entry_date: '2026-09-22' },
    ];
    const result3 = computeSequentialPlanProgression(assignments, logs3);
    expect(result3.sequencePosition).toEqual({
      current: 1,
      total: 3,
      session_name: 'Push Day',
    });
    expect(result3.nextAssignment?.id).toBe(1);
  });

  it('handles multi-assignment sessions requiring all assignments completed before advancing', () => {
    const assignments: AssignmentProgressionInput[] = [
      {
        id: 10,
        session_index: 1,
        session_name: 'Upper Body',
        exercise_id: 'bench',
      },
      {
        id: 11,
        session_index: 1,
        session_name: 'Upper Body',
        exercise_id: 'rows',
      },
      {
        id: 20,
        session_index: 2,
        session_name: 'Lower Body',
        exercise_id: 'squats',
      },
    ];

    // Only 1 of 2 exercises completed in Session 1
    const logs1: LoggedEntryProgressionInput[] = [
      { id: 'l1', workout_plan_assignment_id: 10, entry_date: '2026-09-20' },
    ];
    const result1 = computeSequentialPlanProgression(assignments, logs1);
    expect(result1.sequencePosition).toEqual({
      current: 1,
      total: 2,
      session_name: 'Upper Body',
    });
    expect(result1.nextAssignments).toHaveLength(2);

    // Both exercises completed in Session 1 -> advances to Session 2
    const logs2: LoggedEntryProgressionInput[] = [
      { id: 'l1', workout_plan_assignment_id: 10, entry_date: '2026-09-20' },
      { id: 'l2', workout_plan_assignment_id: 11, entry_date: '2026-09-20' },
    ];
    const result2 = computeSequentialPlanProgression(assignments, logs2);
    expect(result2.sequencePosition).toEqual({
      current: 2,
      total: 2,
      session_name: 'Lower Body',
    });
    expect(result2.nextAssignments).toHaveLength(1);
    expect(result2.nextAssignment?.id).toBe(20);
  });

  it('handles multi-round cycle wrapping accurately', () => {
    const assignments: AssignmentProgressionInput[] = [
      { id: 1, session_index: 1, session_name: 'Session A' },
      { id: 2, session_index: 2, session_name: 'Session B' },
    ];

    // Completed Round 1 (A, B) and starting Round 2 with A done
    const logs: LoggedEntryProgressionInput[] = [
      { id: 'l1', workout_plan_assignment_id: 1, entry_date: '2026-09-10' },
      { id: 'l2', workout_plan_assignment_id: 2, entry_date: '2026-09-12' },
      { id: 'l3', workout_plan_assignment_id: 1, entry_date: '2026-09-14' },
    ];

    const result = computeSequentialPlanProgression(assignments, logs);
    expect(result.sequencePosition).toEqual({
      current: 2,
      total: 2,
      session_name: 'Session B',
    });
    expect(result.nextAssignment?.id).toBe(2);
  });

  it('keeps progression on first incomplete session when an out-of-order session is logged prematurely', () => {
    const assignments: AssignmentProgressionInput[] = [
      { id: 10, session_index: 1, session_name: 'Session 1' },
      { id: 20, session_index: 2, session_name: 'Session 2' },
      { id: 30, session_index: 3, session_name: 'Session 3' },
    ];

    // User logged Session 2 before Session 1
    const logs: LoggedEntryProgressionInput[] = [
      { id: 'l1', workout_plan_assignment_id: 20, entry_date: '2026-09-10' },
    ];

    const result = computeSequentialPlanProgression(assignments, logs);
    // Progression must remain at Session 1 because Session 1 is not completed in this cycle
    expect(result.sequencePosition).toEqual({
      current: 1,
      total: 3,
      session_name: 'Session 1',
    });
    expect(result.nextAssignment?.id).toBe(10);
  });

  it('handles multiple sessions logged on the same date in chronological sequence', () => {
    const assignments: AssignmentProgressionInput[] = [
      { id: 1, session_index: 1, session_name: 'Morning Session' },
      { id: 2, session_index: 2, session_name: 'Evening Session' },
    ];

    // Both logged on 2026-09-20 in chronological order
    const logs: LoggedEntryProgressionInput[] = [
      { id: 101, workout_plan_assignment_id: 1, entry_date: '2026-09-20' },
      { id: 102, workout_plan_assignment_id: 2, entry_date: '2026-09-20' },
    ];

    const result = computeSequentialPlanProgression(assignments, logs);
    // Cycle completed -> wraps back to Session 1
    expect(result.sequencePosition).toEqual({
      current: 1,
      total: 2,
      session_name: 'Morning Session',
    });
    expect(result.nextAssignment?.id).toBe(1);
  });
});
