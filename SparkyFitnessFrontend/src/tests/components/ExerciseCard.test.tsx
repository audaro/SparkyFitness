import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import ExerciseCard from '@/pages/Diary/ExerciseCard';
import {
  createWorkoutPlaybackDraftFromPreset,
  saveWorkoutPlaybackDraftToStorage,
  type WorkoutPlaybackDraft,
} from '@/utils/workoutPlayback';
import type { WorkoutPreset } from '@/types/workout';

const mockNavigate = jest.fn();

const SELECTED_DATE = '2026-08-18';

const presetFixture = {
  id: 'preset-1',
  user_id: 'user-1',
  name: 'Upper Body',
  description: null,
  exercises: [
    {
      exercise_id: 'exercise-1',
      exercise_name: 'Bench Press',
      sets: [{ set_number: 1, reps: 8, weight: 80, rest_time: 90 }],
    },
  ],
} as unknown as WorkoutPreset;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/', search: `?date=${SELECTED_DATE}` }),
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({ activeUserId: 'user-1' }),
}));

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    loggingLevel: 'ERROR',
    energyUnit: 'kcal',
    convertEnergy: (value: number) => value,
    getEnergyUnitString: () => 'kcal',
  }),
}));

let dayEntries: unknown[] = [];
let activePlans: unknown[] = [];

jest.mock('@/hooks/Exercises/useExerciseEntries', () => ({
  useExerciseEntries: () => ({ data: dayEntries, isLoading: false }),
  useDeleteExerciseEntryMutation: () => ({ mutateAsync: jest.fn() }),
  useDeleteExercisePresetEntryMutation: () => ({ mutateAsync: jest.fn() }),
}));

jest.mock('@/hooks/Exercises/useWorkoutPlans', () => ({
  useActiveWorkoutPlans: () => ({ data: activePlans }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ fetchQuery: jest.fn() }),
  // The card reads the day's plans and the preset list through react-query;
  // neither is what these cases are about, so every read answers empty.
  useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
}));

jest.mock('@/hooks/Exercises/useExercises', () => ({
  exerciseByIdOptions: jest.fn(),
}));

// The child dialogs are heavy trees of their own (search, tabs, further
// queries) and none of them are what these cases are about. `AddExerciseDialog`
// keeps just enough to drive the preset selection it owns, and to show whether
// it is still open when the guard appears.
jest.mock('@/pages/Exercises/AddExerciseDialog', () => ({
  __esModule: true,
  default: ({
    open,
    onWorkoutPresetSelected,
  }: {
    open: boolean;
    onWorkoutPresetSelected: (preset: WorkoutPreset) => void;
  }) =>
    open ? (
      <div>
        <span>add-exercise-dialog</span>
        <button
          type="button"
          onClick={() => onWorkoutPresetSelected(presetFixture)}
        >
          pick preset
        </button>
      </div>
    ) : null,
}));

jest.mock('@/pages/Diary/EditExerciseEntryDialog', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/pages/Diary/ExercisePlaybackModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/pages/Diary/LogExerciseEntryDialog', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/pages/Diary/EditExerciseDatabaseDialog', () => ({
  __esModule: true,
  default: () => null,
}));

const renderCard = () =>
  render(
    <ExerciseCard selectedDate={SELECTED_DATE} onExercisesLogged={jest.fn()} />
  );

const openPresetSelector = () => {
  // The Play button in the card header opens the add dialog on its preset tab.
  fireEvent.click(screen.getAllByRole('button')[0]!);
};

const navigatedState = (): {
  returnTo?: string;
  draft?: WorkoutPlaybackDraft;
} => mockNavigate.mock.calls[0]![1].state;

