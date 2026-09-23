import { render, screen } from '@testing-library/react-native';
import type { ExerciseSessionResponse } from '@workspace/shared';
import ExerciseSummary from '../../src/components/ExerciseSummary';
import type { WorkoutPlanTemplate } from '../../src/types/workoutPlans';

const mockUseActiveWorkoutPlans = jest.fn();

jest.mock('../../src/hooks/useActiveWorkoutPlan', () => ({
  useActiveWorkoutPlans: (...args: unknown[]) =>
    mockUseActiveWorkoutPlans(...args),
}));

jest.mock('../../src/components/Icon', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ name }: { name: string }) => <View testID={`icon-${name}`} />,
  };
});

jest.mock('../../src/components/SwipeableExerciseRow', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: () => <View testID="exercise-row" /> };
});

const ENTRY_DATE = '2026-09-22';
const PLAN_NAME = 'QA Rotation';
const ASSIGNMENT_ID = 4242;

const plan = {
  id: 7,
  plan_name: PLAN_NAME,
  schedule_type: 'sequential',
  assignments: [
    {
      id: ASSIGNMENT_ID,
      session_index: 2,
      session_name: 'QA Pull',
      exercise_name: 'Lat Pulldown',
    },
  ],
  next_assignment: {
    id: ASSIGNMENT_ID,
    session_index: 2,
    session_name: 'QA Pull',
    exercise_name: 'Lat Pulldown',
  },
  sequence_position: { current: 2, total: 3, session_name: 'QA Pull' },
} as unknown as WorkoutPlanTemplate;

// A live plan session as the server writes it: the whole entry exists the
// moment the workout is started, with its prescribed sets already in place and
// `completed_at` null on every one of them.
const startedSession = (
  sets: { completed_at: string | null }[]
): ExerciseSessionResponse =>
  ({
    type: 'preset',
    id: 'preset-entry-1',
    entry_date: ENTRY_DATE,
    name: 'QA Pull',
    workout_plan_assignment_id: ASSIGNMENT_ID,
    total_duration_minutes: 0,
    exercises: [
      {
        id: 'entry-1',
        exercise_id: 'exercise-1',
        workout_plan_assignment_id: ASSIGNMENT_ID,
        duration_minutes: 0,
        calories_burned: 0,
        entry_date: ENTRY_DATE,
        sets: sets.map((set, index) => ({
          id: index + 1,
          set_number: index + 1,
          reps: 10,
          weight: 40,
          completed_at: set.completed_at,
        })),
        exercise_snapshot: { id: 'exercise-1', name: 'Lat Pulldown' },
        activity_details: [],
        superset_group: null,
      },
    ],
    activity_details: [],
  }) as unknown as ExerciseSessionResponse;

const renderSummary = (entries: ExerciseSessionResponse[]) =>
  render(
    <ExerciseSummary
      exerciseEntries={entries}
      entryDate={ENTRY_DATE}
      onPressPlanAssignment={jest.fn()}
    />
  );

describe('ExerciseSummary plan banner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseActiveWorkoutPlans.mockReturnValue({ plans: [plan] });
  });

  it('keeps the banner up for a session that was started but never logged', () => {
    renderSummary([
      startedSession([{ completed_at: null }, { completed_at: null }]),
    ]);

    // The banner is the only way back into a session the user walked away
    // from, so an entry that exists purely because the workout was opened must
    // not count as the plan's day being done.
    expect(screen.getByText(new RegExp(PLAN_NAME))).toBeTruthy();
  });

  it('hides the banner once a set in the session has been completed', () => {
    renderSummary([
      startedSession([
        { completed_at: '2026-09-22T10:00:00.000Z' },
        { completed_at: null },
      ]),
    ]);

    // One ticked set of two: the session was trained, so the plan stops
    // asking for it today.
    expect(screen.queryByText(new RegExp(PLAN_NAME))).toBeNull();
  });

  it('hides the banner for a plan entry that carries no sets at all', () => {
    // A hand-logged or imported session has no set rows, so nothing in it
    // could ever be ticked — same allowance the server's progression read
    // makes.
    const entry = startedSession([]);

    renderSummary([entry]);
    expect(screen.queryByText(new RegExp(PLAN_NAME))).toBeNull();
  });
});
