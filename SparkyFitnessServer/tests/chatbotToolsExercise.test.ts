import { vi, beforeEach, describe, expect, it } from 'vitest';
import { addDays, todayInZone } from '@workspace/shared';
import {
  buildExerciseTools,
  VALID_ACTIONS,
} from '../ai/tools/exerciseTools.js';
import {
  manageExerciseInput,
  manageExerciseSchema,
} from '../ai/tools/schemas/exercise.js';
import workoutRecommendationService, {
  WorkoutGenerationError,
} from '../services/workoutRecommendationService.js';
import exerciseService from '../services/exerciseService.js';
import preferenceService from '../services/preferenceService.js';
import workoutPresetService from '../services/workoutPresetService.js';
import exerciseDb from '../models/exercise.js';
import exerciseEntryDb from '../models/exerciseEntry.js';
import workoutPresetRepository from '../models/workoutPresetRepository.js';
import workoutPlanTemplateService from '../services/workoutPlanTemplateService.js';
import workoutPlanTemplateRepository from '../models/workoutPlanTemplateRepository.js';
import { getResolvedExerciseCaloriesRange } from '../services/exerciseCalorieRangeService.js';

vi.mock('../services/exerciseService', () => ({
  default: {
    searchExercises: vi.fn(),
    searchExercisesPaginated: vi.fn(),
    createExercise: vi.fn(),
    createExerciseEntry: vi.fn(),
    getExerciseEntriesByDate: vi.fn(),
    updateExerciseEntry: vi.fn(),
    deleteExerciseEntry: vi.fn(),
    getExerciseById: vi.fn(),
    getExerciseProgressData: vi.fn(),
    logWorkoutPresetGrouped: vi.fn(),
  },
}));
vi.mock('../services/preferenceService', () => ({
  default: { getUserPreferences: vi.fn() },
}));
vi.mock('../services/workoutPresetService', () => ({
  default: {
    getWorkoutPresets: vi.fn(),
    createWorkoutPreset: vi.fn(),
    updateWorkoutPreset: vi.fn(),
  },
}));
vi.mock('../models/exercise', () => ({
  default: {
    getExercisesWithPagination: vi.fn(),
    countExercises: vi.fn(),
  },
}));
vi.mock('../models/exerciseEntry', () => ({
  default: {
    getExerciseDiaryRange: vi.fn(),
    getDailyExerciseTotalsRange: vi.fn(),
    getRecentExerciseEntries: vi.fn(),
    getExerciseUsage: vi.fn(),
    getFrequentSets: vi.fn(),
  },
}));
vi.mock('../models/workoutPresetRepository', () => ({
  default: {
    getWorkoutPresetByName: vi.fn(),
  },
}));
vi.mock('../services/workoutPlanTemplateService', () => ({
  default: {
    getWorkoutPlanTemplatesByUserId: vi.fn(),
    createWorkoutPlanTemplate: vi.fn(),
    updateWorkoutPlanTemplate: vi.fn(),
  },
}));
vi.mock('../models/workoutPlanTemplateRepository', () => ({
  default: {
    getWorkoutPlanTemplateById: vi.fn(),
  },
}));
vi.mock('../services/exerciseCalorieRangeService', () => ({
  getResolvedExerciseCaloriesRange: vi.fn(),
  getResolvedExerciseCaloriesTotal: vi.fn(),
}));
// Hand-rolled rather than importOriginal: the real module pulls the pool
// manager in transitively, and the tool matches this error by `instanceof`, so
// the class the test throws has to be the same one the tool imported.
vi.mock('../services/workoutRecommendationService', () => {
  class WorkoutGenerationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'WorkoutGenerationError';
    }
  }
  return {
    WorkoutGenerationError,
    default: {
      getMuscleRecovery: vi.fn(),
      generateRecommendation: vi.fn(),
    },
  };
});
vi.mock('../config/logging', () => ({
  log: vi.fn(),
}));

const opts = { toolCallId: 'tc-1', messages: [] };
const DB_ERROR_TEXT =
  'Error [DB_ERROR]: A database error occurred.\n\nSuggestion: Do NOT retry the same call — it will fail the same way. Tell the user what failed and stop.';
const NOT_FOUND_RESOURCE_TEXT =
  "Error [NOT_FOUND]: Resource with ID 'unknown' not found.\n\nSuggestion: Check the ID and try again.";

const ENTRY_ID = '11111111-1111-4111-8111-111111111111';
const EXERCISE_ID = '22222222-2222-4222-8222-222222222222';
const EXERCISE_ID_2 = '33333333-3333-4333-8333-333333333333';
// Preset and plan ids are integer SERIAL keys, unlike the uuid exercise ids.
const PRESET_ID = 44;

let tools: ReturnType<typeof buildExerciseTools>;

beforeEach(() => {
  // Default: no resolved rows, so the tool falls back to the raw per-day totals and the
  // projection goldens below stay meaningful. Resolution itself is covered separately.
  vi.mocked(getResolvedExerciseCaloriesRange).mockResolvedValue(new Map());
  vi.clearAllMocks();
  // A metric user unless a test says otherwise, so the logging goldens below
  // store the numbers they were given.
  vi.mocked(preferenceService.getUserPreferences).mockResolvedValue({
    default_weight_unit: 'kg',
    default_distance_unit: 'km',
  } as never);
  tools = buildExerciseTools('user-1', 'UTC');
});

describe('sparky_manage_exercise validation', () => {
  it('renders zod issues for a missing per-action field', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'search_exercises' },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: searchTerm: Invalid input: expected string, received undefined'
    );
  });

  it('infers action when missing from input parameters', async () => {
    vi.mocked(exerciseService.searchExercisesPaginated).mockResolvedValue({
      exercises: [],
      totalCount: 0,
    });
    // Omit the 'action' field, but supply 'searchTerm' to imply search_exercises
    const result = await tools.sparky_manage_exercise.execute!(
      { searchTerm: 'pushups' },
      opts
    );
    expect(result).toBe(
      '# Exercise Search: "pushups"\n\nNo results found.\n\n---\nShowing 0 of 0 results.'
    );
  });
});

describe('search_exercises', () => {
  it('renders the paginated catalog matches', async () => {
    vi.mocked(exerciseService.searchExercisesPaginated).mockResolvedValue({
      exercises: [
        {
          id: EXERCISE_ID,
          name: 'Bench Press',
          category: 'Strength',
          primary_muscles: ['Chest', 'Triceps'],
          equipment: ['Barbell'],
          level: 'intermediate',
          calories_per_hour: 400,
          description: null,
          is_custom: false,
          user_id: 'user-1',
          tags: ['private'],
        },
      ],
      totalCount: 1,
    });

    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'search_exercises', searchTerm: 'bench' },
      opts
    );

    expect(result).toBe(
      `# Exercise Search: "bench"\n\n**Bench Press** (Strength)\n  Muscles: Chest, Triceps | Equipment: Barbell\n  ID: ${EXERCISE_ID}\n\n---\nShowing 1 of 1 results.`
    );
    expect(exerciseService.searchExercisesPaginated).toHaveBeenCalledWith(
      'user-1',
      'bench',
      'user-1',
      undefined,
      undefined,
      20,
      0
    );
  });

  it('passes filters as single-element arrays and reports remaining pages', async () => {
    vi.mocked(exerciseService.searchExercisesPaginated).mockResolvedValue({
      exercises: [
        {
          id: EXERCISE_ID,
          name: 'Cable Fly',
          category: null,
          primary_muscles: [],
          equipment: [],
        },
      ],
      totalCount: 41,
    });

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'search_exercises',
        searchTerm: 'fly',
        muscleGroup: 'Chest',
        equipment: 'Cable',
        limit: 1,
        offset: 0,
      },
      opts
    );

    expect(result).toBe(
      `# Exercise Search: "fly"\n\n**Cable Fly** (Uncategorized)\n  Muscles: N/A | Equipment: None\n  ID: ${EXERCISE_ID}\n\n---\nShowing 1 of 41 results. Use offset=1 to see more.`
    );
    expect(exerciseService.searchExercisesPaginated).toHaveBeenCalledWith(
      'user-1',
      'fly',
      'user-1',
      ['Cable'],
      ['Chest'],
      1,
      0
    );
  });

  it('renders an empty result set', async () => {
    vi.mocked(exerciseService.searchExercisesPaginated).mockResolvedValue({
      exercises: [],
      totalCount: 0,
    });
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'search_exercises', searchTerm: 'zzz' },
      opts
    );
    expect(result).toBe(
      '# Exercise Search: "zzz"\n\nNo results found.\n\n---\nShowing 0 of 0 results.'
    );
  });

  it('maps service failures to DB_ERROR', async () => {
    vi.mocked(exerciseService.searchExercisesPaginated).mockRejectedValue(
      new Error('boom')
    );
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'search_exercises', searchTerm: 'bench' },
      opts
    );
    expect(result).toBe(DB_ERROR_TEXT);
  });

  // A deterministic constraint violation used to reach the chat as a bare
  // "a database error occurred", so the only way to see what broke was to grep
  // the server log. Surface the constraint name (schema metadata, not row data).
  it('names the violated constraint instead of a bare DB error', async () => {
    const pgError = Object.assign(new Error('insert failed'), {
      code: '23514',
      constraint: 'food_variants_source_check',
    });
    vi.mocked(exerciseService.searchExercisesPaginated).mockRejectedValue(
      pgError
    );

    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'search_exercises', searchTerm: 'bench' },
      opts
    );

    expect(result).toContain('check constraint food_variants_source_check');
    // And it must never invite the blind identical retry that a deterministic
    // failure guarantees will fail again.
    expect(result).not.toContain('try again');
    expect(result).toContain('Do NOT retry');
  });
});

