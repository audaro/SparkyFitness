import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import WorkoutPlaybackPage from '@/pages/Diary/WorkoutPlaybackPage';
import type { WorkoutPreset } from '@/types/workout';
import { createWorkoutPlaybackDraftFromPreset } from '@/utils/workoutPlayback';

const mockNavigate = jest.fn();
const mockCreatePresetSession = jest.fn();
const mockSearchParams = new URLSearchParams('date=2026-04-27');
let mockLocationState: { returnTo?: string; draft?: unknown } | null = null;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultValue?: string,
      values?: Record<string, string | number>
    ) =>
      (defaultValue || key).replace(
        '{{setNumber}}',
        String(values?.['setNumber'] ?? '{{setNumber}}')
      ),
  }),
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: mockLocationState }),
  useSearchParams: () => [mockSearchParams],
}));

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ weightUnit: 'kg', timezone: 'UTC' }),
}));

jest.mock('@/hooks/Exercises/useExerciseEntries', () => ({
  useCreatePresetSessionMutation: () => ({
    mutateAsync: (...args: unknown[]) => mockCreatePresetSession(...args),
    isPending: false,
  }),
}));

const presetFixture: WorkoutPreset = {
  id: 'preset-1',
  user_id: 'user-1',
  name: 'Upper Body',
  description: 'Push + Pull',
  exercises: [
    {
      exercise_id: 'exercise-1',
      exercise_name: 'Bench Press',
      sets: [{ set_number: 1, reps: 8, weight: 80, rest_time: 90 }],
    },
    {
      exercise_id: 'exercise-2',
      exercise_name: 'Barbell Row',
      sets: [{ set_number: 1, reps: 10, weight: 60, rest_time: 90 }],
    },
  ],
} as unknown as WorkoutPreset;

