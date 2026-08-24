import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useExercisePackImport } from '../../src/hooks/useExercisePacks';
import {
  importExercisePackBatch,
  type ExercisePack,
  type ExercisePackImportBatch,
} from '../../src/services/api/exercisePacksApi';
import { createTestQueryClient, createQueryWrapper } from './queryTestUtils';

jest.mock('../../src/services/api/exercisePacksApi', () => ({
  importExercisePackBatch: jest.fn(),
}));

const mockImportBatch = importExercisePackBatch as jest.MockedFunction<
  typeof importExercisePackBatch
>;

const pack: ExercisePack = {
  id: 'gym-machines',
  label: 'Gym Machines & Cables',
  description: 'machines and cables',
  total: 25,
  alreadyImported: 0,
};

function batch(
  overrides: Partial<ExercisePackImportBatch>,
): ExercisePackImportBatch {
  return {
    packId: 'gym-machines',
    total: 25,
    imported: 10,
    skipped: 0,
    failed: 0,
    failures: [],
    processed: 10,
    nextOffset: 10,
    done: false,
    ...overrides,
  };
}

function renderImportHook() {
  const queryClient = createTestQueryClient();
  return {
    ...renderHook(() => useExercisePackImport(), {
      wrapper: createQueryWrapper(queryClient),
    }),
    queryClient,
  };
}

// A pack is a few hundred image downloads, so the client walks it batch by
// batch rather than holding one long request open.
describe('useExercisePackImport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('walks every batch until the server reports done', async () => {
    mockImportBatch
      .mockResolvedValueOnce(batch({ processed: 10, nextOffset: 10 }))
      .mockResolvedValueOnce(batch({ processed: 20, nextOffset: 20 }))
      .mockResolvedValueOnce(
        batch({ imported: 5, processed: 25, nextOffset: null, done: true }),
      );

    const { result } = renderImportHook();
    await act(async () => {
      await result.current.importPack(pack);
    });

    await waitFor(() => expect(mockImportBatch).toHaveBeenCalledTimes(3));
    expect(mockImportBatch.mock.calls.map((call) => call[1])).toEqual([
      0, 10, 20,
    ]);
    expect(result.current.progress?.imported).toBe(25);
    expect(result.current.progress?.processed).toBe(25);
  });

  it('accumulates skips and failures across batches', async () => {
    mockImportBatch
      .mockResolvedValueOnce(
        batch({
          imported: 8,
          skipped: 2,
          failed: 1,
          failures: [{ name: 'Leg Press', reason: 'boom' }],
        }),
      )
      .mockResolvedValueOnce(
        batch({
          imported: 9,
          skipped: 1,
          processed: 20,
          nextOffset: null,
          done: true,
        }),
      );

    const { result } = renderImportHook();
    await act(async () => {
      await result.current.importPack(pack);
    });

    expect(result.current.progress?.imported).toBe(17);
    expect(result.current.progress?.skipped).toBe(3);
    expect(result.current.progress?.failures).toEqual([
      { name: 'Leg Press', reason: 'boom' },
    ]);
  });

  // An interrupted run is safe to abandon: import is idempotent, so starting
  // again simply picks up whatever is still missing.
  it('stops requesting further batches once cancelled', async () => {
    mockImportBatch.mockImplementation(async (_packId, offset) =>
      batch({ processed: offset + 10, nextOffset: offset + 10 }),
    );

    const { result } = renderImportHook();
    const run = act(async () => {
      await result.current.importPack(pack);
    });
    result.current.cancel();
    await run;

    // The in-flight batch finishes; nothing after it is requested.
    expect(mockImportBatch).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed request without leaving the import stuck', async () => {
    mockImportBatch.mockRejectedValue(new Error('network down'));

    const { result } = renderImportHook();
    await act(async () => {
      await result.current.importPack(pack);
    });

    expect(result.current.isImporting).toBe(false);
  });

  // The exercises earlier batches added are already saved; leaving them behind
  // an infinite stale time would look like the failed import lost them.
  it('refreshes the exercise caches when a later batch fails', async () => {
    mockImportBatch
      .mockResolvedValueOnce(batch({ imported: 10 }))
      .mockRejectedValueOnce(new Error('network down'));

    const { result, queryClient } = renderImportHook();
    const resetQueries = jest.spyOn(queryClient, 'resetQueries');

    await act(async () => {
      await result.current.importPack(pack);
    });

    expect(resetQueries).toHaveBeenCalledWith({
      queryKey: ['exercisesLibrary'],
    });
    expect(result.current.progress?.imported).toBe(10);
  });

  it('ignores a second start while one import is already running', async () => {
    mockImportBatch.mockImplementation(async () =>
      batch({ processed: 25, nextOffset: null, done: true }),
    );

    const { result } = renderImportHook();
    await act(async () => {
      await Promise.all([
        result.current.importPack(pack),
        result.current.importPack(pack),
      ]);
    });

    expect(mockImportBatch).toHaveBeenCalledTimes(1);
  });
});