describe('ExerciseCard workout preset playback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    dayEntries = [];
    activePlans = [];
  });

  it('starts playback on the diary’s selected date, not today', async () => {
    renderCard();
    openPresetSelector();
    fireEvent.click(await screen.findByText('pick preset'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    expect(mockNavigate.mock.calls[0]![0]).toBe(
      `/workout-playback?date=${SELECTED_DATE}`
    );
    // The diary is a day view: a preset logged from it belongs to the day being
    // viewed, unlike the coaching surfaces, which always program today.
    expect(navigatedState().draft?.entry_date).toBe(SELECTED_DATE);
    expect(navigatedState().draft?.name).toBe('Upper Body');
  });

  it('prompts before replacing a workout already in progress for that day', async () => {
    saveWorkoutPlaybackDraftToStorage(
      createWorkoutPlaybackDraftFromPreset(presetFixture, SELECTED_DATE)
    );

    renderCard();
    openPresetSelector();
    fireEvent.click(await screen.findByText('pick preset'));

    expect(
      await screen.findByText('Workout already in progress')
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    // The add dialog closes first, so the prompt is not buried under it.
    expect(screen.queryByText('add-exercise-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Resume it'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    expect(navigatedState().draft).toBeUndefined();
  });
});

// The sequential banner's own badge — the plan name is not rendered in it.
const PLAN_BADGE = 'Plan Up Next';
const ASSIGNMENT_ID = 4242;

const sequentialPlan = {
  id: 7,
  plan_name: 'QA Rotation',
  schedule_type: 'sequential',
  assignments: [
    { id: ASSIGNMENT_ID, session_index: 2, session_name: 'QA Pull' },
  ],
  next_assignment: {
    id: ASSIGNMENT_ID,
    session_index: 2,
    session_name: 'QA Pull',
  },
  sequence_position: { current: 2, total: 3, session_name: 'QA Pull' },
};

// A live plan session as the server writes it: the entry and its prescribed
// sets exist from the moment the workout is started, `completed_at` null on
// every one of them until a set is ticked.
const startedPlanSession = (completedAt: string | null) => ({
  type: 'preset',
  id: 'preset-entry-1',
  entry_date: SELECTED_DATE,
  name: 'QA Pull',
  workout_plan_assignment_id: ASSIGNMENT_ID,
  total_duration_minutes: 0,
  exercises: [
    {
      id: 'entry-1',
      exercise_id: 'exercise-1',
      exercise_name: 'Lat Pulldown',
      workout_plan_assignment_id: ASSIGNMENT_ID,
      duration_minutes: 0,
      calories_burned: 0,
      entry_date: SELECTED_DATE,
      sets: [
        {
          id: 1,
          set_number: 1,
          reps: 10,
          weight: 40,
          completed_at: completedAt,
        },
        { id: 2, set_number: 2, reps: 10, weight: 40, completed_at: null },
      ],
      activity_details: [],
      superset_group: null,
    },
  ],
  activity_details: [],
});

describe('ExerciseCard plan banner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    activePlans = [sequentialPlan];
  });

  it('keeps the banner up for a session that was started but never logged', () => {
    dayEntries = [startedPlanSession(null)];
    renderCard();

    // The entry exists only because the session was opened — on the phone or
    // here — so the plan still has today's session outstanding, and the banner
    // is the way back into it.
    expect(screen.getByText(PLAN_BADGE)).toBeInTheDocument();
  });

  it('hides the banner once a set in the session has been completed', () => {
    dayEntries = [startedPlanSession('2026-08-18T10:00:00.000Z')];
    renderCard();

    // One ticked set of two: the session was trained, so the plan stops
    // asking for it today.
    expect(screen.queryByText(PLAN_BADGE)).not.toBeInTheDocument();
  });

  it('counts a plan entry that carries no set list at all', () => {
    // Hand-logged and synced rows reach this card without a `sets` array,
    // which the day's totals above already allow for. Nothing in such an
    // entry could have been ticked, so it counts as performed rather than
    // throwing on the way past.
    const entry = startedPlanSession(null) as {
      exercises: { sets?: unknown }[];
    };
    delete entry.exercises[0]!.sets;
    dayEntries = [entry];

    renderCard();
    expect(screen.queryByText(PLAN_BADGE)).not.toBeInTheDocument();
  });
});