describe('create_exercise', () => {
  it('reuses an existing exercise matched case-insensitively', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([
      { id: EXERCISE_ID, name: 'Running' },
    ]);

    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'create_exercise', name: 'running' },
      opts
    );

    expect(result).toBe('✅ Exercise "Running" created.');
    expect(exerciseService.createExercise).not.toHaveBeenCalled();
  });

  it("creates with MCP's defaults when no exercise matches", async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([]);
    vi.mocked(exerciseService.createExercise).mockResolvedValue({
      id: EXERCISE_ID,
      name: 'Jump Rope',
    });

    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'create_exercise', name: 'Jump Rope' },
      opts
    );

    expect(result).toBe('✅ Exercise "Jump Rope" created.');
    expect(exerciseService.createExercise).toHaveBeenCalledWith('user-1', {
      name: 'Jump Rope',
      category: 'custom',
      calories_per_hour: 300,
      description: null,
      is_custom: true,
      shared_with_public: false,
      source: 'manual',
    });
  });

  it('passes provided category, calories and description through', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([]);
    vi.mocked(exerciseService.createExercise).mockResolvedValue({
      id: EXERCISE_ID,
      name: 'Rowing',
    });

    await tools.sparky_manage_exercise.execute!(
      {
        action: 'create_exercise',
        name: 'Rowing',
        category: 'Cardio',
        calories_per_hour: 550,
        description: 'Indoor rower',
      },
      opts
    );

    expect(exerciseService.createExercise).toHaveBeenCalledWith('user-1', {
      name: 'Rowing',
      category: 'Cardio',
      calories_per_hour: 550,
      description: 'Indoor rower',
      modality: undefined,
      is_custom: true,
      shared_with_public: false,
      source: 'manual',
    });
  });

  it('passes an explicit modality through to the service', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([]);
    vi.mocked(exerciseService.createExercise).mockResolvedValue({
      id: EXERCISE_ID,
      name: 'Plank',
    });

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'create_exercise',
        name: 'Plank',
        category: 'Isometric',
        modality: 'duration',
      },
      opts
    );

    expect(result).toBe('✅ Exercise "Plank" created.');
    expect(exerciseService.createExercise).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ name: 'Plank', modality: 'duration' })
    );
  });

  it('rejects a modality outside the enum', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([]);

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'create_exercise',
        name: 'Plank',
        modality: 'time_only',
      } as never,
      opts
    );

    expect(result).toContain('modality');
    expect(exerciseService.createExercise).not.toHaveBeenCalled();
  });
});

describe('log_exercise', () => {
  it('defaults to General Exercise when exercise_id and exercise_name are missing', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([]);
    vi.mocked(exerciseService.createExercise).mockResolvedValue({
      id: EXERCISE_ID,
      name: 'General Exercise',
    } as any);
    vi.mocked(exerciseService.createExerciseEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'log_exercise', entry_date: '2026-06-10' },
      opts
    );
    expect(result).toBe('✅ Exercise logged for 2026-06-10.');
    expect(exerciseService.createExercise).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ name: 'General Exercise' })
    );
  });

  // Matches the web's entry_time contract; without it a chatbot-logged workout
  // had a NULL time and sorted differently in the diary than a web-logged one.
  it('persists entry_time when the user states a time', async () => {
    vi.mocked(exerciseService.createExerciseEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    await tools.sparky_manage_exercise.execute!(
      {
        action: 'log_exercise',
        exercise_id: EXERCISE_ID,
        entry_date: '2026-06-10',
        entry_time: '19:45',
        duration_minutes: 30,
      },
      opts
    );

    expect(exerciseService.createExerciseEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({ entry_time: '19:45' }),
      expect.anything()
    );
  });

  it('logs by exercise_id with repository-shaped sets', async () => {
    vi.mocked(exerciseService.createExerciseEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'log_exercise',
        exercise_id: EXERCISE_ID,
        entry_date: '2026-06-10',
        duration_minutes: 40,
        sets: [
          { reps: 10, weight: 60 },
          { reps: 8, weight: 65, set_type: 'Drop Set' },
        ],
      },
      opts
    );

    expect(result).toBe('✅ Exercise logged for 2026-06-10.');
    expect(exerciseService.searchExercises).not.toHaveBeenCalled();
    expect(exerciseService.createExerciseEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      {
        exercise_id: EXERCISE_ID,
        entry_date: '2026-06-10',
        duration_minutes: 40,
        sets: [
          {
            set_number: 1,
            set_type: 'Working Set',
            reps: 10,
            weight: 60,
            duration: null,
            distance: null,
            rest_time: null,
            rpe: null,
            notes: null,
          },
          {
            set_number: 2,
            set_type: 'Drop Set',
            reps: 8,
            weight: 65,
            duration: null,
            distance: null,
            rest_time: null,
            rpe: null,
            notes: null,
          },
        ],
      },
      { skipDuplicateCheck: true }
    );
  });

  it('prefers the case-insensitive exact name match over substring matches', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([
      { id: EXERCISE_ID_2, name: 'Running Intervals' },
      { id: EXERCISE_ID, name: 'Running' },
    ]);
    vi.mocked(exerciseService.createExerciseEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    await tools.sparky_manage_exercise.execute!(
      {
        action: 'log_exercise',
        exercise_name: 'running',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(exerciseService.createExerciseEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({ exercise_id: EXERCISE_ID }),
      { skipDuplicateCheck: true }
    );
  });

  it('falls back to the first fuzzy match', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([
      { id: EXERCISE_ID_2, name: 'Running Intervals' },
    ]);
    vi.mocked(exerciseService.createExerciseEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    await tools.sparky_manage_exercise.execute!(
      {
        action: 'log_exercise',
        exercise_name: 'running',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(exerciseService.createExerciseEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({ exercise_id: EXERCISE_ID_2 }),
      { skipDuplicateCheck: true }
    );
  });

  it('auto-creates a custom 300 kcal/h exercise when nothing matches', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([]);
    vi.mocked(exerciseService.createExercise).mockResolvedValue({
      id: EXERCISE_ID,
      name: 'Underwater Hockey',
    });
    vi.mocked(exerciseService.createExerciseEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'log_exercise',
        exercise_name: 'Underwater Hockey',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe('✅ Exercise logged for 2026-06-10.');
    expect(exerciseService.createExercise).toHaveBeenCalledWith('user-1', {
      name: 'Underwater Hockey',
      category: 'custom',
      calories_per_hour: 300,
      is_custom: true,
      shared_with_public: false,
      source: 'manual',
    });
    expect(exerciseService.createExerciseEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({ exercise_id: EXERCISE_ID }),
      { skipDuplicateCheck: true }
    );
  });

  it('parses sets passed as a JSON string', async () => {
    vi.mocked(exerciseService.createExerciseEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    await tools.sparky_manage_exercise.execute!(
      {
        action: 'log_exercise',
        exercise_id: EXERCISE_ID,
        entry_date: '2026-06-10',
        sets: '[{"reps":5,"weight":100}]',
      },
      opts
    );

    expect(exerciseService.createExerciseEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({
        sets: [
          {
            set_number: 1,
            set_type: 'Working Set',
            reps: 5,
            weight: 100,
            duration: null,
            distance: null,
            rest_time: null,
            rpe: null,
            notes: null,
          },
        ],
      }),
      { skipDuplicateCheck: true }
    );
  });

  it('persists per-set distance for cardio sets', async () => {
    vi.mocked(exerciseService.createExerciseEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    await tools.sparky_manage_exercise.execute!(
      {
        action: 'log_exercise',
        exercise_id: EXERCISE_ID,
        entry_date: '2026-06-10',
        duration_minutes: 30,
        sets: [{ duration: 1800, distance: 5.2 }],
      },
      opts
    );

    expect(exerciseService.createExerciseEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({
        sets: [expect.objectContaining({ duration: 1800, distance: 5.2 })],
      }),
      { skipDuplicateCheck: true }
    );
  });

  it('rejects a fractional set duration (per-set duration is integer seconds)', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'log_exercise',
        exercise_id: EXERCISE_ID,
        entry_date: '2026-06-10',
        sets: [{ reps: 5, duration: 90.5 }],
      },
      opts
    );

    // The sets union collapses inner paths, so the issue is reported on 'sets'.
    expect(result).toBe('Error [VALIDATION]: sets: Invalid input');
    expect(exerciseService.createExerciseEntry).not.toHaveBeenCalled();
  });

  it('rounds fractional durations arriving through the JSON-string sets branch', async () => {
    vi.mocked(exerciseService.createExerciseEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    await tools.sparky_manage_exercise.execute!(
      {
        action: 'log_exercise',
        exercise_id: EXERCISE_ID,
        entry_date: '2026-06-10',
        sets: '[{"reps":5,"duration":90.6}]',
      },
      opts
    );

    expect(exerciseService.createExerciseEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({
        sets: [expect.objectContaining({ duration: 91 })],
      }),
      { skipDuplicateCheck: true }
    );
  });

  it('ignores an unparseable sets string and still logs', async () => {
    vi.mocked(exerciseService.createExerciseEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'log_exercise',
        exercise_id: EXERCISE_ID,
        entry_date: '2026-06-10',
        sets: '{not json',
      },
      opts
    );

    expect(result).toBe('✅ Exercise logged for 2026-06-10.');
    expect(exerciseService.createExerciseEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({ sets: undefined }),
      { skipDuplicateCheck: true }
    );
  });
});

describe('log_exercise units', () => {
  // The columns hold kg and km. A user whose app shows pounds says "benched
  // 185" and the model passes 185; stored as-is that is a 185 kg bench that
  // every progression then reads off.
  it('converts stated pounds and miles into the kg and km the columns hold', async () => {
    vi.mocked(exerciseService.createExerciseEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    await tools.sparky_manage_exercise.execute!(
      {
        action: 'log_exercise',
        exercise_id: EXERCISE_ID,
        entry_date: '2026-06-10',
        weight_unit: 'lbs',
        distance_unit: 'miles',
        distance: 3,
        sets: [{ reps: 5, weight: 185, distance: 1 }],
      },
      opts
    );

    const payload = vi.mocked(exerciseService.createExerciseEntry).mock
      .calls[0][2] as {
      distance: number;
      sets: { weight: number; distance: number }[];
    };
    expect(payload.distance).toBeCloseTo(4.828, 3);
    expect(payload.sets[0].weight).toBeCloseTo(83.915, 3);
    expect(payload.sets[0].distance).toBeCloseTo(1.609, 3);
    // Stated units settle it without a preferences read.
    expect(preferenceService.getUserPreferences).not.toHaveBeenCalled();
  });

  it("reads unstated units from the user's preferences", async () => {
    vi.mocked(preferenceService.getUserPreferences).mockResolvedValue({
      default_weight_unit: 'lbs',
      default_distance_unit: 'miles',
    } as never);
    vi.mocked(exerciseService.createExerciseEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    await tools.sparky_manage_exercise.execute!(
      {
        action: 'log_exercise',
        exercise_id: EXERCISE_ID,
        entry_date: '2026-06-10',
        distance: 1,
        sets: [{ reps: 10, weight: 100 }],
      },
      opts
    );

    const payload = vi.mocked(exerciseService.createExerciseEntry).mock
      .calls[0][2] as { distance: number; sets: { weight: number }[] };
    expect(payload.distance).toBeCloseTo(1.609, 3);
    expect(payload.sets[0].weight).toBeCloseTo(45.359, 3);
  });

  it('accepts the spellings a model actually produces', async () => {
    vi.mocked(exerciseService.createExerciseEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    await tools.sparky_manage_exercise.execute!(
      {
        action: 'log_exercise',
        exercise_id: EXERCISE_ID,
        entry_date: '2026-06-10',
        weight_unit: 'Pounds',
        sets: [{ reps: 10, weight: 100 }],
      },
      opts
    );

    const payload = vi.mocked(exerciseService.createExerciseEntry).mock
      .calls[0][2] as { sets: { weight: number }[] };
    expect(payload.sets[0].weight).toBeCloseTo(45.359, 3);
  });

  it('converts an update the same way', async () => {
    vi.mocked(exerciseService.updateExerciseEntry).mockResolvedValue({
      id: ENTRY_ID,
    } as never);

    await tools.sparky_manage_exercise.execute!(
      {
        action: 'update_exercise_entry',
        entry_id: ENTRY_ID,
        weight_unit: 'lbs',
        sets: [{ reps: 10, weight: 100 }],
      },
      opts
    );

    const payload = vi.mocked(exerciseService.updateExerciseEntry).mock
      .calls[0][3] as { sets: { weight: number }[] };
    expect(payload.sets[0].weight).toBeCloseTo(45.359, 3);
  });
});

describe('list_exercise_diary', () => {
  it('flattens preset sessions and renders the per-entry list in created_at order', async () => {
    vi.mocked(exerciseService.getExerciseEntriesByDate).mockResolvedValue([
      {
        type: 'preset',
        id: 'pe-1',
        name: 'Push Day',
        created_at: '2026-06-10T08:00:00Z',
        exercises: [
          {
            id: 'ee-2',
            name: 'Bench Press',
            sets: [
              {
                id: 's1',
                set_number: 1,
                set_type: 'Working Set',
                reps: 10,
                weight: 60,
                duration: null,
                rest_time: 90,
                rpe: 8,
                notes: null,
              },
              {
                id: 's2',
                set_number: 2,
                set_type: 'Working Set',
                reps: 8,
                weight: 65,
                duration: null,
                rest_time: null,
                rpe: null,
                notes: 'tough',
              },
            ],
            duration_minutes: 0,
            calories_burned: 0,
            notes: 'felt good',
            distance: null,
            avg_heart_rate: null,
            steps: null,
            created_at: '2026-06-10T08:05:00Z',
          },
        ],
      },
      {
        type: 'individual',
        id: 'ee-1',
        name: 'Morning Run',
        sets: [],
        duration_minutes: 30,
        calories_burned: 300,
        notes: null,
        distance: 5,
        avg_heart_rate: 150,
        steps: 6000,
        created_at: '2026-06-10T07:00:00Z',
      },
    ]);

    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'list_exercise_diary', entry_date: '2026-06-10' },
      opts
    );

    expect(result).toBe(
      '# Exercise Diary: 2026-06-10\n\n' +
        '**Morning Run** | 30 min | 300 kcal | 5 dist | 150 bpm | 6000 steps\n  ID: ee-1\n\n' +
        '**Bench Press** — 2 sets\n  Sets: 10r×60kg×RPE 8 (rest 90s); 8r×65kg (tough)\n  Notes: felt good\n  ID: ee-2'
    );
    expect(exerciseService.getExerciseEntriesByDate).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      '2026-06-10'
    );
  });

  it('renders an empty diary', async () => {
    vi.mocked(exerciseService.getExerciseEntriesByDate).mockResolvedValue([]);
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'list_exercise_diary', entry_date: '2026-06-11' },
      opts
    );
    expect(result).toBe('# Exercise Diary: 2026-06-11\n\nNo results found.');
  });
});

