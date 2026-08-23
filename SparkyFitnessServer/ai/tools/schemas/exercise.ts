import { z } from 'zod';
import { EXERCISE_MODALITIES } from '@workspace/shared';
import {
  dateSchema,
  optionalEntryTimeSchema,
  setTypeEnum,
  paginationSchema,
  uuidSchema,
} from './common.js';

// workout_presets and workout_plan_templates use integer SERIAL keys, unlike
// the uuid-keyed exercise catalog and diary entries.
const numericIdSchema = z.coerce.number().int().positive();

const exerciseSetSchema = z
  .object({
    reps: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Number of repetitions'),
    weight: z.coerce.number().min(0).optional().describe('Weight in kg'),
    duration: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Duration in seconds'),
    distance: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Distance in km — cardio sets'),
    rest_time: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Rest time in seconds'),
    set_type: setTypeEnum.default('Working Set'),
    rpe: z.coerce
      .number()
      .min(0)
      .max(10)
      .optional()
      .describe('Rate of Perceived Exertion (0-10 scale, one decimal allowed)'),
    notes: z.string().max(1000).optional().describe('Note for this set'),
  })
  .strict();

const searchExercisesSchema = z
  .object({
    action: z.literal('search_exercises'),
    searchTerm: z
      .string()
      .min(1)
      .max(200)
      .describe('Name or part of exercise name'),
    // Both filters match array elements with `::jsonb ?|`, which is exact and
    // case-sensitive against the lowercase free-exercise-db vocabulary stored
    // in the catalog — a title-cased example teaches a filter that matches
    // nothing. Keep these examples lowercase.
    muscleGroup: z
      .string()
      .optional()
      .describe("Muscle group filter, lowercase (e.g., 'chest', 'biceps')"),
    equipment: z
      .string()
      .optional()
      .describe("Equipment filter, lowercase (e.g., 'dumbbell', 'body only')"),
    ...paginationSchema.shape,
  })
  .strict();

const createExerciseSchema = z
  .object({
    action: z.literal('create_exercise'),
    name: z.string().min(1).max(200).describe('Full name for the exercise'),
    category: z
      .string()
      .optional()
      .describe("Category (e.g., 'Strength', 'Cardio')"),
    calories_per_hour: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Estimated calories burned per hour'),
    description: z
      .string()
      .max(1000)
      .optional()
      .describe('Description of the exercise'),
    modality: z
      .enum(EXERCISE_MODALITIES)
      .optional()
      .describe(
        'Which set editor the exercise uses; defaults to a value derived from the category'
      ),
  })
  .strict();

const logExerciseSchema = z
  .object({
    action: z.literal('log_exercise'),
    exercise_id: uuidSchema.optional().describe('UUID of the exercise'),
    exercise_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Name of the exercise (alternative to ID)'),
    entry_date: dateSchema,
    entry_time: optionalEntryTimeSchema,
    duration_minutes: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Duration in minutes'),
    calories_burned: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Calories burned'),
    notes: z.string().max(2000).optional().describe('Additional notes'),
    distance: z.coerce
      .number()
      .min(0)
      .optional()
      .describe(
        "Distance covered, in the user's distance unit (e.g. km) — for cardio"
      ),
    avg_heart_rate: z.coerce
      .number()
      .int()
      .min(0)
      .max(300)
      .optional()
      .describe('Average heart rate in bpm — for cardio'),
    steps: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Step count for the activity'),
    sets: z
      .union([z.array(exerciseSetSchema), z.string()])
      .optional()
      .describe('Set details as array or JSON string'),
  })
  .strict();

const listExerciseDiarySchema = z
  .object({
    action: z.literal('list_exercise_diary'),
    entry_date: dateSchema,
  })
  .strict();

const getWorkoutPresetsSchema = z
  .object({
    action: z.literal('get_workout_presets'),
  })
  .strict();

const logWorkoutPresetSchema = z
  .object({
    action: z.literal('log_workout_preset'),
    preset_id: numericIdSchema
      .optional()
      .describe('Numeric ID of the workout preset'),
    preset_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Name of the preset (alternative to ID)'),
    entry_date: dateSchema,
  })
  .strict();