describe('WorkoutPlaybackPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockCreatePresetSession.mockReset();
    window.localStorage.clear();
    mockLocationState = { returnTo: '/?date=2026-04-27' };
  });

  it('shows elapsed timer and collapses completed exercises', () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    if (draft.exercises[0]?.sets[0]) {
      draft.exercises[0].sets[0].completed = true;
    }
    draft.active_exercise_index = 1;
    draft.active_set_index = 0;
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    expect(screen.getAllByText('Duration').length).toBeGreaterThan(0);
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThanOrEqual(1);
  });

  it('renders duration instead of reps and weight for a timed set', () => {
    const timedPreset = {
      ...presetFixture,
      exercises: [
        {
          exercise_id: 'exercise-treadmill',
          exercise_name: 'Treadmill Warm Up',
          category: 'cardio',
          sets: [
            {
              set_number: 1,
              set_type: 'Warm-up',
              duration: 600,
              reps: null,
              weight: null,
              rest_time: 60,
            },
          ],
        },
      ],
    } as unknown as WorkoutPreset;
    const draft = createWorkoutPlaybackDraftFromPreset(
      timedPreset,
      '2026-04-27'
    );
    expect(draft.exercises[0]?.modality).toBe('duration_distance');
    // Pre-modality local drafts must retain their time-based rendering.
    delete (draft.exercises[0] as { modality?: unknown }).modality;
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    expect(screen.getByText('Duration (s)')).toBeInTheDocument();
    const durationInput = screen.getByLabelText(
      'Duration set 1'
    ) as HTMLInputElement;
    expect(durationInput).toHaveValue(600);
    fireEvent.change(durationInput, { target: { value: '300' } });
    expect(durationInput).toHaveValue(300);
    expect(screen.queryByLabelText('Reps set 1')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Weight set 1')).not.toBeInTheDocument();
  });

  it('keeps blank rows duration-based in legacy timed drafts', () => {
    const timedPreset = {
      ...presetFixture,
      exercises: [
        {
          exercise_id: 'exercise-treadmill',
          exercise_name: 'Treadmill Warm Up',
          category: 'cardio',
          sets: [
            {
              set_number: 1,
              duration: 600,
              reps: null,
              weight: 0,
              rest_time: 60,
            },
          ],
        },
      ],
    } as unknown as WorkoutPreset;
    const draft = createWorkoutPlaybackDraftFromPreset(
      timedPreset,
      '2026-04-27'
    );
    delete (draft.exercises[0] as { modality?: unknown }).modality;
    draft.exercises[0]?.sets.push({
      set_number: 2,
      duration: null,
      reps: null,
      weight: null,
      rest_time: 60,
      completed: false,
      completed_at: null,
    });
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    expect(screen.getByText('Duration (s)')).toBeInTheDocument();
    expect(screen.getByLabelText('Duration set 1')).toHaveValue(600);
    expect(screen.getByLabelText('Duration set 2')).toHaveValue(null);
    expect(screen.queryByLabelText('Reps set 2')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Weight set 2')).not.toBeInTheDocument();
  });

  it('trusts exercise modality over stale set data', () => {
    const mixedPreset = {
      ...presetFixture,
      exercises: [
        {
          exercise_id: 'exercise-plank',
          exercise_name: 'Plank',
          category: 'isometric',
          sets: [
            {
              set_number: 1,
              duration: null,
              reps: null,
              weight: null,
              rest_time: 60,
            },
          ],
        },
        {
          exercise_id: 'exercise-bench',
          exercise_name: 'Bench Press',
          sets: [
            {
              set_number: 1,
              duration: 600,
              reps: null,
              weight: 80,
              rest_time: 90,
            },
          ],
        },
      ],
    } as unknown as WorkoutPreset;
    const draft = createWorkoutPlaybackDraftFromPreset(
      mixedPreset,
      '2026-04-27'
    );
    expect(draft.exercises[0]?.modality).toBe('duration');
    expect(draft.exercises[1]?.modality).toBe('weight_reps');
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    // Plank is timed by modality even with no duration values yet.
    expect(screen.getByLabelText('Duration set 1')).toHaveValue(null);
    // Bench keeps reps/weight despite a stale duration on its set.
    expect(screen.getByLabelText('Reps set 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Weight set 1')).toBeInTheDocument();
  });

  it('restores a draft from localStorage on reload', async () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    window.localStorage.setItem(
      'sparky.workoutPlaybackDraft.v1:2026-04-27',
      JSON.stringify(draft)
    );
    mockLocationState = { returnTo: '/?date=2026-04-27' };

    render(<WorkoutPlaybackPage />);

    await waitFor(() => {
      expect(screen.getByText('Upper Body')).toBeInTheDocument();
    });
    expect(screen.getAllByLabelText('Reps set 1')[0]).toBeInTheDocument();
  });

  it('starts rest countdown when current set is completed', () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    fireEvent.click(screen.getAllByLabelText('Complete set 1')[0]!);

    expect(
      screen.getAllByRole('button', { name: 'Pause' }).length
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
    expect(screen.getByText('640')).toBeInTheDocument();
  });

  it('allows editing set values and adding/removing sets', () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    const repsInput = screen.getAllByLabelText(
      'Reps set 1'
    )[0] as HTMLInputElement;
    fireEvent.change(repsInput, { target: { value: '12' } });
    expect(repsInput.value).toBe('12');

    fireEvent.click(screen.getByLabelText('Add set for Bench Press'));
    expect(screen.getAllByLabelText('Reps set 2').length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getAllByLabelText('Remove set 2 for Bench Press')[0]!
    );
    expect(screen.queryByLabelText('Reps set 2')).not.toBeInTheDocument();

    const sessionNotes = screen.getAllByPlaceholderText(
      'Any notes about this session...'
    )[0] as HTMLTextAreaElement;
    fireEvent.change(sessionNotes, { target: { value: 'Felt strong today' } });
    expect(sessionNotes.value).toBe('Felt strong today');

    expect(screen.queryByLabelText('Set notes 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText('Toggle notes for set 1')[0]!);
    expect(screen.getByLabelText('Set notes 1')).toBeInTheDocument();
  });

  it('clears the start time when the clear button is clicked', () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    draft.started_at = '2026-04-27T14:30:00.000Z';
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    const startTimeInput = screen.getByLabelText(
      'Start Time'
    ) as HTMLInputElement;
    expect(startTimeInput.value).toBe('14:30');

    fireEvent.click(screen.getByText('Clear'));
    expect(startTimeInput.value).toBe('');
  });

  it('allows extending a finished exercise after expanding it', () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    if (draft.exercises[0]?.sets[0]) {
      draft.exercises[0].sets[0].completed = true;
    }
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    fireEvent.click(screen.getByLabelText('Expand Bench Press'));
    fireEvent.click(screen.getByLabelText('Add set for Bench Press'));

    expect(screen.getAllByLabelText('Reps set 2').length).toBeGreaterThan(0);
  });

  it('edits rest via rest chip presets', () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    fireEvent.click(screen.getAllByLabelText('Edit rest for set 1')[0]!);
    fireEvent.click(screen.getByRole('button', { name: '2:00' }));

    fireEvent.click(screen.getAllByLabelText('Edit rest for set 1')[0]!);
    expect(screen.getByLabelText('Custom (seconds)')).toHaveValue(120);
  });

  describe('hold timer', () => {
    // A plank: a timed set whose prescription is the thing being counted down.
    const plankPreset = {
      ...presetFixture,
      name: 'Core',
      exercises: [
        {
          exercise_id: 'exercise-plank',
          exercise_name: 'Plank',
          category: 'strength',
          modality: 'duration',
          sets: [
            {
              set_number: 1,
              set_type: 'Working Set',
              duration: 45,
              reps: null,
              weight: null,
              rest_time: 60,
            },
            {
              set_number: 2,
              set_type: 'Working Set',
              duration: 45,
              reps: null,
              weight: null,
              rest_time: 60,
            },
          ],
        },
      ],
    } as unknown as WorkoutPreset;

    const renderPlank = () => {
      const draft = createWorkoutPlaybackDraftFromPreset(
        plankPreset,
        '2026-04-27'
      );
      mockLocationState = { returnTo: '/?date=2026-04-27', draft };
      render(<WorkoutPlaybackPage />);
    };

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-04-27T10:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('counts down the prescribed duration of the set being held', () => {
      renderPlank();

      fireEvent.click(screen.getByLabelText('Start hold for set 1'));

      expect(screen.getByText('Hold')).toBeInTheDocument();
      expect(screen.getByText('0:45')).toBeInTheDocument();
      // The row's own button becomes the way out of the hold.
      expect(screen.getByLabelText('Stop hold for set 1')).toBeInTheDocument();
    });

    it('logs the time actually held when the hold is stopped early', () => {
      renderPlank();

      fireEvent.click(screen.getByLabelText('Start hold for set 1'));

      act(() => {
        jest.advanceTimersByTime(20_000);
      });

      fireEvent.click(screen.getByLabelText('Stop hold for set 1'));

      // Twenty seconds held, not the forty-five prescribed.
      expect(
        (screen.getByLabelText('Duration set 1') as HTMLInputElement).value
      ).toBe('20');
      expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
      // And it lands in the rest before the next set, exactly as ticking the
      // box does. (The tile is back to Rest; "Rest" also names a column, so
      // the countdown is identified by its controls.)
      expect(screen.queryByText('Hold')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Pause')).toBeInTheDocument();
    });

    it('logs the full target and starts the rest when the hold runs out', () => {
      renderPlank();

      fireEvent.click(screen.getByLabelText('Start hold for set 1'));

      act(() => {
        jest.advanceTimersByTime(46_000);
      });

      expect(
        (screen.getByLabelText('Duration set 1') as HTMLInputElement).value
      ).toBe('45');
      expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
      expect(screen.queryByText('Hold')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Pause')).toBeInTheDocument();
    });

    it('refuses to start a hold while a rest is running', () => {
      renderPlank();

      fireEvent.click(screen.getAllByLabelText('Complete set 1')[0]!);
      expect(screen.getByLabelText('Pause')).toBeInTheDocument();

      // Mutual exclusion: the break before a set and the work of one are never
      // both counting down.
      expect(screen.getByLabelText('Start hold for set 2')).toBeDisabled();
    });

    it('offers no hold on a set with no prescribed duration', () => {
      const draft = createWorkoutPlaybackDraftFromPreset(
        presetFixture,
        '2026-04-27'
      );
      mockLocationState = { returnTo: '/?date=2026-04-27', draft };

      render(<WorkoutPlaybackPage />);

      expect(
        screen.queryByLabelText('Start hold for set 1')
      ).not.toBeInTheDocument();
    });
  });

  it('keeps rest indicator anchored to next set even when selecting others', () => {
    const draft = createWorkoutPlaybackDraftFromPreset(
      presetFixture,
      '2026-04-27'
    );
    if (draft.exercises[0]?.sets[0]) {
      draft.exercises[0].sets.push({
        ...draft.exercises[0].sets[0],
        set_number: 2,
      });
    }
    mockLocationState = { returnTo: '/?date=2026-04-27', draft };

    render(<WorkoutPlaybackPage />);

    fireEvent.click(screen.getAllByLabelText('Complete set 1')[0]!);
    expect(screen.getByLabelText('Pause')).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByLabelText('Select set 2 for Bench Press')[0]!
    );

    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
  });
});
