import { act, renderHook, waitFor } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';

import {
  useExerciseAlternatives,
  useReplaceRecommendationExercise,
  useUpdateRecommendationStatus,
  useWorkoutRecommendation,
} from '../../src/hooks/useWorkoutRecommendation';
import {
  fetchAlternatives,
  fetchRecommendation,
  generateRecommendation,
  patchRecommendationStatus,
  replaceRecommendationExercise,
  type WorkoutRecommendation,
} from '../../src/services/api/workoutRecommendationsApi';
import { useRefetchOnFocus } from '../../src/hooks/useRefetchOnFocus';
import {
  exerciseAlternativesQueryKey,
  workoutRecommendationQueryKey,
} from '../../src/hooks/queryKeys';
import { createQueryWrapper, createTestQueryClient, type QueryClient } from './queryTestUtils';
import { apiError as rawApiError, apiErrorWithMessage } from '../helpers/apiError';

jest.mock('../../src/services/api/workoutRecommendationsApi', () => ({
  fetchRecommendation: jest.fn(),
  generateRecommendation: jest.fn(),
  patchRecommendationStatus: jest.fn(),
  fetchAlternatives: jest.fn(),
  replaceRecommendationExercise: jest.fn(),
}));

// Mocked rather than stubbing `useFocusEffect`: the contract this hook owns is
// that it hands its refetch to the shared focus hook gated on `enabled`, not
// anything about how React Navigation delivers focus. Screens rendering real
// trees stub `useFocusEffect` instead — see `OnDemandWorkoutsScreen`.
jest.mock('../../src/hooks/useRefetchOnFocus', () => ({
  useRefetchOnFocus: jest.fn(),
}));

jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

const mockFetch = fetchRecommendation as jest.MockedFunction<typeof fetchRecommendation>;
const mockGenerate = generateRecommendation as jest.MockedFunction<typeof generateRecommendation>;
const mockPatchStatus = patchRecommendationStatus as jest.MockedFunction<
  typeof patchRecommendationStatus
>;
const mockFetchAlternatives = fetchAlternatives as jest.MockedFunction<typeof fetchAlternatives>;
const mockReplace = replaceRecommendationExercise as jest.MockedFunction<
  typeof replaceRecommendationExercise
>;
const mockRefetchOnFocus = useRefetchOnFocus as jest.MockedFunction<typeof useRefetchOnFocus>;
const mockToast = Toast.show as jest.MockedFunction<typeof Toast.show>;

const recommendation = (overrides?: Partial<WorkoutRecommendation>): WorkoutRecommendation => ({
  id: '11111111-1111-4111-8111-111111111111',
  status: 'active',
  target_duration_minutes: 45,
  gym_profile_id: null,
  generated_at: '2026-08-24T09:00:00Z',
  payload: {
    muscle_groups: ['chest'],
    estimated_duration_minutes: 45,
    exercises: [
      {
        exercise_id: '22222222-2222-4222-8222-222222222222',
        exercise_name: 'Bench Press',
        modality: 'weight_reps',
        primary_muscles: ['chest'],
        secondary_muscles: ['triceps'],
        equipment: ['barbell'],
        images: [],
        sort_order: 0,
        rest_seconds: 90,
        rationale: 'fresh chest',
        sets: [
          {
            set_number: 1,
            set_type: 'Working Set',
            reps: 8,
            weight: 60,
            duration: null,
            distance: null,
            rest_time: 90,
          },
        ],
      },
    ],
  },
  ...overrides,
});

/** A 422 carrying a server message, the shape `getApiErrorMessage` can read. */
const apiError = (statusCode: number, message?: string) =>
  message ? apiErrorWithMessage(statusCode, message) : rawApiError(statusCode, '');