const updateExerciseEntrySchema = z
  .object({
    action: z.literal('update_exercise_entry'),
    entry_id: uuidSchema.describe('UUID of the exercise entry to update'),
    entry_date: dateSchema
      .optional()
      .describe('New date for the entry (YYYY-MM-DD)'),
    entry_time: optionalEntryTimeSchema,
    duration_minutes: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Duration in minutes'),
    calories_burned: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Calories burned'),
    notes: z.string().max(2000).optional().describe('Additional notes'),
    distance: z.coerce
      .number()
      .min(0)
      .optional()
      .describe(
        "Distance covered, in the user's distance unit (e.g. km) — for cardio"
      ),
    avg_heart_rate: z.coerce
      .number()
      .int()
      .min(0)
      .max(300)
      .optional()
      .describe('Average heart rate in bpm — for cardio'),
    steps: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Step count for the activity'),
    sets: z
      .union([z.array(exerciseSetSchema), z.string()])
      .optional()
      .describe(
        'Replacement set details as array or JSON string; replaces all existing sets when provided'
      ),
  })
  .strict();

const deleteExerciseEntrySchema = z
  .object({
    action: z.literal('delete_exercise_entry'),
    entry_id: uuidSchema.describe('UUID of the exercise entry to delete'),
  })
  .strict();

const getExerciseDetailsSchema = z
  .object({
    action: z.literal('get_exercise_details'),
    exercise_id: uuidSchema.optional().describe('UUID of the exercise'),
    exercise_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Name of the exercise (alternative to ID)'),
  })
  .strict();

// Per-set programming for workout presets. Unlike diary sets
// (exerciseSetSchema) preset sets carry an explicit 1-based set_number and
// have no rpe column (workout_preset_exercise_sets has none).
const presetSetSchema = z
  .object({
    set_number: z.coerce
      .number()
      .int()
      .positive()
      .describe('1-based set number'),
    set_type: setTypeEnum.optional(),
    reps: z.coerce.number().int().min(0).optional(),
    weight: z.coerce.number().min(0).optional().describe('Weight in kg'),
    duration: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Seconds — for duration/cardio sets'),
    distance: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Km — for duration_distance sets'),
    rest_time: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Rest after this set, seconds'),
    notes: z.string().max(500).optional(),
  })
  .strict();

const presetExerciseSchema = z
  .object({
    exercise_id: z
      .string()
      .min(1)
      .optional()
      .describe('Exercise UUID (from search_exercises) or external source id'),
    exercise_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Exercise name — alternative to exercise_id: resolves to an existing exercise or creates a custom one'
      ),
    sort_order: z.coerce.number().int().min(0).optional(),
    superset_group: z.coerce
      .number()
      .int()
      .optional()
      .describe('Same number on 2+ exercises marks them a superset'),
    sets: z.array(presetSetSchema).min(1).optional(),
  })
  .strict();

const createWorkoutPresetSchema = z
  .object({
    action: z.literal('create_workout_preset'),
    name: z.string().min(1).max(200).describe('Name of the workout preset'),
    description: z
      .string()
      .max(1000)
      .optional()
      .describe('Description of the preset'),
    exercise_ids: z
      .array(uuidSchema)
      .optional()
      .describe(
        'List of exercise UUIDs to include in the preset (simple form, no programming)'
      ),
    exercises: z
      .array(presetExerciseSchema)
      .min(1)
      .optional()
      .describe(
        'Fully programmed exercises with per-set reps/weight/duration/rest — preferred over exercise_ids'
      ),
  })
  .strict();

const updateWorkoutPresetSchema = z
  .object({
    action: z.literal('update_workout_preset'),
    preset_id: numericIdSchema
      .optional()
      .describe('Numeric ID of the workout preset'),
    preset_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Name of the preset to update (alternative to ID)'),
    name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('New name for the preset'),
    description: z
      .string()
      .max(1000)
      .optional()
      .describe('New description for the preset'),
    exercises: z
      .array(presetExerciseSchema)
      .min(1)
      .optional()
      .describe(
        'Replacement exercise list with programming; REPLACES all existing exercises/sets, so send the complete desired list'
      ),
  })
  .strict();

