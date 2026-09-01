import { vi, beforeEach, describe, expect, it } from 'vitest';
import { todayInZone } from '@workspace/shared';
import { buildGoalTools } from '../ai/tools/goalTools.js';
import goalService from '../services/goalService.js';
import goalPresetService from '../services/goalPresetService.js';
import weeklyGoalPlanService from '../services/weeklyGoalPlanService.js';
import goalRepository from '../models/goalRepository.js';

vi.mock('../services/goalService', () => ({
  default: {
    getUserGoals: vi.fn(),
    manageGoalTimeline: vi.fn(),
  },
}));
vi.mock('../models/goalRepository', () => ({
  default: {
    getGoalTimeline: vi.fn(),
  },
}));
vi.mock('../services/goalPresetService', () => ({
  default: {
    getGoalPresets: vi.fn(),
    createGoalPreset: vi.fn(),
    updateGoalPreset: vi.fn(),
  },
}));
vi.mock('../services/weeklyGoalPlanService', () => ({
  default: {
    getWeeklyGoalPlans: vi.fn(),
    createWeeklyGoalPlan: vi.fn(),
    updateWeeklyGoalPlan: vi.fn(),
  },
}));
vi.mock('../config/logging', () => ({
  log: vi.fn(),
}));

const opts = { toolCallId: 'tc-1', messages: [] };
const DB_ERROR_TEXT =
  'Error [DB_ERROR]: A database error occurred.\n\nSuggestion: Do NOT retry the same call — it will fail the same way. Tell the user what failed and stop.';

let tools: ReturnType<typeof buildGoalTools>;

beforeEach(() => {
  vi.clearAllMocks();
  tools = buildGoalTools('user-1', 'UTC');
});

