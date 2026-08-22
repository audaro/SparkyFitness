import { tool } from 'ai';
import { z } from 'zod';
import { addDays, todayInZone } from '@workspace/shared';
import { log } from '../../config/logging.js';
import exerciseService from '../../services/exerciseService.js';
import workoutPresetService from '../../services/workoutPresetService.js';
import workoutPlanTemplateService from '../../services/workoutPlanTemplateService.js';
import workoutPlanTemplateRepository from '../../models/workoutPlanTemplateRepository.js';
import exerciseDb from '../../models/exercise.js';
import exerciseEntryDb from '../../models/exerciseEntry.js';
import workoutPresetRepository from '../../models/workoutPresetRepository.js';
import { ERRORS, formatZodError } from './errors.js';
import {
  compactRecord,
  DAY_NAMES,
  dayString,
  formatConfirmation,
  formatJsonResult,
  formatList,
} from './formatting.js';
import { getResolvedExerciseCaloriesRange } from '../../services/exerciseCalorieRangeService.js';
import {
  normalizePagination,
  buildPaginatedResult,
  type PaginatedResult,
} from './pagination.js';
import {
  manageExerciseSchema,
  manageExerciseInput,
  type ManageExerciseInput,
} from './schemas/exercise.js';
import { optionalDateSchema } from './schemas/common.js';
import { normalizeActionArgs, normalizeDayKeywords } from './dates.js';

const VALID_ACTIONS = [
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
];

// Optional inputs and nullable DB columns are treated alike: absent.
function isSet<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

// Text columns may hold JSON arrays, comma-separated values, or plain strings.
function safeParseJson(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      /* not JSON */
    }
    if (value.includes(',')) {
      return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return value ? [value] : [];
  }
  return [];
}

interface ExerciseSetInput {
  reps?: number;
  weight?: number;
  duration?: number;
  distance?: number;
  rest_time?: number;
  set_type?: string;
  rpe?: number;
  notes?: string;
}

interface PresetSetInput {
  set_number: number;
  set_type?: string;
  reps?: number;
  weight?: number;
  duration?: number;
  distance?: number;
  rest_time?: number;
  notes?: string;
}

interface PresetExerciseInput {
  exercise_id: string;
  sort_order?: number;
  superset_group?: number;
  sets?: PresetSetInput[];
}

// The exercise rows the workout-preset service expects: sort_order defaults
// to list position, and absent set fields become explicit nulls (preset sets
// have no rpe column, unlike diary sets).
function toPresetExercises(exercises: PresetExerciseInput[]) {
  return exercises.map((ex, i) => ({
    exercise_id: ex.exercise_id,
    sort_order: ex.sort_order ?? i,
    superset_group: ex.superset_group ?? null,
    sets: ex.sets?.map((s) => ({
      set_number: s.set_number,
      set_type: s.set_type || 'Working Set',
      reps: s.reps ?? null,
      weight: s.weight ?? null,
      duration: s.duration ?? null,
      distance: s.distance ?? null,
      rest_time: s.rest_time ?? null,
      notes: s.notes ?? null,
    })),
  }));
}

interface PlanAssignmentSetInput {
  set_number: number;
  set_type?: string;
  reps?: number;
  weight?: number;
  duration?: number;
  rest_time?: number;
  notes?: string;
}

interface PlanAssignmentInput {
  day_of_week: number;
  workout_preset_id?: number;
  exercise_id?: string;
  sort_order?: number;
  sets?: PlanAssignmentSetInput[];
}

// The workout-plan REST routes carry no Zod validation, so the tool enforces
// the assignment invariants itself: exactly one of preset/exercise per slot,
// and per-set programming only where an exercise is scheduled directly.
function validatePlanAssignments(
  assignments: PlanAssignmentInput[]
): string | null {
  for (const a of assignments) {
    const hasPreset = Boolean(a.workout_preset_id);
    const hasExercise = Boolean(a.exercise_id);
    if (hasPreset === hasExercise) {
      return 'Each assignment needs exactly one of workout_preset_id or exercise_id';
    }
    if (a.sets?.length && !hasExercise) {
      return 'Assignment sets are only valid with exercise_id';
    }
  }
  return null;
}

// The assignment rows the workout-plan-template service expects: sort_order
// defaults to list position, and absent set fields become explicit nulls
// (assignment sets have no distance or rpe column).
function toPlanAssignments(assignments: PlanAssignmentInput[]) {
  return assignments.map((a, i) => ({
    day_of_week: a.day_of_week,
    workout_preset_id: a.workout_preset_id ?? null,
    exercise_id: a.exercise_id ?? null,
    sort_order: a.sort_order ?? i,
    sets: a.sets?.map((s) => ({
      set_number: s.set_number,
      set_type: s.set_type || 'Working Set',
      reps: s.reps ?? null,
      weight: s.weight ?? null,
      duration: s.duration ?? null,
      rest_time: s.rest_time ?? null,
      notes: s.notes ?? null,
    })),
  }));
}

// The joined rows the workout-plan repository returns (template + assignment
// + set aggregation). Surrogate row ids are typed so the projection can drop
// them: the tool's replace-style updates must not echo them back.
interface WorkoutPlanSetRow {
  id?: number;
  set_number: number;
  set_type: string | null;
  reps: number | null;
  weight: number | null;
  duration: number | null;
  rest_time: number | null;
  notes: string | null;
}

interface WorkoutPlanAssignmentRow {
  id?: number;
  day_of_week: number;
  sort_order: number;
  workout_preset_id: number | null;
  workout_preset_name: string | null;
  exercise_id: string | null;
  exercise_name: string | null;
  sets?: WorkoutPlanSetRow[] | null;
}