describe('workout presets', () => {
  it('get_workout_presets lists presets with exercise counts', async () => {
    vi.mocked(workoutPresetService.getWorkoutPresets).mockResolvedValue({
      presets: [{ id: 7, name: 'Push Day', exercises: [{}, {}, {}] }],
      total: 1,
      page: 1,
      limit: 1000,
    });

    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'get_workout_presets' },
      opts
    );

    expect(result).toBe(
      '# Workout Presets\n\n**Push Day** — 3 exercises\n  ID: 7'
    );
    expect(workoutPresetService.getWorkoutPresets).toHaveBeenCalledWith(
      'user-1',
      1,
      1000
    );
  });

  it('log_workout_preset requires preset_id or preset_name', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'log_workout_preset', entry_date: '2026-06-10' },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Either preset_id or preset_name must be provided'
    );
  });

  it('log_workout_preset resolves the preset by name and logs a grouped session', async () => {
    vi.mocked(workoutPresetRepository.getWorkoutPresetByName).mockResolvedValue(
      { id: 7, name: 'Push Day' }
    );
    vi.mocked(exerciseService.logWorkoutPresetGrouped).mockResolvedValue({
      id: 'pe-1',
      exercises: [{}, {}],
      // The full PresetSessionResponse shape isn't needed by the handler.
    } as never);

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'log_workout_preset',
        preset_name: 'Push Day',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      '✅ Workout preset logged for 2026-06-10. 2 exercises added.'
    );
    expect(workoutPresetRepository.getWorkoutPresetByName).toHaveBeenCalledWith(
      'user-1',
      'Push Day'
    );
    expect(exerciseService.logWorkoutPresetGrouped).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      7,
      '2026-06-10'
    );
  });

  it('log_workout_preset reports an unknown preset name as not found', async () => {
    vi.mocked(workoutPresetRepository.getWorkoutPresetByName).mockResolvedValue(
      null
    );
    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'log_workout_preset',
        preset_name: 'Nope',
        entry_date: '2026-06-10',
      },
      opts
    );
    expect(result).toBe(NOT_FOUND_RESOURCE_TEXT);
    expect(exerciseService.logWorkoutPresetGrouped).not.toHaveBeenCalled();
  });

  it('log_workout_preset maps a missing preset_id to not found', async () => {
    vi.mocked(exerciseService.logWorkoutPresetGrouped).mockRejectedValue(
      new Error('Workout preset not found.')
    );
    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'log_workout_preset',
        preset_id: PRESET_ID,
        entry_date: '2026-06-10',
      },
      opts
    );
    expect(result).toBe(NOT_FOUND_RESOURCE_TEXT);
  });

  it('create_workout_preset builds ordered exercises and confirms', async () => {
    vi.mocked(workoutPresetService.createWorkoutPreset).mockResolvedValue({
      id: 9,
      name: 'Leg Day',
      exercises: [{}, {}],
    });

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'create_workout_preset',
        name: 'Leg Day',
        exercise_ids: [EXERCISE_ID, EXERCISE_ID_2],
      },
      opts
    );

    expect(result).toBe(
      '✅ Workout preset "Leg Day" created with 2 exercises.'
    );
    expect(workoutPresetService.createWorkoutPreset).toHaveBeenCalledWith(
      'user-1',
      {
        user_id: 'user-1',
        name: 'Leg Day',
        description: null,
        is_public: false,
        exercises: [
          { exercise_id: EXERCISE_ID, sort_order: 0 },
          { exercise_id: EXERCISE_ID_2, sort_order: 1 },
        ],
      }
    );
  });

  it('create_workout_preset requires exercises or exercise_ids', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'create_workout_preset', name: 'Empty Day' },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Either exercises or exercise_ids must be provided'
    );
    expect(workoutPresetService.createWorkoutPreset).not.toHaveBeenCalled();
  });

  it('create_workout_preset accepts fully programmed exercises and confirms with set count', async () => {
    vi.mocked(workoutPresetService.createWorkoutPreset).mockResolvedValue({
      id: 9,
      name: 'Leg Day',
      exercises: [{}, {}],
    });

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'create_workout_preset',
        name: 'Leg Day',
        description: 'Lower body strength',
        exercises: [
          {
            exercise_id: EXERCISE_ID,
            sets: [
              {
                set_number: 1,
                set_type: 'Warmup',
                reps: 5,
                weight: 60,
                rest_time: 120,
              },
              { set_number: 2, reps: 5, weight: 100, rest_time: 180 },
            ],
          },
          {
            exercise_id: EXERCISE_ID_2,
            sort_order: 5,
            superset_group: 1,
            sets: [{ set_number: 1, reps: 10, notes: 'slow tempo' }],
          },
        ],
      },
      opts
    );

    expect(result).toBe(
      '✅ Workout preset "Leg Day" created: 2 exercises, 3 sets.'
    );
    expect(workoutPresetService.createWorkoutPreset).toHaveBeenCalledWith(
      'user-1',
      {
        user_id: 'user-1',
        name: 'Leg Day',
        description: 'Lower body strength',
        is_public: false,
        exercises: [
          {
            exercise_id: EXERCISE_ID,
            sort_order: 0,
            superset_group: null,
            sets: [
              {
                set_number: 1,
                set_type: 'Warmup',
                reps: 5,
                weight: 60,
                duration: null,
                distance: null,
                rest_time: 120,
                notes: null,
              },
              {
                set_number: 2,
                set_type: 'Working Set',
                reps: 5,
                weight: 100,
                duration: null,
                distance: null,
                rest_time: 180,
                notes: null,
              },
            ],
          },
          {
            exercise_id: EXERCISE_ID_2,
            sort_order: 5,
            superset_group: 1,
            sets: [
              {
                set_number: 1,
                set_type: 'Working Set',
                reps: 10,
                weight: null,
                duration: null,
                distance: null,
                rest_time: null,
                notes: 'slow tempo',
              },
            ],
          },
        ],
      }
    );
  });

  it('create_workout_preset rejects a missing name with a validation error', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'create_workout_preset',
        exercises: [
          { exercise_id: EXERCISE_ID, sets: [{ set_number: 1, reps: 5 }] },
        ],
      },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: name: Invalid input: expected string, received undefined'
    );
    expect(workoutPresetService.createWorkoutPreset).not.toHaveBeenCalled();
  });

  it('create_workout_preset resolves exercise_name items against existing exercises', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([
      { id: EXERCISE_ID, name: 'Bench Press' },
    ]);
    vi.mocked(workoutPresetService.createWorkoutPreset).mockResolvedValue({
      id: 9,
      name: 'Push Day',
      exercises: [{}],
    });

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'create_workout_preset',
        name: 'Push Day',
        exercises: [
          {
            exercise_name: 'Bench Press',
            sets: [{ set_number: 1, reps: 8, weight: 60 }],
          },
        ],
      },
      opts
    );

    expect(result).toBe(
      '✅ Workout preset "Push Day" created: 1 exercises, 1 sets.'
    );
    expect(exerciseService.createExercise).not.toHaveBeenCalled();
    expect(workoutPresetService.createWorkoutPreset).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        exercises: [
          expect.objectContaining({ exercise_id: EXERCISE_ID, sort_order: 0 }),
        ],
      })
    );
  });

  it('create_workout_preset auto-creates unknown names once per distinct name', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([]);
    vi.mocked(exerciseService.createExercise).mockResolvedValue({
      id: EXERCISE_ID_2,
      name: 'Cable Crunch',
    });
    vi.mocked(workoutPresetService.createWorkoutPreset).mockResolvedValue({
      id: 9,
      name: 'Core Day',
      exercises: [{}, {}],
    });

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'create_workout_preset',
        name: 'Core Day',
        exercises: [
          {
            exercise_name: 'Cable Crunch',
            sets: [{ set_number: 1, reps: 12 }],
          },
          {
            exercise_name: 'cable crunch',
            superset_group: 1,
            sets: [{ set_number: 1, reps: 15 }],
          },
        ],
      },
      opts
    );

    expect(result).toBe(
      '✅ Workout preset "Core Day" created: 2 exercises, 2 sets.'
    );
    expect(exerciseService.createExercise).toHaveBeenCalledTimes(1);
    expect(exerciseService.createExercise).toHaveBeenCalledWith('user-1', {
      name: 'Cable Crunch',
      category: 'custom',
      calories_per_hour: 300,
      is_custom: true,
      shared_with_public: false,
      source: 'manual',
    });
    expect(workoutPresetService.createWorkoutPreset).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        exercises: [
          expect.objectContaining({ exercise_id: EXERCISE_ID_2 }),
          expect.objectContaining({
            exercise_id: EXERCISE_ID_2,
            superset_group: 1,
          }),
        ],
      })
    );
  });

  it('create_workout_preset rejects an item with neither exercise_id nor exercise_name', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'create_workout_preset',
        name: 'Broken Day',
        exercises: [{ sets: [{ set_number: 1, reps: 8 }] }],
      },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: exercises[0] needs exercise_id or exercise_name'
    );
    expect(workoutPresetService.createWorkoutPreset).not.toHaveBeenCalled();
  });

  it('create_workout_preset validates every item before creating any exercise', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([]);

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'create_workout_preset',
        name: 'Half Day',
        exercises: [
          { exercise_name: 'Brand New Movement' },
          { sets: [{ set_number: 1, reps: 8 }] },
        ],
      },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: exercises[1] needs exercise_id or exercise_name'
    );
    expect(exerciseService.createExercise).not.toHaveBeenCalled();
    expect(workoutPresetService.createWorkoutPreset).not.toHaveBeenCalled();
  });

  it('create_workout_preset rejects a duplicate name with recovery guidance', async () => {
    vi.mocked(workoutPresetRepository.getWorkoutPresetByName).mockResolvedValue(
      { id: PRESET_ID, name: 'Push Day' }
    );

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'create_workout_preset',
        name: 'Push Day',
        exercise_ids: [EXERCISE_ID],
      },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: A workout preset named "Push Day" already exists. One create_workout_preset call must contain the COMPLETE routine in its exercises array — to change the existing preset, call update_workout_preset with preset_name and the full exercise list; to make another routine, pick a different name'
    );
    expect(workoutPresetService.createWorkoutPreset).not.toHaveBeenCalled();
  });

  it('update_workout_preset resolves exercise_name items', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([
      { id: EXERCISE_ID, name: 'Squat' },
    ]);
    vi.mocked(workoutPresetService.updateWorkoutPreset).mockResolvedValue({
      id: PRESET_ID,
      name: 'Leg Day',
      exercises: [{}],
    });

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'update_workout_preset',
        preset_id: PRESET_ID,
        exercises: [
          { exercise_name: 'Squat', sets: [{ set_number: 1, reps: 5 }] },
        ],
      },
      opts
    );

    expect(result).toBe('✅ Workout preset "Leg Day" updated.');
    expect(workoutPresetService.updateWorkoutPreset).toHaveBeenCalledWith(
      'user-1',
      PRESET_ID,
      expect.objectContaining({
        exercises: [expect.objectContaining({ exercise_id: EXERCISE_ID })],
      })
    );
  });

  it('update_workout_preset requires preset_id or preset_name', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'update_workout_preset', name: 'New Name' },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Either preset_id or preset_name must be provided'
    );
    expect(workoutPresetService.updateWorkoutPreset).not.toHaveBeenCalled();
  });

  it('update_workout_preset requires something to update', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'update_workout_preset', preset_id: PRESET_ID },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Nothing to update — provide name, description, or exercises'
    );
    expect(workoutPresetService.updateWorkoutPreset).not.toHaveBeenCalled();
  });

  it('update_workout_preset replaces programming by preset id', async () => {
    vi.mocked(workoutPresetService.updateWorkoutPreset).mockResolvedValue({
      id: PRESET_ID,
      name: 'Leg Day v2',
      exercises: [{}],
    });

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'update_workout_preset',
        preset_id: PRESET_ID,
        name: 'Leg Day v2',
        exercises: [
          {
            exercise_id: EXERCISE_ID,
            sets: [{ set_number: 1, reps: 8, weight: 90, rest_time: 150 }],
          },
        ],
      },
      opts
    );

    expect(result).toBe('✅ Workout preset "Leg Day v2" updated.');
    expect(workoutPresetService.updateWorkoutPreset).toHaveBeenCalledWith(
      'user-1',
      PRESET_ID,
      {
        name: 'Leg Day v2',
        exercises: [
          {
            exercise_id: EXERCISE_ID,
            sort_order: 0,
            superset_group: null,
            sets: [
              {
                set_number: 1,
                set_type: 'Working Set',
                reps: 8,
                weight: 90,
                duration: null,
                distance: null,
                rest_time: 150,
                notes: null,
              },
            ],
          },
        ],
      }
    );
  });

  it('update_workout_preset resolves the preset by name', async () => {
    vi.mocked(workoutPresetRepository.getWorkoutPresetByName).mockResolvedValue(
      { id: 7, name: 'Push Day' }
    );
    vi.mocked(workoutPresetService.updateWorkoutPreset).mockResolvedValue({
      id: 7,
      name: 'Push Day',
      exercises: [],
    });

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'update_workout_preset',
        preset_name: 'Push Day',
        description: 'Chest, shoulders, triceps',
      },
      opts
    );

    expect(result).toBe('✅ Workout preset "Push Day" updated.');
    expect(workoutPresetRepository.getWorkoutPresetByName).toHaveBeenCalledWith(
      'user-1',
      'Push Day'
    );
    expect(workoutPresetService.updateWorkoutPreset).toHaveBeenCalledWith(
      'user-1',
      7,
      { description: 'Chest, shoulders, triceps' }
    );
  });

  it('update_workout_preset reports an unknown preset name as not found', async () => {
    vi.mocked(workoutPresetRepository.getWorkoutPresetByName).mockResolvedValue(
      null
    );
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'update_workout_preset', preset_name: 'Nope', name: 'X' },
      opts
    );
    expect(result).toBe(
      "Error [NOT_FOUND]: Workout Preset with ID 'Nope' not found.\n\nSuggestion: Check the ID and try again."
    );
    expect(workoutPresetService.updateWorkoutPreset).not.toHaveBeenCalled();
  });
});