describe('sparky_manage_goals', () => {
  it('get_goals renders the goals for an explicit date', async () => {
    vi.mocked(goalService.getUserGoals).mockResolvedValue({
      calories: 2100,
      protein: 160,
      carbs: 240,
      fat: 70,
      water_goal_ml: 2200,
      saturated_fat: 20,
    });

    const result = await tools.sparky_manage_goals.execute!(
      { action: 'get_goals', target_date: '2026-06-01' },
      opts
    );

    expect(result).toBe(
      '### Goals for 2026-06-01\n\n' +
        '- **Calories:** 2100 kcal\n' +
        '- **Protein:** 160g\n' +
        '- **Carbs:** 240g\n' +
        '- **Fat:** 70g\n' +
        '- **Water:** 2200ml\n'
    );
    expect(goalService.getUserGoals).toHaveBeenCalledWith(
      'user-1',
      '2026-06-01',
      undefined,
      true
    );
  });

  it('get_goals defaults to today (UTC) and labels it "today"', async () => {
    vi.mocked(goalService.getUserGoals).mockResolvedValue({
      calories: 2000,
      protein: 150,
      carbs: 250,
      fat: 67,
      water_goal_ml: 1920,
    });

    const result = await tools.sparky_manage_goals.execute!(
      { action: 'get_goals' },
      opts
    );

    expect(result).toBe(
      '### Goals for today\n\n' +
        '- **Calories:** 2000 kcal\n' +
        '- **Protein:** 150g\n' +
        '- **Carbs:** 250g\n' +
        '- **Fat:** 67g\n' +
        '- **Water:** 1920ml\n'
    );
    expect(goalService.getUserGoals).toHaveBeenCalledWith(
      'user-1',
      todayInZone('UTC'),
      undefined,
      true
    );
  });

  it('set_goals applies MCP defaults for omitted fields and cascades', async () => {
    vi.mocked(goalService.manageGoalTimeline).mockResolvedValue({
      message: 'ok',
    });
    // Mock existing goals to provide defaults for omitted fields
    vi.mocked(goalService.getUserGoals).mockResolvedValue({
      calories: 2000,
      protein: 150,
      carbs: 250,
      fat: 67,
      water_goal_ml: 2000,
    });
    const result = await tools.sparky_manage_goals.execute!(
      { action: 'set_goals', start_date: '2026-06-15', calories: 2200 },
      opts
    );
    expect(result).toBe('✅ Goals set successfully starting from 2026-06-15.');
    expect(goalService.manageGoalTimeline).toHaveBeenCalledWith('user-1', {
      p_start_date: '2026-06-15',
      p_cascade: true,
      p_calories: 2200,
      p_protein: 150,
      p_carbs: 250,
      p_fat: 67,
      p_water_goal_ml: 2000,
      p_saturated_fat: undefined,
      p_polyunsaturated_fat: undefined,
      p_monounsaturated_fat: undefined,
      p_trans_fat: undefined,
      p_cholesterol: undefined,
      p_sodium: undefined,
      p_potassium: undefined,
      p_dietary_fiber: undefined,
      p_sugars: undefined,
      p_vitamin_a: undefined,
      p_vitamin_c: undefined,
      p_calcium: undefined,
      p_iron: undefined,
      custom_nutrients: undefined,
    });
  });

  it('set_goals without start_date defaults to today', async () => {
    vi.mocked(goalService.manageGoalTimeline).mockResolvedValue({
      message: 'ok',
    });
    vi.mocked(goalService.getUserGoals).mockResolvedValue({
      calories: 2000,
      protein: 150,
      carbs: 250,
      fat: 67,
      water_goal_ml: 2000,
    });

    const result = await tools.sparky_manage_goals.execute!(
      { action: 'set_goals', calories: 2200 } as any,
      opts
    );

    const today = todayInZone('UTC');
    expect(result).toBe(`✅ Goals set successfully starting from ${today}.`);
    expect(goalService.manageGoalTimeline).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ p_start_date: today, p_calories: 2200 })
    );
  });

  it('rejects unknown actions', async () => {
    const result = await tools.sparky_manage_goals.execute!(
      { action: 'bogus_action' } as any,
      opts
    );

    expect(result).toBe('Error [VALIDATION]: action: Invalid input');
  });

  it('rejects stray keys (strict per-action schema)', async () => {
    const result = await tools.sparky_manage_goals.execute!(
      { action: 'get_goals', foo: 1 } as any,
      opts
    );

    expect(result).toBe('Error [VALIDATION]: Unrecognized key: "foo"');
  });

  it('list_goal_timeline renders one line per goal change', async () => {
    vi.mocked(goalRepository.getGoalTimeline).mockResolvedValue([
      {
        id: 1,
        goal_date: '2026-06-01',
        calories: 2000,
        protein: 150,
        carbs: 250,
        fat: 67,
        water_goal_ml: 2000,
      },
      {
        id: 2,
        goal_date: '2026-05-01',
        calories: 1800,
        protein: 140,
        carbs: 200,
        fat: 60,
        water_goal_ml: 1500,
      },
    ]);

    const result = await tools.sparky_manage_goals.execute!(
      { action: 'list_goal_timeline' },
      opts
    );

    expect(result).toBe(
      '# Goal Timeline\n\n' +
        '**2026-06-01**: 2000 kcal | P: 150g | C: 250g | F: 67g | W: 2000ml\n\n' +
        '**2026-05-01**: 1800 kcal | P: 140g | C: 200g | F: 60g | W: 1500ml'
    );
    expect(goalRepository.getGoalTimeline).toHaveBeenCalledWith('user-1');
  });

  it('list_goal_timeline renders a pg local-midnight Date goal_date as a calendar-day string', async () => {
    vi.mocked(goalRepository.getGoalTimeline).mockResolvedValue([
      {
        id: 1,
        goal_date: new Date(2026, 5, 1),
        calories: 2000,
        protein: 150,
        carbs: 250,
        fat: 67,
        water_goal_ml: 2000,
      },
    ]);

    const result = await tools.sparky_manage_goals.execute!(
      { action: 'list_goal_timeline' },
      opts
    );

    expect(result).toBe(
      '# Goal Timeline\n\n' +
        '**2026-06-01**: 2000 kcal | P: 150g | C: 250g | F: 67g | W: 2000ml'
    );
  });

  it('list_goal_timeline reports when there are no goals', async () => {
    vi.mocked(goalRepository.getGoalTimeline).mockResolvedValue([]);

    const result = await tools.sparky_manage_goals.execute!(
      { action: 'list_goal_timeline' },
      opts
    );

    expect(result).toBe('# Goal Timeline\n\nNo results found.');
  });

  it('returns DB_ERROR when the service throws', async () => {
    vi.mocked(goalService.getUserGoals).mockRejectedValue(new Error('boom'));

    const result = await tools.sparky_manage_goals.execute!(
      { action: 'get_goals' },
      opts
    );

    expect(result).toBe(DB_ERROR_TEXT);
  });
});