interface WorkoutPlanRow {
  id: number;
  plan_name: string;
  description: string | null;
  start_date: unknown;
  end_date: unknown | null;
  is_active: boolean;
  assignments?: WorkoutPlanAssignmentRow[] | null;
}

// Full structured projection: update_workout_plan REPLACES the whole
// schedule, so the model must be able to read back every id, sort_order, and
// per-set number it needs to faithfully rebuild the current week.
function projectWorkoutPlan(p: WorkoutPlanRow) {
  return {
    id: p.id,
    plan_name: p.plan_name,
    description: p.description ?? null,
    is_active: p.is_active,
    start_date: dayString(p.start_date),
    end_date: p.end_date ? dayString(p.end_date) : null,
    assignments: (p.assignments ?? []).map((a) => ({
      day_of_week: a.day_of_week,
      day: DAY_NAMES[a.day_of_week],
      sort_order: a.sort_order,
      workout_preset_id: a.workout_preset_id,
      workout_preset_name: a.workout_preset_name,
      exercise_id: a.exercise_id,
      exercise_name: a.exercise_name,
      sets: (a.sets ?? []).map((s) => ({
        set_number: s.set_number,
        set_type: s.set_type,
        reps: s.reps,
        weight: s.weight,
        duration: s.duration,
        rest_time: s.rest_time,
        notes: s.notes,
      })),
    })),
  };
}

// The set rows the exercise-entry repository expects: 1-based set_number plus
// explicit nulls for absent fields (mirrors MCP's per-set INSERT defaults).
function toRepoSets(sets: ExerciseSetInput[]) {
  return sets.map((s, i) => ({
    set_number: i + 1,
    set_type: s.set_type || 'Working Set',
    reps: s.reps ?? null,
    weight: s.weight ?? null,
    // Sets may arrive as a JSON string that bypasses schema validation, so
    // round here to keep the integer-seconds duration column safe.
    duration: typeof s.duration === 'number' ? Math.round(s.duration) : null,
    distance: s.distance ?? null,
    rest_time: s.rest_time ?? null,
    rpe: s.rpe ?? null,
    notes: s.notes ?? null,
  }));
}

// MCP's date-range defaults: a single `date` overrides start/end; otherwise
// the range defaults to today (user timezone) / the start date.
function exerciseDateRange(
  query: {
    date?: string;
    start_date?: string;
    end_date?: string;
  },
  tz: string
): { startDate: string; endDate: string } {
  const today = todayInZone(tz);
  const date = query.date || undefined;
  const startDate = date || query.start_date || today;
  const endDate = date || query.end_date || startDate;
  return { startDate, endDate };
}

// Renders a row's bare-DATE entry_date as a calendar-day string for JSON
// output. entry_date is nullable; NULL stays JSON null, not the string "null".
function projectEntryDate<T extends { entry_date?: unknown }>(row: T) {
  if (!isSet(row.entry_date)) return row;
  return { ...row, entry_date: dayString(row.entry_date) };
}

// exercise_entries dumps (`SELECT ee.*`/`SELECT *`, used by the diary, recent,
// and usage tools) carry audit/ownership columns and internal surrogate keys.
// `id` (edit/delete) and `exercise_id` (lookups / re-logging) are kept, as are
// populated metrics and the denormalized catalog fields.
const EXERCISE_ENTRY_DROP: readonly string[] = [
  'user_id',
  'created_at',
  'updated_at',
  'created_by_user_id',
  'updated_by_user_id',
  'workout_plan_assignment_id',
  'exercise_preset_entry_id',
  'sort_order',
];
// exercise_entry_sets dumps (`SELECT *`): audit timestamps and per-set
// completion timestamps are token noise for the chatbot.
// `exercise_entry_id` is kept so the model can map sets back to their entry.
const EXERCISE_SET_DROP: readonly string[] = [
  'created_at',
  'updated_at',
  'completed_at',
];
// exercises catalog rows (sparky_list_exercises) — drop the redundant caller id
// and audit columns; keep descriptive catalog fields.
const EXERCISE_CATALOG_DROP: readonly string[] = [
  'user_id',
  'created_at',
  'updated_at',
  'created_by_user_id',
  'updated_by_user_id',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function projectExerciseEntry(row: any) {
  return compactRecord(projectEntryDate(row), EXERCISE_ENTRY_DROP);
}

// The column set MCP's exercise search exposed; richer server rows are
// projected down to it so the chat-visible output stays identical.
function projectExercise(row: any) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    muscle_groups: row.primary_muscles,
    equipment: row.equipment,
    level: row.level,
    calories_per_hour: row.calories_per_hour,
    description: row.description,
    is_custom: row.is_custom,
  };
}

// Case-insensitive exact name lookup (MCP's `name ILIKE $1` without
// wildcards). The server search returns substring matches; the exact match,
// when present, is always among them.
async function findExerciseByExactName(userId: string, name: string) {
  const rows = await exerciseService.searchExercises(
    userId,
    name,
    userId,
    undefined,
    undefined
  );
  return rows.find(
    (e: any) => String(e.name).toLowerCase() === name.toLowerCase()
  );
}

// Full details for one exercise by id or name, projected to MCP's shape.
// Throws "not found" errors for the callers' catch blocks to map.
async function getExerciseDetails(
  userId: string,
  params: { exercise_id?: string; exercise_name?: string }
) {
  let row: any;
  if (params.exercise_id) {
    row = await exerciseService.getExerciseById(userId, params.exercise_id);
  } else if (params.exercise_name) {
    row = await findExerciseByExactName(userId, params.exercise_name);
  } else {
    throw new Error('Either exercise_id or exercise_name must be provided');
  }
  if (!row) {
    throw new Error('Exercise not found');
  }
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    muscle_groups: safeParseJson(row.primary_muscles),
    equipment: safeParseJson(row.equipment),
    level: row.level,
    calories_per_hour: row.calories_per_hour,
    description: row.description,
    is_custom: row.is_custom,
    instructions: safeParseJson(row.instructions),
    images: safeParseJson(row.images),
  };
}

