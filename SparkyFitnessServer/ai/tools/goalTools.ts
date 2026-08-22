import { tool } from 'ai';
import { z } from 'zod';
import { todayInZone } from '@workspace/shared';
import { log } from '../../config/logging.js';
import goalService from '../../services/goalService.js';
import goalPresetService from '../../services/goalPresetService.js';
import weeklyGoalPlanService from '../../services/weeklyGoalPlanService.js';
import goalRepository from '../../models/goalRepository.js';
import { ERRORS, formatZodError } from './errors.js';
import {
  DAY_NAMES,
  dayString,
  formatConfirmation,
  formatJsonResult,
  formatList,
} from './formatting.js';
import {
  manageGoalsSchema,
  manageGoalsInput,
  type ManageGoalsInput,
} from './schemas/goals.js';
import { optionalDateSchema } from './schemas/common.js';
import { normalizeActionArgs, normalizeDayKeywords } from './dates.js';

const VALID_ACTIONS = [
  'get_goals',
  'set_goals',
  'get_goal_presets',
  'create_goal_preset',
  'update_goal_preset',
  'get_weekly_goal_plans',
  'create_weekly_goal_plan',
  'update_weekly_goal_plan',
  'list_goal_timeline',
];

// Actions whose inputs may be echoed-back projection rows and need the
// null/id/day normalization in execute before the strict parse.
const PRESET_PLAN_ACTIONS = new Set([
  'get_goal_presets',
  'create_goal_preset',
  'update_goal_preset',
  'get_weekly_goal_plans',
  'create_weekly_goal_plan',
  'update_weekly_goal_plan',
]);

// Goal-preset columns the tool exposes; used for payload building, merge, and
// the get_goal_presets projection.
const PRESET_FIELDS = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'water_goal_ml',
  'saturated_fat',
  'polyunsaturated_fat',
  'monounsaturated_fat',
  'trans_fat',
  'cholesterol',
  'sodium',
  'potassium',
  'dietary_fiber',
  'sugars',
  'vitamin_a',
  'vitamin_c',
  'calcium',
  'iron',
  'protein_percentage',
  'carbs_percentage',
  'fat_percentage',
] as const;

// Columns the tool does not expose but must carry through an update: the
// repository update is a full replace, so omitting them would blank values
// set from the goal-preset form.
const PRESET_CARRY_FIELDS = [
  'target_exercise_calories_burned',
  'target_exercise_duration_minutes',
  'breakfast_percentage',
  'lunch_percentage',
  'dinner_percentage',
  'snacks_percentage',
  'custom_nutrients',
  'custom_meal_percentages',
] as const;

interface GoalPresetRow extends Record<string, unknown> {
  id: string;
  preset_name: string;
}

interface WeeklyGoalPlanRow extends Record<string, unknown> {
  id: string;
  plan_name: string;
  start_date: string | Date;
  end_date?: string | Date | null;
  is_active: boolean;
}

// weekly_goal_plans stores one preset column per weekday; indexed by
// day_of_week (0=Sunday) to match DAY_NAMES.
const DAY_PRESET_COLUMNS = [
  'sunday_preset_id',
  'monday_preset_id',
  'tuesday_preset_id',
  'wednesday_preset_id',
  'thursday_preset_id',
  'friday_preset_id',
  'saturday_preset_id',
] as const;

function projectGoalPreset(p: GoalPresetRow) {
  const out: Record<string, unknown> = { id: p.id, preset_name: p.preset_name };
  for (const field of PRESET_FIELDS) {
    out[field] = p[field] ?? null;
  }
  return out;
}

function projectWeeklyGoalPlan(
  plan: WeeklyGoalPlanRow,
  presetNames: Map<string, string>
) {
  const dayPresets = [];
  for (let dow = 0; dow < 7; dow++) {
    const presetId = plan[DAY_PRESET_COLUMNS[dow]] as string | null | undefined;
    if (presetId) {
      dayPresets.push({
        day: DAY_NAMES[dow],
        day_of_week: dow,
        preset_id: presetId,
        preset_name: presetNames.get(presetId) ?? null,
      });
    }
  }
  return {
    id: plan.id,
    plan_name: plan.plan_name,
    start_date: dayString(plan.start_date),
    end_date: plan.end_date ? dayString(plan.end_date) : null,
    is_active: plan.is_active,
    day_presets: dayPresets,
  };
}