describe('sparky_get_goal_snapshot', () => {
  it("projects the server's goal object down to MCP's column set", async () => {
    const snapshotFields = {
      calories: 2000,
      protein: 150,
      carbs: 250,
      fat: 67,
      water_goal_ml: 1920,
      saturated_fat: 20,
      polyunsaturated_fat: 10,
      monounsaturated_fat: 25,
      trans_fat: 0,
      cholesterol: 300,
      sodium: 2300,
      potassium: 3500,
      dietary_fiber: 25,
      sugars: 50,
      vitamin_a: 900,
      vitamin_c: 90,
      calcium: 1000,
      iron: 18,
    };
    vi.mocked(goalService.getUserGoals).mockResolvedValue({
      ...snapshotFields,
      protein_percentage: null,
      breakfast_percentage: 25,
      custom_nutrients: {},
    });

    const result = await tools.sparky_get_goal_snapshot.execute!(
      { target_date: '2026-06-01' },
      opts
    );

    expect(result).toBe(JSON.stringify(snapshotFields));
    expect(goalService.getUserGoals).toHaveBeenCalledWith(
      'user-1',
      '2026-06-01',
      undefined,
      true
    );
  });

  it('defaults to today (UTC) when no target_date is given', async () => {
    vi.mocked(goalService.getUserGoals).mockResolvedValue({ calories: 2000 });

    const result = await tools.sparky_get_goal_snapshot.execute!({}, opts);

    expect(result).toBe(JSON.stringify({ calories: 2000 }));
    expect(goalService.getUserGoals).toHaveBeenCalledWith(
      'user-1',
      todayInZone('UTC'),
      undefined,
      true
    );
  });

  it("maps 'not found' service errors to NOT_FOUND", async () => {
    vi.mocked(goalService.getUserGoals).mockRejectedValue(
      new Error('Goal not found')
    );

    const result = await tools.sparky_get_goal_snapshot.execute!(
      { target_date: '2026-06-01' },
      opts
    );

    expect(result).toBe(
      "Error [NOT_FOUND]: Goal with ID '2026-06-01' not found.\n\nSuggestion: Check the ID and try again."
    );
  });

  it('rejects malformed dates', async () => {
    const result = await tools.sparky_get_goal_snapshot.execute!(
      { target_date: '06/01/2026' },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: target_date: Date must be in YYYY-MM-DD format (or "today", "yesterday", "tomorrow")'
    );
  });

  it('returns DB_ERROR for other service failures', async () => {
    vi.mocked(goalService.getUserGoals).mockRejectedValue(new Error('boom'));

    const result = await tools.sparky_get_goal_snapshot.execute!({}, opts);

    expect(result).toBe(DB_ERROR_TEXT);
  });
});

const PRESET_ID = '11111111-1111-4111-8111-111111111111';
const PRESET_ID_2 = '22222222-2222-4222-8222-222222222222';
const WPLAN_ID = '33333333-3333-4333-8333-333333333333';
const WPLAN_ID_2 = '44444444-4444-4444-8444-444444444444';
const TODAY = todayInZone('UTC');

// A stored preset the way goalPresetService returns it (water_goal already
// mapped to water_goal_ml), including form-only fields the tool must carry
// through the full-replace update untouched.
const cutPreset = {
  id: PRESET_ID,
  user_id: 'user-1',
  preset_name: 'Cut Day',
  calories: 1800,
  protein: 150,
  carbs: 150,
  fat: 60,
  water_goal_ml: 2500,
  saturated_fat: 18,
  polyunsaturated_fat: null,
  monounsaturated_fat: null,
  trans_fat: null,
  cholesterol: null,
  sodium: 2300,
  potassium: null,
  dietary_fiber: 30,
  sugars: null,
  vitamin_a: null,
  vitamin_c: null,
  calcium: null,
  iron: null,
  protein_percentage: null,
  carbs_percentage: null,
  fat_percentage: null,
  target_exercise_calories_burned: 300,
  target_exercise_duration_minutes: 30,
  breakfast_percentage: 25,
  lunch_percentage: 25,
  dinner_percentage: 30,
  snacks_percentage: 20,
  custom_nutrients: { creatine: 5 },
  custom_meal_percentages: {},
};

