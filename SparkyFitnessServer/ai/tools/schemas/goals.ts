import { z } from 'zod';
import { dateSchema, optionalDateSchema, uuidSchema } from './common.js';

const getGoalsSchema = z
  .object({
    action: z.literal('get_goals'),
    target_date: optionalDateSchema.describe(
      'Date to fetch goals for (defaults to today)'
    ),
  })
  .strict();

const setGoalsSchema = z
  .object({
    action: z.literal('set_goals'),
    start_date: dateSchema
      .optional()
      .describe('Date when these goals take effect'),
    calories: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Daily calorie goal'),
    protein: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Daily protein goal (g)'),
    carbs: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Daily carbohydrate goal (g)'),
    fat: z.coerce.number().min(0).optional().describe('Daily fat goal (g)'),
    water_goal_ml: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Daily water intake goal (ml)'),
    weight: z.coerce.number().min(0).optional().describe('Target body weight'),
    // Additional nutrient fields (optional)
    saturated_fat: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Daily saturated fat (g)'),
    polyunsaturated_fat: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Daily polyunsaturated fat (g)'),
    monounsaturated_fat: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Daily monounsaturated fat (g)'),
    trans_fat: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Daily trans fat (g)'),
    cholesterol: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Daily cholesterol (mg)'),
    sodium: z.coerce.number().min(0).optional().describe('Daily sodium (mg)'),
    potassium: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Daily potassium (mg)'),
    dietary_fiber: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Daily dietary fiber (g)'),
    sugars: z.coerce.number().min(0).optional().describe('Daily sugars (g)'),
    vitamin_a: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Daily vitamin A (µg)'),
    vitamin_c: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Daily vitamin C (mg)'),
    calcium: z.coerce.number().min(0).optional().describe('Daily calcium (mg)'),
    iron: z.coerce.number().min(0).optional().describe('Daily iron (mg)'),
    custom_nutrients: z
      .record(z.string(), z.coerce.number())
      .optional()
      .describe('Custom nutrient values'),
  })
  .strict();

// Nutrient/target fields shared by the goal-preset actions. Macro percentages
// must be sent as a full set together with calories (the service derives
// protein/carbs/fat grams from them); the handler validates that.
const goalPresetFields = {
  calories: z.coerce.number().min(0).optional().describe('Daily calorie goal'),
  protein: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('Daily protein goal (g)'),
  carbs: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('Daily carbohydrate goal (g)'),
  fat: z.coerce.number().min(0).optional().describe('Daily fat goal (g)'),
  water_goal_ml: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('Daily water intake goal (ml)'),
  protein_percentage: z.coerce
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe('Protein % of calories — send all three percentages together'),
  carbs_percentage: z.coerce
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe('Carbs % of calories — send all three percentages together'),
  fat_percentage: z.coerce
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe('Fat % of calories — send all three percentages together'),
  saturated_fat: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('Daily saturated fat (g)'),
  polyunsaturated_fat: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('Daily polyunsaturated fat (g)'),
  monounsaturated_fat: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('Daily monounsaturated fat (g)'),
  trans_fat: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('Daily trans fat (g)'),
  cholesterol: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('Daily cholesterol (mg)'),
  sodium: z.coerce.number().min(0).optional().describe('Daily sodium (mg)'),
  potassium: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('Daily potassium (mg)'),
  dietary_fiber: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('Daily dietary fiber (g)'),
  sugars: z.coerce.number().min(0).optional().describe('Daily sugars (g)'),
  vitamin_a: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('Daily vitamin A (µg)'),
  vitamin_c: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('Daily vitamin C (mg)'),
  calcium: z.coerce.number().min(0).optional().describe('Daily calcium (mg)'),
  iron: z.coerce.number().min(0).optional().describe('Daily iron (mg)'),
};

const getGoalPresetsSchema = z
  .object({
    action: z.literal('get_goal_presets'),
  })
  .strict();

const createGoalPresetSchema = z
  .object({
    action: z.literal('create_goal_preset'),
    preset_name: z.string().min(1).max(200).describe('Name of the goal preset'),
    ...goalPresetFields,
  })
  .strict();

const updateGoalPresetSchema = z
  .object({
    action: z.literal('update_goal_preset'),
    preset_id: uuidSchema.optional().describe('UUID of the goal preset'),
    preset_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Name of the preset to update (alternative to ID)'),
    new_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('New name for the preset'),
    ...goalPresetFields,
  })
  .strict();

// One weekday slot of a weekly goal plan: which preset applies on which day.
const dayPresetSchema = z
  .object({
    day_of_week: z.coerce
      .number()
      .int()
      .min(0)
      .max(6)
      .describe('Day of week: 0=Sunday … 6=Saturday'),
    preset_id: uuidSchema
      .optional()
      .describe('Goal preset UUID (from get_goal_presets)'),
    preset_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Goal preset name (alternative to preset_id)'),
  })
  .strict();

const getWeeklyGoalPlansSchema = z
  .object({
    action: z.literal('get_weekly_goal_plans'),
  })
  .strict();

const createWeeklyGoalPlanSchema = z
  .object({
    action: z.literal('create_weekly_goal_plan'),
    plan_name: z
      .string()
      .min(1)
      .max(200)
      .describe('Name of the weekly goal plan'),
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
        'Activating this plan deactivates every other weekly goal plan'
      ),
    day_presets: z
      .array(dayPresetSchema)
      .min(1)
      .describe(
        'Which goal preset applies on which weekday; unlisted days fall back to the default goals'
      ),
  })
  .strict();

