import { vi, beforeEach, describe, expect, it } from 'vitest';
import exerciseDb from '../models/exercise.js';
import exerciseEntryDb from '../models/exerciseEntry.js';
import calorieCalculationService from '../services/CalorieCalculationService.js';
import exerciseService from '../services/exerciseService.js';

vi.mock('../db/poolManager', () => ({
  getClient: vi.fn(),
  getSystemClient: vi.fn(),
}));
vi.mock('../models/exerciseRepository', () => ({}));
vi.mock('../models/exercise', () => ({
  default: { getExerciseById: vi.fn() },
}));
vi.mock('../models/exerciseEntry', () => ({
  default: {
    getExerciseEntryById: vi.fn(),
    updateExerciseEntry: vi.fn(),
  },
}));
vi.mock('../models/activityDetailsRepository', () => ({
  default: { getActivityDetailsByEntryId: vi.fn() },
}));
vi.mock('../models/exercisePresetEntryRepository.js', () => ({ default: {} }));
vi.mock('../models/preferenceRepository', () => ({}));
vi.mock('../models/workoutPresetRepository', () => ({ default: {} }));
vi.mock('../config/logging', () => ({ log: vi.fn() }));
vi.mock('../integrations/wger/wgerService', () => ({}));
vi.mock('../integrations/nutritionix/nutritionixService', () => ({}));
vi.mock('../integrations/freeexercisedb/FreeExerciseDBService', () => ({}));
vi.mock('../models/measurementRepository', () => ({}));
vi.mock('../utils/imageDownloader', () => ({ downloadImage: vi.fn() }));
vi.mock('../services/CalorieCalculationService', () => ({
  default: { estimateCaloriesBurnedPerHour: vi.fn() },
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

const ENTRY_ID = 'e1';
const USER = 'user-1';
const RUN_ID = 'run-1';

const existing = {
  id: ENTRY_ID,
  exercise_id: RUN_ID,
  duration_minutes: 20,
  calories_burned: 200,
  entry_date: '2026-08-28',
  notes: null,
  image_url: null,
};

describe('updateExerciseEntry calories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(exerciseEntryDb.getExerciseEntryById).mockResolvedValue(
      existing as never
    );
    vi.mocked(exerciseEntryDb.updateExerciseEntry).mockImplementation(
      async (_id, _auth, _acting, data) => ({ id: ENTRY_ID, ...data }) as never
    );
    vi.mocked(exerciseDb.getExerciseById).mockResolvedValue({
      id: RUN_ID,
      name: 'Running',
    } as never);
    vi.mocked(
      calorieCalculationService.estimateCaloriesBurnedPerHour
    ).mockResolvedValue(600);
  });

  it('re-estimates calories from the entry’s own exercise when the duration changes', async () => {
    // A 20-minute run stretched to 40 used to keep the 20-minute figure,
    // because the recompute keyed on an exercise_id the edit never sends.
    await exerciseService.updateExerciseEntry(USER, USER, ENTRY_ID, {
      duration_minutes: 40,
    });

    expect(exerciseDb.getExerciseById).toHaveBeenCalledWith(RUN_ID, USER);
    const written = vi.mocked(exerciseEntryDb.updateExerciseEntry).mock
      .calls[0][3] as { calories_burned: number };
    expect(written.calories_burned).toBe(400);
  });

  it('keeps the stored figure when the duration did not change', async () => {
    // A live workout autosaves every few seconds with the same duration; that
    // must not re-estimate (and must not overwrite a figure the user typed).
    await exerciseService.updateExerciseEntry(USER, USER, ENTRY_ID, {
      duration_minutes: 20,
      notes: 'felt good',
    });

    expect(
      calorieCalculationService.estimateCaloriesBurnedPerHour
    ).not.toHaveBeenCalled();
    const written = vi.mocked(exerciseEntryDb.updateExerciseEntry).mock
      .calls[0][3] as { calories_burned: number };
    expect(written.calories_burned).toBe(200);
  });

  it('never overrides calories the caller stated', async () => {
    await exerciseService.updateExerciseEntry(USER, USER, ENTRY_ID, {
      duration_minutes: 40,
      calories_burned: 123,
    });

    expect(
      calorieCalculationService.estimateCaloriesBurnedPerHour
    ).not.toHaveBeenCalled();
    const written = vi.mocked(exerciseEntryDb.updateExerciseEntry).mock
      .calls[0][3] as { calories_burned: number };
    expect(written.calories_burned).toBe(123);
  });
});