function renderWithClient<T>(hook: () => T, client: QueryClient = createTestQueryClient()) {
  const rendered = renderHook(hook, { wrapper: createQueryWrapper(client) });
  return { ...rendered, client };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useWorkoutRecommendation', () => {
  test('a user who has never generated one gets null, not an error', () => {
    // `fetchRecommendation` resolves null for a 404 rather than throwing, so
    // the card can show its empty state instead of a retry button.
    mockFetch.mockResolvedValue(null);

    const { result } = renderWithClient(() => useWorkoutRecommendation());

    return waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.recommendation).toBeNull();
      expect(result.current.isError).toBe(false);
    });
  });

  test('a failed read reports isError with no recommendation', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));

    const { result } = renderWithClient(() => useWorkoutRecommendation());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.recommendation).toBeNull();
  });

  test('subscribes its refetch to focus, gated on the same enabled flag', () => {
    mockFetch.mockResolvedValue(null);

    const { result } = renderWithClient(() => useWorkoutRecommendation({ enabled: false }));

    // The stored row goes stale on a day rollover and on a workout generated
    // from another device; `staleTime` is Infinity app-wide, so without this
    // the card holds whatever it fetched at launch.
    expect(mockRefetchOnFocus).toHaveBeenCalledWith(result.current.refetch, false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('enabled defaults to true', async () => {
    mockFetch.mockResolvedValue(recommendation());

    const { result } = renderWithClient(() => useWorkoutRecommendation());

    await waitFor(() => expect(result.current.recommendation).not.toBeNull());
    expect(mockRefetchOnFocus).toHaveBeenCalledWith(expect.any(Function), true);
  });

  test('generating writes the response into the cache instead of refetching', async () => {
    mockFetch.mockResolvedValue(null);
    const fresh = recommendation({ target_duration_minutes: 30 });
    mockGenerate.mockResolvedValue(fresh);

    const client = createTestQueryClient();
    const { result } = renderWithClient(() => useWorkoutRecommendation(), client);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    mockFetch.mockClear();

    await act(async () => {
      result.current.generate({ duration_minutes: 30 });
    });

    await waitFor(() => expect(result.current.recommendation).toEqual(fresh));
    // The response IS the new row, so a refetch would only ask the server to
    // hand back what it just returned.
    expect(client.getQueryData(workoutRecommendationQueryKey)).toEqual(fresh);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('generate passes an empty body through when given no parameters', async () => {
    mockFetch.mockResolvedValue(null);
    mockGenerate.mockResolvedValue(recommendation());

    const { result } = renderWithClient(() => useWorkoutRecommendation());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.generateAsync({});
    });

    expect(mockGenerate).toHaveBeenCalledWith({});
  });

  test('a 422 from generate says the gym profile is the problem', async () => {
    mockFetch.mockResolvedValue(null);
    mockGenerate.mockRejectedValue(apiError(422));

    const { result } = renderWithClient(() => useWorkoutRecommendation());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.generate({});
    });

    // 422 is the engine reporting it had nothing to program with — a fresh
    // catalog, or a gym profile so narrow no exercise survives the filter.
    // That is the user's to fix, so it gets its own message.
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          text2: 'No exercises matched your gym equipment. Try another gym profile.',
        }),
      ),
    );
  });

  test('any other generate failure gets the generic retry message', async () => {
    mockFetch.mockResolvedValue(null);
    mockGenerate.mockRejectedValue(apiError(500, 'boom'));

    const { result } = renderWithClient(() => useWorkoutRecommendation());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.generate({});
    });

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ text2: 'Please try again.' }),
      ),
    );
  });

  test('a failed generate leaves the cached recommendation alone', async () => {
    const existing = recommendation();
    mockFetch.mockResolvedValue(existing);
    mockGenerate.mockRejectedValue(apiError(422));

    const { result } = renderWithClient(() => useWorkoutRecommendation());
    await waitFor(() => expect(result.current.recommendation).toEqual(existing));

    await act(async () => {
      result.current.generate({});
    });

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(result.current.recommendation).toEqual(existing);
  });

  test('isGenerating tracks the mutation, not the query', async () => {
    mockFetch.mockResolvedValue(null);
    let settle: (value: WorkoutRecommendation) => void = () => {};
    mockGenerate.mockReturnValue(
      new Promise<WorkoutRecommendation>((resolve) => {
        settle = resolve;
      }),
    );

    const { result } = renderWithClient(() => useWorkoutRecommendation());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isGenerating).toBe(false);

    act(() => {
      result.current.generate({});
    });
    await waitFor(() => expect(result.current.isGenerating).toBe(true));

    await act(async () => {
      settle(recommendation());
    });
    await waitFor(() => expect(result.current.isGenerating).toBe(false));
  });
});