const updateWeeklyGoalPlanSchema = z
  .object({
    action: z.literal('update_weekly_goal_plan'),
    plan_id: uuidSchema.optional().describe('UUID of the weekly goal plan'),
    plan_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Name of the plan to update (alternative to ID)'),
    new_name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('New name for the plan'),
    start_date: dateSchema.optional().describe('New start date (YYYY-MM-DD)'),
    end_date: dateSchema.optional().describe('New end date (YYYY-MM-DD)'),
    is_active: z
      .boolean()
      .optional()
      .describe(
        'Activating this plan deactivates every other weekly goal plan'
      ),
    day_presets: z
      .array(dayPresetSchema)
      .min(1)
      .optional()
      .describe(
        'Replacement weekday mapping; REPLACES all seven day slots, so send the complete desired week'
      ),
  })
  .strict();

const listGoalTimelineSchema = z
  .object({
    action: z.literal('list_goal_timeline'),
  })
  .strict();

export const manageGoalsSchema = z.discriminatedUnion('action', [
  getGoalsSchema,
  setGoalsSchema,
  getGoalPresetsSchema,
  createGoalPresetSchema,
  updateGoalPresetSchema,
  getWeeklyGoalPlansSchema,
  createWeeklyGoalPlanSchema,
  updateWeeklyGoalPlanSchema,
  listGoalTimelineSchema,
]);

export type ManageGoalsInput = z.infer<typeof manageGoalsSchema>;

// Flat shape published to the LLM as `inputSchema`. Strict per-action
// validation still runs in the tool handler via `manageGoalsSchema.safeParse`.
export const manageGoalsInput = z.object({
  action: z
    .enum([
      'get_goals',
      'set_goals',
      'get_goal_presets',
      'create_goal_preset',
      'update_goal_preset',
      'get_weekly_goal_plans',
      'create_weekly_goal_plan',
      'update_weekly_goal_plan',
      'list_goal_timeline',
    ])
    .optional()
    .describe(
      'Action to perform; see the tool description for the fields each action needs.'
    ),
  target_date: optionalDateSchema.describe(
    'get_goals: date to fetch goals for (defaults to today)'
  ),
  start_date: dateSchema
    .optional()
    .describe('set_goals: date when these goals take effect'),
  calories: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('set_goals: daily calorie goal'),
  protein: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('set_goals: daily protein goal (g)'),
  carbs: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('set_goals: daily carbohydrate goal (g)'),
  fat: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('set_goals: daily fat goal (g)'),
  water_goal_ml: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('set_goals: daily water intake goal (ml)'),
  weight: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('set_goals: target body weight'),
  // Additional nutrient fields (optional)
  saturated_fat: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('set_goals: saturated fat (g)'),
  polyunsaturated_fat: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('set_goals: polyunsaturated fat (g)'),
  monounsaturated_fat: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('set_goals: monounsaturated fat (g)'),
  trans_fat: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('set_goals: trans fat (g)'),
  cholesterol: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('set_goals: cholesterol (mg)'),
  sodium: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('set_goals: sodium (mg)'),
  potassium: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('set_goals: potassium (mg)'),
  dietary_fiber: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('set_goals: dietary fiber (g)'),
  sugars: z.coerce.number().min(0).optional().describe('set_goals: sugars (g)'),
  vitamin_a: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('set_goals: vitamin A (µg)'),
  vitamin_c: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('set_goals: vitamin C (mg)'),
  calcium: z.coerce
    .number()
    .min(0)
    .optional()
    .describe('set_goals: calcium (mg)'),
  iron: z.coerce.number().min(0).optional().describe('set_goals: iron (mg)'),
  protein_percentage: z.coerce
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe(
      'create/update_goal_preset: protein % of calories — send all three percentages together'
    ),
  carbs_percentage: z.coerce
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe(
      'create/update_goal_preset: carbs % of calories — send all three percentages together'
    ),
  fat_percentage: z.coerce
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe(
      'create/update_goal_preset: fat % of calories — send all three percentages together'
    ),
  preset_id: z
    .string()
    .optional()
    .describe(
      'Goal preset UUID — for update_goal_preset (see get_goal_presets)'
    ),
  preset_name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Goal preset name — the name for create_goal_preset, or the preset to update (alternative to preset_id)'
    ),
  new_name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('New name — for update_goal_preset / update_weekly_goal_plan'),
  plan_id: z
    .string()
    .optional()
    .describe(
      'Weekly goal plan UUID — for update_weekly_goal_plan (see get_weekly_goal_plans)'
    ),
  plan_name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Weekly goal plan name — the name for create_weekly_goal_plan, or the plan to update (alternative to plan_id)'
    ),
  end_date: dateSchema
    .optional()
    .describe('Plan end date (YYYY-MM-DD) — for weekly goal plans'),
  is_active: z
    .boolean()
    .optional()
    .describe(
      'For create/update_weekly_goal_plan: activating a plan deactivates every other weekly goal plan'
    ),
  day_presets: z
    .array(
      z.object({
        day_of_week: z.coerce.number().int().min(0).max(6),
        preset_id: uuidSchema.optional(),
        preset_name: z.string().min(1).max(200).optional(),
      })
    )
    .min(1)
    .optional()
    .describe(
      'Weekday mapping for create/update_weekly_goal_plan: [{day_of_week 0=Sun…6=Sat, preset_id OR preset_name}]. On update this REPLACES all seven day slots.'
    ),
  // Custom nutrients as a map of name -> amount (numeric)
  custom_nutrients: z
    .record(z.string(), z.coerce.number())
    .optional()
    .describe('set_goals: custom nutrient values'),
});