describe('update_exercise_entry / delete_exercise_entry', () => {
  it('updates only the provided fields and replaces sets', async () => {
    vi.mocked(exerciseService.updateExerciseEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'update_exercise_entry',
        entry_id: ENTRY_ID,
        duration_minutes: 45,
        steps: 1234,
        sets: '[{"reps":12}]',
      },
      opts
    );

    expect(result).toBe('✅ Exercise entry updated.');
    expect(exerciseService.updateExerciseEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      ENTRY_ID,
      {
        duration_minutes: 45,
        steps: 1234,
        sets: [
          {
            set_number: 1,
            set_type: 'Working Set',
            reps: 12,
            weight: null,
            duration: null,
            distance: null,
            rest_time: null,
            rpe: null,
            notes: null,
          },
        ],
      }
    );
  });

  it('rejects an unparseable sets string', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'update_exercise_entry', entry_id: ENTRY_ID, sets: '{bad' },
      opts
    );
    expect(result).toBe('Error [VALIDATION]: Invalid JSON format for sets');
    expect(exerciseService.updateExerciseEntry).not.toHaveBeenCalled();
  });

  it('maps a missing entry to NOT_FOUND with the entry id', async () => {
    vi.mocked(exerciseService.updateExerciseEntry).mockRejectedValue(
      new Error('Exercise entry not found.')
    );
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'update_exercise_entry', entry_id: ENTRY_ID, notes: 'x' },
      opts
    );
    expect(result).toBe(
      `Error [NOT_FOUND]: Exercise Entry with ID '${ENTRY_ID}' not found.\n\nSuggestion: Check the ID and try again.`
    );
  });

  it('deletes an entry', async () => {
    vi.mocked(exerciseService.deleteExerciseEntry).mockResolvedValue({
      message: 'Exercise entry deleted successfully.',
    });
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'delete_exercise_entry', entry_id: ENTRY_ID },
      opts
    );
    expect(result).toBe('✅ Exercise entry deleted.');
    expect(exerciseService.deleteExerciseEntry).toHaveBeenCalledWith(
      'user-1',
      ENTRY_ID
    );
  });

  it('maps a missing entry on delete to NOT_FOUND with the entry id', async () => {
    vi.mocked(exerciseService.deleteExerciseEntry).mockRejectedValue(
      new Error('Exercise entry not found.')
    );
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'delete_exercise_entry', entry_id: ENTRY_ID },
      opts
    );
    expect(result).toBe(
      `Error [NOT_FOUND]: Exercise Entry with ID '${ENTRY_ID}' not found.\n\nSuggestion: Check the ID and try again.`
    );
  });
});

