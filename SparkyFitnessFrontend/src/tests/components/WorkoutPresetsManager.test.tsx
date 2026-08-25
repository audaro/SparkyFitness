import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import WorkoutPresetsManager from '@/pages/Exercises/WorkoutPresetsManager';
import type { WorkoutPreset } from '@/types/workout';
import {
  createWorkoutPlaybackDraftFromPreset,
  saveWorkoutPlaybackDraftToStorage,
  type WorkoutPlaybackDraft,
} from '@/utils/workoutPlayback';
import { todayInZone } from '@workspace/shared';

const mockCreatePreset = jest.fn();
const mockNavigate = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultOrValues?: string | Record<string, unknown>) => {
      if (typeof defaultOrValues === 'string') return defaultOrValues;
      if (defaultOrValues && typeof defaultOrValues === 'object') {
        // Real interpolation only for the key exercised in these tests
        // (matches en/translation.json's "{{name}} (Copy)"), so the
        // duplicate-name truncation tests assert on the actual rendered
        // string rather than a synthetic JSON blob. Other keyed
        // interpolations fall back to the JSON-stringified form.
        if (key === 'workoutPresetsManager.duplicateNameSuffix') {
          const { name } = defaultOrValues as { name: string };
          return `${name} (Copy)`;
        }
        return `${key}:${JSON.stringify(defaultOrValues)}`;
      }
      return key;
    },
  }),
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/exercises', search: '' }),
}));

jest.mock('@/contexts/PreferencesContext', () => ({
  // `timezone` matters here: the preset paths log to today in the *user's*
  // timezone, not the machine's local date.
  usePreferences: () => ({ weightUnit: 'kg', timezone: 'UTC' }),
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('@/hooks/Exercises/useExerciseEntries', () => ({
  useLogWorkoutPresetMutation: () => ({ mutateAsync: jest.fn() }),
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
  ],
} as unknown as WorkoutPreset;

jest.mock('@/hooks/Exercises/useWorkoutPresets', () => ({
  useWorkoutPresets: () => ({
    data: { pages: [{ presets: [presetFixture], total: 1 }] },
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isLoading: false,
    isFetchingNextPage: false,
  }),
  useCreateWorkoutPresetMutation: () => ({
    mutateAsync: (...args: unknown[]) => mockCreatePreset(...args),
  }),
  useUpdateWorkoutPresetMutation: () => ({ mutateAsync: jest.fn() }),
  useDeleteWorkoutPresetMutation: () => ({ mutateAsync: jest.fn() }),
}));

describe('WorkoutPresetsManager duplicate preset', () => {
  beforeEach(() => {
    mockCreatePreset.mockReset();
  });

  it('creates a private copy with the original exercises/sets and a "(Copy)" name, regardless of the source visibility', async () => {
    render(<WorkoutPresetsManager />);

    // DataTable renders both a desktop table and a mobile card list at once
    // (toggled with CSS media queries jsdom doesn't apply), so each row's
    // menu trigger appears twice; only one needs to be exercised here.
    // Radix's dropdown trigger opens on pointerDown, not click.
    const trigger = screen.getAllByRole('button', { name: /open menu/i })[0]!;
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);
    fireEvent.click((await screen.findAllByText('Duplicate'))[0]!);

    await waitFor(() => expect(mockCreatePreset).toHaveBeenCalledTimes(1));
    expect(mockCreatePreset).toHaveBeenCalledWith({
      user_id: 'user-1',
      name: 'Upper Body (Copy)',
      description: 'Push + Pull',
      is_public: false,
      exercises: presetFixture.exercises.map((exercise, index) => ({
        ...exercise,
        sort_order: index,
      })),
    });
  });

  it('truncates a max-length preset name so the duplicate stays within 255 characters', async () => {
    const originalName = presetFixture.name;
    presetFixture.name = 'A'.repeat(255);

    try {
      render(<WorkoutPresetsManager />);

      const trigger = screen.getAllByRole('button', { name: /open menu/i })[0]!;
      fireEvent.pointerDown(trigger, {
        button: 0,
        ctrlKey: false,
        pointerId: 1,
      });
      fireEvent.click(trigger);
      fireEvent.click((await screen.findAllByText('Duplicate'))[0]!);

      await waitFor(() => expect(mockCreatePreset).toHaveBeenCalledTimes(1));
      const duplicateName = (
        mockCreatePreset.mock.calls[0]![0] as { name: string }
      ).name;
      // 248-char truncated name + " (Copy)" (7 chars) = 255, the
      // workout_presets.name VARCHAR(255) limit.
      expect(duplicateName).toBe(`${'A'.repeat(248)} (Copy)`);
      expect(duplicateName.length).toBe(255);
    } finally {
      presetFixture.name = originalName;
    }
  });
});

describe('WorkoutPresetsManager start workout', () => {
  // The mocked timezone, so this matches what the component computes.
  const today = todayInZone('UTC');

  const startPresetFromRowMenu = async () => {
    const trigger = screen.getAllByRole('button', { name: /open menu/i })[0]!;
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);
    // By role, not by text: "Start Workout" is also the page header button and
    // the title of the dialog it opens.
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /start workout/i })
    );
  };

  const navigatedState = (): {
    returnTo?: string;
    draft?: WorkoutPlaybackDraft;
  } => mockNavigate.mock.calls[0]![1].state;

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it('enters playback with the preset as a draft, logged to today in the user timezone', async () => {
    render(<WorkoutPresetsManager />);
    await startPresetFromRowMenu();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    expect(mockNavigate.mock.calls[0]![0]).toBe(
      `/workout-playback?date=${today}`
    );
    expect(navigatedState().draft?.name).toBe('Upper Body');
    expect(navigatedState().draft?.entry_date).toBe(today);
  });

  it('prompts before replacing a workout already in progress for the day', async () => {
    saveWorkoutPlaybackDraftToStorage(
      createWorkoutPlaybackDraftFromPreset(presetFixture, today)
    );

    render(<WorkoutPresetsManager />);
    await startPresetFromRowMenu();

    // Without the guard the route-state draft would replace the stored one on
    // arrival, taking every set logged into it.
    expect(
      await screen.findByText('Workout already in progress')
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Start new workout'));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
  });
});
