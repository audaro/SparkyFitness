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

jest.mock('@/hooks/Exercises/useExerciseEntries', () => ({
  useExerciseEntries: () => ({ data: [], isLoading: false }),
  useDeleteExerciseEntryMutation: () => ({ mutateAsync: jest.fn() }),
  useDeleteExercisePresetEntryMutation: () => ({ mutateAsync: jest.fn() }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ fetchQuery: jest.fn() }),
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
