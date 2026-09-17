import { vi, beforeEach, describe, expect, it } from 'vitest';
import exerciseDb from '../models/exercise.js';
import exerciseService from '../services/exerciseService.js';
import foodRepository from '../models/foodRepository.js';
import foodCoreService from '../services/foodCoreService.js';
import { removeEntityImageDir } from '../middleware/imageUpload.js';

/**
 * Deleting a library item must not destroy diary history.
 *
 * Before 20260912150000_preserve_data_on_user_and_library_deletes.sql an entry
 * was a bare pointer at the library row, so the delete rules cascaded it away.
 * Entries have carried their own snapshot (name, category, nutrition, muscles,
 * images) for a long time now, so they can outlive the row — but the delete
 * code still hand-deleted them, which meant the new foreign-key rule never got
 * a turn and the old behaviour survived the migration.
 *
 * These tests pin the three modes and, above all, the rule that runs through
 * all of them: another user's diary is never touched.
 */

vi.mock('../db/poolManager', () => ({
  getClient: vi.fn(),
  getSystemClient: vi.fn(),
}));
vi.mock('../config/logging', () => ({ log: vi.fn() }));
vi.mock('../models/exerciseRepository', () => ({}));
vi.mock('../models/exercise', () => ({
  default: {
    getExerciseOwnerId: vi.fn(),
    getExerciseDeletionImpact: vi.fn(),
    deleteExerciseAndDependencies: vi.fn(),
    deleteExerciseEntriesForUser: vi.fn(),
    updateExercise: vi.fn(),
    getExerciseById: vi.fn(),
  },
}));
vi.mock('../models/exerciseEntry', () => ({ default: {} }));
vi.mock('../models/activityDetailsRepository', () => ({}));
vi.mock('../models/exercisePresetEntryRepository.js', () => ({ default: {} }));
vi.mock('../models/userRepository', () => ({}));
vi.mock('../models/preferenceRepository', () => ({}));
vi.mock('../models/workoutPresetRepository', () => ({ default: {} }));
vi.mock('../models/measurementRepository', () => ({}));
vi.mock('../models/familyAccessRepository', () => ({
  checkFamilyAccessPermission: vi.fn(),
}));
vi.mock('../services/CalorieCalculationService', () => ({ default: {} }));
vi.mock('../utils/uuidUtils', () => ({
  isValidUuid: vi.fn(),
  resolveExerciseIdToUuid: vi.fn(),
}));
vi.mock('../utils/imageDownloader', () => ({ downloadImage: vi.fn() }));
vi.mock('../integrations/wger/wgerService', () => ({}));
vi.mock('../integrations/nutritionix/nutritionixService', () => ({}));
vi.mock('../integrations/freeexercisedb/FreeExerciseDBService', () => ({}));
vi.mock('../services/exerciseEntryHistoryService', () => ({
  getGroupedExerciseSessionById: vi.fn(),
  getGroupedExerciseSessionByIdWithClient: vi.fn(),
}));
vi.mock('../models/foodRepository', () => ({
  default: {
    getFoodOwnerId: vi.fn(),
    getFoodDeletionImpact: vi.fn(),
    deleteFoodAndDependencies: vi.fn(),
    deleteFoodEntriesForUser: vi.fn(),
    updateFood: vi.fn(),
  },
}));
vi.mock('../middleware/imageUpload', () => ({
  removeEntityImageDir: vi.fn(),
}));
vi.mock('../utils/timezoneLoader', () => ({
  resolveTemplateStartDay: vi.fn(async () => '2026-09-12'),
}));

const USER = 'user-1';
const EXERCISE = 'exercise-1';
const FOOD = 'food-1';

const exerciseImpact = (otherUserReferences: number) => ({
  exerciseEntriesCount: 7,
  workoutPlansCount: 1,
  workoutPresetsCount: 2,
  totalReferences: 10,
  currentUserReferences: 10 - otherUserReferences,
  otherUserReferences,
  isPubliclyShared: false,
  familySharedUsers: [],
});