interface ProgressDay {
  entry_date: string;
  max_weight: number | null;
  max_reps: number | null;
  total_volume: number | null;
}

// Per-date set aggregates for one exercise, paginated over the grouped days.
// Mirrors MCP's GROUP BY query: days whose entries have no sets are excluded,
// MAX/SUM skip null reps/weights, and volume counts null weights as 0.
async function getExerciseProgress(
  userId: string,
  params: {
    exercise_id?: string;
    exercise_name?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
  }
): Promise<PaginatedResult<ProgressDay>> {
  let exerciseId = params.exercise_id;
  if (!exerciseId && params.exercise_name) {
    const exercise = await findExerciseByExactName(
      userId,
      params.exercise_name
    );
    exerciseId = exercise?.id;
  }
  if (!exerciseId) throw new Error('Exercise not found');

  const entries = await exerciseService.getExerciseProgressData(
    userId,
    exerciseId,
    params.start_date || '1970-01-01',
    params.end_date || '9999-12-31'
  );

  // Repository rows arrive in entry_date ASC order; the Map keeps it.
  const byDate = new Map<string, ProgressDay>();
  for (const entry of entries) {
    const sets: ExerciseSetInput[] = entry.sets ?? [];
    if (sets.length === 0) continue;
    const key = dayString(entry.entry_date);
    let day = byDate.get(key);
    if (!day) {
      day = {
        entry_date: key,
        max_weight: null,
        max_reps: null,
        total_volume: null,
      };
      byDate.set(key, day);
    }
    for (const s of sets) {
      if (isSet(s.weight)) {
        const weight = Number(s.weight);
        day.max_weight = isSet(day.max_weight)
          ? Math.max(day.max_weight, weight)
          : weight;
      }
      if (isSet(s.reps)) {
        day.max_reps = isSet(day.max_reps)
          ? Math.max(day.max_reps, s.reps)
          : s.reps;
        day.total_volume =
          (day.total_volume ?? 0) +
          s.reps * (isSet(s.weight) ? Number(s.weight) : 0);
      }
    }
  }

  const days = [...byDate.values()];
  const { limit, offset } = normalizePagination(params.limit, params.offset);
  return buildPaginatedResult(
    days.slice(offset, offset + limit),
    days.length,
    offset
  );
}

// Standalone domain tools.
const exerciseDateRangeSchema = z.object({
  date: optionalDateSchema,
  start_date: optionalDateSchema,
  end_date: optionalDateSchema,
});

const exercisePaginationSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

const listExercisesSchema = exercisePaginationSchema.extend({
  search: z.string().optional(),
});

const getExerciseDetailsSchema = z.object({
  exercise_id: z.string().optional(),
  exercise_name: z.string().optional(),
});

const searchExercisesSchema = exercisePaginationSchema.extend({
  query: z.string().min(1),
  muscle_group: z.string().optional(),
  equipment: z.string().optional(),
});

const recentExerciseEntriesSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
});

const exerciseUsageSchema = exerciseDateRangeSchema
  .merge(exercisePaginationSchema)
  .extend({
    exercise_id: z.string().min(1),
  });

const exerciseProgressSchema = exerciseDateRangeSchema
  .merge(exercisePaginationSchema)
  .extend({
    exercise_id: z.string().optional(),
    exercise_name: z.string().optional(),
  });