describe('get_exercise_details (manage action)', () => {
  it('renders the markdown detail card with parsed text columns', async () => {
    vi.mocked(exerciseService.getExerciseById).mockResolvedValue({
      id: EXERCISE_ID,
      name: 'Bench Press',
      description: 'A classic chest press.',
      category: 'Strength',
      equipment: '["Barbell"]',
      primary_muscles: '["Chest","Triceps"]',
      instructions: '["Lie on the bench.","Press the bar."]',
      images: ['bench.png'],
      level: 'intermediate',
      calories_per_hour: 400,
      is_custom: false,
    });

    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'get_exercise_details', exercise_id: EXERCISE_ID },
      opts
    );

    expect(result).toBe(
      '### Bench Press\n\n' +
        '*A classic chest press.*\n\n' +
        '**Category:** Strength\n' +
        '**Equipment:** Barbell\n' +
        '**Muscles:** Chest, Triceps\n\n' +
        '#### Instructions\n' +
        '1. Lie on the bench.\n' +
        '2. Press the bar.\n'
    );
    expect(exerciseService.getExerciseById).toHaveBeenCalledWith(
      'user-1',
      EXERCISE_ID
    );
  });

  it('returns DB_ERROR when neither id nor name is given (MCP quirk)', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'get_exercise_details' },
      opts
    );
    expect(result).toBe(DB_ERROR_TEXT);
  });

  it('maps an unmatched name to the generic not-found text', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([]);
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'get_exercise_details', exercise_name: 'Benchh' },
      opts
    );
    expect(result).toBe(NOT_FOUND_RESOURCE_TEXT);
  });
});

describe('get_exercise_progress (manage action)', () => {
  it('aggregates per-day set stats, skipping days without sets', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([
      { id: EXERCISE_ID, name: 'Bench Press' },
    ]);
    vi.mocked(exerciseService.getExerciseProgressData).mockResolvedValue([
      {
        entry_date: '2026-06-01',
        sets: [
          { reps: 10, weight: 60 },
          { reps: 8, weight: 70 },
        ],
      },
      { entry_date: '2026-06-01', sets: [{ reps: 5, weight: 80 }] },
      { entry_date: '2026-06-03', sets: [] },
      {
        entry_date: '2026-06-05',
        sets: [
          { reps: null, weight: 50 },
          { reps: 12, weight: null },
        ],
      },
    ]);

    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'get_exercise_progress', exercise_name: 'bench press' },
      opts
    );

    expect(result).toBe(
      '# Exercise Progress: bench press\n\n' +
        '**2026-06-01**: Max Weight: 80kg | Max Reps: 10 | Volume: 1560kg\n\n' +
        '**2026-06-05**: Max Weight: 50kg | Max Reps: 12 | Volume: 0kg\n\n' +
        '---\nShowing 2 of 2 results.'
    );
    expect(exerciseService.getExerciseProgressData).toHaveBeenCalledWith(
      'user-1',
      EXERCISE_ID,
      '1970-01-01',
      '9999-12-31'
    );
  });

  it('maps an unknown exercise to the generic not-found text', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([]);
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'get_exercise_progress', exercise_name: 'nope' },
      opts
    );
    expect(result).toBe(NOT_FOUND_RESOURCE_TEXT);
  });
});

describe('sparky_list_exercises', () => {
  it('returns the paginated catalog as JSON', async () => {
    vi.mocked(exerciseDb.getExercisesWithPagination).mockResolvedValue([
      { id: EXERCISE_ID, name: 'Bench Press' },
    ]);
    vi.mocked(exerciseDb.countExercises).mockResolvedValue(1);

    const result = await tools.sparky_list_exercises.execute!({}, opts);

    expect(result).toBe(
      JSON.stringify({
        data: [{ id: EXERCISE_ID, name: 'Bench Press' }],
        has_more: false,
        next_offset: null,
        total_count: 1,
      })
    );
    expect(exerciseDb.getExercisesWithPagination).toHaveBeenCalledWith(
      'user-1',
      undefined,
      null,
      null,
      null,
      null,
      20,
      0
    );
    expect(exerciseDb.countExercises).toHaveBeenCalledWith(
      'user-1',
      undefined,
      null,
      null,
      null,
      null
    );
  });

  it('clamps the limit to 50 and treats a blank search as absent', async () => {
    vi.mocked(exerciseDb.getExercisesWithPagination).mockResolvedValue([]);
    vi.mocked(exerciseDb.countExercises).mockResolvedValue(0);

    await tools.sparky_list_exercises.execute!(
      { limit: 500, offset: 10, search: '   ' },
      opts
    );

    expect(exerciseDb.getExercisesWithPagination).toHaveBeenCalledWith(
      'user-1',
      undefined,
      null,
      null,
      null,
      null,
      50,
      10
    );
  });
});

describe('sparky_get_exercise_details', () => {
  it('returns the projected exercise as JSON', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([
      {
        id: EXERCISE_ID,
        name: 'Bench Press',
        category: 'Strength',
        primary_muscles: ['Chest', 'Triceps'],
        equipment: ['Barbell'],
        level: 'intermediate',
        calories_per_hour: 400,
        description: null,
        is_custom: false,
        instructions: ['Lie on the bench.'],
        images: [],
        user_id: 'user-1',
      },
    ]);

    const result = await tools.sparky_get_exercise_details.execute!(
      { exercise_name: 'Bench Press' },
      opts
    );

    expect(result).toBe(
      JSON.stringify({
        id: EXERCISE_ID,
        name: 'Bench Press',
        category: 'Strength',
        muscle_groups: ['Chest', 'Triceps'],
        equipment: ['Barbell'],
        level: 'intermediate',
        calories_per_hour: 400,
        description: null,
        is_custom: false,
        instructions: ['Lie on the bench.'],
        images: [],
      })
    );
  });

  it('names the missing exercise in the NOT_FOUND error', async () => {
    vi.mocked(exerciseService.searchExercises).mockResolvedValue([]);
    const result = await tools.sparky_get_exercise_details.execute!(
      { exercise_name: 'Benchh' },
      opts
    );
    expect(result).toBe(
      "Error [NOT_FOUND]: Exercise with ID 'Benchh' not found.\n\nSuggestion: Check the ID and try again."
    );
  });
});

describe('sparky_search_exercises', () => {
  it('requires a query', async () => {
    const result = await tools.sparky_search_exercises.execute!(
      {} as never,
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: query: Invalid input: expected string, received undefined'
    );
  });

  it('returns projected matches as JSON', async () => {
    vi.mocked(exerciseService.searchExercisesPaginated).mockResolvedValue({
      exercises: [
        {
          id: EXERCISE_ID,
          name: 'Bench Press',
          category: 'Strength',
          primary_muscles: ['Chest'],
          equipment: ['Barbell'],
          level: 'intermediate',
          calories_per_hour: 400,
          description: null,
          is_custom: false,
          user_id: 'user-1',
          tags: ['private'],
        },
      ],
      totalCount: 1,
    });

    const result = await tools.sparky_search_exercises.execute!(
      { query: 'bench', muscle_group: 'Chest' },
      opts
    );

    expect(result).toBe(
      JSON.stringify({
        data: [
          {
            id: EXERCISE_ID,
            name: 'Bench Press',
            category: 'Strength',
            muscle_groups: ['Chest'],
            equipment: ['Barbell'],
            level: 'intermediate',
            calories_per_hour: 400,
            description: null,
            is_custom: false,
          },
        ],
        has_more: false,
        next_offset: null,
        total_count: 1,
      })
    );
    expect(exerciseService.searchExercisesPaginated).toHaveBeenCalledWith(
      'user-1',
      'bench',
      'user-1',
      undefined,
      ['Chest'],
      20,
      0
    );
  });
});

describe('sparky_get_exercise_diary', () => {
  it('lets a single date override the range and wraps entries plus sets', async () => {
    vi.mocked(exerciseEntryDb.getExerciseDiaryRange).mockResolvedValue({
      entries: [{ id: 'ee-1' }],
      sets: [{ id: 's-1' }],
    });

    const result = await tools.sparky_get_exercise_diary.execute!(
      { date: '2026-06-10', start_date: '2026-06-01' },
      opts
    );

    expect(result).toBe(
      JSON.stringify({
        start_date: '2026-06-10',
        end_date: '2026-06-10',
        entries: [{ id: 'ee-1' }],
        sets: [{ id: 's-1' }],
      })
    );
    expect(exerciseEntryDb.getExerciseDiaryRange).toHaveBeenCalledWith(
      'user-1',
      '2026-06-10',
      '2026-06-10'
    );
  });

  it('defaults to today (UTC) when no dates are given', async () => {
    vi.mocked(exerciseEntryDb.getExerciseDiaryRange).mockResolvedValue({
      entries: [],
      sets: [],
    });
    await tools.sparky_get_exercise_diary.execute!({}, opts);
    const today = todayInZone('UTC');
    expect(exerciseEntryDb.getExerciseDiaryRange).toHaveBeenCalledWith(
      'user-1',
      today,
      today
    );
  });
});