describe('useUpdateRecommendationStatus', () => {
  test('writes the returned row into the shared cache', async () => {
    const started = recommendation({ status: 'started' });
    mockPatchStatus.mockResolvedValue(started);

    const client = createTestQueryClient();
    const { result } = renderWithClient(() => useUpdateRecommendationStatus(), client);

    await act(async () => {
      await result.current.mutateAsync({ id: started.id, status: 'started' });
    });

    expect(mockPatchStatus).toHaveBeenCalledWith(started.id, 'started');
    expect(client.getQueryData(workoutRecommendationQueryKey)).toEqual(started);
  });

  test('a failure is swallowed silently rather than toasted', async () => {
    mockPatchStatus.mockRejectedValue(apiError(500, 'boom'));

    const { result } = renderWithClient(() => useUpdateRecommendationStatus());

    await act(async () => {
      // Best-effort by design: nothing server-side branches on the status yet,
      // so a failure here must never interrupt a live workout.
      result.current.mutate({ id: 'rec-1', status: 'completed' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockToast).not.toHaveBeenCalled();
  });
});

describe('useExerciseAlternatives', () => {
  const alternative = {
    exercise_id: '33333333-3333-4333-8333-333333333333',
    exercise_name: 'Dumbbell Press',
    source: 'local' as const,
    primary_muscles: ['chest'],
    secondary_muscles: [],
    equipment: ['dumbbell'],
    images: [],
    mechanic: null,
    level: null,
    score: 0.9,
  };

  test('costs nothing when no exercise is named', () => {
    const { result } = renderWithClient(() => useExerciseAlternatives(undefined));

    // The same search screen reached from Add must not pay for a lookup it
    // has no subject for.
    expect(mockFetchAlternatives).not.toHaveBeenCalled();
    expect(result.current.alternatives).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  test('fetches ranked alternatives once an exercise is named', async () => {
    mockFetchAlternatives.mockResolvedValue([alternative]);

    const client = createTestQueryClient();
    const { result } = renderWithClient(
      () => useExerciseAlternatives(alternative.exercise_id),
      client,
    );

    await waitFor(() => expect(result.current.alternatives).toEqual([alternative]));
    expect(mockFetchAlternatives).toHaveBeenCalledWith(alternative.exercise_id);
    expect(client.getQueryData(exerciseAlternativesQueryKey(alternative.exercise_id))).toEqual([
      alternative,
    ]);
  });

  test('a failed lookup leaves the user with a plain search, not an error screen', async () => {
    mockFetchAlternatives.mockRejectedValue(new Error('offline'));

    const { result } = renderWithClient(() => useExerciseAlternatives('ex-1'));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.alternatives).toEqual([]);
  });
});

describe('useReplaceRecommendationExercise', () => {
  const body = {
    exercise_id_out: '44444444-4444-4444-8444-444444444444',
    exercise_id_in: '55555555-5555-4555-8555-555555555555',
  };

  test('the re-prescribed workout goes straight into the cache', async () => {
    const swapped = recommendation({ target_duration_minutes: 60 });
    mockReplace.mockResolvedValue(swapped);

    const client = createTestQueryClient();
    const { result } = renderWithClient(() => useReplaceRecommendationExercise(), client);

    await act(async () => {
      await result.current.mutateAsync(body);
    });

    expect(mockReplace).toHaveBeenCalledWith(body);
    expect(client.getQueryData(workoutRecommendationQueryKey)).toEqual(swapped);
  });

  test("a 422's own message is surfaced verbatim", async () => {
    // The server says which refusal it is — already in the workout, or not in
    // the catalog — and that is the user's to act on.
    mockReplace.mockRejectedValue(apiError(422, 'That exercise is already in this workout.'));

    const { result } = renderWithClient(() => useReplaceRecommendationExercise());

    await act(async () => {
      result.current.mutate(body);
    });

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ text2: 'That exercise is already in this workout.' }),
      ),
    );
  });

  test('a 422 with no readable message still gets a usable one', async () => {
    mockReplace.mockRejectedValue(apiError(422));

    const { result } = renderWithClient(() => useReplaceRecommendationExercise());

    await act(async () => {
      result.current.mutate(body);
    });

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ text2: 'Please try again.' }),
      ),
    );
  });

  test('a non-422 failure never surfaces the server text', async () => {
    mockReplace.mockRejectedValue(apiError(500, 'Internal database error at line 42'));

    const { result } = renderWithClient(() => useReplaceRecommendationExercise());

    await act(async () => {
      result.current.mutate(body);
    });

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ text2: 'Please try again.' }),
      ),
    );
  });
});