// The service derives protein/carbs/fat grams from percentages only when
// calories and all three percentages are present, so a partial set would
// silently persist without recalculation.
function validatePresetPercentages(
  payload: Record<string, unknown>
): string | null {
  const values = [
    payload['protein_percentage'],
    payload['carbs_percentage'],
    payload['fat_percentage'],
  ].filter((v) => v !== null && v !== undefined);
  if (values.length === 0) {
    return null;
  }
  if (values.length < 3) {
    return 'Macro percentages must be sent as a full set: protein_percentage, carbs_percentage, and fat_percentage together';
  }
  if (payload['calories'] === null || payload['calories'] === undefined) {
    return 'Macro percentages need calories to derive gram targets — provide calories too';
  }
  const sum = values.reduce((acc: number, v) => acc + Number(v), 0);
  if (Math.abs(sum - 100) > 1) {
    return `Macro percentages must sum to 100 (got ${sum})`;
  }
  return null;
}

interface DayPresetInput {
  day_of_week: number;
  preset_id?: string;
  preset_name?: string;
}

function resolveDayPresets(
  dayPresets: DayPresetInput[],
  presets: GoalPresetRow[]
):
  | { ok: true; columns: Record<string, string | null> }
  | { ok: false; message: string } {
  const columns: Record<string, string | null> = {};
  for (const col of DAY_PRESET_COLUMNS) {
    columns[col] = null;
  }
  const seen = new Set<number>();
  for (const d of dayPresets) {
    if (seen.has(d.day_of_week)) {
      return {
        ok: false,
        message: `Duplicate day_of_week ${d.day_of_week} in day_presets`,
      };
    }
    seen.add(d.day_of_week);
    let presetId = d.preset_id;
    if (presetId) {
      const id = presetId;
      if (!presets.some((p) => p.id === id)) {
        return {
          ok: false,
          message: `Goal preset with ID '${presetId}' was not found — see get_goal_presets`,
        };
      }
    } else if (d.preset_name) {
      const name = d.preset_name.toLowerCase();
      const matches = presets.filter(
        (p) => p.preset_name.toLowerCase() === name
      );
      if (matches.length === 0) {
        return {
          ok: false,
          message: `Goal preset "${d.preset_name}" was not found — see get_goal_presets`,
        };
      }
      if (matches.length > 1) {
        return {
          ok: false,
          message: `Multiple goal presets are named "${d.preset_name}" — use preset_id (see get_goal_presets)`,
        };
      }
      presetId = matches[0].id;
    } else {
      return {
        ok: false,
        message: `day_presets entry for day ${d.day_of_week} needs preset_id or preset_name`,
      };
    }
    columns[DAY_PRESET_COLUMNS[d.day_of_week]] = presetId;
  }
  return { ok: true, columns };
}

// The column set MCP's goal queries exposed; richer server goal objects are
// projected down to it so the chat-visible JSON stays identical.
const GOAL_SNAPSHOT_FIELDS = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'water_goal_ml',
  'saturated_fat',
  'polyunsaturated_fat',
  'monounsaturated_fat',
  'trans_fat',
  'cholesterol',
  'sodium',
  'potassium',
  'dietary_fiber',
  'sugars',
  'vitamin_a',
  'vitamin_c',
  'calcium',
  'iron',
] as const;

// Adjusted goals come from the goal-mode calculation and can carry float noise
// (e.g. 88.30000000000001). Round to 1 decimal for chat display — integers stay
// integers, so raw stored goals render exactly as before.
function roundGoalValue(value: unknown): unknown {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num * 10) / 10 : value;
}

const goalSnapshotSchema = z.object({
  target_date: optionalDateSchema,
});