describe('sparky_get_daily_exercise_totals', () => {
  it('uses start_date as the end of an open range and wraps the rows', async () => {
    vi.mocked(exerciseEntryDb.getDailyExerciseTotalsRange).mockResolvedValue([
      { entry_date: '2026-06-01', entry_count: 2 },
    ]);

    const result = await tools.sparky_get_daily_exercise_totals.execute!(
      { start_date: '2026-06-01' },
      opts
    );

    expect(result).toBe(
      JSON.stringify({
        start_date: '2026-06-01',
        end_date: '2026-06-01',
        rows: [{ entry_date: '2026-06-01', entry_count: 2 }],
      })
    );
    expect(exerciseEntryDb.getDailyExerciseTotalsRange).toHaveBeenCalledWith(
      'user-1',
      '2026-06-01',
      '2026-06-01'
    );
  });
});

describe('sparky_get_recent_exercise_entries', () => {
  it('defaults the limit to 50 and returns raw rows as JSON', async () => {
    vi.mocked(exerciseEntryDb.getRecentExerciseEntries).mockResolvedValue([
      { id: 'ee-1', exercise_name_from_catalog: 'Running' },
    ]);

    const result = await tools.sparky_get_recent_exercise_entries.execute!(
      {},
      opts
    );

    expect(result).toBe(
      JSON.stringify([{ id: 'ee-1', exercise_name_from_catalog: 'Running' }])
    );
    expect(exerciseEntryDb.getRecentExerciseEntries).toHaveBeenCalledWith(
      'user-1',
      50
    );
  });

  it('rejects an out-of-range limit', async () => {
    const result = await tools.sparky_get_recent_exercise_entries.execute!(
      { limit: 999 },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: limit: Too big: expected number to be <=200'
    );
  });
});

describe('sparky_get_exercise_usage', () => {
  it('returns paginated usage rows as JSON', async () => {
    vi.mocked(exerciseEntryDb.getExerciseUsage).mockResolvedValue({
      rows: [{ id: 'ee-1' }, { id: 'ee-2' }],
      totalCount: 12,
    });

    const result = await tools.sparky_get_exercise_usage.execute!(
      {
        exercise_id: EXERCISE_ID,
        start_date: '2026-06-01',
        end_date: '2026-06-07',
        limit: 2,
      },
      opts
    );

    expect(result).toBe(
      JSON.stringify({
        data: [{ id: 'ee-1' }, { id: 'ee-2' }],
        has_more: true,
        next_offset: 2,
        total_count: 12,
      })
    );
    expect(exerciseEntryDb.getExerciseUsage).toHaveBeenCalledWith(
      'user-1',
      EXERCISE_ID,
      '2026-06-01',
      '2026-06-07',
      2,
      0
    );
  });
});

describe('sparky_get_exercise_progress', () => {
  it('returns the aggregated days as JSON and forwards the date range', async () => {
    vi.mocked(exerciseService.getExerciseProgressData).mockResolvedValue([
      { entry_date: '2026-06-01', sets: [{ reps: 10, weight: 60 }] },
    ]);

    const result = await tools.sparky_get_exercise_progress.execute!(
      {
        exercise_id: EXERCISE_ID,
        start_date: '2026-06-01',
        end_date: '2026-06-07',
      },
      opts
    );

    expect(result).toBe(
      JSON.stringify({
        data: [
          {
            entry_date: '2026-06-01',
            max_weight: 60,
            max_reps: 10,
            total_volume: 600,
          },
        ],
        has_more: false,
        next_offset: null,
        total_count: 1,
      })
    );
    expect(exerciseService.getExerciseProgressData).toHaveBeenCalledWith(
      'user-1',
      EXERCISE_ID,
      '2026-06-01',
      '2026-06-07'
    );
  });

  it('collapses two same-day pg Date entries into one calendar-day group', async () => {
    vi.mocked(exerciseService.getExerciseProgressData).mockResolvedValue([
      { entry_date: new Date(2026, 5, 10), sets: [{ reps: 10, weight: 60 }] },
      { entry_date: new Date(2026, 5, 10), sets: [{ reps: 8, weight: 70 }] },
    ]);

    const result = await tools.sparky_get_exercise_progress.execute!(
      { exercise_id: EXERCISE_ID },
      opts
    );

    expect(result).toBe(
      JSON.stringify({
        data: [
          {
            entry_date: '2026-06-10',
            max_weight: 70,
            max_reps: 10,
            total_volume: 10 * 60 + 8 * 70,
          },
        ],
        has_more: false,
        next_offset: null,
        total_count: 1,
      })
    );
  });
});

describe('get_frequent_sets', () => {
  it('renders the usual-workouts summary grouped by weekday', async () => {
    vi.mocked(exerciseEntryDb.getFrequentSets).mockResolvedValue([
      {
        day_of_week: 1,
        exercise_id: EXERCISE_ID,
        exercise_name: 'Squats',
        session_count: 4,
        modal_sets: 3,
        modal_reps: 8,
        modal_weight: 80,
        modal_duration: null,
      },
      {
        day_of_week: 1,
        exercise_id: ENTRY_ID,
        exercise_name: 'Plank',
        session_count: 2,
        modal_sets: 3,
        modal_reps: null,
        modal_weight: null,
        modal_duration: 60,
      },
      {
        day_of_week: 4,
        exercise_id: EXERCISE_ID,
        exercise_name: 'Squats',
        session_count: 3,
        modal_sets: 3,
        modal_reps: 5,
        modal_weight: 90,
        modal_duration: null,
      },
    ]);

    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'get_frequent_sets', weeks: 6 },
      opts
    );

    expect(result).toBe(
      '# Usual workouts (last 6 weeks)\n' +
        '\n## Monday\n' +
        `- Squats — 4 sessions, typically 3×8 @ 80kg (id: ${EXERCISE_ID})\n` +
        `- Plank — 2 sessions, typically 3 sets of 60s (id: ${ENTRY_ID})\n` +
        '\n## Thursday\n' +
        `- Squats — 3 sessions, typically 3×5 @ 90kg (id: ${EXERCISE_ID})`
    );
    // Window: 6 weeks back from today (UTC) through today — future
    // plan-generated entries must not count as history.
    const [, since, until] = vi.mocked(exerciseEntryDb.getFrequentSets).mock
      .calls[0];
    // Inclusive window: exactly 6*7 days ending today.
    expect(until).toBe(todayInZone('UTC'));
    expect(since).toBe(addDays(todayInZone('UTC'), -(6 * 7 - 1)));
  });

  it('infers get_frequent_sets when only weeks is provided', async () => {
    vi.mocked(exerciseEntryDb.getFrequentSets).mockResolvedValue([]);

    const result = await tools.sparky_manage_exercise.execute!(
      { weeks: 2 },
      opts
    );

    expect(result).toBe(
      'No repeated workouts found in the last 2 weeks (an exercise must appear on the same weekday at least twice to count). Ask the user about their routine instead.'
    );
    expect(exerciseEntryDb.getFrequentSets).toHaveBeenCalledTimes(1);
  });

  it('explains an empty result instead of inventing a routine', async () => {
    vi.mocked(exerciseEntryDb.getFrequentSets).mockResolvedValue([]);

    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'get_frequent_sets' },
      opts
    );

    expect(result).toBe(
      'No repeated workouts found in the last 4 weeks (an exercise must appear on the same weekday at least twice to count). Ask the user about their routine instead.'
    );
  });

  it('rejects an out-of-range weeks value', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'get_frequent_sets', weeks: 26 },
      opts
    );

    expect(result).toContain('Error [VALIDATION]');
    expect(exerciseEntryDb.getFrequentSets).not.toHaveBeenCalled();
  });
});

describe('get_workout_plans', () => {
  const PLAN_ID = 7;
  const PLAN_ID_2 = 8;

  it('returns full structured plans so a replace-style update can rebuild them', async () => {
    vi.mocked(
      workoutPlanTemplateService.getWorkoutPlanTemplatesByUserId
    ).mockResolvedValue([
      {
        id: PLAN_ID,
        plan_name: 'PPL Week',
        description: 'Push/pull/legs',
        is_active: true,
        start_date: new Date(2026, 7, 17),
        end_date: null,
        assignments: [
          {
            id: 301,
            day_of_week: 1,
            sort_order: 0,
            workout_preset_id: PRESET_ID,
            workout_preset_name: 'Push Day',
            exercise_id: null,
            exercise_name: null,
            sets: [],
          },
          {
            id: 302,
            day_of_week: 5,
            sort_order: 1,
            workout_preset_id: null,
            workout_preset_name: null,
            exercise_id: EXERCISE_ID,
            exercise_name: 'Squat',
            sets: [
              {
                id: 900,
                set_number: 1,
                set_type: 'Working Set',
                reps: 5,
                weight: 100,
                duration: null,
                rest_time: 180,
                notes: null,
              },
            ],
          },
        ],
      },
      {
        id: PLAN_ID_2,
        plan_name: 'Deload',
        description: null,
        is_active: false,
        start_date: new Date(2026, 8, 1),
        end_date: new Date(2026, 8, 7),
        assignments: [],
      },
    ]);

    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'get_workout_plans' },
      opts
    );

    // Surrogate assignment/set row ids are dropped: the update action's
    // strict schema would reject them if the model echoed them back.
    expect(result).toBe(
      JSON.stringify([
        {
          id: PLAN_ID,
          plan_name: 'PPL Week',
          description: 'Push/pull/legs',
          is_active: true,
          start_date: '2026-08-17',
          end_date: null,
          assignments: [
            {
              day_of_week: 1,
              day: 'Mon',
              sort_order: 0,
              workout_preset_id: PRESET_ID,
              workout_preset_name: 'Push Day',
              exercise_id: null,
              exercise_name: null,
              sets: [],
            },
            {
              day_of_week: 5,
              day: 'Fri',
              sort_order: 1,
              workout_preset_id: null,
              workout_preset_name: null,
              exercise_id: EXERCISE_ID,
              exercise_name: 'Squat',
              sets: [
                {
                  set_number: 1,
                  set_type: 'Working Set',
                  reps: 5,
                  weight: 100,
                  duration: null,
                  rest_time: 180,
                  notes: null,
                },
              ],
            },
          ],
        },
        {
          id: PLAN_ID_2,
          plan_name: 'Deload',
          description: null,
          is_active: false,
          start_date: '2026-09-01',
          end_date: '2026-09-07',
          assignments: [],
        },
      ])
    );
  });
});

