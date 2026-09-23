export interface AssignmentProgressionInput {
  id: string | number;
  session_index?: number | null;
  session_name?: string | null;
  sort_order?: number | null;
  day_of_week?: number | null;
  workout_preset_id?: number | null;
  exercise_id?: string | null;
}

export interface LoggedEntryProgressionInput {
  id?: string | number;
  workout_plan_assignment_id?: string | number | null;
  entry_date?: string | Date;
  created_at?: string | Date;
}

export interface SequencePosition {
  current: number;
  total: number;
  session_name?: string | null;
}

export interface SequentialProgressionResult<
  T extends AssignmentProgressionInput,
> {
  nextAssignments: T[];
  nextAssignment: T | null;
  sequencePosition: SequencePosition | null;
}

/**
 * Computes the active session and progress position for a sequential workout plan.
 * Pure function: given assignments and chronologically sorted logged entries,
 * finds the next incomplete session in the progression cycle.
 */
export function computeSequentialPlanProgression<
  T extends AssignmentProgressionInput,
>(
  assignments: T[],
  loggedRows: LoggedEntryProgressionInput[]
): SequentialProgressionResult<T> {
  if (!assignments || assignments.length === 0) {
    return {
      nextAssignments: [],
      nextAssignment: null,
      sequencePosition: null,
    };
  }

  // Group distinct session indices (sorted ascending)
  const sessionIndices: number[] = Array.from(
    new Set<number>(assignments.map((a) => a.session_index ?? 1))
  ).sort((a: number, b: number) => a - b);

  if (sessionIndices.length === 0) {
    return {
      nextAssignments: [],
      nextAssignment: null,
      sequencePosition: null,
    };
  }

  // Map assignment ID -> array of monotonic log sequence indices
  const logOrderIndicesByAssignment = new Map<string | number, number[]>();
  for (const [logOrder, row] of loggedRows.entries()) {
    const aid = row.workout_plan_assignment_id;
    if (aid === null || aid === undefined) continue;
    // Normalize numeric IDs to match assignment IDs
    const normalizedAid =
      typeof aid === 'string' && !isNaN(Number(aid)) ? Number(aid) : aid;
    const list = logOrderIndicesByAssignment.get(normalizedAid) || [];
    list.push(logOrder);
    logOrderIndicesByAssignment.set(normalizedAid, list);
  }

  let nextSessionIndex = sessionIndices[0] ?? 1;
  let nextSessionOrder = 0;
  let cycleThreshold = -1;
  let hasActiveSession = false;

  // Loop cycles to find first incomplete session
  while (!hasActiveSession) {
    let cycleCompleted = true;
    for (let i = 0; i < sessionIndices.length; i++) {
      const sIndex = sessionIndices[i]!;
      const sAssignments = assignments.filter(
        (a) => (a.session_index ?? 1) === sIndex
      );
      if (sAssignments.length === 0) continue;

      // Check if every assignment in this session has been completed after cycleThreshold
      let sessionCanComplete = true;
      let sessionCompletionOrder = cycleThreshold;

      for (const a of sAssignments) {
        const aid =
          typeof a.id === 'string' && !isNaN(Number(a.id))
            ? Number(a.id)
            : a.id;
        const orders = logOrderIndicesByAssignment.get(aid) || [];
        const nextOrder = orders.find((o) => o > cycleThreshold);
        if (nextOrder === undefined) {
          sessionCanComplete = false;
          break;
        }
        if (nextOrder > sessionCompletionOrder) {
          sessionCompletionOrder = nextOrder;
        }
      }

      if (!sessionCanComplete) {
        nextSessionIndex = sIndex;
        nextSessionOrder = i;
        hasActiveSession = true;
        cycleCompleted = false;
        break;
      } else {
        cycleThreshold = sessionCompletionOrder;
      }
    }

    if (cycleCompleted) {
      // Check if there are any further entries logged after the latest cycleThreshold
      let hasFutureLogs = false;
      for (const orders of logOrderIndicesByAssignment.values()) {
        if (orders.some((o) => o > cycleThreshold)) {
          hasFutureLogs = true;
          break;
        }
      }
      if (!hasFutureLogs) {
        // Wrap around to the start of the next cycle
        nextSessionIndex = sessionIndices[0] ?? 1;
        nextSessionOrder = 0;
        hasActiveSession = true;
      }
    }
  }

  const activeSessionAssignments = assignments.filter(
    (a) => (a.session_index ?? 1) === nextSessionIndex
  );

  const currentSessionName = activeSessionAssignments[0]?.session_name || null;

  return {
    nextAssignments: activeSessionAssignments,
    nextAssignment: activeSessionAssignments[0] || null,
    sequencePosition: {
      current: nextSessionOrder + 1,
      total: sessionIndices.length,
      session_name: currentSessionName,
    },
  };
}