export function buildGoalTools(userId: string, tz: string) {
  return {
    sparky_manage_goals: tool({
      description: `Target management: set and view calorie, macro, water, and weight goals.

This tool takes a FLAT object with an "action" field. Do NOT nest fields under the action name.

Actions:
- action: 'get_goals' (fields: target_date?) — returns the goals active on a specific date
- action: 'set_goals' (fields: start_date, calories?, protein?, carbs?, fat?, water_goal_ml?, weight?) — sets new goals from a start date
- action: 'get_goal_presets' — lists saved goal presets with their targets
- action: 'create_goal_preset' (fields: preset_name, calories?, protein?, carbs?, fat?, water_goal_ml?, protein_percentage?/carbs_percentage?/fat_percentage? as a full set, other nutrients?) — saves a reusable named goal preset
- action: 'update_goal_preset' (fields: preset_id?|preset_name?, new_name?, any goal fields) — only provided fields change
- action: 'get_weekly_goal_plans' — lists weekly goal plans mapping weekdays to presets
- action: 'create_weekly_goal_plan' (fields: plan_name, day_presets:[{day_of_week 0=Sun…6=Sat, preset_id?|preset_name?}], start_date?, end_date?, is_active?) — activating a plan deactivates all others
- action: 'update_weekly_goal_plan' (fields: plan_id?|plan_name?, new_name?, start_date?, end_date?, is_active?, day_presets?) — day_presets REPLACES all seven day slots, so send the complete desired week; end_date: null makes the plan open-ended
- action: 'list_goal_timeline' — lists all goal changes over time`,
      inputSchema: manageGoalsInput,
      execute: async (rawArgs) => {
        const normalized = normalizeActionArgs(
          rawArgs,
          tz,
          VALID_ACTIONS,
          (args) => {
            // A bare `id` is the surrogate key of an echoed projection row —
            // the model is pointing at an existing record, so this is always
            // an update (the pre-parse normalization below remaps the id).
            if (args.id) {
              return args.plan_name || args.day_presets
                ? 'update_weekly_goal_plan'
                : 'update_goal_preset';
            }
            if (args.day_presets) {
              return args.plan_id || args.new_name
                ? 'update_weekly_goal_plan'
                : 'create_weekly_goal_plan';
            }
            if (args.plan_id) {
              return 'update_weekly_goal_plan';
            }
            if (args.preset_id || (args.preset_name && args.new_name)) {
              return 'update_goal_preset';
            }
            // preset_name + goal fields is create_goal_preset's signature;
            // the duplicate-name constraint stops an intended update from
            // forking a second preset.
            if (args.preset_name) {
              return 'create_goal_preset';
            }
            if (
              args.calories !== undefined ||
              args.protein !== undefined ||
              args.carbs !== undefined ||
              args.fat !== undefined ||
              args.water_goal_ml !== undefined ||
              args.weight !== undefined ||
              args.start_date !== undefined
            ) {
              return 'set_goals';
            }
            if (args.target_date !== undefined) {
              return 'get_goals';
            }
            return undefined;
          }
        );
        // get_goal_presets / get_weekly_goal_plans rows are projected with
        // explicit nulls and an `id` key; when a row is echoed back into an
        // update, z.coerce.number() would turn each null into 0
        // (Number(null) === 0) and silently zero every unset target. Nulls
        // never mean "clear" on these actions, so drop them pre-parse, map the
        // row id onto the action's id field, and strip the day_presets
        // projection label.
        const rec = normalized as Record<string, unknown>;
        if (
          typeof rec.action === 'string' &&
          PRESET_PLAN_ACTIONS.has(rec.action)
        ) {
          for (const key of Object.keys(rec)) {
            // end_date: null on a plan update is an explicit "make the plan
            // open-ended", not projection noise — keep it for the parse.
            if (
              key === 'end_date' &&
              rec.action === 'update_weekly_goal_plan'
            ) {
              continue;
            }
            if (rec[key] === null) {
              delete rec[key];
            }
          }
          const idKey =
            rec.action === 'update_goal_preset'
              ? 'preset_id'
              : rec.action === 'update_weekly_goal_plan'
                ? 'plan_id'
                : null;
          if (idKey && rec.id !== undefined && rec[idKey] === undefined) {
            rec[idKey] = rec.id;
            delete rec.id;
          }
          if (Array.isArray(rec.day_presets)) {
            rec.day_presets = rec.day_presets.map((item) =>
              item && typeof item === 'object'
                ? Object.fromEntries(
                    Object.entries(item).filter(
                      ([k, v]) => v !== null && k !== 'day'
                    )
                  )
                : item
            );
          }
        }
        const parsed = manageGoalsSchema.safeParse(normalized);
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        const args: ManageGoalsInput = parsed.data;
        try {
          switch (args.action) {
            case 'get_goals': {
              // adjust=true applies the same goal-mode calculation (adaptive
              // TDEE, exercise-water addition, etc.) the Diary tab uses, so the
              // chatbot reports the goal the user actually sees there rather
              // than the raw stored goal row. set_goals below intentionally
              // stays on raw goals since it persists them.
              const goals = (await goalService.getUserGoals(
                userId,
                args.target_date || todayInZone(tz),
                undefined,
                true
              )) as Record<string, unknown>;
              let text = `### Goals for ${args.target_date || 'today'}\n\n`;
              const DISPLAY_FIELDS = [
                'calories',
                'protein',
                'carbs',
                'fat',
                'water_goal_ml',
              ] as const;
              for (const field of DISPLAY_FIELDS) {
                if (goals[field] !== null && goals[field] !== undefined) {
                  let label: string;
                  let unit: string;
                  switch (field) {
                    case 'calories':
                      label = 'Calories';
                      unit = ' kcal';
                      break;
                    case 'water_goal_ml':
                      label = 'Water';
                      unit = 'ml';
                      break;
                    case 'protein':
                      label = 'Protein';
                      unit = 'g';
                      break;
                    case 'carbs':
                      label = 'Carbs';
                      unit = 'g';
                      break;
                    case 'fat':
                      label = 'Fat';
                      unit = 'g';
                      break;
                    default:
                      label = field;
                      unit = '';
                  }
                  text += `- **${label}:** ${roundGoalValue(goals[field])}${unit}\n`;
                }
              }
              if (
                (goals as any).custom_nutrients &&
                typeof (goals as any).custom_nutrients === 'object'
              ) {
                const custom = (goals as any).custom_nutrients as Record<
                  string,
                  number
                >;
                for (const [name, amount] of Object.entries(custom)) {
                  text += `- **${name}:** ${amount}\n`;
                }
              }
              return text;
            }

            case 'set_goals': {
              const startDate = args.start_date || todayInZone(tz);
              // Fetch existing goals for the start date to preserve unchanged nutrients
              const existingGoals: any = await goalService.getUserGoals(
                userId,
                startDate
              );
              // Build base payload with required fields, using existing goals as defaults
              const payload: any = {
                p_start_date: startDate,
                p_cascade: true,
                p_calories: args.calories ?? existingGoals.calories,
                p_protein: args.protein ?? existingGoals.protein,
                p_carbs: args.carbs ?? existingGoals.carbs,
                p_fat: args.fat ?? existingGoals.fat,
                p_water_goal_ml:
                  args.water_goal_ml ?? existingGoals.water_goal_ml,
                p_saturated_fat:
                  args.saturated_fat ?? existingGoals.saturated_fat,
                p_polyunsaturated_fat:
                  args.polyunsaturated_fat ?? existingGoals.polyunsaturated_fat,
                p_monounsaturated_fat:
                  args.monounsaturated_fat ?? existingGoals.monounsaturated_fat,
                p_trans_fat: args.trans_fat ?? existingGoals.trans_fat,
                p_cholesterol: args.cholesterol ?? existingGoals.cholesterol,
                p_sodium: args.sodium ?? existingGoals.sodium,
                p_potassium: args.potassium ?? existingGoals.potassium,
                p_dietary_fiber:
                  args.dietary_fiber ?? existingGoals.dietary_fiber,
                p_sugars: args.sugars ?? existingGoals.sugars,
                p_vitamin_a: args.vitamin_a ?? existingGoals.vitamin_a,
                p_vitamin_c: args.vitamin_c ?? existingGoals.vitamin_c,
                p_calcium: args.calcium ?? existingGoals.calcium,
                p_iron: args.iron ?? existingGoals.iron,
                // Preserve custom nutrients if not provided
                custom_nutrients:
                  args.custom_nutrients ?? existingGoals.custom_nutrients,
              };
              await goalService.manageGoalTimeline(userId, payload);
              return formatConfirmation(
                `Goals set successfully starting from ${startDate}.`
              );
            }

            case 'get_goal_presets': {
              const presets = (await goalPresetService.getGoalPresets(
                userId
              )) as GoalPresetRow[];
              return formatJsonResult(presets.map(projectGoalPreset));
            }

            case 'create_goal_preset': {
              const payload: Record<string, unknown> = {
                preset_name: args.preset_name,
              };
              for (const field of PRESET_FIELDS) {
                const value = (args as Record<string, unknown>)[field];
                if (value !== undefined) {
                  payload[field] = value;
                }
              }
              const pctError = validatePresetPercentages(payload);
              if (pctError) {
                return ERRORS.VALIDATION(pctError);
              }
              // Case-insensitive pre-check: the DB unique constraint is
              // case-sensitive, and a case-only duplicate would break
              // name-based addressing (the ambiguity guard matches
              // case-insensitively).
              const existingPresets = (await goalPresetService.getGoalPresets(
                userId
              )) as GoalPresetRow[];
              const presetNameTaken = existingPresets.find(
                (p) =>
                  p.preset_name.toLowerCase() ===
                  (args.preset_name as string).toLowerCase()
              );
              if (presetNameTaken) {
                return ERRORS.VALIDATION(
                  `A goal preset named "${args.preset_name}" already exists — use update_goal_preset to change it, or choose a different name`
                );
              }
              try {
                const preset = (await goalPresetService.createGoalPreset(
                  userId,
                  payload
                )) as GoalPresetRow;
                return formatConfirmation(
                  `Goal preset "${preset.preset_name}" created.`
                );
              } catch (error) {
                if (
                  error instanceof Error &&
                  error.message.includes('already exists')
                ) {
                  return ERRORS.VALIDATION(
                    `A goal preset named "${args.preset_name}" already exists — use update_goal_preset to change it, or choose a different name`
                  );
                }
                throw error;
              }
            }

            case 'update_goal_preset': {
              if (!args.preset_id && !args.preset_name) {
                return ERRORS.VALIDATION(
                  'Either preset_id or preset_name must be provided'
                );
              }
              const hasUpdate =
                args.new_name !== undefined ||
                PRESET_FIELDS.some(
                  (field) =>
                    (args as Record<string, unknown>)[field] !== undefined
                );
              if (!hasUpdate) {
                return ERRORS.VALIDATION(
                  'Nothing to update — provide new_name or at least one goal field'
                );
              }
              const presets = (await goalPresetService.getGoalPresets(
                userId
              )) as GoalPresetRow[];
              let existing: GoalPresetRow | undefined;
              if (args.preset_id) {
                existing = presets.find((p) => p.id === args.preset_id);
                if (!existing) {
                  return ERRORS.NOT_FOUND('Goal Preset', args.preset_id);
                }
              } else {
                const name = (args.preset_name as string).toLowerCase();
                const matches = presets.filter(
                  (p) => p.preset_name.toLowerCase() === name
                );
                if (matches.length === 0) {
                  return ERRORS.NOT_FOUND(
                    'Goal Preset',
                    args.preset_name as string
                  );
                }
                if (matches.length > 1) {
                  return ERRORS.VALIDATION(
                    `Multiple goal presets are named "${args.preset_name}" — use preset_id (see get_goal_presets)`
                  );
                }
                existing = matches[0];
              }
              if (args.new_name !== undefined) {
                const selfId = existing.id;
                const renameTaken = presets.find(
                  (p) =>
                    p.id !== selfId &&
                    p.preset_name.toLowerCase() ===
                      (args.new_name as string).toLowerCase()
                );
                if (renameTaken) {
                  return ERRORS.VALIDATION(
                    `A goal preset named "${args.new_name}" already exists — choose a different name`
                  );
                }
              }
              // Full-replace repository update: merge over the existing row
              // and carry through the fields this tool does not expose.
              const payload: Record<string, unknown> = {
                preset_name: args.new_name ?? existing.preset_name,
              };
              for (const field of PRESET_FIELDS) {
                const value = (args as Record<string, unknown>)[field];
                payload[field] =
                  value !== undefined ? value : (existing[field] ?? null);
              }
              for (const field of PRESET_CARRY_FIELDS) {
                payload[field] = existing[field] ?? null;
              }
              // Explicit gram targets without new percentages switch the
              // preset to gram mode — otherwise the service would recompute
              // grams from the old percentages and overwrite them.
              if (
                (args.protein !== undefined ||
                  args.carbs !== undefined ||
                  args.fat !== undefined) &&
                args.protein_percentage === undefined &&
                args.carbs_percentage === undefined &&
                args.fat_percentage === undefined
              ) {
                payload['protein_percentage'] = null;
                payload['carbs_percentage'] = null;
                payload['fat_percentage'] = null;
              }
              const pctError = validatePresetPercentages(payload);
              if (pctError) {
                return ERRORS.VALIDATION(pctError);
              }
              try {
                const updated = (await goalPresetService.updateGoalPreset(
                  existing.id,
                  userId,
                  payload
                )) as GoalPresetRow;
                return formatConfirmation(
                  `Goal preset "${updated.preset_name}" updated.`
                );
              } catch (error) {
                if (
                  error instanceof Error &&
                  error.message.includes('already exists')
                ) {
                  return ERRORS.VALIDATION(
                    `A goal preset named "${args.new_name}" already exists — choose a different name`
                  );
                }
                throw error;
              }
            }

            case 'get_weekly_goal_plans': {
              const [plans, presets] = await Promise.all([
                weeklyGoalPlanService.getWeeklyGoalPlans(userId) as Promise<
                  WeeklyGoalPlanRow[]
                >,
                goalPresetService.getGoalPresets(userId) as Promise<
                  GoalPresetRow[]
                >,
              ]);
              const presetNames = new Map(
                presets.map((p) => [p.id, p.preset_name])
              );
              return formatJsonResult(
                plans.map((plan) => projectWeeklyGoalPlan(plan, presetNames))
              );
            }

            case 'create_weekly_goal_plan': {
              const startDate = args.start_date ?? todayInZone(tz);
              if (args.end_date && args.end_date < startDate) {
                return ERRORS.VALIDATION(
                  'end_date must be on or after start_date'
                );
              }
              const plans = (await weeklyGoalPlanService.getWeeklyGoalPlans(
                userId
              )) as WeeklyGoalPlanRow[];
              const nameTaken = plans.find(
                (p) =>
                  p.plan_name.toLowerCase() === args.plan_name.toLowerCase()
              );
              if (nameTaken) {
                return ERRORS.VALIDATION(
                  `A weekly goal plan named "${args.plan_name}" already exists (plan_id ${nameTaken.id}) — use update_weekly_goal_plan to change it, or choose a different name`
                );
              }
              const presets = (await goalPresetService.getGoalPresets(
                userId
              )) as GoalPresetRow[];
              const resolved = resolveDayPresets(args.day_presets, presets);
              if (!resolved.ok) {
                return ERRORS.VALIDATION(resolved.message);
              }
              const plan = (await weeklyGoalPlanService.createWeeklyGoalPlan(
                userId,
                {
                  plan_name: args.plan_name,
                  start_date: startDate,
                  end_date: args.end_date ?? null,
                  is_active: args.is_active ?? false,
                  ...resolved.columns,
                }
              )) as WeeklyGoalPlanRow;
              return formatConfirmation(
                `Weekly goal plan "${plan.plan_name}" created.` +
                  (plan.is_active
                    ? ' Plan is active — other weekly goal plans were deactivated.'
                    : '')
              );
            }

            case 'update_weekly_goal_plan': {
              if (!args.plan_id && !args.plan_name) {
                return ERRORS.VALIDATION(
                  'Either plan_id or plan_name must be provided'
                );
              }
              if (
                args.new_name === undefined &&
                args.start_date === undefined &&
                args.end_date === undefined &&
                args.is_active === undefined &&
                !args.day_presets?.length
              ) {
                return ERRORS.VALIDATION(
                  'Nothing to update — provide new_name, start_date, end_date, is_active, or day_presets'
                );
              }
              const plans = (await weeklyGoalPlanService.getWeeklyGoalPlans(
                userId
              )) as WeeklyGoalPlanRow[];
              let existing: WeeklyGoalPlanRow | undefined;
              if (args.plan_id) {
                existing = plans.find((p) => p.id === args.plan_id);
                if (!existing) {
                  return ERRORS.NOT_FOUND('Weekly Goal Plan', args.plan_id);
                }
              } else {
                const name = (args.plan_name as string).toLowerCase();
                const matches = plans.filter(
                  (p) => p.plan_name.toLowerCase() === name
                );
                if (matches.length === 0) {
                  return ERRORS.NOT_FOUND(
                    'Weekly Goal Plan',
                    args.plan_name as string
                  );
                }
                if (matches.length > 1) {
                  return ERRORS.VALIDATION(
                    `Multiple weekly goal plans are named "${args.plan_name}" — use plan_id (see get_weekly_goal_plans)`
                  );
                }
                existing = matches[0];
              }
              if (args.new_name !== undefined) {
                const selfId = existing.id;
                const renameTaken = plans.find(
                  (p) =>
                    p.id !== selfId &&
                    p.plan_name.toLowerCase() ===
                      (args.new_name as string).toLowerCase()
                );
                if (renameTaken) {
                  return ERRORS.VALIDATION(
                    `A weekly goal plan named "${args.new_name}" already exists — choose a different name`
                  );
                }
              }
              const mergedStart =
                args.start_date ?? dayString(existing.start_date);
              const mergedEnd =
                args.end_date !== undefined
                  ? args.end_date
                  : existing.end_date
                    ? dayString(existing.end_date)
                    : null;
              if (mergedEnd && mergedEnd < mergedStart) {
                return ERRORS.VALIDATION(
                  'end_date must be on or after start_date'
                );
              }
              // Full-replace repository update: day columns either come from
              // a complete replacement week or are carried from the row.
              let dayColumns: Record<string, string | null>;
              if (args.day_presets?.length) {
                const presets = (await goalPresetService.getGoalPresets(
                  userId
                )) as GoalPresetRow[];
                const resolved = resolveDayPresets(args.day_presets, presets);
                if (!resolved.ok) {
                  return ERRORS.VALIDATION(resolved.message);
                }
                dayColumns = resolved.columns;
              } else {
                dayColumns = {};
                for (const col of DAY_PRESET_COLUMNS) {
                  dayColumns[col] = (existing[col] as string | null) ?? null;
                }
              }
              const updated = (await weeklyGoalPlanService.updateWeeklyGoalPlan(
                existing.id,
                userId,
                {
                  plan_name: args.new_name ?? existing.plan_name,
                  start_date: mergedStart,
                  end_date: mergedEnd,
                  is_active: args.is_active ?? existing.is_active,
                  ...dayColumns,
                }
              )) as WeeklyGoalPlanRow;
              return formatConfirmation(
                `Weekly goal plan "${updated.plan_name}" updated.` +
                  (args.is_active && !existing.is_active
                    ? ' Plan is active — other weekly goal plans were deactivated.'
                    : '')
              );
            }

            case 'list_goal_timeline': {
              const timeline = await goalRepository.getGoalTimeline(userId);
              return formatList(
                timeline,
                'Goal Timeline',
                (g: any) =>
                  `**${dayString(g.goal_date)}**: ${g.calories} kcal | P: ${g.protein}g | C: ${g.carbs}g | F: ${g.fat}g | W: ${g.water_goal_ml}ml`
              );
            }

            default:
              return ERRORS.INVALID_ACTION(
                String((args as any).action),
                VALID_ACTIONS
              );
          }
        } catch (error) {
          log('error', '[Goal Tool] Error:', error);
          return ERRORS.DB_ERROR(error);
        }
      },
    }),

    sparky_get_goal_snapshot: tool({
      description: 'Returns the goals active on a specific date.',
      inputSchema: goalSnapshotSchema,
      execute: async (rawArgs) => {
        const parsed = goalSnapshotSchema.safeParse(
          normalizeDayKeywords(rawArgs, tz)
        );
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        try {
          // adjust=true so the snapshot matches the goal-mode-calculated goal
          // shown on the Diary tab, consistent with the get_goals action above.
          const goals = (await goalService.getUserGoals(
            userId,
            parsed.data.target_date || todayInZone(tz),
            undefined,
            true
          )) as Record<string, unknown>;
          const data: Record<string, unknown> = {};
          for (const field of GOAL_SNAPSHOT_FIELDS) {
            if (field in goals) {
              data[field] = roundGoalValue(goals[field]);
            }
          }
          return formatJsonResult(data);
        } catch (error) {
          log('error', '[Goal Tool] sparky_get_goal_snapshot error:', error);
          if (error instanceof Error && error.message.includes('not found')) {
            return ERRORS.NOT_FOUND(
              'Goal',
              parsed.data.target_date || 'unknown'
            );
          }
          return ERRORS.DB_ERROR(error);
        }
      },
    }),
  };
}
