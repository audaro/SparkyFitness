import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { useWorkoutPlaybackStart } from '@/hooks/Exercises/useWorkoutPlaybackStart';
import {
  createWorkoutPlaybackDraftFromPreset,
  saveWorkoutPlaybackDraftToStorage,
  type WorkoutPlaybackDraft,
} from '@/utils/workoutPlayback';
import type { WorkoutPreset } from '@/types/workout';

const mockNavigate = jest.fn();
const mockOnStarted = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/exercises', search: '?date=2026-08-18' }),
}));

const makePreset = (name: string): WorkoutPreset =>
  ({
    id: 'preset-1',
    user_id: 'user-1',
    name,
    description: null,
    exercises: [
      {
        exercise_id: 'exercise-1',
        exercise_name: 'Bench Press',
        sets: [{ set_number: 1, reps: 8, weight: 80, rest_time: 90 }],
      },
    ],
  }) as unknown as WorkoutPreset;

const ENTRY_DATE = '2026-08-24';

/** Minimal host: the hook's whole surface is a trigger and the dialog. */
const Harness = () => {
  const { requestStart, guardDialog } = useWorkoutPlaybackStart();

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          requestStart({
            entryDate: ENTRY_DATE,
            createDraft: () =>
              createWorkoutPlaybackDraftFromPreset(
                makePreset('Upper Body'),
                ENTRY_DATE
              ),
            onStarted: mockOnStarted,
          })
        }
      >
        start
      </button>
      {guardDialog}
    </div>
  );
};

const storeUnfinishedWorkout = () => {
  saveWorkoutPlaybackDraftToStorage(
    createWorkoutPlaybackDraftFromPreset(
      makePreset('Half-finished workout'),
      ENTRY_DATE
    )
  );
};

const navigatedState = (): {
  returnTo?: string;
  draft?: WorkoutPlaybackDraft;
} => mockNavigate.mock.calls[0][1].state;

describe('useWorkoutPlaybackStart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it('enters playback directly when the day has no workout in progress', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('start'));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate.mock.calls[0][0]).toBe(
      '/workout-playback?date=2026-08-24'
    );
    expect(navigatedState().draft?.name).toBe('Upper Body');
    expect(navigatedState().returnTo).toBe('/exercises?date=2026-08-18');
    expect(mockOnStarted).toHaveBeenCalledTimes(1);
  });

  it('prompts instead of navigating when the day already has one', () => {
    storeUnfinishedWorkout();

    render(<Harness />);
    fireEvent.click(screen.getByText('start'));

    // The route-state draft would have overwritten the stored one on arrival,
    // taking every logged set with it.
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockOnStarted).not.toHaveBeenCalled();
    expect(screen.getByText('Workout already in progress')).toBeInTheDocument();
  });

  it('replaces the unfinished workout once confirmed', () => {
    storeUnfinishedWorkout();

    render(<Harness />);
    fireEvent.click(screen.getByText('start'));
    fireEvent.click(screen.getByText('Start new workout'));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(navigatedState().draft?.name).toBe('Upper Body');
    expect(mockOnStarted).toHaveBeenCalledTimes(1);
  });

  it('resumes by navigating with no draft at all', () => {
    storeUnfinishedWorkout();

    render(<Harness />);
    fireEvent.click(screen.getByText('start'));
    fireEvent.click(screen.getByText('Resume it'));

    // Sending no draft is what makes the playback page fall back to the stored
    // one; sending any draft here would be the overwrite this guards against.
    expect(navigatedState().draft).toBeUndefined();
    expect(navigatedState().returnTo).toBe('/exercises?date=2026-08-18');
    // Resuming an old workout is not starting the new one.
    expect(mockOnStarted).not.toHaveBeenCalled();
  });

  it('cancelling leaves the unfinished workout untouched', () => {
    storeUnfinishedWorkout();

    render(<Harness />);
    fireEvent.click(screen.getByText('start'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(
      screen.queryByText('Workout already in progress')
    ).not.toBeInTheDocument();
  });

  it('builds the draft only when playback is actually entered', () => {
    storeUnfinishedWorkout();
    const createDraft = jest.fn(() =>
      createWorkoutPlaybackDraftFromPreset(makePreset('Upper Body'), ENTRY_DATE)
    );

    const LazyHarness = () => {
      const { requestStart, guardDialog } = useWorkoutPlaybackStart();
      return (
        <div>
          <button
            type="button"
            onClick={() => requestStart({ entryDate: ENTRY_DATE, createDraft })}
          >
            start
          </button>
          {guardDialog}
        </div>
      );
    };

    render(<LazyHarness />);
    fireEvent.click(screen.getByText('start'));

    // A draft stamps `started_at` when it is built, so one built for a start
    // the user then cancels would carry a start time that never happened.
    expect(createDraft).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Start new workout'));
    expect(createDraft).toHaveBeenCalledTimes(1);
  });
});