// Weekly-plan assignment sets: like preset sets but the
// workout_plan_assignment_sets table has no distance column.
const planAssignmentSetSchema = z
  .object({
    set_number: z.coerce
      .number()
      .int()
      .positive()
      .describe('1-based set number'),
    set_type: setTypeEnum.optional(),
    reps: z.coerce.number().int().min(0).optional(),
    weight: z.coerce.number().min(0).optional().describe('Weight in kg'),
    duration: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Seconds — for duration/cardio sets'),
    rest_time: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Rest after this set, seconds'),
    notes: z.string().max(500).optional(),
  })
  .strict();

const planAssignmentSchema = z
  .object({
    day_of_week: z.coerce
      .number()
      .int()
      .min(0)
      .max(6)
      .describe('Day of week: 0=Sunday … 6=Saturday'),
    workout_preset_id: numericIdSchema
      .optional()
      .describe(
        'Numeric ID of the workout preset to schedule this day (alternative to exercise_id)'
      ),
    exercise_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Single exercise to schedule this day (alternative to workout_preset_id)'
      ),
    sort_order: z.coerce.number().int().min(0).optional(),
    sets: z
      .array(planAssignmentSetSchema)
      .min(1)
      .optional()
      .describe('Per-set programming — only valid with exercise_id'),
  })
  .strict();

const getWorkoutPlansSchema = z
  .object({
    action: z.literal('get_workout_plans'),
  })
  .strict();

const createWorkoutPlanSchema = z
  .object({
    action: z.literal('create_workout_plan'),
    name: z.string().min(1).max(200).describe('Name of the workout plan'),
    description: z
      .string()
      .max(1000)
      .optional()
      .describe('Description of the plan'),
    start_date: dateSchema
      .optional()
      .describe('Plan start date (YYYY-MM-DD); defaults to today'),
    end_date: dateSchema
      .optional()
      .describe('Plan end date (YYYY-MM-DD); open-ended if omitted'),
    is_active: z
      .boolean()
      .optional()
      .describe(
        'Active plans auto-generate workout diary entries from today onward'
      ),
    assignments: z
      .array(planAssignmentSchema)
      .min(1)
      .describe('Weekly schedule: which preset/exercise runs on which day'),
  })
  .strict();

const updateWorkoutPlanSchema = z
  .object({
    action: z.literal('update_workout_plan'),
    plan_id: numericIdSchema
      .optional()
      .describe('Numeric ID of the workout plan'),
    plan_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Name of the plan to update (alternative to ID)'),
    name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('New name for the plan'),
    description: z
      .string()
      .max(1000)
      .optional()
      .describe('New description for the plan'),
    start_date: dateSchema.optional().describe('New start date (YYYY-MM-DD)'),
    end_date: dateSchema.optional().describe('New end date (YYYY-MM-DD)'),
    is_active: z
      .boolean()
      .optional()
      .describe('Activate/deactivate the plan; other fields stay unchanged'),
    assignments: z
      .array(planAssignmentSchema)
      .min(1)
      .optional()
      .describe(
        'Replacement weekly schedule; REPLACES all existing assignments, so send the complete desired week'
      ),
  })
  .strict();

const getExerciseProgressSchema = z
  .object({
    action: z.literal('get_exercise_progress'),
    exercise_id: uuidSchema.optional().describe('UUID of the exercise'),
    exercise_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Name of the exercise (alternative to ID)'),
    start_date: dateSchema
      .optional()
      .describe('Start date for progress tracking'),
    end_date: dateSchema.optional().describe('End date for progress tracking'),
    ...paginationSchema.shape,
  })
  .strict();

const getFrequentSetsSchema = z
  .object({
    action: z.literal('get_frequent_sets'),
    weeks: z.coerce.number().int().min(1).max(12).optional(),
  })
  .strict();

const getMuscleRecoverySchema = z
  .object({
    action: z.literal('get_muscle_recovery'),
  })
  .strict();

// The bounds mirror generateWorkoutRecommendationRequestSchema in
// @workspace/shared — the tool reaches the same service the REST route does,
// so a value this accepts and that rejects would fail deeper and less legibly.
const generateWorkoutSchema = z
  .object({
    action: z.literal('generate_workout'),
    duration_minutes: z.coerce
      .number()
      .int()
      .min(15)
      .max(180)
      .optional()
      .describe(
        "Target session length; defaults to the coach profile's session_minutes, then 60"
      ),
    swap: z
      .boolean()
      .optional()
      .describe(
        'Regenerate preferring exercises other than the ones already suggested'
      ),
  })
  .strict();