describe('goal presets', () => {
  it('get_goal_presets returns the full structured targets', async () => {
    vi.mocked(goalPresetService.getGoalPresets).mockResolvedValue([cutPreset]);

    const result = await tools.sparky_manage_goals.execute!(
      { action: 'get_goal_presets' },
      opts
    );

    expect(result).toBe(
      JSON.stringify([
        {
          id: PRESET_ID,
          preset_name: 'Cut Day',
          calories: 1800,
          protein: 150,
          carbs: 150,
          fat: 60,
          water_goal_ml: 2500,
          saturated_fat: 18,
          polyunsaturated_fat: null,
          monounsaturated_fat: null,
          trans_fat: null,
          cholesterol: null,
          sodium: 2300,
          potassium: null,
          dietary_fiber: 30,
          sugars: null,
          vitamin_a: null,
          vitamin_c: null,
          calcium: null,
          iron: null,
          protein_percentage: null,
          carbs_percentage: null,
          fat_percentage: null,
        },
      ])
    );
  });

  it('create_goal_preset sends only the provided fields', async () => {
    vi.mocked(goalPresetService.createGoalPreset).mockResolvedValue({
      id: PRESET_ID,
      preset_name: 'Refeed Day',
    });

    const result = await tools.sparky_manage_goals.execute!(
      {
        action: 'create_goal_preset',
        preset_name: 'Refeed Day',
        calories: 2600,
        protein: 160,
        water_goal_ml: 3000,
      },
      opts
    );

    expect(result).toBe('✅ Goal preset "Refeed Day" created.');
    expect(goalPresetService.createGoalPreset).toHaveBeenCalledWith('user-1', {
      preset_name: 'Refeed Day',
      calories: 2600,
      protein: 160,
      water_goal_ml: 3000,
    });
  });

  it('create_goal_preset accepts a complete percentage set', async () => {
    vi.mocked(goalPresetService.createGoalPreset).mockResolvedValue({
      id: PRESET_ID,
      preset_name: 'Macro Split',
    });
    const result = await tools.sparky_manage_goals.execute!(
      {
        action: 'create_goal_preset',
        preset_name: 'Macro Split',
        calories: 2000,
        protein_percentage: 30,
        carbs_percentage: 40,
        fat_percentage: 30,
      },
      opts
    );
    expect(result).toBe('✅ Goal preset "Macro Split" created.');
  });

  it('create_goal_preset rejects a partial percentage set', async () => {
    const result = await tools.sparky_manage_goals.execute!(
      {
        action: 'create_goal_preset',
        preset_name: 'Broken',
        calories: 2000,
        protein_percentage: 30,
      },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Macro percentages must be sent as a full set: protein_percentage, carbs_percentage, and fat_percentage together'
    );
    expect(goalPresetService.createGoalPreset).not.toHaveBeenCalled();
  });

  it('create_goal_preset rejects percentages that do not sum to 100', async () => {
    const result = await tools.sparky_manage_goals.execute!(
      {
        action: 'create_goal_preset',
        preset_name: 'Broken',
        calories: 2000,
        protein_percentage: 30,
        carbs_percentage: 30,
        fat_percentage: 30,
      },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Macro percentages must sum to 100 (got 90)'
    );
  });

  it('create_goal_preset surfaces the duplicate-name constraint', async () => {
    vi.mocked(goalPresetService.createGoalPreset).mockRejectedValue(
      new Error('A goal preset with this name already exists.')
    );
    const result = await tools.sparky_manage_goals.execute!(
      { action: 'create_goal_preset', preset_name: 'Cut Day', calories: 1800 },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: A goal preset named "Cut Day" already exists — use update_goal_preset to change it, or choose a different name'
    );
  });

  it('create_goal_preset rejects a case-only duplicate name before the service', async () => {
    vi.mocked(goalPresetService.getGoalPresets).mockResolvedValue([cutPreset]);
    const result = await tools.sparky_manage_goals.execute!(
      { action: 'create_goal_preset', preset_name: 'cut day', calories: 1800 },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: A goal preset named "cut day" already exists — use update_goal_preset to change it, or choose a different name'
    );
    expect(goalPresetService.createGoalPreset).not.toHaveBeenCalled();
  });

  it('update_goal_preset round-trips an echoed get_goal_presets row', async () => {
    vi.mocked(goalPresetService.getGoalPresets).mockResolvedValue([cutPreset]);
    vi.mocked(goalPresetService.updateGoalPreset).mockResolvedValue({
      id: PRESET_ID,
      preset_name: 'Cut Day',
    });

    // The projected row exactly as get_goal_presets returns it (nulls and
    // surrogate id included), with only calories edited.
    const result = await tools.sparky_manage_goals.execute!(
      {
        action: 'update_goal_preset',
        id: PRESET_ID,
        preset_name: 'Cut Day',
        calories: 1750,
        protein: 150,
        carbs: 150,
        fat: 60,
        water_goal_ml: 2500,
        saturated_fat: 18,
        polyunsaturated_fat: null,
        monounsaturated_fat: null,
        trans_fat: null,
        cholesterol: null,
        sodium: 2300,
        potassium: null,
        dietary_fiber: 30,
        sugars: null,
        vitamin_a: null,
        vitamin_c: null,
        calcium: null,
        iron: null,
        protein_percentage: null,
        carbs_percentage: null,
        fat_percentage: null,
      } as unknown as Parameters<
        NonNullable<typeof tools.sparky_manage_goals.execute>
      >[0],
      opts
    );

    expect(result).toBe('✅ Goal preset "Cut Day" updated.');
    const payload = vi.mocked(goalPresetService.updateGoalPreset).mock
      .calls[0][2] as Record<string, unknown>;
    expect(payload.calories).toBe(1750);
    // Echoed nulls must stay null — z.coerce.number() would otherwise turn
    // them into 0 and zero out every unset target.
    expect(payload.polyunsaturated_fat).toBeNull();
    expect(payload.sugars).toBeNull();
    expect(payload.sodium).toBe(2300);
  });

  it('infers update_goal_preset from an echoed row with no action', async () => {
    vi.mocked(goalPresetService.getGoalPresets).mockResolvedValue([cutPreset]);
    vi.mocked(goalPresetService.updateGoalPreset).mockResolvedValue({
      id: PRESET_ID,
      preset_name: 'Cut Day',
    });

    // No action field — the surrogate id alone must select the update path
    // rather than inferring create_goal_preset and choking on the id key.
    const result = await tools.sparky_manage_goals.execute!(
      {
        id: PRESET_ID,
        preset_name: 'Cut Day',
        calories: 1700,
        sodium: 2300,
        sugars: null,
      } as unknown as Parameters<
        NonNullable<typeof tools.sparky_manage_goals.execute>
      >[0],
      opts
    );

    expect(result).toBe('✅ Goal preset "Cut Day" updated.');
    const payload = vi.mocked(goalPresetService.updateGoalPreset).mock
      .calls[0][2] as Record<string, unknown>;
    expect(payload.calories).toBe(1700);
    expect(payload.sugars).toBeNull();
  });

  it('update_goal_preset rejects renaming onto another preset but allows re-casing itself', async () => {
    const bulkPreset = {
      ...cutPreset,
      id: PRESET_ID_2,
      preset_name: 'Bulk Day',
    };
    vi.mocked(goalPresetService.getGoalPresets).mockResolvedValue([
      cutPreset,
      bulkPreset,
    ]);

    const collision = await tools.sparky_manage_goals.execute!(
      {
        action: 'update_goal_preset',
        preset_id: PRESET_ID_2,
        new_name: 'CUT DAY',
      },
      opts
    );
    expect(collision).toBe(
      'Error [VALIDATION]: A goal preset named "CUT DAY" already exists — choose a different name'
    );
    expect(goalPresetService.updateGoalPreset).not.toHaveBeenCalled();

    vi.mocked(goalPresetService.updateGoalPreset).mockResolvedValue({
      id: PRESET_ID,
      preset_name: 'CUT DAY',
    });
    const recase = await tools.sparky_manage_goals.execute!(
      {
        action: 'update_goal_preset',
        preset_id: PRESET_ID,
        new_name: 'CUT DAY',
      },
      opts
    );
    expect(recase).toBe('✅ Goal preset "CUT DAY" updated.');
  });

  it('update_goal_preset requires an identifier and an update field', async () => {
    const noId = await tools.sparky_manage_goals.execute!(
      { action: 'update_goal_preset', calories: 2000 },
      opts
    );
    expect(noId).toBe(
      'Error [VALIDATION]: Either preset_id or preset_name must be provided'
    );
    const noFields = await tools.sparky_manage_goals.execute!(
      { action: 'update_goal_preset', preset_id: PRESET_ID },
      opts
    );
    expect(noFields).toBe(
      'Error [VALIDATION]: Nothing to update — provide new_name or at least one goal field'
    );
  });

  it('update_goal_preset merges the existing row and carries form-only fields', async () => {
    vi.mocked(goalPresetService.getGoalPresets).mockResolvedValue([cutPreset]);
    vi.mocked(goalPresetService.updateGoalPreset).mockResolvedValue({
      id: PRESET_ID,
      preset_name: 'Cut Day',
    });

    const result = await tools.sparky_manage_goals.execute!(
      { action: 'update_goal_preset', preset_name: 'Cut Day', calories: 1700 },
      opts
    );

    expect(result).toBe('✅ Goal preset "Cut Day" updated.');
    expect(goalPresetService.updateGoalPreset).toHaveBeenCalledWith(
      PRESET_ID,
      'user-1',
      {
        preset_name: 'Cut Day',
        calories: 1700,
        protein: 150,
        carbs: 150,
        fat: 60,
        water_goal_ml: 2500,
        saturated_fat: 18,
        polyunsaturated_fat: null,
        monounsaturated_fat: null,
        trans_fat: null,
        cholesterol: null,
        sodium: 2300,
        potassium: null,
        dietary_fiber: 30,
        sugars: null,
        vitamin_a: null,
        vitamin_c: null,
        calcium: null,
        iron: null,
        protein_percentage: null,
        carbs_percentage: null,
        fat_percentage: null,
        target_exercise_calories_burned: 300,
        target_exercise_duration_minutes: 30,
        breakfast_percentage: 25,
        lunch_percentage: 25,
        dinner_percentage: 30,
        snacks_percentage: 20,
        custom_nutrients: { creatine: 5 },
        custom_meal_percentages: {},
      }
    );
  });

  it('update_goal_preset drops stored percentages when explicit grams arrive', async () => {
    vi.mocked(goalPresetService.getGoalPresets).mockResolvedValue([
      {
        ...cutPreset,
        protein_percentage: 30,
        carbs_percentage: 40,
        fat_percentage: 30,
      },
    ]);
    vi.mocked(goalPresetService.updateGoalPreset).mockResolvedValue({
      id: PRESET_ID,
      preset_name: 'Cut Day',
    });

    await tools.sparky_manage_goals.execute!(
      { action: 'update_goal_preset', preset_id: PRESET_ID, protein: 170 },
      opts
    );

    expect(goalPresetService.updateGoalPreset).toHaveBeenCalledWith(
      PRESET_ID,
      'user-1',
      expect.objectContaining({
        protein: 170,
        protein_percentage: null,
        carbs_percentage: null,
        fat_percentage: null,
      })
    );
  });

  it('update_goal_preset rejects ambiguous names and maps unknown ids', async () => {
    vi.mocked(goalPresetService.getGoalPresets).mockResolvedValue([
      cutPreset,
      { ...cutPreset, id: PRESET_ID_2, preset_name: 'cut day' },
    ]);
    const ambiguous = await tools.sparky_manage_goals.execute!(
      { action: 'update_goal_preset', preset_name: 'Cut Day', calories: 1700 },
      opts
    );
    expect(ambiguous).toBe(
      'Error [VALIDATION]: Multiple goal presets are named "Cut Day" — use preset_id (see get_goal_presets)'
    );

    vi.mocked(goalPresetService.getGoalPresets).mockResolvedValue([]);
    const missing = await tools.sparky_manage_goals.execute!(
      { action: 'update_goal_preset', preset_id: PRESET_ID, calories: 1700 },
      opts
    );
    expect(missing).toBe(
      `Error [NOT_FOUND]: Goal Preset with ID '${PRESET_ID}' not found.\n\nSuggestion: Check the ID and try again.`
    );
  });
});

