import { vi, beforeEach, describe, expect, it } from 'vitest';
import exerciseDb from '../models/exercise.js';
import freeExerciseDBService from '../integrations/freeexercisedb/FreeExerciseDBService.js';
import exerciseService from '../services/exerciseService.js';
import { downloadImage } from '../utils/imageDownloader.js';

vi.mock('../db/poolManager', () => ({
  getClient: vi.fn(),
  getSystemClient: vi.fn(),
}));
vi.mock('../models/exerciseRepository', () => ({}));
vi.mock('../models/exercise', () => ({
  default: {
    getExerciseBySourceAndSourceId: vi.fn(),
    getImportedSourceIds: vi.fn(),
    getAllExerciseNames: vi.fn(),
    createExercise: vi.fn(),
  },
}));
vi.mock('../models/exerciseEntry', () => ({ default: {} }));
vi.mock('../models/activityDetailsRepository', () => ({}));
vi.mock('../models/exercisePresetEntryRepository.js', () => ({ default: {} }));
vi.mock('../models/preferenceRepository', () => ({}));
vi.mock('../models/workoutPresetRepository', () => ({ default: {} }));
vi.mock('../config/logging', () => ({ log: vi.fn() }));
vi.mock('../integrations/wger/wgerService', () => ({
  default: {
    getWgerExerciseDetails: vi.fn(),
    extractWgerText: vi.fn(),
  },
}));
vi.mock('../integrations/nutritionix/nutritionixService', () => ({}));
vi.mock('../integrations/freeexercisedb/FreeExerciseDBService', () => ({
  default: {
    getExerciseById: vi.fn(),
    getExerciseImageUrl: vi.fn(),
    getAllExercises: vi.fn(),
  },
}));
vi.mock('../models/measurementRepository', () => ({}));
vi.mock('../utils/imageDownloader', () => ({ downloadImage: vi.fn() }));
vi.mock('../services/CalorieCalculationService', () => ({
  default: {
    estimateCaloriesBurnedPerHour: vi.fn(),
  },
}));
vi.mock('../utils/uuidUtils', () => ({
  isValidUuid: vi.fn(),
  resolveExerciseIdToUuid: vi.fn(),
}));
vi.mock('../models/familyAccessRepository', () => ({
  checkFamilyAccessPermission: vi.fn(),
}));
vi.mock('../services/exerciseEntryHistoryService', () => ({
  getGroupedExerciseSessionById: vi.fn(),
  getGroupedExerciseSessionByIdWithClient: vi.fn(),
}));

