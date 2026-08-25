import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import UpNextCard from '@/pages/Exercises/UpNextCard';
import type { RecommendedExercise } from '@workspace/shared';
import type { WorkoutRecommendation } from '@/hooks/Exercises/useWorkoutRecommendation';
import type { GymProfile } from '@/hooks/Exercises/useGymProfiles';
import {
  createWorkoutPlaybackDraftFromRecommendation,
  saveWorkoutPlaybackDraftToStorage,
} from '@/utils/workoutPlayback';

const mockGenerate = jest.fn();
const mockRefetch = jest.fn();
const mockMarkStatus = jest.fn();
const mockNavigate = jest.fn();

let mockIsActingOnBehalf = false;
let mockRecommendation: WorkoutRecommendation | null = null;
let mockProfiles: GymProfile[] = [];
let mockQueryState = { isLoading: false, isError: false };
let mockWeightUnit: 'kg' | 'lbs' = 'kg';
let mockDistanceUnit: 'km' | 'miles' = 'km';
let mockTimezone = 'UTC';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultOrValues?: string | Record<string, unknown>) => {
      if (typeof defaultOrValues === 'string') return defaultOrValues;
      if (defaultOrValues && typeof defaultOrValues === 'object') {
        const values = defaultOrValues as {
          defaultValue?: string;
          defaultValue_one?: string;
          defaultValue_other?: string;
          count?: number;
        } & Record<string, unknown>;
        const template =
          values.count === 1
            ? (values.defaultValue_one ?? values.defaultValue)
            : (values.defaultValue_other ?? values.defaultValue);
        if (typeof template === 'string') {
          return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
            String(values[name] ?? '')
          );
        }
        return key;
      }
      return key;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({ isActingOnBehalf: mockIsActingOnBehalf }),
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/exercises', search: '?date=2026-08-18' }),
}));

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({
    weightUnit: mockWeightUnit,
    distanceUnit: mockDistanceUnit,
    timezone: mockTimezone,
    convertWeight: (value: number, from: string, to: string) =>
      from === to ? value : value * 2.20462,
    convertDistance: (value: number, from: string, to: string) =>
      from === to ? value : value * 0.621371,
  }),
}));

jest.mock('@/hooks/Exercises/useGymProfiles', () => ({
  useGymProfiles: () => ({ profiles: mockProfiles }),
}));

jest.mock('@/hooks/Exercises/useWorkoutRecommendation', () => ({
  useWorkoutRecommendation: () => ({
    data: mockRecommendation,
    isLoading: mockQueryState.isLoading,
    isError: mockQueryState.isError,
    refetch: mockRefetch,
  }),
  useGenerateWorkoutRecommendationMutation: () => ({
    mutate: mockGenerate,
    isPending: false,
  }),
  useUpdateWorkoutRecommendationStatusMutation: () => ({
    mutate: mockMarkStatus,
  }),
}));

const makeExercise = (
  overrides: Partial<RecommendedExercise> = {}
): RecommendedExercise => ({
  exercise_id: '11111111-1111-4111-8111-111111111111',
  exercise_name: 'Barbell Bench Press',
  modality: 'weight_reps',
  primary_muscles: ['chest'],
  secondary_muscles: ['triceps'],
  equipment: ['barbell'],
  images: [],
  sort_order: 0,
  rest_seconds: 120,
  rationale: 'Fresh chest',
  sets: [
    {
      set_number: 1,
      set_type: 'Warmup',
      reps: 10,
      weight: 40,
      duration: null,
      distance: null,
      rest_time: 60,
    },
    {
      set_number: 2,
      set_type: 'Working Set',
      reps: 8,
      weight: 60,
      duration: null,
      distance: null,
      rest_time: 120,
    },
    {
      set_number: 3,
      set_type: 'Working Set',
      reps: 8,
      weight: 60,
      duration: null,
      distance: null,
      rest_time: 120,
    },
  ],
  ...overrides,
});

const makeRecommendation = (
  overrides: Partial<WorkoutRecommendation> = {},
  exercises: RecommendedExercise[] = [makeExercise()]
): WorkoutRecommendation => ({
  id: '22222222-2222-4222-8222-222222222222',
  status: 'active',
  target_duration_minutes: 45,
  gym_profile_id: null,
  generated_at: '2026-08-24T10:00:00.000Z',
  payload: {
    muscle_groups: ['chest', 'triceps'],
    estimated_duration_minutes: 44,
    exercises,
  },
  ...overrides,
});