export function buildExerciseTools(userId: string, tz: string) {
  return {
    sparky_manage_exercise: tool({
      description: `Fitness tracking: search exercises, log workouts with sets, manage presets.

Actions:
- search_exercises(searchTerm, muscleGroup?, equipment?, limit?, offset?)
- create_exercise(name, category?, calories_per_hour?, description?, modality?:weight_reps|reps_only|duration|duration_distance)
- log_exercise(entry_date, exercise_id?|exercise_name?, duration_minutes?, calories_burned?, notes?, distance?, avg_heart_rate?, steps?, sets?:JSON string or array of [{reps,weight,duration,distance,rest_time,set_type,rpe,notes}]) — distance/avg_heart_rate/steps are for cardio
- list_exercise_diary(entry_date)
- get_workout_presets()
- log_workout_preset(entry_date, preset_id?|preset_name?)
- update_exercise_entry(entry_id, entry_date?, duration_minutes?, calories_burned?, notes?, distance?, avg_heart_rate?, steps?, sets?) — only the provided fields change; sets, when provided, replace all existing sets
- delete_exercise_entry(entry_id)
- get_exercise_details(exercise_id?|exercise_name?)
- create_workout_preset(name, description?, exercise_ids? OR exercises?) — exercises is the programmed form: [{exercise_id, sort_order?, superset_group?, sets?:[{set_number, set_type?, reps?, weight?(kg), duration?(seconds), distance?(km), rest_time?(seconds), notes?}]}]; use search_exercises first to get real exercise ids
- update_workout_preset(preset_id?|preset_name?, name?, description?, exercises?) — exercises REPLACES the entire list, so send the complete desired routine
- get_exercise_progress(exercise_id?|exercise_name?, start_date?, end_date?, limit?, offset?) — returns paginated performance history
- get_frequent_sets(weeks?(default 4)) — the user's usual routine mined from history: per weekday, exercises trained 2+ times with their typical sets/reps/weight; use it to build "a routine from what I usually do"
- get_workout_plans() — lists the user's weekly workout plans with their day schedules
- create_workout_plan(name, description?, start_date?(default today), end_date?, is_active?, assignments:[{day_of_week 0-6 (0=Sunday), workout_preset_id? OR exercise_id? (exactly one), sort_order?, sets?:[{set_number, set_type?, reps?, weight?(kg), duration?(seconds), rest_time?(seconds), notes?}]}]) — sets only with exercise_id; active plans auto-generate workout diary entries from today; get preset ids from get_workout_presets
- update_workout_plan(plan_id?|plan_name?, name?, description?, start_date?, end_date?, is_active?, assignments?) — only provided fields change, but assignments REPLACES the entire weekly schedule, so send the complete desired week`,
      inputSchema: manageExerciseInput,
      execute: async (rawArgs) => {
        const normalized = normalizeActionArgs(
          rawArgs,
          tz,
          VALID_ACTIONS,
          (args) => {
            if (args.searchTerm) {
              return 'search_exercises';
            }
            if (args.weeks !== undefined) {
              return 'get_frequent_sets';
            }
            if (args.sets || args.duration_minutes || args.calories_burned) {
              return 'log_exercise';
            }
            if (args.preset_id || args.preset_name) {
              return 'log_workout_preset';
            }
            if (args.entry_id) {
              return 'update_exercise_entry';
            }
            if (args.start_date || args.end_date) {
              return 'get_exercise_progress';
            }
            if (args.entry_date) {
              return 'list_exercise_diary';
            }
            return 'list_exercise_diary'; // fallback
          }
        ) as any;

        // Default missing entry_date to today's date string for logging actions
        const loggingActions = ['log_exercise', 'log_workout_preset'];
        if (
          normalized.entry_date === undefined &&
          loggingActions.includes(normalized.action)
        ) {
          normalized.entry_date = todayInZone(tz);
        }

        const parsed = manageExerciseSchema.safeParse(normalized);
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        const args: ManageExerciseInput = parsed.data;
        try {
          switch (args.action) {
            case 'search_exercises': {
              const { limit, offset } = normalizePagination(
                args.limit,
                args.offset
              );
              const { exercises, totalCount } =
                await exerciseService.searchExercisesPaginated(
                  userId,
                  args.searchTerm,
                  userId,
                  args.equipment ? [args.equipment] : undefined,
                  args.muscleGroup ? [args.muscleGroup] : undefined,
                  limit,
                  offset
                );
              const result = buildPaginatedResult(
                exercises.map(projectExercise),
                totalCount,
                offset
              );
              return formatList(
                result.data,
                `Exercise Search: "${args.searchTerm}"`,
                (e: any) =>
                  `**${e.name}** (${e.category || 'Uncategorized'})\n  Muscles: ${e.muscle_groups?.join(', ') || 'N/A'} | Equipment: ${e.equipment?.join(', ') || 'None'}\n  ID: ${e.id}`,
                {
                  total_count: result.total_count,
                  has_more: result.has_more,
                  next_offset: result.next_offset,
                }
              );
            }

            case 'create_exercise': {
              // MCP returned the existing exercise (same confirmation text)
              // when one already matched the name case-insensitively.
              const existing = await findExerciseByExactName(userId, args.name);
              const exercise =
                existing ??
                (await exerciseService.createExercise(userId, {
                  name: args.name,
                  category: args.category || 'custom',
                  calories_per_hour: args.calories_per_hour || 300,
                  description: args.description || null,
                  modality: args.modality,
                  is_custom: true,
                  shared_with_public: false,
                  source: 'manual',
                }));
              return formatConfirmation(`Exercise "${exercise.name}" created.`);
            }

            case 'log_exercise': {
              if (!args.exercise_id && !args.exercise_name) {
                args.exercise_name = 'General Exercise';
              }
              // Parse sets if it arrives as a JSON string (LLM serialisation quirk)
              let parsedSets: ExerciseSetInput[] | undefined;
              if (typeof args.sets === 'string') {
                try {
                  parsedSets = JSON.parse(args.sets);
                } catch {
                  parsedSets = undefined;
                }
              } else {
                parsedSets = args.sets;
              }
              let exerciseId = args.exercise_id;
              if (!exerciseId && args.exercise_name) {
                // Exact match first, then fuzzy, then auto-create — MCP's
                // resolution order.
                const rows = await exerciseService.searchExercises(
                  userId,
                  args.exercise_name,
                  userId,
                  undefined,
                  undefined
                );
                const name = args.exercise_name.toLowerCase();
                const found =
                  rows.find(
                    (e: any) => String(e.name).toLowerCase() === name
                  ) ?? rows[0];
                if (found) {
                  exerciseId = found.id;
                } else {
                  const created = await exerciseService.createExercise(userId, {
                    name: args.exercise_name,
                    category: 'custom',
                    calories_per_hour: 300,
                    is_custom: true,
                    shared_with_public: false,
                    source: 'manual',
                  });
                  exerciseId = created.id;
                }
              }
              // skipDuplicateCheck: logging the same exercise twice in a day
              // must create two entries (MCP always inserted), not merge into
              // the server's manual same-exercise/same-date upsert.
              await exerciseService.createExerciseEntry(
                userId,
                userId,
                {
                  exercise_id: exerciseId,
                  entry_date: args.entry_date,
                  entry_time: args.entry_time,
                  duration_minutes: args.duration_minutes,
                  calories_burned: args.calories_burned,
                  notes: args.notes,
                  distance: args.distance,
                  avg_heart_rate: args.avg_heart_rate,
                  steps: args.steps,
                  sets: parsedSets ? toRepoSets(parsedSets) : undefined,
                },
                { skipDuplicateCheck: true }
              );
              return formatConfirmation(
                `Exercise logged for ${args.entry_date}.`
              );
            }

            case 'list_exercise_diary': {
              const grouped = await exerciseService.getExerciseEntriesByDate(
                userId,
                userId,
                args.entry_date
              );
              // Flatten preset sessions into their member entries and render
              // the flat per-entry list MCP produced (created_at ASC).
              const entries = grouped
                .flatMap((item: any) =>
                  item.type === 'preset' ? item.exercises : [item]
                )
                .sort(
                  (a: any, b: any) =>
                    new Date(a.created_at).getTime() -
                    new Date(b.created_at).getTime()
                );
              return formatList(
                entries,
                `Exercise Diary: ${args.entry_date}`,
                (e: any) => {
                  let text = `**${e.name}**`;
                  const sets: ExerciseSetInput[] = e.sets ?? [];
                  if (sets.length > 0) text += ` — ${sets.length} sets`;
                  if (e.duration_minutes)
                    text += ` | ${e.duration_minutes} min`;
                  if (e.calories_burned) text += ` | ${e.calories_burned} kcal`;
                  if (isSet(e.distance)) text += ` | ${e.distance} dist`;
                  if (isSet(e.avg_heart_rate))
                    text += ` | ${e.avg_heart_rate} bpm`;
                  if (isSet(e.steps)) text += ` | ${e.steps} steps`;
                  if (sets.length > 0) {
                    const setLine = sets
                      .map((s) => {
                        const parts: string[] = [];
                        if (isSet(s.reps)) parts.push(`${s.reps}r`);
                        if (isSet(s.weight)) parts.push(`${s.weight}kg`);
                        if (isSet(s.duration)) parts.push(`${s.duration}s`);
                        if (isSet(s.distance)) parts.push(`${s.distance}km`);
                        if (isSet(s.rpe)) parts.push(`RPE ${s.rpe}`);
                        let str = parts.join('×');
                        if (isSet(s.rest_time))
                          str += ` (rest ${s.rest_time}s)`;
                        if (s.notes) str += ` (${s.notes})`;
                        return str;
                      })
                      .filter(Boolean)
                      .join('; ');
                    if (setLine) text += `\n  Sets: ${setLine}`;
                  }
                  if (e.notes) text += `\n  Notes: ${e.notes}`;
                  text += `\n  ID: ${e.id}`;
                  return text;
                }
              );
            }

            case 'get_workout_presets': {
              const { presets } = await workoutPresetService.getWorkoutPresets(
                userId,
                1,
                1000
              );
              return formatList(
                presets,
                'Workout Presets',
                (p: any) =>
                  `**${p.name}** — ${p.exercises.length} exercises\n  ID: ${p.id}`
              );
            }

            case 'log_workout_preset': {
              if (!args.preset_id && !args.preset_name) {
                return ERRORS.VALIDATION(
                  'Either preset_id or preset_name must be provided'
                );
              }
              let presetId = args.preset_id;
              if (!presetId && args.preset_name) {
                const preset =
                  await workoutPresetRepository.getWorkoutPresetByName(
                    userId,
                    args.preset_name
                  );
                if (!preset) {
                  return ERRORS.NOT_FOUND('Resource', 'unknown');
                }
                presetId = preset.id;
              }
              const session = await exerciseService.logWorkoutPresetGrouped(
                userId,
                userId,
                presetId,
                args.entry_date
              );
              return formatConfirmation(
                `Workout preset logged for ${args.entry_date}. ${session?.exercises.length ?? 0} exercises added.`
              );
            }

            case 'update_exercise_entry': {
              // Parse sets if it arrives as a JSON string, matching log_exercise.
              let parsedSets: ExerciseSetInput[] | undefined;
              if (typeof args.sets === 'string') {
                try {
                  parsedSets = JSON.parse(args.sets);
                } catch {
                  return ERRORS.VALIDATION('Invalid JSON format for sets');
                }
              } else {
                parsedSets = args.sets;
              }
              try {
                await exerciseService.updateExerciseEntry(
                  userId,
                  userId,
                  args.entry_id,
                  {
                    entry_date: args.entry_date,
                    entry_time: args.entry_time,
                    duration_minutes: args.duration_minutes,
                    calories_burned: args.calories_burned,
                    notes: args.notes,
                    distance: args.distance,
                    avg_heart_rate: args.avg_heart_rate,
                    steps: args.steps,
                    sets: parsedSets ? toRepoSets(parsedSets) : undefined,
                  }
                );
              } catch (error) {
                if (
                  error instanceof Error &&
                  error.message.includes('not found')
                ) {
                  return ERRORS.NOT_FOUND('Exercise Entry', args.entry_id);
                }
                throw error;
              }
              return formatConfirmation('Exercise entry updated.');
            }

            case 'delete_exercise_entry': {
              try {
                await exerciseService.deleteExerciseEntry(
                  userId,
                  args.entry_id
                );
              } catch (error) {
                if (
                  error instanceof Error &&
                  error.message.includes('not found')
                ) {
                  return ERRORS.NOT_FOUND('Exercise Entry', args.entry_id);
                }
                throw error;
              }
              return formatConfirmation('Exercise entry deleted.');
            }

            case 'get_exercise_details': {
              const exercise = await getExerciseDetails(userId, {
                exercise_id: args.exercise_id,
                exercise_name: args.exercise_name,
              });
              let text = `### ${exercise.name}\n\n`;
              if (exercise.description) text += `*${exercise.description}*\n\n`;
              text += `**Category:** ${exercise.category}\n`;
              text += `**Equipment:** ${exercise.equipment?.join(', ') || 'None'}\n`;
              text += `**Muscles:** ${exercise.muscle_groups?.join(', ') || 'N/A'}\n\n`;

              if (exercise.instructions && exercise.instructions.length > 0) {
                text += '#### Instructions\n';
                exercise.instructions.forEach((ins, i) => {
                  text += `${i + 1}. ${ins}\n`;
                });
              }

              return text;
            }

            case 'create_workout_preset': {
              if (!args.exercises?.length && !args.exercise_ids?.length) {
                return ERRORS.VALIDATION(
                  'Either exercises or exercise_ids must be provided'
                );
              }
              if (args.exercises?.length) {
                const preset = await workoutPresetService.createWorkoutPreset(
                  userId,
                  {
                    user_id: userId,
                    name: args.name,
                    description: args.description ?? null,
                    is_public: false,
                    exercises: toPresetExercises(args.exercises),
                  }
                );
                const setCount = args.exercises.reduce(
                  (sum, ex) => sum + (ex.sets?.length ?? 0),
                  0
                );
                return formatConfirmation(
                  `Workout preset "${preset.name}" created: ${preset.exercises.length} exercises, ${setCount} sets.`
                );
              }
              const preset = await workoutPresetService.createWorkoutPreset(
                userId,
                {
                  user_id: userId,
                  name: args.name,
                  description: args.description ?? null,
                  is_public: false,
                  exercises: (args.exercise_ids as string[]).map(
                    (exerciseId, i) => ({
                      exercise_id: exerciseId,
                      sort_order: i,
                    })
                  ),
                }
              );
              return formatConfirmation(
                `Workout preset "${preset.name}" created with ${preset.exercises.length} exercises.`
              );
            }

            case 'update_workout_preset': {
              if (!args.preset_id && !args.preset_name) {
                return ERRORS.VALIDATION(
                  'Either preset_id or preset_name must be provided'
                );
              }
              if (
                args.name === undefined &&
                args.description === undefined &&
                !args.exercises?.length
              ) {
                return ERRORS.VALIDATION(
                  'Nothing to update — provide name, description, or exercises'
                );
              }
              let presetId = args.preset_id;
              if (!presetId && args.preset_name) {
                const preset =
                  await workoutPresetRepository.getWorkoutPresetByName(
                    userId,
                    args.preset_name
                  );
                if (!preset) {
                  return ERRORS.NOT_FOUND('Workout Preset', args.preset_name);
                }
                presetId = preset.id;
              }
              const updated = await workoutPresetService.updateWorkoutPreset(
                userId,
                presetId,
                {
                  ...(args.name !== undefined && { name: args.name }),
                  ...(args.description !== undefined && {
                    description: args.description,
                  }),
                  ...(args.exercises?.length && {
                    exercises: toPresetExercises(args.exercises),
                  }),
                }
              );
              return formatConfirmation(
                `Workout preset "${updated.name}" updated.`
              );
            }

            case 'get_exercise_progress': {
              const progress = await getExerciseProgress(userId, {
                exercise_id: args.exercise_id,
                exercise_name: args.exercise_name,
                start_date: args.start_date,
                end_date: args.end_date,
                limit: args.limit,
                offset: args.offset,
              });
              return formatList(
                progress.data,
                `Exercise Progress: ${args.exercise_name || args.exercise_id}`,
                (p: any) =>
                  `**${p.entry_date}**: Max Weight: ${p.max_weight}kg | Max Reps: ${p.max_reps} | Volume: ${p.total_volume}kg`,
                {
                  total_count: progress.total_count,
                  has_more: progress.has_more,
                  next_offset: progress.next_offset,
                }
              );
            }

            case 'get_frequent_sets': {
              const weeks = args.weeks ?? 4;
              const since = addDays(todayInZone(tz), -(weeks * 7));
              const rows = await exerciseEntryDb.getFrequentSets(
                userId,
                since,
                todayInZone(tz)
              );
              if (rows.length === 0) {
                return `No repeated workouts found in the last ${weeks} weeks (an exercise must appear on the same weekday at least twice to count). Ask the user about their routine instead.`;
              }
              const DOW_NAMES = [
                'Sunday',
                'Monday',
                'Tuesday',
                'Wednesday',
                'Thursday',
                'Friday',
                'Saturday',
              ];
              let text = `# Usual workouts (last ${weeks} weeks)\n`;
              let currentDay = -1;
              for (const row of rows) {
                if (row.day_of_week !== currentDay) {
                  currentDay = row.day_of_week;
                  text += `\n## ${DOW_NAMES[currentDay] ?? currentDay}\n`;
                }
                let typical: string;
                if (row.modal_reps !== null) {
                  typical = `${row.modal_sets ?? '?'}×${row.modal_reps}`;
                  if (row.modal_weight !== null) {
                    typical += ` @ ${row.modal_weight}kg`;
                  }
                } else if (row.modal_duration !== null) {
                  typical = `${row.modal_sets ?? '?'} sets of ${row.modal_duration}s`;
                } else {
                  typical = `${row.modal_sets ?? '?'} sets`;
                }
                text += `- ${row.exercise_name} — ${row.session_count} sessions, typically ${typical} (id: ${row.exercise_id})\n`;
              }
              return text.trimEnd();
            }

            case 'get_workout_plans': {
              const plans: WorkoutPlanRow[] =
                await workoutPlanTemplateService.getWorkoutPlanTemplatesByUserId(
                  userId
                );
              return formatJsonResult(plans.map(projectWorkoutPlan));
            }

            case 'create_workout_plan': {
              const assignmentError = validatePlanAssignments(args.assignments);
              if (assignmentError) {
                return ERRORS.VALIDATION(assignmentError);
              }
              const createStart = args.start_date ?? todayInZone(tz);
              // Day strings compare lexicographically. An inverted range would
              // make the active window empty — worse on update, where the old
              // future diary entries are deleted and none regenerate.
              if (args.end_date && args.end_date < createStart) {
                return ERRORS.VALIDATION(
                  'end_date must be on or after start_date'
                );
              }
              const plan =
                await workoutPlanTemplateService.createWorkoutPlanTemplate(
                  userId,
                  {
                    plan_name: args.name,
                    description: args.description ?? null,
                    start_date: createStart,
                    end_date: args.end_date ?? null,
                    is_active: args.is_active ?? false,
                    assignments: toPlanAssignments(args.assignments),
                    currentClientDate: todayInZone(tz),
                  }
                );
              const base = `Workout plan "${plan.plan_name}" created: ${plan.assignments.length} day assignments.`;
              return formatConfirmation(
                plan.is_active
                  ? `${base} Plan is active — workout diary entries were generated.`
                  : base
              );
            }

            case 'update_workout_plan': {
              if (!args.plan_id && !args.plan_name) {
                return ERRORS.VALIDATION(
                  'Either plan_id or plan_name must be provided'
                );
              }
              if (
                args.name === undefined &&
                args.description === undefined &&
                args.start_date === undefined &&
                args.end_date === undefined &&
                args.is_active === undefined &&
                !args.assignments?.length
              ) {
                return ERRORS.VALIDATION(
                  'Nothing to update — provide name, description, start_date, end_date, is_active, or assignments'
                );
              }
              if (args.assignments?.length) {
                const assignmentError = validatePlanAssignments(
                  args.assignments
                );
                if (assignmentError) {
                  return ERRORS.VALIDATION(assignmentError);
                }
              }
              let planId = args.plan_id;
              if (!planId && args.plan_name) {
                const plans: WorkoutPlanRow[] =
                  await workoutPlanTemplateService.getWorkoutPlanTemplatesByUserId(
                    userId
                  );
                const matches = plans.filter(
                  (p) =>
                    String(p.plan_name).toLowerCase() ===
                    args.plan_name!.toLowerCase()
                );
                if (matches.length === 0) {
                  return ERRORS.NOT_FOUND('Workout Plan', args.plan_name);
                }
                // Plan names carry no uniqueness constraint; guessing between
                // duplicates would silently update the wrong plan.
                if (matches.length > 1) {
                  return ERRORS.VALIDATION(
                    `Multiple plans are named "${args.plan_name}" — use plan_id (see get_workout_plans)`
                  );
                }
                planId = matches[0].id;
              }
              // The repository update is a full-replace with '' / false
              // defaults — omitting plan_name would blank it and omitting
              // is_active would deactivate the plan — so merge the request
              // over the current row before sending complete data.
              const existing: (WorkoutPlanRow & { user_id: string }) | null =
                await workoutPlanTemplateRepository.getWorkoutPlanTemplateById(
                  planId,
                  userId
                );
              if (!existing || existing.user_id !== userId) {
                return ERRORS.NOT_FOUND('Workout Plan', String(planId));
              }
              const mergedStart =
                args.start_date ??
                (existing.start_date
                  ? dayString(existing.start_date)
                  : todayInZone(tz));
              const mergedEnd =
                args.end_date ??
                (existing.end_date ? dayString(existing.end_date) : null);
              if (mergedEnd && mergedEnd < mergedStart) {
                return ERRORS.VALIDATION(
                  'end_date must be on or after start_date'
                );
              }
              const updated =
                await workoutPlanTemplateService.updateWorkoutPlanTemplate(
                  userId,
                  planId,
                  {
                    plan_name: args.name ?? existing.plan_name,
                    description: args.description ?? existing.description,
                    start_date: mergedStart,
                    end_date: mergedEnd,
                    is_active: args.is_active ?? existing.is_active,
                    ...(args.assignments?.length && {
                      assignments: toPlanAssignments(args.assignments),
                    }),
                    currentClientDate: todayInZone(tz),
                  }
                );
              return formatConfirmation(
                `Workout plan "${updated.plan_name}" updated.`
              );
            }

            default:
              return ERRORS.INVALID_ACTION(
                String((args as any).action),
                VALID_ACTIONS
              );
          }
        } catch (error) {
          log('error', '[Exercise Tool] Error:', error);
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND('Resource', 'unknown');
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),

    sparky_list_exercises: tool({
      description:
        'Returns a paginated exercise catalog for the authenticated user.',
      inputSchema: listExercisesSchema,
      execute: async (rawArgs) => {
        const parsed = listExercisesSchema.safeParse(
          normalizeDayKeywords(rawArgs, tz)
        );
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        try {
          const { limit, offset } = normalizePagination(
            parsed.data.limit,
            parsed.data.offset
          );
          const search = parsed.data.search?.trim() || undefined;
          const [rows, totalCount] = await Promise.all([
            exerciseDb.getExercisesWithPagination(
              userId,
              search,
              null,
              null,
              null,
              null,
              limit,
              offset
            ),
            exerciseDb.countExercises(userId, search, null, null, null, null),
          ]);
          const data = buildPaginatedResult(
            rows.map((r: Record<string, unknown>) =>
              compactRecord(r, EXERCISE_CATALOG_DROP)
            ),
            totalCount,
            offset
          );
          return formatJsonResult(data);
        } catch (error) {
          log('error', '[Exercise Tool] sparky_list_exercises error:', error);
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND('Exercise', 'unknown');
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),

    sparky_get_exercise_details: tool({
      description:
        'Returns full details for one exercise by exercise_id or exercise_name.',
      inputSchema: getExerciseDetailsSchema,
      execute: async (rawArgs) => {
        const parsed = getExerciseDetailsSchema.safeParse(
          normalizeDayKeywords(rawArgs, tz)
        );
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        try {
          const data = await getExerciseDetails(userId, parsed.data);
          return formatJsonResult(data);
        } catch (error) {
          log(
            'error',
            '[Exercise Tool] sparky_get_exercise_details error:',
            error
          );
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND(
              'Exercise',
              parsed.data.exercise_id || parsed.data.exercise_name || 'unknown'
            );
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),

    sparky_search_exercises: tool({
      description: 'Searches exercises by name and optional filters.',
      inputSchema: searchExercisesSchema,
      execute: async (rawArgs) => {
        const parsed = searchExercisesSchema.safeParse(
          normalizeDayKeywords(rawArgs, tz)
        );
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        try {
          const args = parsed.data;
          const { limit, offset } = normalizePagination(
            args.limit,
            args.offset
          );
          const { exercises, totalCount } =
            await exerciseService.searchExercisesPaginated(
              userId,
              args.query,
              userId,
              args.equipment ? [args.equipment] : undefined,
              args.muscle_group ? [args.muscle_group] : undefined,
              limit,
              offset
            );
          const data = buildPaginatedResult(
            exercises.map(projectExercise),
            totalCount,
            offset
          );
          return formatJsonResult(data);
        } catch (error) {
          log('error', '[Exercise Tool] sparky_search_exercises error:', error);
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND('Exercise', parsed.data.query);
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),

    sparky_get_exercise_diary: tool({
      description:
        'Returns entry-level exercise diary data for a specific date or date range.',
      inputSchema: exerciseDateRangeSchema,
      execute: async (rawArgs) => {
        const parsed = exerciseDateRangeSchema.safeParse(
          normalizeDayKeywords(rawArgs, tz)
        );
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        try {
          const { startDate, endDate } = exerciseDateRange(parsed.data, tz);
          const { entries, sets } = await exerciseEntryDb.getExerciseDiaryRange(
            userId,
            startDate,
            endDate
          );
          const data = {
            start_date: startDate,
            end_date: endDate,
            entries: entries.map(projectExerciseEntry),
            sets: sets.map((s: Record<string, unknown>) =>
              compactRecord(s, EXERCISE_SET_DROP)
            ),
          };
          return formatJsonResult(data);
        } catch (error) {
          log(
            'error',
            '[Exercise Tool] sparky_get_exercise_diary error:',
            error
          );
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND(
              'Exercise diary',
              parsed.data.date || parsed.data.start_date || 'unknown'
            );
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),

    sparky_get_daily_exercise_totals: tool({
      description: 'Returns daily exercise totals for a date or range.',
      inputSchema: exerciseDateRangeSchema,
      execute: async (rawArgs) => {
        const parsed = exerciseDateRangeSchema.safeParse(
          normalizeDayKeywords(rawArgs, tz)
        );
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        try {
          const { startDate, endDate } = exerciseDateRange(parsed.data, tz);
          const rows = await exerciseEntryDb.getDailyExerciseTotalsRange(
            userId,
            startDate,
            endDate
          );
          // `calories_burned` reports the resolved figure — max(device summary,
          // logged + background steps) — so it matches the Diary. The raw row sum
          // double-counts a device summary against the workouts it already includes.
          const resolvedByDate = await getResolvedExerciseCaloriesRange(
            userId,
            startDate,
            endDate
          );
          const data = {
            start_date: startDate,
            end_date: endDate,
            rows: rows.map((row: { entry_date?: unknown }) => {
              const projected = projectEntryDate(row) as Record<
                string,
                unknown
              >;
              const resolved = resolvedByDate.get(String(projected.entry_date));
              return resolved
                ? { ...projected, calories_burned: resolved.calories }
                : projected;
            }),
          };
          return formatJsonResult(data);
        } catch (error) {
          log(
            'error',
            '[Exercise Tool] sparky_get_daily_exercise_totals error:',
            error
          );
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND(
              'Exercise totals',
              parsed.data.date || parsed.data.start_date || 'unknown'
            );
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),

    sparky_get_recent_exercise_entries: tool({
      description:
        'Returns recent entry-level exercise diary rows for the authenticated user.',
      inputSchema: recentExerciseEntriesSchema,
      execute: async (rawArgs) => {
        const parsed = recentExerciseEntriesSchema.safeParse(
          normalizeDayKeywords(rawArgs, tz)
        );
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        try {
          const limit = Math.min(Math.max(parsed.data.limit ?? 50, 1), 200);
          const rows = await exerciseEntryDb.getRecentExerciseEntries(
            userId,
            limit
          );
          return formatJsonResult(rows.map(projectExerciseEntry));
        } catch (error) {
          log(
            'error',
            '[Exercise Tool] sparky_get_recent_exercise_entries error:',
            error
          );
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND('Exercise entries', 'recent');
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),

    sparky_get_exercise_usage: tool({
      description:
        'Shows where a specific exercise_id was used in the exercise diary.',
      inputSchema: exerciseUsageSchema,
      execute: async (rawArgs) => {
        const parsed = exerciseUsageSchema.safeParse(
          normalizeDayKeywords(rawArgs, tz)
        );
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        try {
          const { exercise_id, ...query } = parsed.data;
          const { startDate, endDate } = exerciseDateRange(query, tz);
          const { limit, offset } = normalizePagination(
            query.limit,
            query.offset
          );
          const { rows, totalCount } = await exerciseEntryDb.getExerciseUsage(
            userId,
            exercise_id,
            startDate,
            endDate,
            limit,
            offset
          );
          const data = buildPaginatedResult(
            rows.map(projectExerciseEntry),
            totalCount,
            offset
          );
          return formatJsonResult(data);
        } catch (error) {
          log(
            'error',
            '[Exercise Tool] sparky_get_exercise_usage error:',
            error
          );
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND('Exercise', parsed.data.exercise_id);
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),

    sparky_get_exercise_progress: tool({
      description: 'Returns paginated performance history for an exercise.',
      inputSchema: exerciseProgressSchema,
      execute: async (rawArgs) => {
        const parsed = exerciseProgressSchema.safeParse(
          normalizeDayKeywords(rawArgs, tz)
        );
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        try {
          const data = await getExerciseProgress(userId, parsed.data);
          return formatJsonResult(data);
        } catch (error) {
          log(
            'error',
            '[Exercise Tool] sparky_get_exercise_progress error:',
            error
          );
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND(
              'Exercise',
              parsed.data.exercise_id || parsed.data.exercise_name || 'unknown'
            );
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),
  };
}