// Bulk import of a named free-exercise-db subset, walked in batches by the
// client. Membership comes from the catalog's own equipment value, so the
// pack tracks upstream rather than a hand-listed set of names.
describe('exercise catalog packs', () => {
  const userId = 'user-1';

  function catalogEntry(
    id: string,
    name: string,
    equipment: string | null
  ): Record<string, unknown> {
    return {
      id,
      name,
      equipment,
      images: [`${id}/0.jpg`, `${id}/1.jpg`],
      primaryMuscles: ['chest'],
      instructions: ['Sit down.', 'Press.'],
      category: 'strength',
    };
  }

  // Deliberately out of alphabetical order: batching relies on the service
  // imposing a stable order, not on upstream's.
  const catalog = [
    catalogEntry('Leg_Press', 'Leg Press', 'machine'),
    catalogEntry('Barbell_Squat', 'Barbell Squat', 'barbell'),
    catalogEntry('Cable_Crossover', 'Cable Crossover', 'cable'),
    catalogEntry('Ab_Crunch_Machine', 'Ab Crunch Machine', 'machine'),
    catalogEntry('Push_Up', 'Push Up', 'body only'),
    catalogEntry('Nameless', '', 'machine'),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error TS(2339): mock method not on typed function.
    freeExerciseDBService.getAllExercises.mockResolvedValue(catalog);
    // @ts-expect-error TS(2339): mock method not on typed function.
    freeExerciseDBService.getExerciseImageUrl.mockImplementation(
      (p: string) => `https://raw.example/${p}`
    );
    // @ts-expect-error TS(2339): mock method not on typed function.
    downloadImage.mockImplementation(
      async (_url: string, dir: string) =>
        `/uploads/exercises/${dir}/0_hash.jpg`
    );
    // @ts-expect-error TS(2339): mock method not on typed function.
    exerciseDb.createExercise.mockImplementation(
      async (data: Record<string, unknown>) => data
    );
    // @ts-expect-error TS(2339): mock method not on typed function.
    exerciseDb.getExerciseBySourceAndSourceId.mockResolvedValue(undefined);
    // @ts-expect-error TS(2339): mock method not on typed function.
    exerciseDb.getImportedSourceIds.mockResolvedValue([]);
    // @ts-expect-error TS(2339): mock method not on typed function.
    exerciseDb.getAllExerciseNames.mockResolvedValue([]);
  });

  it('reports the pack size and how much of it the user already has', async () => {
    // @ts-expect-error TS(2339): mock method not on typed function.
    exerciseDb.getImportedSourceIds.mockResolvedValue(['Leg_Press']);

    const packs = await exerciseService.listExerciseCatalogPacks(userId);
    const gym = packs.find((pack) => pack.id === 'gym-machines');

    // Machine + cable only, and the unnamed row is not importable.
    expect(gym?.total).toBe(3);
    expect(gym?.alreadyImported).toBe(1);
  });

  it('imports a batch in a stable alphabetical order', async () => {
    const first = await exerciseService.importExerciseCatalogPack(
      userId,
      'gym-machines',
      0,
      2
    );

    expect(first.imported).toBe(2);
    expect(first.total).toBe(3);
    expect(first.done).toBe(false);
    expect(first.nextOffset).toBe(2);
    // @ts-expect-error TS(2339): mock method not on typed function.
    const created = exerciseDb.createExercise.mock.calls.map(
      (call: [Record<string, unknown>]) => call[0].name
    );
    expect(created).toEqual(['Ab Crunch Machine', 'Cable Crossover']);
  });

  it('finishes the pack on the finishing batch', async () => {
    const last = await exerciseService.importExerciseCatalogPack(
      userId,
      'gym-machines',
      2,
      2
    );

    expect(last.imported).toBe(1);
    expect(last.processed).toBe(3);
    expect(last.done).toBe(true);
    expect(last.nextOffset).toBeNull();
  });

  it('skips exercises the user already imported instead of duplicating them', async () => {
    // @ts-expect-error TS(2339): mock method not on typed function.
    exerciseDb.getExerciseBySourceAndSourceId.mockImplementation(
      async (_source: string, sourceId: string) =>
        sourceId === 'Ab_Crunch_Machine' ? { id: 'existing' } : undefined
    );

    const result = await exerciseService.importExerciseCatalogPack(
      userId,
      'gym-machines',
      0,
      10
    );

    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(2);
    expect(exerciseDb.createExercise).toHaveBeenCalledTimes(2);
  });

  // A hand-made exercise may already carry logged sets. Importing a second
  // copy under the same name would split that history across two rows.
  it('skips a catalog entry the user already keeps under the same name', async () => {
    // @ts-expect-error TS(2339): mock method not on typed function.
    exerciseDb.getAllExerciseNames.mockResolvedValue(['ab crunch-machine']);

    const result = await exerciseService.importExerciseCatalogPack(
      userId,
      'gym-machines',
      0,
      10
    );

    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(2);
    // @ts-expect-error TS(2339): mock method not on typed function.
    const created = exerciseDb.createExercise.mock.calls.map(
      (call: [Record<string, unknown>]) => call[0].name
    );
    expect(created).not.toContain('Ab Crunch Machine');
  });

  it('counts name-collisions as already in the library when listing packs', async () => {
    // @ts-expect-error TS(2339): mock method not on typed function.
    exerciseDb.getAllExerciseNames.mockResolvedValue(['Leg Press']);

    const packs = await exerciseService.listExerciseCatalogPacks(userId);

    expect(packs[0].alreadyImported).toBe(1);
  });

  it('names a failed exercise and still imports the rest of the batch', async () => {
    // @ts-expect-error TS(2339): mock method not on typed function.
    exerciseDb.createExercise.mockImplementation(
      async (data: Record<string, unknown>) => {
        if (data.name === 'Cable Crossover') {
          throw new Error('constraint violation');
        }
        return data;
      }
    );

    const result = await exerciseService.importExerciseCatalogPack(
      userId,
      'gym-machines',
      0,
      10
    );

    expect(result.imported).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([
      { name: 'Cable Crossover', reason: 'constraint violation' },
    ]);
    expect(result.done).toBe(true);
  });

  it('rejects an unknown pack id with a 400', async () => {
    await expect(
      exerciseService.importExerciseCatalogPack(userId, 'not-a-pack', 0, 10)
    ).rejects.toMatchObject({ status: 400 });
    expect(exerciseDb.createExercise).not.toHaveBeenCalled();
  });

  it('reports done for an offset past the end of the pack', async () => {
    const result = await exerciseService.importExerciseCatalogPack(
      userId,
      'gym-machines',
      99,
      10
    );

    expect(result.imported).toBe(0);
    expect(result.done).toBe(true);
    expect(result.nextOffset).toBeNull();
  });
});