describe('weekly goal plans', () => {
  const storedPlan = {
    id: WPLAN_ID,
    user_id: 'user-1',
    plan_name: 'Training Split',
    start_date: new Date(2026, 7, 17),
    end_date: null,
    is_active: true,
    sunday_preset_id: null,
    monday_preset_id: PRESET_ID,
    tuesday_preset_id: null,
    wednesday_preset_id: PRESET_ID,
    thursday_preset_id: null,
    friday_preset_id: PRESET_ID_2,
    saturday_preset_id: null,
  };

  it('get_weekly_goal_plans resolves preset names per weekday', async () => {
    vi.mocked(weeklyGoalPlanService.getWeeklyGoalPlans).mockResolvedValue([
      storedPlan,
    ]);
    vi.mocked(goalPresetService.getGoalPresets).mockResolvedValue([
      cutPreset,
      { ...cutPreset, id: PRESET_ID_2, preset_name: 'Rest Day' },
    ]);

    const result = await tools.sparky_manage_goals.execute!(
      { action: 'get_weekly_goal_plans' },
      opts
    );

    expect(result).toBe(
      JSON.stringify([
        {
          id: WPLAN_ID,
          plan_name: 'Training Split',
          start_date: '2026-08-17',
          end_date: null,
          is_active: true,
          day_presets: [
            {
              day: 'Mon',
              day_of_week: 1,
              preset_id: PRESET_ID,
              preset_name: 'Cut Day',
            },
            {
              day: 'Wed',
              day_of_week: 3,
              preset_id: PRESET_ID,
              preset_name: 'Cut Day',
            },
            {
              day: 'Fri',
              day_of_week: 5,
              preset_id: PRESET_ID_2,
              preset_name: 'Rest Day',
            },
          ],
        },
      ])
    );
  });

  it('create_weekly_goal_plan maps day_presets onto weekday columns', async () => {
    vi.mocked(weeklyGoalPlanService.getWeeklyGoalPlans).mockResolvedValue([]);
    vi.mocked(goalPresetService.getGoalPresets).mockResolvedValue([
      cutPreset,
      { ...cutPreset, id: PRESET_ID_2, preset_name: 'Rest Day' },
    ]);
    vi.mocked(weeklyGoalPlanService.createWeeklyGoalPlan).mockResolvedValue({
      id: WPLAN_ID,
      plan_name: 'Training Split',
      is_active: true,
    });

    const result = await tools.sparky_manage_goals.execute!(
      {
        action: 'create_weekly_goal_plan',
        plan_name: 'Training Split',
        is_active: true,
        day_presets: [
          { day_of_week: 1, preset_id: PRESET_ID },
          { day_of_week: 5, preset_name: 'Rest Day' },
        ],
      },
      opts
    );

    expect(result).toBe(
      '✅ Weekly goal plan "Training Split" created. Plan is active — other weekly goal plans were deactivated.'
    );
    expect(weeklyGoalPlanService.createWeeklyGoalPlan).toHaveBeenCalledWith(
      'user-1',
      {
        plan_name: 'Training Split',
        start_date: TODAY,
        end_date: null,
        is_active: true,
        sunday_preset_id: null,
        monday_preset_id: PRESET_ID,
        tuesday_preset_id: null,
        wednesday_preset_id: null,
        thursday_preset_id: null,
        friday_preset_id: PRESET_ID_2,
        saturday_preset_id: null,
      }
    );
  });

  it('create_weekly_goal_plan rejects duplicate names, days, and unknown presets', async () => {
    vi.mocked(weeklyGoalPlanService.getWeeklyGoalPlans).mockResolvedValue([
      storedPlan,
    ]);
    const dupName = await tools.sparky_manage_goals.execute!(
      {
        action: 'create_weekly_goal_plan',
        plan_name: 'training split',
        day_presets: [{ day_of_week: 1, preset_id: PRESET_ID }],
      },
      opts
    );
    expect(dupName).toBe(
      `Error [VALIDATION]: A weekly goal plan named "training split" already exists (plan_id ${WPLAN_ID}) — use update_weekly_goal_plan to change it, or choose a different name`
    );

    vi.mocked(weeklyGoalPlanService.getWeeklyGoalPlans).mockResolvedValue([]);
    vi.mocked(goalPresetService.getGoalPresets).mockResolvedValue([cutPreset]);
    const dupDay = await tools.sparky_manage_goals.execute!(
      {
        action: 'create_weekly_goal_plan',
        plan_name: 'Split',
        day_presets: [
          { day_of_week: 1, preset_id: PRESET_ID },
          { day_of_week: 1, preset_id: PRESET_ID },
        ],
      },
      opts
    );
    expect(dupDay).toBe(
      'Error [VALIDATION]: Duplicate day_of_week 1 in day_presets'
    );

    const unknownPreset = await tools.sparky_manage_goals.execute!(
      {
        action: 'create_weekly_goal_plan',
        plan_name: 'Split',
        day_presets: [{ day_of_week: 1, preset_name: 'Nope' }],
      },
      opts
    );
    expect(unknownPreset).toBe(
      'Error [VALIDATION]: Goal preset "Nope" was not found — see get_goal_presets'
    );
    expect(weeklyGoalPlanService.createWeeklyGoalPlan).not.toHaveBeenCalled();
  });

  it('update_weekly_goal_plan clears the end date with an explicit null', async () => {
    const boundedPlan = { ...storedPlan, end_date: new Date(2026, 8, 30) };
    vi.mocked(weeklyGoalPlanService.getWeeklyGoalPlans).mockResolvedValue([
      boundedPlan,
    ]);
    vi.mocked(weeklyGoalPlanService.updateWeeklyGoalPlan).mockResolvedValue({
      ...boundedPlan,
      end_date: null,
    });

    const result = await tools.sparky_manage_goals.execute!(
      {
        action: 'update_weekly_goal_plan',
        plan_id: WPLAN_ID,
        end_date: null,
      } as unknown as Parameters<
        NonNullable<typeof tools.sparky_manage_goals.execute>
      >[0],
      opts
    );

    expect(result).toBe('✅ Weekly goal plan "Training Split" updated.');
    const payload = vi.mocked(weeklyGoalPlanService.updateWeeklyGoalPlan).mock
      .calls[0][2] as Record<string, unknown>;
    expect(payload.end_date).toBeNull();
    expect(payload.monday_preset_id).toBe(PRESET_ID);
  });

  it('update_weekly_goal_plan rejects renaming onto another plan', async () => {
    vi.mocked(weeklyGoalPlanService.getWeeklyGoalPlans).mockResolvedValue([
      storedPlan,
      {
        ...storedPlan,
        id: WPLAN_ID_2,
        plan_name: 'Deload Week',
        is_active: false,
      },
    ]);
    const result = await tools.sparky_manage_goals.execute!(
      {
        action: 'update_weekly_goal_plan',
        plan_id: WPLAN_ID_2,
        new_name: 'training split',
      },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: A weekly goal plan named "training split" already exists — choose a different name'
    );
    expect(weeklyGoalPlanService.updateWeeklyGoalPlan).not.toHaveBeenCalled();
  });

  it('update_weekly_goal_plan carries the weekday columns when only renaming', async () => {
    vi.mocked(weeklyGoalPlanService.getWeeklyGoalPlans).mockResolvedValue([
      storedPlan,
    ]);
    vi.mocked(weeklyGoalPlanService.updateWeeklyGoalPlan).mockResolvedValue({
      id: WPLAN_ID,
      plan_name: 'Training Split v2',
    });

    const result = await tools.sparky_manage_goals.execute!(
      {
        action: 'update_weekly_goal_plan',
        plan_id: WPLAN_ID,
        new_name: 'Training Split v2',
      },
      opts
    );

    expect(result).toBe('✅ Weekly goal plan "Training Split v2" updated.');
    expect(weeklyGoalPlanService.updateWeeklyGoalPlan).toHaveBeenCalledWith(
      WPLAN_ID,
      'user-1',
      {
        plan_name: 'Training Split v2',
        start_date: '2026-08-17',
        end_date: null,
        is_active: true,
        sunday_preset_id: null,
        monday_preset_id: PRESET_ID,
        tuesday_preset_id: null,
        wednesday_preset_id: PRESET_ID,
        thursday_preset_id: null,
        friday_preset_id: PRESET_ID_2,
        saturday_preset_id: null,
      }
    );
  });

  it('update_weekly_goal_plan replaces the whole week when day_presets is sent', async () => {
    vi.mocked(weeklyGoalPlanService.getWeeklyGoalPlans).mockResolvedValue([
      storedPlan,
    ]);
    vi.mocked(goalPresetService.getGoalPresets).mockResolvedValue([cutPreset]);
    vi.mocked(weeklyGoalPlanService.updateWeeklyGoalPlan).mockResolvedValue({
      id: WPLAN_ID,
      plan_name: 'Training Split',
    });

    await tools.sparky_manage_goals.execute!(
      {
        action: 'update_weekly_goal_plan',
        plan_name: 'Training Split',
        day_presets: [{ day_of_week: 2, preset_id: PRESET_ID }],
      },
      opts
    );

    expect(weeklyGoalPlanService.updateWeeklyGoalPlan).toHaveBeenCalledWith(
      WPLAN_ID,
      'user-1',
      expect.objectContaining({
        monday_preset_id: null,
        tuesday_preset_id: PRESET_ID,
        wednesday_preset_id: null,
        friday_preset_id: null,
      })
    );
  });

  it('update_weekly_goal_plan validates identifiers, ambiguity, and dates', async () => {
    const noId = await tools.sparky_manage_goals.execute!(
      { action: 'update_weekly_goal_plan', new_name: 'X' },
      opts
    );
    expect(noId).toBe(
      'Error [VALIDATION]: Either plan_id or plan_name must be provided'
    );

    vi.mocked(weeklyGoalPlanService.getWeeklyGoalPlans).mockResolvedValue([
      storedPlan,
      { ...storedPlan, id: WPLAN_ID_2, plan_name: 'training split' },
    ]);
    const ambiguous = await tools.sparky_manage_goals.execute!(
      {
        action: 'update_weekly_goal_plan',
        plan_name: 'Training Split',
        new_name: 'X',
      },
      opts
    );
    expect(ambiguous).toBe(
      'Error [VALIDATION]: Multiple weekly goal plans are named "Training Split" — use plan_id (see get_weekly_goal_plans)'
    );

    vi.mocked(weeklyGoalPlanService.getWeeklyGoalPlans).mockResolvedValue([
      storedPlan,
    ]);
    const inverted = await tools.sparky_manage_goals.execute!(
      {
        action: 'update_weekly_goal_plan',
        plan_id: WPLAN_ID,
        end_date: '2026-08-01',
      },
      opts
    );
    expect(inverted).toBe(
      'Error [VALIDATION]: end_date must be on or after start_date'
    );
    expect(weeklyGoalPlanService.updateWeeklyGoalPlan).not.toHaveBeenCalled();
  });
});
