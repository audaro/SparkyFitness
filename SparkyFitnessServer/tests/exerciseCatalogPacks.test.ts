import { vi, beforeEach, describe, expect, it } from 'vitest';
import exerciseDb from '../models/exercise.js';
import freeExerciseDBService from '../integrations/freeexercisedb/FreeExerciseDBService.js';
import exerciseDbMirrorService from '../integrations/exercisedb/ExerciseDbMirrorService.js';
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
vi.mock('../integrations/exercisedb/ExerciseDbMirrorService', () => ({
  default: {
    getAllExercises: vi.fn(),
    getMediaUrl: vi.fn(),
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

  // The ExerciseDB-mirror side. Deliberately out of alphabetical order for
  // the same reason as above. The cardio-target row and the barbell row are
  // not members; the unknown-target row IS a member so its import fails
  // loudly instead of the pack silently shrinking.
  const mirrorCatalog = [
    {
      id: '0743',
      name: 'sled hack squat',
      equipment: 'sled machine',
      target: 'quads',
      secondary_muscles: ['glutes', 'ankle stabilizers'],
      instruction_steps: { en: ['Load the sled.', 'Squat.'], de: ['Beladen.'] },
      image: 'images/0743-a.jpg',
      gif_url: 'videos/0743-a.gif',
    },
    {
      id: '0577',
      name: 'lever chest press',
      equipment: 'leverage machine',
      target: 'pectorals',
      secondary_muscles: ['deltoids', 'triceps'],
      instruction_steps: { en: ['Sit down.', 'Press.'] },
      image: 'images/0577-b.jpg',
      gif_url: 'videos/0577-b.gif',
    },
    {
      id: '0798',
      name: 'stationary bike walk',
      equipment: 'leverage machine',
      target: 'cardiovascular system',
    },
    {
      id: '4242',
      name: 'lever future machine',
      equipment: 'leverage machine',
      target: 'brand new muscle',
      instruction_steps: { en: ['Do it.'] },
    },
    {
      id: '0001',
      name: 'barbell curl',
      equipment: 'barbell',
      target: 'biceps',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error TS(2339): mock method not on typed function.
    freeExerciseDBService.getAllExercises.mockResolvedValue(catalog);
    // @ts-expect-error TS(2339): mock method not on typed function.
    exerciseDbMirrorService.getAllExercises.mockResolvedValue(mirrorCatalog);
    // @ts-expect-error TS(2339): mock method not on typed function.
    exerciseDbMirrorService.getMediaUrl.mockImplementation(
      (p: string) => `https://mirror.example/${p}`
    );
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
    ).rejects.toMatchObject({ statusCode: 400 });
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

  // The second-source pack: same batching contract, but membership excludes
  // the cardio-target rows and import translates the mirror's vocabulary onto
  // the local one instead of copying it through.
  describe('exercisedb machines pack', () => {
    it('excludes cardio-target rows from the pack but keeps unknown targets', async () => {
      // @ts-expect-error TS(2339): mock method not on typed function.
      exerciseDb.getImportedSourceIds.mockImplementation(
        async (source: string) =>
          source === 'exercisedb' ? ['0577'] : ['Leg_Press']
      );

      const packs = await exerciseService.listExerciseCatalogPacks(userId);
      const pack = packs.find((p) => p.id === 'exercisedb-machines');

      // 0577 + 0743 + the unknown-target 4242; not the cardio row, not the
      // barbell row.
      expect(pack?.total).toBe(3);
      expect(pack?.alreadyImported).toBe(1);
      // And the per-source progress does not bleed into the other pack.
      expect(packs.find((p) => p.id === 'gym-machines')?.alreadyImported).toBe(
        1
      );
    });

    it('maps a mirror record onto the local vocabulary on import', async () => {
      const result = await exerciseService.importExerciseCatalogPack(
        userId,
        'exercisedb-machines',
        0,
        1
      );

      expect(result.imported).toBe(1);
      // @ts-expect-error TS(2339): mock method not on typed function.
      const created = exerciseDb.createExercise.mock.calls[0][0];
      expect(created.source).toBe('exercisedb');
      expect(created.source_id).toBe('0577');
      expect(created.name).toBe('lever chest press');
      // "leverage machine" collapses to the coarse enum; the granular half
      // lives in the shared per-source item map, not on the row.
      expect(created.equipment).toEqual(['machine']);
      expect(created.primary_muscles).toEqual(['chest']);
      // deltoids -> shoulders; triceps passes through.
      expect(created.secondary_muscles).toEqual(['shoulders', 'triceps']);
      expect(created.instructions).toEqual(['Sit down.', 'Press.']);
      expect(created.description).toBe('Sit down.');
      expect(created.category).toBe('strength');
      expect(created.is_custom).toBe(true);
      expect(created.shared_with_public).toBe(false);
      // Photo and animation both come down, into a prefixed directory the
      // free-exercise-db image-recovery route cannot mistake for its own id.
      expect(downloadImage).toHaveBeenCalledWith(
        'https://mirror.example/images/0577-b.jpg',
        'exercisedb_0577'
      );
      expect(downloadImage).toHaveBeenCalledWith(
        'https://mirror.example/videos/0577-b.gif',
        'exercisedb_0577'
      );
    });

    it('drops unmappable secondaries without failing the row', async () => {
      const result = await exerciseService.importExerciseCatalogPack(
        userId,
        'exercisedb-machines',
        2,
        1
      );

      expect(result.imported).toBe(1);
      // @ts-expect-error TS(2339): mock method not on typed function.
      const created = exerciseDb.createExercise.mock.calls[0][0];
      expect(created.name).toBe('sled hack squat');
      expect(created.primary_muscles).toEqual(['quadriceps']);
      // 'ankle stabilizers' is a curated null (no canonical home); 'glutes'
      // survives.
      expect(created.secondary_muscles).toEqual(['glutes']);
    });

    it('names a row with an unmapped target as a failure instead of guessing', async () => {
      const result = await exerciseService.importExerciseCatalogPack(
        userId,
        'exercisedb-machines',
        0,
        10
      );

      expect(result.imported).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.failures[0].name).toBe('lever future machine');
      expect(result.failures[0].reason).toContain('brand new muscle');
    });

    it('dedups against previous imports under the exercisedb source', async () => {
      // @ts-expect-error TS(2339): mock method not on typed function.
      exerciseDb.getExerciseBySourceAndSourceId.mockImplementation(
        async (source: string, sourceId: string) =>
          source === 'exercisedb' && sourceId === '0577'
            ? { id: 'existing' }
            : undefined
      );

      const result = await exerciseService.importExerciseCatalogPack(
        userId,
        'exercisedb-machines',
        0,
        10
      );

      expect(result.skipped).toBe(1);
      // The unknown-target row still fails; only the sled row imports fresh.
      expect(result.imported).toBe(1);
      expect(result.failed).toBe(1);
    });
  });
});
