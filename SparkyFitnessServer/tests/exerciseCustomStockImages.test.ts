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
    searchExercises: vi.fn(),
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

// Auto-attach free-exercise-db stock photos to hand-created exercises whose
// name is an exact (normalized) unique match for one catalog entry. A wrong
// exercise's photos are worse than none, so anything looser attaches nothing.
describe('custom exercise stock images', () => {
  const userId = 'user-1';

  const upstreamBenchPress = {
    id: 'Barbell_Bench_Press',
    name: 'Barbell Bench Press',
    images: ['Barbell_Bench_Press/0.jpg', 'Barbell_Bench_Press/1.jpg'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error TS(2339): mock method not on typed function.
    exerciseDb.createExercise.mockImplementation(
      async (data: Record<string, unknown>) => data
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
  });

  it('attaches the catalog images on an exact normalized name match', async () => {
    // @ts-expect-error TS(2339): mock method not on typed function.
    freeExerciseDBService.searchExercises.mockResolvedValue({
      exercises: [upstreamBenchPress],
      totalCount: 1,
    });

    await exerciseService.createExercise(userId, {
      name: 'barbell bench-press',
      source: 'custom',
      is_custom: true,
      images: [],
    });

    expect(downloadImage).toHaveBeenCalledTimes(2);
    // @ts-expect-error TS(2339): mock method not on typed function.
    const created = exerciseDb.createExercise.mock.calls[0][0];
    expect(created.images).toEqual([
      'Barbell_Bench_Press/0_hash.jpg',
      'Barbell_Bench_Press/0_hash.jpg',
    ]);
  });

  it('attaches nothing when the best match is only fuzzy', async () => {
    // @ts-expect-error TS(2339): mock method not on typed function.
    freeExerciseDBService.searchExercises.mockResolvedValue({
      exercises: [upstreamBenchPress],
      totalCount: 1,
    });

    await exerciseService.createExercise(userId, {
      name: 'Machine Chest Press',
      source: 'manual',
      is_custom: true,
      images: [],
    });

    expect(downloadImage).not.toHaveBeenCalled();
    // @ts-expect-error TS(2339): mock method not on typed function.
    const created = exerciseDb.createExercise.mock.calls[0][0];
    expect(created.images).toEqual([]);
  });

  it('leaves user-supplied images alone', async () => {
    await exerciseService.createExercise(userId, {
      name: 'Barbell Bench Press',
      source: 'custom',
      is_custom: true,
      images: ['My_Exercise/own-photo.jpg'],
    });

    expect(freeExerciseDBService.searchExercises).not.toHaveBeenCalled();
    // @ts-expect-error TS(2339): mock method not on typed function.
    const created = exerciseDb.createExercise.mock.calls[0][0];
    expect(created.images).toEqual(['My_Exercise/own-photo.jpg']);
  });

  it('skips non-custom sources entirely', async () => {
    await exerciseService.createExercise(userId, {
      name: 'Walking',
      source: 'Health Data',
      images: [],
    });

    expect(freeExerciseDBService.searchExercises).not.toHaveBeenCalled();
  });

  it('still creates the exercise when the catalog lookup fails', async () => {
    // @ts-expect-error TS(2339): mock method not on typed function.
    freeExerciseDBService.searchExercises.mockRejectedValue(
      new Error('network down')
    );

    const result = await exerciseService.createExercise(userId, {
      name: 'Barbell Bench Press',
      source: 'custom',
      is_custom: true,
      images: [],
    });

    expect(result).toBeDefined();
    expect(exerciseDb.createExercise).toHaveBeenCalledTimes(1);
    // @ts-expect-error TS(2339): mock method not on typed function.
    const created = exerciseDb.createExercise.mock.calls[0][0];
    expect(created.images).toEqual([]);
  });

  it('attaches nothing when several catalog entries share the normalized name', async () => {
    // @ts-expect-error TS(2339): mock method not on typed function.
    freeExerciseDBService.searchExercises.mockResolvedValue({
      exercises: [
        upstreamBenchPress,
        { ...upstreamBenchPress, id: 'Barbell_Bench_Press_2' },
      ],
      totalCount: 2,
    });

    await exerciseService.createExercise(userId, {
      name: 'Barbell Bench Press',
      source: 'custom',
      is_custom: true,
      images: [],
    });

    expect(downloadImage).not.toHaveBeenCalled();
  });
});