const foodImpact = (otherUserReferences: number) => ({
  foodEntries: [],
  foodEntriesCount: 5,
  mealFoodsCount: 1,
  mealPlansCount: 0,
  mealPlanTemplateAssignmentsCount: 0,
  totalReferences: 6,
  currentUserReferences: 6 - otherUserReferences,
  otherUserReferences,
  isPubliclyShared: false,
  familySharedUsers: [],
});

describe('deleting a library exercise', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(exerciseDb.getExerciseOwnerId).mockResolvedValue(USER);
    vi.mocked(exerciseDb.deleteExerciseAndDependencies).mockResolvedValue({
      success: true,
      deletedEntries: 0,
    });
    vi.mocked(exerciseDb.deleteExerciseEntriesForUser).mockResolvedValue(7);
    vi.mocked(exerciseDb.getExerciseDeletionImpact).mockResolvedValue(
      exerciseImpact(0)
    );
  });

  it('hide leaves the library row and every reference alone', async () => {
    const result = await exerciseService.deleteExercise(USER, EXERCISE, 'hide');

    expect(result.status).toBe('hidden');
    expect(exerciseDb.updateExercise).toHaveBeenCalledWith(EXERCISE, USER, {
      is_quick_exercise: true,
    });
    expect(exerciseDb.deleteExerciseAndDependencies).not.toHaveBeenCalled();
    expect(exerciseDb.deleteExerciseEntriesForUser).not.toHaveBeenCalled();
  });

  it('delete removes the library row but never the diary entries', async () => {
    const result = await exerciseService.deleteExercise(
      USER,
      EXERCISE,
      'delete'
    );

    expect(result.status).toBe('deleted');
    expect(exerciseDb.deleteExerciseAndDependencies).toHaveBeenCalledWith(
      EXERCISE,
      USER,
      '2026-09-12',
      { deleteHistory: false }
    );
    // The whole point: entries survive on their snapshot, with the foreign key
    // nulling their exercise_id.
    expect(exerciseDb.deleteExerciseEntriesForUser).not.toHaveBeenCalled();
  });

  it('delete_with_history removes this user entries atomically with the library row', async () => {
    vi.mocked(exerciseDb.deleteExerciseAndDependencies).mockResolvedValue({
      success: true,
      deletedEntries: 7,
    });

    const result = await exerciseService.deleteExercise(
      USER,
      EXERCISE,
      'delete_with_history'
    );

    expect(result.status).toBe('deleted_with_history');
    expect(result.deletedEntries).toBe(7);
    expect(exerciseDb.deleteExerciseAndDependencies).toHaveBeenCalledWith(
      EXERCISE,
      USER,
      '2026-09-12',
      { deleteHistory: true }
    );
  });

  it('refuses to delete when another user still references it', async () => {
    vi.mocked(exerciseDb.getExerciseDeletionImpact).mockResolvedValue(
      exerciseImpact(3)
    );

    for (const mode of ['delete', 'delete_with_history'] as const) {
      vi.clearAllMocks();
      vi.mocked(exerciseDb.getExerciseOwnerId).mockResolvedValue(USER);
      vi.mocked(exerciseDb.getExerciseDeletionImpact).mockResolvedValue(
        exerciseImpact(3)
      );

      const result = await exerciseService.deleteExercise(USER, EXERCISE, mode);

      // Presets and plans cascade from the library row for EVERY user, so a
      // delete here would quietly strip the exercise out of someone else's
      // templates. Hiding is the only option that leaves them alone.
      expect(result.status).toBe('hidden');
      expect(exerciseDb.deleteExerciseAndDependencies).not.toHaveBeenCalled();
      expect(exerciseDb.deleteExerciseEntriesForUser).not.toHaveBeenCalled();
    }
  });

  it('defaults to the non-destructive delete', async () => {
    await exerciseService.deleteExercise(USER, EXERCISE);

    expect(exerciseDb.deleteExerciseEntriesForUser).not.toHaveBeenCalled();
    expect(exerciseDb.deleteExerciseAndDependencies).toHaveBeenCalledWith(
      EXERCISE,
      USER,
      '2026-09-12',
      { deleteHistory: false }
    );
  });
});