describe('UpNextCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsActingOnBehalf = false;
    mockRecommendation = null;
    mockProfiles = [];
    mockQueryState = { isLoading: false, isError: false };
    mockWeightUnit = 'kg';
    mockDistanceUnit = 'km';
    mockTimezone = 'UTC';
    window.localStorage.clear();
    // Resolve the mutation so the in-flight guard clears between assertions.
    mockGenerate.mockImplementation((_payload, options) =>
      options?.onSettled?.()
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders nothing while acting on behalf of another user', () => {
    mockIsActingOnBehalf = true;
    mockRecommendation = makeRecommendation();

    const { container } = render(<UpNextCard />);

    expect(container).toBeEmptyDOMElement();
  });

  it('offers a Generate button when no workout has been generated yet', () => {
    render(<UpNextCard />);

    expect(screen.getByText('Generate workout')).toBeInTheDocument();
    expect(screen.queryByText('New workout')).not.toBeInTheDocument();
  });

  it('generates at the selected duration without swapping on first run', () => {
    render(<UpNextCard />);

    fireEvent.click(screen.getByText('Generate workout'));

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate.mock.calls[0][0]).toEqual({ duration_minutes: 60 });
  });

  it('regenerating always swaps, at the stored duration', () => {
    mockRecommendation = makeRecommendation();

    render(<UpNextCard />);

    fireEvent.click(screen.getByText('New workout'));

    // The engine is deterministic: without swap this would return the same
    // workout, which is the one thing "New workout" must not do.
    expect(mockGenerate.mock.calls[0][0]).toEqual({
      duration_minutes: 45,
      swap: true,
    });
  });

  it('ignores a second click while a generate is still in flight', () => {
    mockGenerate.mockImplementation(() => {
      /* never settles */
    });
    mockRecommendation = makeRecommendation();

    render(<UpNextCard />);

    const button = screen.getByText('New workout');
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it('summarises working sets only, ignoring the warm-up ramp', () => {
    mockRecommendation = makeRecommendation();

    render(<UpNextCard />);

    // Three stored sets, one of them a warm-up: "2 sets", not "3 sets".
    expect(screen.getByText('2 sets · 8 reps · 60 kg')).toBeInTheDocument();
  });

  it('converts the programmed weight into the display unit', () => {
    mockWeightUnit = 'lbs';
    mockRecommendation = makeRecommendation();

    render(<UpNextCard />);

    expect(screen.getByText('2 sets · 8 reps · 132.3 lbs')).toBeInTheDocument();
  });

  it('formats a cardio prescription as duration and distance', () => {
    mockRecommendation = makeRecommendation({}, [
      makeExercise({
        exercise_id: '33333333-3333-4333-8333-333333333333',
        exercise_name: 'Running',
        modality: 'duration_distance',
        rest_seconds: 0,
        sets: [
          {
            set_number: 1,
            set_type: 'Working Set',
            reps: null,
            weight: null,
            duration: 1800,
            distance: 5,
            rest_time: null,
          },
        ],
      }),
    ]);

    render(<UpNextCard />);

    expect(screen.getByText('30:00 · 5 km')).toBeInTheDocument();
  });

  it('drops the measure a modality gives no meaning to', () => {
    mockRecommendation = makeRecommendation({}, [
      makeExercise({
        exercise_id: '44444444-4444-4444-8444-444444444444',
        exercise_name: 'Plank',
        modality: 'duration',
        sets: [
          {
            set_number: 1,
            set_type: 'Working Set',
            reps: null,
            weight: null,
            duration: 45,
            distance: null,
            rest_time: 60,
          },
        ],
      }),
    ]);

    render(<UpNextCard />);

    // No "0 reps" and no "0 kg" — a null measure is absent, not zero.
    expect(screen.getByText('1 set · 45s')).toBeInTheDocument();
  });

  it('names the gym profile the workout was built with', () => {
    mockProfiles = [
      {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Home Garage',
        equipment: ['barbell'],
        is_active: false,
      } as GymProfile,
      {
        id: '66666666-6666-4666-8666-666666666666',
        name: 'Commercial Gym',
        equipment: ['cable'],
        is_active: true,
      } as GymProfile,
    ];
    mockRecommendation = makeRecommendation({
      gym_profile_id: '55555555-5555-4555-8555-555555555555',
    });

    render(<UpNextCard />);

    // The profile it was built with, not the one currently active.
    expect(screen.getByText('Home Garage')).toBeInTheDocument();
    expect(screen.queryByText('Commercial Gym')).not.toBeInTheDocument();
  });

  it('says nothing about equipment when the profile has since been deleted', () => {
    mockProfiles = [];
    mockRecommendation = makeRecommendation({
      gym_profile_id: '77777777-7777-4777-8777-777777777777',
    });

    render(<UpNextCard />);

    expect(screen.queryByText('Any equipment')).not.toBeInTheDocument();
    expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
  });

  it('keeps showing a cached workout when a refetch fails', () => {
    mockRecommendation = makeRecommendation();
    mockQueryState = { isLoading: false, isError: true };

    render(<UpNextCard />);

    // isError is also true for a failed refetch over good data; blanking the
    // workout the user can still read would be the worse offline story.
    expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
    expect(
      screen.queryByText('Failed to load your suggested workout.')
    ).not.toBeInTheDocument();
  });

  it('offers a retry when the load failed with nothing cached', () => {
    mockQueryState = { isLoading: false, isError: true };

    render(<UpNextCard />);

    expect(
      screen.getByText('Failed to load your suggested workout.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText('Retry'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('offers no way to start before a workout has been generated', () => {
    render(<UpNextCard />);

    expect(screen.queryByText('Start workout')).not.toBeInTheDocument();
  });

  it('hands the generated workout to playback and returns to this page', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-24T12:00:00.000Z'));
    mockRecommendation = makeRecommendation();

    render(<UpNextCard />);
    fireEvent.click(screen.getByText('Start workout'));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const [path, options] = mockNavigate.mock.calls[0];
    expect(path).toBe('/workout-playback?date=2026-08-24');
    expect(options.state.returnTo).toBe('/exercises?date=2026-08-18');

    const draft = options.state.draft;
    expect(draft.name).toBe('Up Next workout');
    expect(draft.entry_date).toBe('2026-08-24');
    expect(draft.exercises).toHaveLength(1);
    expect(draft.exercises[0].exercise_name).toBe('Barbell Bench Press');
    // The whole prescription is played, warm-up ramp included.
    expect(draft.exercises[0].sets).toHaveLength(3);
  });

  it('marks the recommendation started', () => {
    mockRecommendation = makeRecommendation();

    render(<UpNextCard />);
    fireEvent.click(screen.getByText('Start workout'));

    expect(mockMarkStatus).toHaveBeenCalledWith({
      id: '22222222-2222-4222-8222-222222222222',
      status: 'started',
    });
  });

  it("logs the workout to today in the user's timezone, not the browsed day", () => {
    // 06:00 UTC on the 24th is still the 23rd in Los Angeles. The page is also
    // showing 2026-08-18 through its `?date=`, and neither of those is the day
    // this workout belongs to.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-24T06:00:00.000Z'));
    mockTimezone = 'America/Los_Angeles';
    mockRecommendation = makeRecommendation();

    render(<UpNextCard />);
    fireEvent.click(screen.getByText('Start workout'));

    expect(mockNavigate.mock.calls[0][0]).toBe(
      '/workout-playback?date=2026-08-23'
    );
    expect(mockNavigate.mock.calls[0][1].state.draft.entry_date).toBe(
      '2026-08-23'
    );
  });

  it('asks before replacing a workout already in progress for the day', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-24T12:00:00.000Z'));
    mockRecommendation = makeRecommendation();
    saveWorkoutPlaybackDraftToStorage(
      createWorkoutPlaybackDraftFromRecommendation(
        makeRecommendation().payload,
        '2026-08-24',
        'Half-finished workout'
      )
    );

    render(<UpNextCard />);
    fireEvent.click(screen.getByText('Start workout'));

    // A route-state draft overwrites the stored one, so navigating here would
    // silently discard the unfinished workout.
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByText('Workout already in progress')).toBeInTheDocument();
  });

  it('replaces the unfinished workout only once confirmed', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-24T12:00:00.000Z'));
    mockRecommendation = makeRecommendation();
    saveWorkoutPlaybackDraftToStorage(
      createWorkoutPlaybackDraftFromRecommendation(
        makeRecommendation().payload,
        '2026-08-24',
        'Half-finished workout'
      )
    );

    render(<UpNextCard />);
    fireEvent.click(screen.getByText('Start workout'));
    fireEvent.click(screen.getByText('Start new workout'));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate.mock.calls[0][1].state.draft.name).toBe(
      'Up Next workout'
    );
  });

  it('resumes the unfinished workout without a draft to overwrite it', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-24T12:00:00.000Z'));
    mockRecommendation = makeRecommendation();
    saveWorkoutPlaybackDraftToStorage(
      createWorkoutPlaybackDraftFromRecommendation(
        makeRecommendation().payload,
        '2026-08-24',
        'Half-finished workout'
      )
    );

    render(<UpNextCard />);
    fireEvent.click(screen.getByText('Start workout'));
    fireEvent.click(screen.getByText('Resume it'));

    // No draft in the route state is what makes the playback page fall back to
    // the stored one — that fallback IS the resume.
    expect(mockNavigate).toHaveBeenCalledWith(
      '/workout-playback?date=2026-08-24',
      { state: { returnTo: '/exercises?date=2026-08-18' } }
    );
    // Resuming is not starting the generated workout.
    expect(mockMarkStatus).not.toHaveBeenCalled();
  });
});