describe('create_workout_plan', () => {
  const PRESET_ID_2 = 45;
  const TODAY = todayInZone('UTC');

  it('creates a weekly plan and sends normalized assignments to the service', async () => {
    vi.mocked(
      workoutPlanTemplateService.createWorkoutPlanTemplate
    ).mockResolvedValue({
      plan_name: 'PPL Week',
      is_active: false,
      assignments: [{}, {}, {}],
    });

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'create_workout_plan',
        name: 'PPL Week',
        assignments: [
          { day_of_week: 1, workout_preset_id: PRESET_ID },
          { day_of_week: 3, workout_preset_id: PRESET_ID_2 },
          {
            day_of_week: 5,
            exercise_id: EXERCISE_ID,
            sets: [{ set_number: 1, reps: 5, weight: 100 }],
          },
        ],
      },
      opts
    );

    expect(result).toBe(
      '✅ Workout plan "PPL Week" created: 3 day assignments.'
    );
    expect(
      workoutPlanTemplateService.createWorkoutPlanTemplate
    ).toHaveBeenCalledWith('user-1', {
      plan_name: 'PPL Week',
      description: null,
      start_date: TODAY,
      end_date: null,
      is_active: false,
      assignments: [
        {
          day_of_week: 1,
          workout_preset_id: PRESET_ID,
          exercise_id: null,
          sort_order: 0,
          sets: undefined,
        },
        {
          day_of_week: 3,
          workout_preset_id: PRESET_ID_2,
          exercise_id: null,
          sort_order: 1,
          sets: undefined,
        },
        {
          day_of_week: 5,
          workout_preset_id: null,
          exercise_id: EXERCISE_ID,
          sort_order: 2,
          sets: [
            {
              set_number: 1,
              set_type: 'Working Set',
              reps: 5,
              weight: 100,
              duration: null,
              rest_time: null,
              notes: null,
            },
          ],
        },
      ],
      currentClientDate: TODAY,
    });
  });

  it('confirms diary generation when the plan is created active', async () => {
    vi.mocked(
      workoutPlanTemplateService.createWorkoutPlanTemplate
    ).mockResolvedValue({
      plan_name: 'PPL Week',
      is_active: true,
      assignments: [{}],
    });

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'create_workout_plan',
        name: 'PPL Week',
        is_active: true,
        start_date: '2026-08-24',
        assignments: [{ day_of_week: 1, workout_preset_id: PRESET_ID }],
      },
      opts
    );

    expect(result).toBe(
      '✅ Workout plan "PPL Week" created: 1 day assignments. Plan is active — workout diary entries were generated.'
    );
    expect(
      workoutPlanTemplateService.createWorkoutPlanTemplate
    ).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ start_date: '2026-08-24', is_active: true })
    );
  });

  it('rejects an assignment carrying both a preset and an exercise', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'create_workout_plan',
        name: 'Broken',
        assignments: [
          {
            day_of_week: 1,
            workout_preset_id: PRESET_ID,
            exercise_id: EXERCISE_ID,
          },
        ],
      },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Each assignment needs exactly one of workout_preset_id or exercise_id'
    );
    expect(
      workoutPlanTemplateService.createWorkoutPlanTemplate
    ).not.toHaveBeenCalled();
  });

  it('rejects sets attached to a preset assignment', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'create_workout_plan',
        name: 'Broken',
        assignments: [
          {
            day_of_week: 1,
            workout_preset_id: PRESET_ID,
            sets: [{ set_number: 1, reps: 5 }],
          },
        ],
      },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Assignment sets are only valid with exercise_id'
    );
  });

  it('rejects an end_date before the start_date', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'create_workout_plan',
        name: 'Backwards',
        start_date: '2026-08-24',
        end_date: '2026-08-20',
        assignments: [{ day_of_week: 1, workout_preset_id: PRESET_ID }],
      },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: end_date must be on or after start_date'
    );
    expect(
      workoutPlanTemplateService.createWorkoutPlanTemplate
    ).not.toHaveBeenCalled();
  });
});

describe('update_workout_plan', () => {
  const PLAN_ID = 7;
  const TODAY = todayInZone('UTC');

  it('requires a plan identifier', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'update_workout_plan', is_active: true },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Either plan_id or plan_name must be provided'
    );
  });

  it('requires at least one updatable field', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'update_workout_plan', plan_id: PLAN_ID },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Nothing to update — provide name, description, start_date, end_date, is_active, or assignments'
    );
  });

  it('merges the request over the existing row (read-modify-write)', async () => {
    vi.mocked(
      workoutPlanTemplateService.getWorkoutPlanTemplatesByUserId
    ).mockResolvedValue([{ id: PLAN_ID, plan_name: 'PPL Week' }]);
    vi.mocked(
      workoutPlanTemplateRepository.getWorkoutPlanTemplateById
    ).mockResolvedValue({
      id: PLAN_ID,
      user_id: 'user-1',
      plan_name: 'PPL Week',
      description: 'Original split',
      start_date: new Date(2026, 7, 17),
      end_date: null,
      is_active: true,
      assignments: [{ day_of_week: 1 }],
    });
    vi.mocked(
      workoutPlanTemplateService.updateWorkoutPlanTemplate
    ).mockResolvedValue({ plan_name: 'PPL Week' });

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'update_workout_plan',
        plan_name: 'ppl week',
        is_active: false,
      },
      opts
    );

    expect(result).toBe('✅ Workout plan "PPL Week" updated.');
    // The merged payload keeps every unspecified field from the current row
    // (the repository would otherwise blank plan_name and deactivate) and
    // omits assignments entirely so they stay untouched.
    expect(
      workoutPlanTemplateService.updateWorkoutPlanTemplate
    ).toHaveBeenCalledWith('user-1', PLAN_ID, {
      plan_name: 'PPL Week',
      description: 'Original split',
      start_date: '2026-08-17',
      end_date: null,
      is_active: false,
      currentClientDate: TODAY,
    });
  });

  it('replaces the schedule when assignments are provided', async () => {
    vi.mocked(
      workoutPlanTemplateRepository.getWorkoutPlanTemplateById
    ).mockResolvedValue({
      id: PLAN_ID,
      user_id: 'user-1',
      plan_name: 'PPL Week',
      description: null,
      start_date: new Date(2026, 7, 17),
      end_date: new Date(2026, 8, 13),
      is_active: false,
      assignments: [],
    });
    vi.mocked(
      workoutPlanTemplateService.updateWorkoutPlanTemplate
    ).mockResolvedValue({ plan_name: 'PPL Week' });

    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'update_workout_plan',
        plan_id: PLAN_ID,
        assignments: [
          { day_of_week: 2, workout_preset_id: PRESET_ID, sort_order: 4 },
        ],
      },
      opts
    );

    expect(result).toBe('✅ Workout plan "PPL Week" updated.');
    expect(
      workoutPlanTemplateService.updateWorkoutPlanTemplate
    ).toHaveBeenCalledWith('user-1', PLAN_ID, {
      plan_name: 'PPL Week',
      description: null,
      start_date: '2026-08-17',
      end_date: '2026-09-13',
      is_active: false,
      assignments: [
        {
          day_of_week: 2,
          workout_preset_id: PRESET_ID,
          exercise_id: null,
          sort_order: 4,
          sets: undefined,
        },
      ],
      currentClientDate: TODAY,
    });
  });

  it('rejects an ambiguous plan name instead of guessing', async () => {
    vi.mocked(
      workoutPlanTemplateService.getWorkoutPlanTemplatesByUserId
    ).mockResolvedValue([
      { id: 7, plan_name: 'PPL Week' },
      { id: 9, plan_name: 'ppl week' },
    ]);
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'update_workout_plan', plan_name: 'PPL Week', is_active: true },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Multiple plans are named "PPL Week" — use plan_id (see get_workout_plans)'
    );
    expect(
      workoutPlanTemplateService.updateWorkoutPlanTemplate
    ).not.toHaveBeenCalled();
  });

  it('rejects a merged range where the kept end_date precedes the new start', async () => {
    vi.mocked(
      workoutPlanTemplateRepository.getWorkoutPlanTemplateById
    ).mockResolvedValue({
      id: PLAN_ID,
      user_id: 'user-1',
      plan_name: 'PPL Week',
      description: null,
      start_date: new Date(2026, 7, 17),
      end_date: new Date(2026, 8, 13),
      is_active: false,
      assignments: [],
    });
    const result = await tools.sparky_manage_exercise.execute!(
      {
        action: 'update_workout_plan',
        plan_id: PLAN_ID,
        start_date: '2026-10-01',
      },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: end_date must be on or after start_date'
    );
    expect(
      workoutPlanTemplateService.updateWorkoutPlanTemplate
    ).not.toHaveBeenCalled();
  });

  it('maps an unknown plan name to NOT_FOUND', async () => {
    vi.mocked(
      workoutPlanTemplateService.getWorkoutPlanTemplatesByUserId
    ).mockResolvedValue([]);
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'update_workout_plan', plan_name: 'Nope', is_active: true },
      opts
    );
    expect(result).toBe(
      "Error [NOT_FOUND]: Workout Plan with ID 'Nope' not found.\n\nSuggestion: Check the ID and try again."
    );
    expect(
      workoutPlanTemplateService.updateWorkoutPlanTemplate
    ).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// W7 — the engine read actions