export const manageExerciseSchema = z.discriminatedUnion('action', [
  searchExercisesSchema,
  createExerciseSchema,
  logExerciseSchema,
  listExerciseDiarySchema,
  getWorkoutPresetsSchema,
  logWorkoutPresetSchema,
  updateExerciseEntrySchema,
  deleteExerciseEntrySchema,
  getExerciseDetailsSchema,
  createWorkoutPresetSchema,
  updateWorkoutPresetSchema,
  getExerciseProgressSchema,
  getFrequentSetsSchema,
  getWorkoutPlansSchema,
  createWorkoutPlanSchema,
  updateWorkoutPlanSchema,
  getMuscleRecoverySchema,
  generateWorkoutSchema,
]);

export type ManageExerciseInput = z.infer<typeof manageExerciseSchema>;

// Flat input shape published to the LLM as `inputSchema`. See comment on
// manageFoodInput in ./food.js for the rationale. Runtime validation still
// uses manageExerciseSchema in the tool handler via safeParse.
export const manageExerciseInput = z.object({
  action: z
    .enum([
      'search_exercises',
      'create_exercise',
      'log_exercise',
      'list_exercise_diary',
      'get_workout_presets',
      'log_workout_preset',
      'update_exercise_entry',
      'delete_exercise_entry',
      'get_exercise_details',
      'create_workout_preset',
      'update_workout_preset',
      'get_exercise_progress',
      'get_frequent_sets',
      'get_workout_plans',
      'create_workout_plan',
      'update_workout_plan',
      'get_muscle_recovery',
      'generate_workout',
    ])
    .optional()
    .describe(
      'Optional action to perform (server infers if omitted); see tool description for per-action fields.'
    ),
  weeks: z.coerce
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe('History window in weeks for get_frequent_sets (default 4)'),
  // identity
  exercise_id: uuidSchema
    .optional()
    .describe(
      'Exercise UUID. REQUIRED for "log_exercise" if exercise_name is not provided.'
    ),
  exercise_name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Exercise name (e.g. "Walking", "Running", "Squats"). REQUIRED for "log_exercise" if exercise_id is not provided.'
    ),
  exercise_ids: z
    .array(uuidSchema)
    .optional()
    .describe(
      'List of exercise UUIDs — for create_workout_preset (simple form)'
    ),
  exercises: z
    .array(
      z.object({
        exercise_id: z.string().min(1).optional(),
        exercise_name: z.string().min(1).max(200).optional(),
        sort_order: z.coerce.number().int().min(0).optional(),
        superset_group: z.coerce.number().int().optional(),
        sets: z
          .array(
            z.object({
              set_number: z.coerce.number().int().positive(),
              set_type: setTypeEnum.optional(),
              reps: z.coerce.number().int().min(0).optional(),
              weight: z.coerce.number().min(0).optional(),
              duration: z.coerce.number().int().min(0).optional(),
              distance: z.coerce.number().min(0).optional(),
              rest_time: z.coerce.number().int().min(0).optional(),
              notes: z.string().max(500).optional(),
            })
          )
          .min(1)
          .optional(),
      })
    )
    .min(1)
    .optional()
    .describe(
      'Fully programmed exercises for create_workout_preset / update_workout_preset: [{exercise_id OR exercise_name (names resolve to existing exercises, unknown names become custom exercises), sort_order?, superset_group?, sets?:[{set_number, set_type?, reps?, weight?(kg), duration?(seconds), distance?(km), rest_time?(seconds), notes?}]}]. On update this REPLACES the whole list.'
    ),
  name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Name — for create_exercise / create_workout_preset / update_workout_preset (new name)'
    ),
  // search
  searchTerm: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Search term — required for search_exercises'),
  // Lowercase for the same reason as the search schema above: `::jsonb ?|` is
  // an exact, case-sensitive match on the stored free-exercise-db strings.
  muscleGroup: z
    .string()
    .optional()
    .describe("Muscle group filter, lowercase (e.g., 'chest')"),
  equipment: z
    .string()
    .optional()
    .describe("Equipment filter, lowercase (e.g., 'dumbbell', 'body only')"),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Pagination limit'),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Pagination offset'),
  // create
  category: z
    .string()
    .optional()
    .describe("Exercise category (e.g., 'Strength', 'Cardio')"),
  calories_per_hour: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('Estimated calories burned per hour'),
  description: z
    .string()
    .max(1000)
    .optional()
    .describe(
      'Description — for create_exercise / create_workout_preset / update_workout_preset'
    ),
  modality: z
    .enum(EXERCISE_MODALITIES)
    .optional()
    .describe(
      'Which set editor the exercise uses; defaults to a value derived from the category'
    ),
  // log
  entry_date: dateSchema.optional().describe('Date for the entry (YYYY-MM-DD)'),
  entry_time: optionalEntryTimeSchema,
  duration_minutes: z.coerce
    .number()
    .min(0)
    .optional()
    .describe(
      'Duration in minutes — the logged length for log/update, the target session length for generate_workout'
    ),
  calories_burned: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('Calories burned'),
  notes: z.string().max(2000).optional().describe('Additional notes'),
  distance: z.coerce
    .number()
    .min(0)
    .optional()
    .describe(
      "Distance covered, in the user's distance unit (e.g. km) — cardio, for log/update"
    ),
  avg_heart_rate: z.coerce
    .number()
    .int()
    .min(0)
    .max(300)
    .optional()
    .describe('Average heart rate in bpm — cardio, for log/update'),
  steps: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Step count for the activity — for log/update'),
  sets: z
    .union([
      z.array(
        z.object({
          reps: z.coerce.number().int().min(0).optional(),
          weight: z.coerce.number().min(0).optional(),
          duration: z.coerce.number().int().min(0).optional(),
          distance: z.coerce.number().min(0).optional(),
          rest_time: z.coerce.number().min(0).optional(),
          set_type: setTypeEnum.optional(),
          rpe: z.coerce.number().min(0).max(10).optional(),
          notes: z.string().max(1000).optional(),
        })
      ),
      z.string(),
    ])
    .optional()
    .describe(
      'Set details as array of objects or JSON string; per-set fields include rpe and notes'
    ),
  // presets
  preset_id: numericIdSchema
    .optional()
    .describe(
      'Workout preset numeric ID — for log_workout_preset / update_workout_preset'
    ),
  preset_name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Workout preset name — for log_workout_preset / update_workout_preset (alternative to preset_id)'
    ),
  // entry management
  entry_id: uuidSchema
    .optional()
    .describe(
      'Exercise diary entry UUID — for update_exercise_entry / delete_exercise_entry'
    ),
  // progress range / workout plan dates
  start_date: dateSchema
    .optional()
    .describe(
      'Start date — for get_exercise_progress / create_workout_plan / update_workout_plan'
    ),
  end_date: dateSchema
    .optional()
    .describe(
      'End date — for get_exercise_progress / create_workout_plan / update_workout_plan'
    ),
  // workout plans
  plan_id: numericIdSchema
    .optional()
    .describe('Workout plan numeric ID — for update_workout_plan'),
  plan_name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Workout plan name — for update_workout_plan (alternative to plan_id)'
    ),
  is_active: z
    .boolean()
    .optional()
    .describe(
      'Whether the workout plan is active — active plans auto-generate workout diary entries'
    ),
  assignments: z
    .array(
      z.object({
        day_of_week: z.coerce.number().int().min(0).max(6),
        workout_preset_id: numericIdSchema.optional(),
        exercise_id: z.string().min(1).optional(),
        sort_order: z.coerce.number().int().min(0).optional(),
        sets: z
          .array(
            z.object({
              set_number: z.coerce.number().int().positive(),
              set_type: setTypeEnum.optional(),
              reps: z.coerce.number().int().min(0).optional(),
              weight: z.coerce.number().min(0).optional(),
              duration: z.coerce.number().int().min(0).optional(),
              rest_time: z.coerce.number().int().min(0).optional(),
              notes: z.string().max(500).optional(),
            })
          )
          .min(1)
          .optional(),
      })
    )
    .min(1)
    .optional()
    .describe(
      'Weekly schedule for create_workout_plan / update_workout_plan: [{day_of_week 0-6 (0=Sunday), workout_preset_id? OR exercise_id? (exactly one), sort_order?, sets?}] — sets only with exercise_id. On update this REPLACES the whole schedule.'
    ),
  // workout generation — duration_minutes above doubles as the target length
  swap: z
    .boolean()
    .optional()
    .describe(
      'For generate_workout: prefer exercises other than the ones already suggested'
    ),
});