describe('deleting a library food', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(foodRepository.getFoodOwnerId).mockResolvedValue(USER);
    vi.mocked(foodRepository.deleteFoodAndDependencies).mockResolvedValue({
      success: true,
      deletedEntries: 0,
    });
    vi.mocked(foodRepository.deleteFoodEntriesForUser).mockResolvedValue(5);
    vi.mocked(foodRepository.getFoodDeletionImpact).mockResolvedValue(
      foodImpact(0)
    );
  });

  it('hide leaves the library row and every reference alone', async () => {
    const result = await foodCoreService.deleteFood(USER, FOOD, 'hide');

    expect(result.status).toBe('hidden');
    expect(foodRepository.updateFood).toHaveBeenCalledWith(FOOD, USER, {
      is_quick_food: true,
    });
    expect(foodRepository.deleteFoodAndDependencies).not.toHaveBeenCalled();
    expect(foodRepository.deleteFoodEntriesForUser).not.toHaveBeenCalled();
  });

  it('delete removes the library row but never the diary entries', async () => {
    const result = await foodCoreService.deleteFood(USER, FOOD, 'delete');

    expect(result.status).toBe('deleted');
    expect(foodRepository.deleteFoodAndDependencies).toHaveBeenCalledWith(
      FOOD,
      USER,
      '2026-09-12',
      { deleteHistory: false }
    );
    expect(foodRepository.deleteFoodEntriesForUser).not.toHaveBeenCalled();
  });

  it('delete keeps the image directory the preserved entries point at', async () => {
    await foodCoreService.deleteFood(USER, FOOD, 'delete');

    // food_entries.images holds paths into uploads/foods/<foodId>/. Wiping the
    // directory here blanked the picture on every preserved entry, including
    // other users' entries.
    expect(removeEntityImageDir).not.toHaveBeenCalled();
  });

  it('delete_with_history removes this user entries and then the images', async () => {
    vi.mocked(foodRepository.deleteFoodAndDependencies).mockResolvedValue({
      success: true,
      deletedEntries: 5,
    });

    const result = await foodCoreService.deleteFood(
      USER,
      FOOD,
      'delete_with_history'
    );

    expect(result.status).toBe('deleted_with_history');
    expect(result.deletedEntries).toBe(5);
    expect(foodRepository.deleteFoodAndDependencies).toHaveBeenCalledWith(
      FOOD,
      USER,
      '2026-09-12',
      { deleteHistory: true }
    );
    // Safe only here: other users were ruled out above, and this user's own
    // entries are gone, so nothing points at the files any more.
    expect(removeEntityImageDir).toHaveBeenCalledWith('foods', FOOD);
  });

  it('refuses to delete when another user still references it', async () => {
    vi.mocked(foodRepository.getFoodDeletionImpact).mockResolvedValue(
      foodImpact(2)
    );

    const result = await foodCoreService.deleteFood(USER, FOOD, 'delete');

    expect(result.status).toBe('hidden');
    expect(foodRepository.deleteFoodAndDependencies).not.toHaveBeenCalled();
    expect(foodRepository.deleteFoodEntriesForUser).not.toHaveBeenCalled();
    expect(removeEntityImageDir).not.toHaveBeenCalled();
  });

  it('refuses outright when the caller does not own the food', async () => {
    vi.mocked(foodRepository.getFoodOwnerId).mockResolvedValue('someone-else');

    await expect(
      foodCoreService.deleteFood(USER, FOOD, 'delete')
    ).rejects.toThrow(/Forbidden/);
  });
});