// ---------------------------------------------------------------------------

const RECOVERY = {
  date: '2026-08-23',
  muscles: [
    {
      muscle: 'quadriceps',
      freshness: 1,
      fatigue_sets: 0,
      last_trained: null,
    },
    {
      muscle: 'triceps',
      freshness: 0.682,
      fatigue_sets: 3.182,
      last_trained: '2026-08-22',
    },
    {
      muscle: 'chest',
      freshness: 0.364,
      fatigue_sets: 6.364,
      last_trained: '2026-08-22',
    },
  ],
  tunables: {
    window_days: 14,
    half_life_days: 2,
    secondary_weight: 0.5,
    full_fatigue_sets: 10,
  },
};

const RECOMMENDATION = {
  id: '77777777-7777-4777-8777-777777777777',
  status: 'active' as const,
  target_duration_minutes: 60,
  gym_profile_id: null,
  generated_at: '2026-08-23T12:00:00.000Z',
  payload: {
    muscle_groups: ['middle back', 'lats'],
    estimated_duration_minutes: 52,
    exercises: [
      {
        exercise_id: EXERCISE_ID,
        exercise_name: 'Seated Cable Rows',
        modality: 'weight_reps' as const,
        primary_muscles: ['middle back'],
        secondary_muscles: ['biceps'],
        equipment: ['cable'],
        images: [],
        sort_order: 0,
        rest_seconds: 90,
        rationale: 'fresh middle back · +2.5% from last session',
        sets: [
          {
            set_number: 1,
            set_type: 'Warmup' as const,
            reps: 10,
            weight: 31.75,
            duration: null,
            distance: null,
            rest_time: 60,
          },
          {
            set_number: 2,
            set_type: 'Working Set' as const,
            reps: 10,
            weight: 52.5,
            duration: null,
            distance: null,
            rest_time: 90,
          },
        ],
      },
      {
        exercise_id: EXERCISE_ID_2,
        exercise_name: 'Pullups',
        modality: 'reps_only' as const,
        primary_muscles: ['lats'],
        secondary_muscles: [],
        equipment: [],
        images: [],
        sort_order: 1,
        rest_seconds: 120,
        rationale: 'fresh lats',
        sets: [
          {
            set_number: 1,
            set_type: 'Working Set' as const,
            reps: 8,
            weight: null,
            duration: null,
            distance: null,
            rest_time: 120,
          },
        ],
      },
    ],
  },
};

describe('get_muscle_recovery', () => {
  it('renders the freshness table with the tunables that explain it', async () => {
    vi.mocked(workoutRecommendationService.getMuscleRecovery).mockResolvedValue(
      RECOVERY
    );

    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'get_muscle_recovery' },
      opts
    );

    expect(workoutRecommendationService.getMuscleRecovery).toHaveBeenCalledWith(
      'user-1'
    );
    expect(result).toBe(
      '# Muscle Recovery (2026-08-23)\n\n' +
        '- quadriceps — 100% fresh — not trained in the last 14 days\n' +
        '- triceps — 68% fresh — last trained 2026-08-22\n' +
        '- chest — 36% fresh — last trained 2026-08-22\n\n' +
        '100% is untrained; 0% is 10 decayed working sets standing against the muscle, and that fatigue halves every 2 days.'
    );
  });

  it('says so plainly when there is no history at all', async () => {
    vi.mocked(workoutRecommendationService.getMuscleRecovery).mockResolvedValue(
      {
        ...RECOVERY,
        muscles: [],
      }
    );

    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'get_muscle_recovery' },
      opts
    );

    expect(result).toBe(
      '# Muscle Recovery (2026-08-23)\n\n' +
        'No exercise history yet — every muscle is fully fresh.\n\n' +
        '100% is untrained; 0% is 10 decayed working sets standing against the muscle, and that fatigue halves every 2 days.'
    );
  });
});

describe('generate_workout', () => {
  it('renders the engine payload with local ids and the proposal handoff', async () => {
    vi.mocked(
      workoutRecommendationService.generateRecommendation
    ).mockResolvedValue(RECOMMENDATION);

    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'generate_workout' },
      opts
    );

    expect(
      workoutRecommendationService.generateRecommendation
    ).toHaveBeenCalledWith('user-1', {
      durationMinutes: undefined,
      swap: undefined,
    });
    expect(result).toBe(
      '# Suggested Workout\n\n' +
        'Built around: middle back, lats\n' +
        'Estimated 52 min (target 60 min) · 2 exercises\n\n' +
        `1. **Seated Cable Rows** — ID: ${EXERCISE_ID}\n` +
        '   modality weight_reps · equipment: cable · why: fresh middle back · +2.5% from last session\n' +
        '   Set 1 (Warmup): 10 reps @ 31.75 kg, rest 60s\n' +
        '   Set 2 (Working Set): 10 reps @ 52.5 kg, rest 90s\n\n' +
        `2. **Pullups** — ID: ${EXERCISE_ID_2}\n` +
        '   modality reps_only · equipment: none · why: fresh lats\n' +
        '   Set 1 (Working Set): 8 reps, rest 120s\n\n' +
        'Now present this to the user by calling sparky_propose_workout_preset with these exercises and sets verbatim — do not alter the programming.'
    );
  });

  it('passes the target duration and swap through to the engine', async () => {
    vi.mocked(
      workoutRecommendationService.generateRecommendation
    ).mockResolvedValue(RECOMMENDATION);

    await tools.sparky_manage_exercise.execute!(
      { action: 'generate_workout', duration_minutes: 45, swap: true },
      opts
    );

    expect(
      workoutRecommendationService.generateRecommendation
    ).toHaveBeenCalledWith('user-1', { durationMinutes: 45, swap: true });
  });

  it('infers the action from a bare swap', async () => {
    vi.mocked(
      workoutRecommendationService.generateRecommendation
    ).mockResolvedValue(RECOMMENDATION);

    await tools.sparky_manage_exercise.execute!({ swap: true }, opts);

    expect(
      workoutRecommendationService.generateRecommendation
    ).toHaveBeenCalledWith('user-1', {
      durationMinutes: undefined,
      swap: true,
    });
  });

  // "I've got 45 minutes" is the coaching prompt's own canonical request. Read
  // as a log it would have written a "General Exercise" entry for a session the
  // user never did — a silent wrong write, not just a wrong read.
  it('infers the action from a bare duration', async () => {
    vi.mocked(
      workoutRecommendationService.generateRecommendation
    ).mockResolvedValue(RECOMMENDATION);

    await tools.sparky_manage_exercise.execute!({ duration_minutes: 45 }, opts);

    expect(
      workoutRecommendationService.generateRecommendation
    ).toHaveBeenCalledWith('user-1', { durationMinutes: 45, swap: undefined });
    expect(exerciseService.createExerciseEntry).not.toHaveBeenCalled();
  });

  it('infers generation from a duration that carries only a note', async () => {
    vi.mocked(
      workoutRecommendationService.generateRecommendation
    ).mockResolvedValue(RECOMMENDATION);

    // "I've got 45 minutes, upper body" — the model tends to put the second
    // half in `notes`. Nothing here names an exercise or a measurement, so
    // there is nothing to log; reading it as a log would have written a
    // "General Exercise" entry.
    await tools.sparky_manage_exercise.execute!(
      { duration_minutes: 45, notes: 'upper body', entry_date: '2026-06-10' },
      opts
    );

    expect(
      workoutRecommendationService.generateRecommendation
    ).toHaveBeenCalledWith('user-1', { durationMinutes: 45, swap: undefined });
    expect(exerciseService.createExerciseEntry).not.toHaveBeenCalled();
  });

  it('leaves a duration that carries any logging field to log_exercise', async () => {
    vi.mocked(exerciseService.createExerciseEntry).mockResolvedValue({
      id: 'entry-1',
    } as never);

    await tools.sparky_manage_exercise.execute!(
      { exercise_name: 'Running', duration_minutes: 45 },
      opts
    );

    expect(exerciseService.createExerciseEntry).toHaveBeenCalled();
    expect(
      workoutRecommendationService.generateRecommendation
    ).not.toHaveBeenCalled();
  });

  it('rejects a target duration the REST route would also reject', async () => {
    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'generate_workout', duration_minutes: 5 },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: duration_minutes: Too small: expected number to be >=15'
    );
    expect(
      workoutRecommendationService.generateRecommendation
    ).not.toHaveBeenCalled();
  });

  // An empty catalog is a state of the user's data, not a fault. DB_ERROR tells
  // the model "do NOT retry", which is exactly the wrong advice here.
  it('surfaces an unbuildable workout as VALIDATION, not DB_ERROR', async () => {
    vi.mocked(
      workoutRecommendationService.generateRecommendation
    ).mockRejectedValue(
      new WorkoutGenerationError(
        'No exercises available to build a workout. Add exercises to your catalog, or relax your gym profile.'
      )
    );

    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'generate_workout' },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: No exercises available to build a workout. Add exercises to your catalog, or relax your gym profile.'
    );
  });

  it('still reports a genuine failure as DB_ERROR', async () => {
    vi.mocked(
      workoutRecommendationService.generateRecommendation
    ).mockRejectedValue(new Error('connection terminated'));

    const result = await tools.sparky_manage_exercise.execute!(
      { action: 'generate_workout' },
      opts
    );

    expect(result).toBe(DB_ERROR_TEXT);
  });
});

describe('action surface', () => {
  // The handler switch, the enum published to the model, and the strict union
  // that validates the call are three separate lists. An action in one and not
  // the others either never reaches the model or is rejected on arrival.
  it('keeps VALID_ACTIONS, the published enum and the strict union in sync', () => {
    const published = manageExerciseInput.shape.action.unwrap().options;
    const union = manageExerciseSchema.options.map(
      (option) => (option.shape.action as { value: string }).value
    );

    expect(VALID_ACTIONS).toEqual(published);
    expect(VALID_ACTIONS).toEqual(union);
  });
});
