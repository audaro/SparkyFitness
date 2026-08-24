import { vi, beforeEach, describe, expect, it } from 'vitest';
import { addDays, todayInZone } from '@workspace/shared';
import { buildFoodTools } from '../ai/tools/foodTools.js';
import mealPlanTemplateRepository from '../models/mealPlanTemplateRepository.js';
import foodCoreService from '../services/foodCoreService.js';
import foodEntryService from '../services/foodEntryService.js';
import mealService from '../services/mealService.js';
import mealPlanTemplateService from '../services/mealPlanTemplateService.js';
import preferenceService from '../services/preferenceService.js';
import { searchProviderFoods } from '../services/externalFoodSearchService.js';
import { VALID_PROVIDER_TYPES } from '../constants/foodProviders.js';
import foodRepository from '../models/foodRepository.js';
import foodEntryMealRepository from '../models/foodEntryMealRepository.js';
import mealTypeRepository from '../models/mealType.js';
import measurementRepository from '../models/measurementRepository.js';
import reportRepository from '../models/reportRepository.js';
import externalProviderRepository from '../models/externalProviderRepository.js';
import { ValidationError } from '../utils/errors.js';

vi.mock('../services/foodCoreService', () => ({
  default: {
    createFood: vi.fn(),
    getFoodById: vi.fn(),
    deleteFood: vi.fn(),
    updateFoodEntriesSnapshot: vi.fn(),
    bulkCreateFoodVariants: vi.fn(),
  },
}));
vi.mock('../services/foodEntryService', () => ({
  default: {
    createFoodEntry: vi.fn(),
    getFoodEntriesByDate: vi.fn(),
    getFoodEntriesByDateRange: vi.fn(),
    createFoodEntryMeal: vi.fn(),
    deleteFoodEntry: vi.fn(),
    deleteFoodEntryMeal: vi.fn(),
    updateFoodEntry: vi.fn(),
    updateFoodEntryMeal: vi.fn(),
    moveFoodEntryMealToMealType: vi.fn(),
    getFoodEntryMealMeta: vi.fn(),
    getFoodEntryMealWithComponents: vi.fn(),
    copyFoodEntries: vi.fn(),
    copyAllFoodEntries: vi.fn(),
  },
}));
vi.mock('../services/mealService', () => ({
  default: {
    searchMeals: vi.fn(),
    getMealById: vi.fn(),
    createMealFromDiaryEntries: vi.fn(),
    createMeal: vi.fn(),
    updateMeal: vi.fn(),
  },
}));
vi.mock('../services/mealPlanTemplateService', () => ({
  default: {
    getMealPlanTemplates: vi.fn(),
    createMealPlanTemplate: vi.fn(),
    updateMealPlanTemplate: vi.fn(),
  },
}));
vi.mock('../models/mealPlanTemplateRepository', () => ({
  default: {
    getGroceryListItems: vi.fn(),
  },
}));
vi.mock('../services/preferenceService', () => ({
  default: {
    getUserPreferences: vi.fn(),
  },
}));
vi.mock('../services/externalFoodSearchService', () => ({
  searchProviderFoods: vi.fn(),
}));
vi.mock('../models/foodRepository', () => ({
  default: {
    getFoodsWithPagination: vi.fn(),
    countFoods: vi.fn(),
    getFoodById: vi.fn(),
    getFoodVariantById: vi.fn(),
    updateFoodVariant: vi.fn(),
    getFoodVariantsByFoodId: vi.fn(),
    getRecentFoodEntries: vi.fn(),
    getFoodUsage: vi.fn(),
    getFoodEntryById: vi.fn(),
  },
}));
vi.mock('../models/foodEntryMealRepository', () => ({
  default: {
    getFoodEntryMealsByDate: vi.fn(),
    getFoodEntryMealsByDateRange: vi.fn(),
  },
}));
vi.mock('../models/mealType.js', () => ({
  default: {
    getAllMealTypes: vi.fn(),
    getMealTypeById: vi.fn(),
  },
}));
vi.mock('../models/measurementRepository', () => ({
  default: {
    insertWaterIntakeLog: vi.fn(),
    getWaterIntakeByDate: vi.fn(),
    upsertWaterData: vi.fn(),
    incrementWaterData: vi.fn(),
    getWaterTotalsByDateRange: vi.fn(),
  },
}));
vi.mock('../models/reportRepository', () => ({
  default: {
    getDailyNutritionTotalsRange: vi.fn(),
  },
}));
vi.mock('../models/externalProviderRepository', () => ({
  default: {
    getActiveProvidersByTypes: vi.fn(),
  },
}));
vi.mock('../config/logging', () => ({
  log: vi.fn(),
}));

const opts = { toolCallId: 'tc-1', messages: [] };
const DB_ERROR_TEXT =
  'Error [DB_ERROR]: A database error occurred.\n\nSuggestion: Do NOT retry the same call — it will fail the same way. Tell the user what failed and stop.';

const FOOD_ID = '11111111-1111-4111-8111-111111111111';
const VARIANT_ID = '22222222-2222-4222-8222-222222222222';
const ENTRY_ID = '33333333-3333-4333-8333-333333333333';
const MEAL_ID = '44444444-4444-4444-8444-444444444444';
const FOOD_ID_2 = '55555555-5555-4555-8555-555555555555';
const MEAL_ID_2 = '66666666-6666-4666-8666-666666666666';
const MEAL_TYPE_ID = '66666666-6666-4666-8666-666666666666';

const FOOD_PROVIDER_TYPES = [...VALID_PROVIDER_TYPES];

const eggsRow = {
  id: FOOD_ID,
  name: 'Eggs',
  brand: 'Farm Fresh',
  user_id: 'user-1',
  default_variant: {
    id: VARIANT_ID,
    serving_size: 100,
    serving_unit: 'g',
    calories: 155,
    protein: 13,
    carbs: 1.1,
    fat: 11,
    saturated_fat: 3.3,
    polyunsaturated_fat: null,
    monounsaturated_fat: null,
    trans_fat: null,
    cholesterol: 373,
    sodium: 124,
    potassium: null,
    dietary_fiber: 0,
    sugars: 1.1,
    vitamin_a: null,
    vitamin_c: null,
    calcium: null,
    iron: null,
    glycemic_index: null,
  },
};

// The nutrition snapshot create_meal/update_meal must copy from the resolved
// variant onto each plain-food ingredient row (meal_foods persists these
// caller-supplied values verbatim; missing ones read back as zero-calorie).
const EGGS_SNAPSHOT = {
  serving_size: 100,
  serving_unit: 'g',
  calories: 155,
  protein: 13,
  carbs: 1.1,
  fat: 11,
  saturated_fat: 3.3,
  polyunsaturated_fat: null,
  monounsaturated_fat: null,
  trans_fat: null,
  cholesterol: 373,
  sodium: 124,
  potassium: null,
  dietary_fiber: 0,
  sugars: 1.1,
  vitamin_a: null,
  vitamin_c: null,
  calcium: null,
  iron: null,
  glycemic_index: null,
  custom_nutrients: null,
};

let tools: ReturnType<typeof buildFoodTools>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(preferenceService.getUserPreferences).mockResolvedValue({
    energy_unit: 'kcal',
    water_display_unit: 'ml',
  });
  vi.mocked(foodRepository.getFoodVariantsByFoodId).mockResolvedValue(
    undefined as any
  );
  vi.mocked(mealTypeRepository.getAllMealTypes).mockResolvedValue([
    { id: 'default-id', name: 'Breakfast', sort_order: 1, user_id: null },
    { id: 'lunch-id', name: 'Lunch', sort_order: 2, user_id: null },
    { id: 'dinner-id', name: 'Dinner', sort_order: 3, user_id: null },
    { id: 'snacks-id', name: 'Snacks', sort_order: 4, user_id: null },
    {
      id: MEAL_TYPE_ID,
      name: 'Second breakfast',
      sort_order: 5,
      user_id: 'user-1',
    },
  ]);
  tools = buildFoodTools('user-1', 'UTC');
});

describe('sparky_manage_food validation', () => {
  it('renders zod issues plus a corrective retry example for a missing per-action field', async () => {
    const result = await tools.sparky_manage_food.execute!(
      { action: 'search_food', search_type: 'broad' },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: search_food call was invalid — food_name: Invalid input: expected string, received undefined. Retry sparky_manage_food with all required fields, for example: {"action":"search_food","food_name":"banana","search_type":"broad"}'
    );
  });

  // Regression for the observed small-model failure: create_food with no
  // food_name and a date under the wrong key (source_date). The date is
  // remapped to entry_date and the error carries a copyable retry example
  // that keeps the model's own nutrition values.
  it('remaps a misfiled source_date and returns a retry example preserving provided args', async () => {
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_food',
        unit: 'serving',
        meal_type: 'breakfast',
        calories: 160,
        protein: 1,
        carbs: 16,
        fat: 10,
        source_date: '2026-06-11',
      },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: create_food call was invalid — food_name: Invalid input: expected string, received undefined. Retry sparky_manage_food with all required fields, for example: {"action":"create_food","food_name":"banana","calories":160,"protein":1,"carbs":16,"fat":10,"unit":"serving","meal_type":"breakfast","entry_date":"2026-06-11"}'
    );
  });

  it('drops unrecognized keys that bled in from another action and proceeds', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([
      eggsRow,
    ]);
    vi.mocked(foodRepository.getFoodVariantsByFoodId).mockResolvedValue([
      { id: 'piece-variant', serving_size: 1, serving_unit: 'piece' },
    ]);
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      food_name: 'Eggs',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_name: 'Eggs',
        quantity: 2,
        unit: 'piece',
        meal_type: 'breakfast',
        entry_date: '2026-06-11',
        calories: 155,
      },
      opts
    );

    expect(result).toBe(
      '✅ Logged "Eggs" (2 piece) for Breakfast on 2026-06-11.'
    );
  });

  // entry_time is a real column the web writes, but no tool schema had the
  // field — so every chatbot-logged entry landed with a NULL time and sorted
  // differently in the diary than the same entry made from the web.
  it('persists entry_time when the user states a time', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([
      eggsRow,
    ]);
    vi.mocked(foodRepository.getFoodVariantsByFoodId).mockResolvedValue([
      { id: 'piece-variant', serving_size: 1, serving_unit: 'piece' },
    ]);
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      food_name: 'Eggs',
    });

    await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_name: 'Eggs',
        quantity: 2,
        unit: 'piece',
        meal_type: 'breakfast',
        entry_date: '2026-06-11',
        entry_time: '08:30',
      },
      opts
    );

    expect(foodEntryService.createFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({ entry_time: '08:30' })
    );
  });

  it('leaves entry_time undefined when no time was given', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([
      eggsRow,
    ]);
    vi.mocked(foodRepository.getFoodVariantsByFoodId).mockResolvedValue([
      { id: 'piece-variant', serving_size: 1, serving_unit: 'piece' },
    ]);
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      food_name: 'Eggs',
    });

    await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_name: 'Eggs',
        quantity: 2,
        unit: 'piece',
        meal_type: 'breakfast',
        entry_date: '2026-06-11',
      },
      opts
    );

    expect(foodEntryService.createFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({ entry_time: undefined })
    );
  });
});

describe('list_meal_types', () => {
  it('lists built-in and custom meal types using the REST repository contract', async () => {
    vi.mocked(mealTypeRepository.getAllMealTypes).mockResolvedValue([
      { id: 'default-id', name: 'Breakfast', sort_order: 1, user_id: null },
      {
        id: MEAL_TYPE_ID,
        name: 'Second breakfast',
        sort_order: 2,
        user_id: 'user-1',
      },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'list_meal_types' },
      opts
    );

    expect(result).toBe(
      `[{"id":"default-id","name":"Breakfast","sort_order":1},{"id":"${MEAL_TYPE_ID}","name":"Second breakfast","sort_order":2}]`
    );
  });

  it('filters out meal types with is_visible: false', async () => {
    vi.mocked(mealTypeRepository.getAllMealTypes).mockResolvedValue([
      {
        id: 'default-id',
        name: 'Breakfast',
        sort_order: 1,
        is_visible: true,
        user_id: null,
      },
      {
        id: MEAL_TYPE_ID,
        name: 'Second breakfast',
        sort_order: 2,
        is_visible: true,
        user_id: 'user-1',
      },
      {
        id: 'hidden-id',
        name: 'Hidden meal',
        sort_order: 5,
        is_visible: false,
        user_id: null,
      },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'list_meal_types' },
      opts
    );

    expect(result).toBe(
      `[{"id":"default-id","name":"Breakfast","sort_order":1},{"id":"${MEAL_TYPE_ID}","name":"Second breakfast","sort_order":2}]`
    );
    expect(result).not.toContain('Hidden meal');
  });
});

describe('search_food', () => {
  it('renders broad matches with the default-variant macro line', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([
      eggsRow,
    ]);
    vi.mocked(foodRepository.countFoods).mockResolvedValue(1);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'search_food', food_name: 'egg', search_type: 'broad' },
      opts
    );

    expect(result).toBe(
      `# Food Search: "egg" (broad)\n\n**Eggs** (Farm Fresh)\n  100g: 155 kcal | P: 13g | C: 1.1g | F: 11g\n  ID: ${FOOD_ID} | Variant: ${VARIANT_ID}\n\n---\nShowing 1 of 1 results.`
    );
    expect(foodRepository.getFoodsWithPagination).toHaveBeenCalledWith(
      'egg',
      null,
      'user-1',
      20,
      0,
      null
    );
  });

  it('filters exact matches by case-insensitive name equality in the tool layer', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([
      { ...eggsRow, id: FOOD_ID_2, name: 'Eggs Benedict Mix' },
      { ...eggsRow, name: 'eggs' },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'search_food', food_name: 'Eggs', search_type: 'exact' },
      opts
    );

    expect(result).toBe(
      `# Food Search: "Eggs" (exact)\n\n**eggs** (Farm Fresh)\n  100g: 155 kcal | P: 13g | C: 1.1g | F: 11g\n  ID: ${FOOD_ID} | Variant: ${VARIANT_ID}\n\n---\nShowing 1 of 1 results.`
    );
    expect(foodRepository.getFoodsWithPagination).toHaveBeenCalledWith(
      'Eggs',
      null,
      'user-1',
      500,
      0,
      null
    );
    expect(foodRepository.countFoods).not.toHaveBeenCalled();
  });

  it('renders no results for an empty search', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([]);
    vi.mocked(foodRepository.countFoods).mockResolvedValue(0);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'search_food', food_name: 'nope', search_type: 'broad' },
      opts
    );

    expect(result).toBe(
      '# Food Search: "nope" (broad)\n\nNo results found.\n\n---\nShowing 0 of 0 results.'
    );
  });
});

describe('lookup_food_nutrition', () => {
  it('returns the internal match without touching external providers', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([
      eggsRow,
      { ...eggsRow, id: FOOD_ID_2, name: 'eggs', brand: 'Other Farm' },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'lookup_food_nutrition', food_name: 'Eggs' },
      opts
    );

    expect(result).toBe(
      `### Found match in **internal**:\n**Eggs** (Farm Fresh)\n  Serving Size: 100 g\n  Energy: 155 kcal\n  Macros: Protein: 13g | Carbs: 1.1g | Fat: 11g\n  Details: Fiber: 0g | Sugar: 1.1g | Sodium: 124mg | SatFat: 3.3g\n  Available Serving Units: 100 g\n  ID: ${FOOD_ID}\n\n**Other Alternatives found:**\n- **eggs** (Other Farm) (100g: 155 kcal)`
    );
    expect(searchProviderFoods).not.toHaveBeenCalled();
  });

  // Live failure: "a normal banana" instant-logged as the user's saved
  // "Banana, dried" (own-catalog matches skip the confirmation card). A
  // form qualifier in the match that the query never said must surface an
  // in-band do-not-log warning demanding a sparky_confirm_food card.
  it('warns when the internal match adds a form qualifier the query did not say', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([
      { ...eggsRow, name: 'Banana, dried', brand: null },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'lookup_food_nutrition', food_name: 'banana' },
      opts
    );

    expect(result).toContain(
      '⚠️ Form mismatch: this match is "Banana, dried" but the request said "banana"'
    );
    expect(result).toContain('Do NOT log this match');
    expect(result).toContain('sparky_confirm_food');
  });

  it('does not warn when the query itself named the form qualifier', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([
      { ...eggsRow, name: 'Banana, dried', brand: null },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'lookup_food_nutrition', food_name: 'dried banana' },
      opts
    );

    expect(result).not.toContain('Form mismatch');
  });

  // Same-food descriptors (toasted, raw, fresh...) track the plain food's
  // nutrition; warning on them would teach the model to distrust exact-enough
  // matches like "toast" → "Toasted White Bread".
  it('does not warn on a match whose extra words are not form qualifiers', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([
      { ...eggsRow, name: 'Toasted White Bread', brand: null },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'lookup_food_nutrition', food_name: 'toast' },
      opts
    );

    expect(result).not.toContain('Form mismatch');
  });

  it('cascades through active providers in order and appends OpenFoodFacts', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([]);
    vi.mocked(foodRepository.countFoods).mockResolvedValue(0);
    vi.mocked(
      externalProviderRepository.getActiveProvidersByTypes
    ).mockResolvedValue([
      { id: 'prov-1', provider_type: 'usda', provider_name: 'USDA' },
    ]);
    vi.mocked(searchProviderFoods).mockResolvedValue({
      foods: [],
      pagination: { page: 1, pageSize: 20, totalCount: 0, hasMore: false },
    });

    const result = await tools.sparky_manage_food.execute!(
      { action: 'lookup_food_nutrition', food_name: 'dragonfruit smoothie' },
      opts
    );

    expect(result).toBe(
      'No matches found in internal DB or configured external databases/OpenFoodFacts for "dragonfruit smoothie". You may estimate the nutrition using AI and save it using create_food.'
    );
    expect(
      externalProviderRepository.getActiveProvidersByTypes
    ).toHaveBeenCalledWith('user-1', FOOD_PROVIDER_TYPES);
    expect(searchProviderFoods).toHaveBeenNthCalledWith(
      1,
      'user-1',
      'usda',
      'dragonfruit smoothie',
      { providerId: 'prov-1' }
    );
    expect(searchProviderFoods).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'openfoodfacts',
      'dragonfruit smoothie',
      { providerId: undefined }
    );
  });

  it('renders a provider match with external id and alternatives', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([]);
    vi.mocked(foodRepository.countFoods).mockResolvedValue(0);
    vi.mocked(
      externalProviderRepository.getActiveProvidersByTypes
    ).mockResolvedValue([
      { id: 'prov-1', provider_type: 'usda', provider_name: 'USDA' },
    ]);
    vi.mocked(searchProviderFoods).mockResolvedValue({
      foods: [
        {
          name: 'Apple',
          provider_external_id: '171688',
          default_variant: {
            serving_size: 100,
            serving_unit: 'g',
            calories: 52,
            protein: 0.3,
            carbs: 14,
            fat: 0.2,
            saturated_fat: null,
            dietary_fiber: 2.4,
            sugars: 10,
            sodium: 1,
          },
        },
        {
          name: 'Apple juice',
          default_variant: {
            serving_size: 240,
            serving_unit: 'ml',
            calories: 110,
          },
        },
      ],
      pagination: { page: 1, pageSize: 20, totalCount: 2, hasMore: false },
    });

    const result = await tools.sparky_manage_food.execute!(
      { action: 'lookup_food_nutrition', food_name: 'apple' },
      opts
    );

    expect(result).toBe(
      '### Found match in **usda**:\n**Apple**\n  Serving Size: 100 g\n  Energy: 52 kcal\n  Macros: Protein: 0.3g | Carbs: 14g | Fat: 0.2g\n  Details: Fiber: 2.4g | Sugar: 10g | Sodium: 1mg | SatFat: 0g\n  Available Serving Units: 100 g\n  External ID: 171688\n\n**Other Alternatives found:**\n- **Apple juice** (240ml: 110 kcal)\n\nNote: this external result is not saved in the food database yet. To save and log it in one step, call sparky_manage_food with: {"action":"log_external_food","food_name":"Apple","external_id":"171688","quantity":1,"meal_type":"<breakfast|lunch|dinner|snacks>"} (adjust quantity and meal_type). Do NOT pass the External ID as food_id.'
    );
  });

  it('continues past a failing provider to the next one', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([]);
    vi.mocked(foodRepository.countFoods).mockResolvedValue(0);
    vi.mocked(
      externalProviderRepository.getActiveProvidersByTypes
    ).mockResolvedValue([
      { id: 'prov-1', provider_type: 'fatsecret', provider_name: 'FatSecret' },
    ]);
    vi.mocked(searchProviderFoods)
      .mockRejectedValueOnce(new Error('provider exploded'))
      .mockResolvedValueOnce({
        foods: [
          {
            name: 'Apple',
            default_variant: {
              serving_size: 100,
              serving_unit: 'g',
              calories: 52,
              protein: 0.3,
              carbs: 14,
              fat: 0.2,
            },
          },
        ],
        pagination: { page: 1, pageSize: 20, totalCount: 1, hasMore: false },
      });

    const result = await tools.sparky_manage_food.execute!(
      { action: 'lookup_food_nutrition', food_name: 'apple' },
      opts
    );

    expect(result).toBe(
      '### Found match in **openfoodfacts**:\n**Apple**\n  Serving Size: 100 g\n  Energy: 52 kcal\n  Macros: Protein: 0.3g | Carbs: 14g | Fat: 0.2g\n  Available Serving Units: 100 g\n\nNote: this external result is not saved in the food database yet. To save and log it in one step, call sparky_manage_food with: {"action":"log_external_food","food_name":"Apple","quantity":1,"meal_type":"<breakfast|lunch|dinner|snacks>"} (adjust quantity and meal_type). Do NOT pass the External ID as food_id.'
    );
  });

  // Providers (USDA especially) rank branded snack products above the plain
  // whole food a user almost always means. The cascade re-ranks so the whole
  // food becomes the primary match and the branded item drops to alternatives.
  it('ranks the whole food ahead of a branded product with the same name', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([]);
    vi.mocked(foodRepository.countFoods).mockResolvedValue(0);
    vi.mocked(
      externalProviderRepository.getActiveProvidersByTypes
    ).mockResolvedValue([
      { id: 'prov-1', provider_type: 'usda', provider_name: 'USDA' },
    ]);
    vi.mocked(searchProviderFoods).mockResolvedValue({
      foods: [
        {
          name: 'BANANA',
          brand: "BETTER'N PEANUT BUTTER",
          provider_external_id: '2012128',
          default_variant: {
            serving_size: 32,
            serving_unit: 'g',
            calories: 100,
            protein: 4,
            carbs: 13,
            fat: 2,
          },
        },
        {
          name: 'Banana, raw',
          provider_external_id: '1105073',
          default_variant: {
            serving_size: 100,
            serving_unit: 'g',
            calories: 89,
            protein: 1.1,
            carbs: 23,
            fat: 0.3,
          },
        },
      ],
      pagination: { page: 1, pageSize: 20, totalCount: 2, hasMore: false },
    });

    const result = await tools.sparky_manage_food.execute!(
      { action: 'lookup_food_nutrition', food_name: 'banana' },
      opts
    );

    // Whole food is the headline match; the branded product is demoted.
    expect(result).toContain('### Found match in **usda**:\n**Banana, raw**');
    expect(result).toContain('External ID: 1105073');
    expect(result).toContain("**BANANA** (BETTER'N PEANUT BUTTER)");
    // And the copyable log example points at the whole food.
    expect(result).toContain(
      '"food_name":"Banana, raw","external_id":"1105073"'
    );
  });

  // A provider default variant with an implausible serving unit (a food
  // portion in milligrams) is skipped in favor of a sane one.
  it('skips an implausible mg serving variant when displaying a match', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([]);
    vi.mocked(foodRepository.countFoods).mockResolvedValue(0);
    vi.mocked(
      externalProviderRepository.getActiveProvidersByTypes
    ).mockResolvedValue([
      { id: 'prov-1', provider_type: 'usda', provider_name: 'USDA' },
    ]);
    vi.mocked(searchProviderFoods).mockResolvedValue({
      foods: [
        {
          name: 'Egg, whole',
          provider_external_id: '748967',
          default_variant: {
            serving_size: 28,
            serving_unit: 'mg',
            calories: 0,
            protein: 0,
            carbs: 0,
            fat: 0,
            is_default: true,
          },
          variants: [
            {
              serving_size: 28,
              serving_unit: 'mg',
              calories: 0,
              protein: 0,
              carbs: 0,
              fat: 0,
              is_default: true,
            },
            {
              serving_size: 100,
              serving_unit: 'g',
              calories: 148,
              protein: 13,
              carbs: 1,
              fat: 10,
              is_default: false,
            },
          ],
        },
      ],
      pagination: { page: 1, pageSize: 20, totalCount: 1, hasMore: false },
    });

    const result = await tools.sparky_manage_food.execute!(
      { action: 'lookup_food_nutrition', food_name: 'egg' },
      opts
    );

    expect(result).toContain('Serving Size: 100 g');
    expect(result).toContain('Energy: 148 kcal');
    expect(result).not.toContain('28 mg');
  });

  it('falls through to ai_estimate when an explicitly requested provider is unconfigured', async () => {
    vi.mocked(
      externalProviderRepository.getActiveProvidersByTypes
    ).mockResolvedValue([]);
    vi.mocked(searchProviderFoods).mockRejectedValue(
      new Error('Missing providerId query parameter')
    );

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'lookup_food_nutrition',
        food_name: 'apple',
        provider_type: 'usda',
      },
      opts
    );

    expect(result).toBe(
      'No matches found in internal DB or configured external databases/OpenFoodFacts for "apple". You may estimate the nutrition using AI and save it using create_food.'
    );
    // Explicit provider bypasses the internal search entirely.
    expect(foodRepository.getFoodsWithPagination).not.toHaveBeenCalled();
    expect(searchProviderFoods).toHaveBeenCalledTimes(1);
    expect(searchProviderFoods).toHaveBeenCalledWith(
      'user-1',
      'usda',
      'apple',
      { providerId: undefined }
    );
  });

  it('returns a DB error for an explicit internal miss (MCP quirk)', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([]);
    vi.mocked(foodRepository.countFoods).mockResolvedValue(0);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'lookup_food_nutrition',
        food_name: 'nope',
        provider_type: 'internal',
      },
      opts
    );

    expect(result).toBe(DB_ERROR_TEXT);
    expect(searchProviderFoods).not.toHaveBeenCalled();
  });

  it('supports explicit provider_type: "swissfood" in lookup_food_nutrition', async () => {
    vi.mocked(
      externalProviderRepository.getActiveProvidersByTypes
    ).mockResolvedValue([
      {
        id: 'prov-swiss',
        provider_type: 'swissfood',
        provider_name: 'Swiss Food DB',
      },
    ]);
    vi.mocked(searchProviderFoods).mockResolvedValue({
      foods: [
        {
          name: 'Appenzeller Cheese',
          provider_external_id: 'swiss-101',
          default_variant: {
            serving_size: 100,
            serving_unit: 'g',
            calories: 395,
            protein: 25,
            carbs: 0,
            fat: 32,
          },
        },
      ],
      pagination: { page: 1, pageSize: 20, totalCount: 1, hasMore: false },
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'lookup_food_nutrition',
        food_name: 'Appenzeller',
        provider_type: 'swissfood',
      },
      opts
    );

    expect(result).toContain('Found match in **swissfood**');
    expect(result).toContain('Appenzeller Cheese');
    expect(searchProviderFoods).toHaveBeenCalledWith(
      'user-1',
      'swissfood',
      'Appenzeller',
      { providerId: 'prov-swiss' }
    );
  });
});

describe('log_food', () => {
  it('reports the legacy meal_type name when resolution fails', async () => {
    vi.mocked(mealTypeRepository.getAllMealTypes).mockResolvedValue([]);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_name: 'Eggs',
        quantity: 1,
        unit: 'serving',
        meal_type: 'breakfast',
      },
      opts
    );

    expect(result).toContain('Meal type "breakfast" was not found');
    expect(result).not.toContain('Meal type "undefined"');
    expect(foodEntryService.createFoodEntry).not.toHaveBeenCalled();
  });

  // The legacy meal_type fallback must only resolve to system defaults
  // (user_id IS NULL). A user-defined type may share a name with a system
  // default (uniqueness is per (name, user_id)); custom types are selected
  // exclusively through meal_type_id.
  it('resolves legacy meal_type only to system defaults, not same-named custom types', async () => {
    vi.mocked(mealTypeRepository.getAllMealTypes).mockResolvedValue([
      {
        id: 'custom-breakfast-id',
        name: 'Breakfast',
        sort_order: 0,
        user_id: 'user-1',
      },
      { id: 'default-id', name: 'Breakfast', sort_order: 1, user_id: null },
    ]);
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([
      {
        ...eggsRow,
        name: 'eggs',
        default_variant: {
          ...eggsRow.default_variant,
          serving_size: 1,
          serving_unit: 'serving',
        },
      },
    ]);
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'eggs',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_name: 'Eggs',
        quantity: 1,
        unit: 'serving',
        meal_type: 'breakfast',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      '✅ Logged "eggs" (1 serving) for Breakfast on 2026-06-10.'
    );
    expect(foodEntryService.createFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({ meal_type_id: 'default-id' })
    );
  });

  it('logs to a custom meal type by ID and gives the ID precedence over the legacy name', async () => {
    vi.mocked(mealTypeRepository.getMealTypeById).mockResolvedValue({
      id: MEAL_TYPE_ID,
      name: 'Second breakfast',
    });
    vi.mocked(foodRepository.getFoodById).mockResolvedValue(eggsRow);
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'Eggs',
    });

    // meal_type is deliberately NOT a built-in enum value: when a valid
    // meal_type_id is supplied, the name must be dropped before the strict
    // parse instead of failing the enum ("meal_type_id always wins").
    const result = await tools.sparky_manage_food.execute!(
      {
        food_id: FOOD_ID,
        quantity: 1,
        meal_type_id: MEAL_TYPE_ID,
        meal_type: 'midnight snack',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      '✅ Logged "Eggs" (1 g) for Second breakfast on 2026-06-10.'
    );
    expect(foodEntryService.createFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({
        meal_type_id: MEAL_TYPE_ID,
      })
    );
    expect(foodEntryService.createFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.not.objectContaining({ meal_type: expect.anything() })
    );
  });

  it('resolves the food by exact name and logs with the default variant', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([
      {
        ...eggsRow,
        name: 'eggs',
        default_variant: {
          ...eggsRow.default_variant,
          serving_size: 1,
          serving_unit: 'serving',
        },
      },
    ]);
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'eggs',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_name: 'Eggs',
        quantity: 2,
        unit: 'serving',
        meal_type: 'breakfast',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      '✅ Logged "eggs" (2 serving) for Breakfast on 2026-06-10.'
    );
    expect(foodEntryService.createFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      {
        user_id: 'user-1',
        food_id: FOOD_ID,
        variant_id: VARIANT_ID,
        entry_date: '2026-06-10',
        quantity: 2,
        unit: 'serving',
        meal_type_id: 'default-id',
      }
    );
  });

  // Live failure: "0.25 pound" of brie logged against a 100 g variant stored
  // unit "pound" verbatim, so the diary math (quantity / serving_size) showed
  // 1 kcal. Same-dimension units must convert into the variant's own unit.
  it('converts a pound quantity into grams against a gram-denominated variant', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([
      eggsRow,
    ]);
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'Eggs',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_name: 'Eggs',
        quantity: 0.25,
        unit: 'pound',
        meal_type: 'dinner',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      '✅ Logged "Eggs" (113.398 g) for Dinner on 2026-06-10.'
    );
    expect(foodEntryService.createFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({
        quantity: 113.398,
        unit: 'g',
        variant_id: VARIANT_ID,
      })
    );
  });

  it('points to lookup + log_external_food when no food matches the name', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([]);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_name: 'Unicorn Steak',
        quantity: 1,
        unit: 'serving',
        meal_type: 'dinner',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: Food "Unicorn Steak" not found in the database. Call lookup_food_nutrition first to search external providers, for example: {"action":"lookup_food_nutrition","food_name":"Unicorn Steak"}. If it returns an external match, log it with log_external_food; otherwise call create_food with estimated macros.'
    );
    expect(foodEntryService.createFoodEntry).not.toHaveBeenCalled();
  });

  // Regression: models paste a lookup result's provider "External ID" (e.g. a
  // USDA FDC id like '2058078') into food_id. That must fall back to name
  // resolution, not blow up on UUID validation.
  it('ignores a non-UUID food_id (provider External ID) and resolves by name', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([
      eggsRow,
    ]);
    vi.mocked(foodRepository.getFoodVariantsByFoodId).mockResolvedValue([
      { id: 'serving-variant', serving_size: 1, serving_unit: 'serving' },
    ]);
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'Eggs',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_name: 'Eggs',
        food_id: '2058078',
        quantity: 2,
        unit: 'serving',
        meal_type: 'breakfast',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      '✅ Logged "Eggs" (2 serving) for Breakfast on 2026-06-10.'
    );
    expect(foodEntryService.createFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({ food_id: FOOD_ID })
    );
  });

  it('returns a chat-visible correction for a non-UUID food_id without a food_name', async () => {
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'delete_food',
        food_id: '2058078',
      },
      opts
    );

    expect(result).toBe(
      "Error [VALIDATION]: food_id '2058078' is not an internal food UUID — External IDs from lookup_food_nutrition results cannot be logged directly. Retry with log_external_food, passing the food_name (and optionally external_id '2058078') plus quantity and meal_type."
    );
    expect(foodEntryService.createFoodEntry).not.toHaveBeenCalled();
  });

  // Regression: after a lookup returns an internal ID, models log with just
  // (food_id, quantity, meal_type). unit must default to the food's serving
  // unit and entry_date to today — requiring them dead-ended small models.
  it('logs with only food_id/quantity/meal_type, defaulting unit and date', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue(eggsRow);
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'Eggs',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_id: FOOD_ID,
        quantity: 1,
        meal_type: 'breakfast',
      },
      opts
    );

    const today = todayInZone('UTC');
    expect(result).toBe(
      `✅ Logged "Eggs" (1 ${eggsRow.default_variant.serving_unit}) for Breakfast on ${today}.`
    );
    expect(foodEntryService.createFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({
        food_id: FOOD_ID,
        variant_id: VARIANT_ID,
        unit: eggsRow.default_variant.serving_unit,
        entry_date: today,
      })
    );
  });

  it('logs with only food_id/meal_type, defaulting quantity, unit, and date', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue(eggsRow);
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'Eggs',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_id: FOOD_ID,
        meal_type: 'breakfast',
      },
      opts
    );

    const today = todayInZone('UTC');
    expect(result).toBe(
      `✅ Logged "Eggs" (1 ${eggsRow.default_variant.serving_unit}) for Breakfast on ${today}.`
    );
    expect(foodEntryService.createFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({
        food_id: FOOD_ID,
        variant_id: VARIANT_ID,
        quantity: 1,
        unit: eggsRow.default_variant.serving_unit,
        entry_date: today,
      })
    );
  });

  // A no-action call shaped like a log (food_id + quantity + meal_type) must
  // infer log_food — it used to fall through to the bare-food_id branch and
  // infer delete_food.
  it('infers log_food (not delete_food) for food_id + quantity + meal_type without action', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue(eggsRow);
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'Eggs',
    });

    const result = await tools.sparky_manage_food.execute!(
      { food_id: FOOD_ID, quantity: 2, meal_type: 'lunch' },
      opts
    );

    expect(result).toContain('✅ Logged "Eggs"');
    expect(foodEntryService.createFoodEntry).toHaveBeenCalled();
  });

  it('uses an explicit food_id and resolves its default variant', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue(eggsRow);
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'Eggs',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_name: 'Eggs',
        food_id: FOOD_ID,
        quantity: 100,
        unit: 'g',
        meal_type: 'lunch',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe('✅ Logged "Eggs" (100 g) for Lunch on 2026-06-10.');
    expect(foodRepository.getFoodsWithPagination).not.toHaveBeenCalled();
    expect(foodRepository.getFoodById).toHaveBeenCalledWith(FOOD_ID, 'user-1');
  });

  it('uses a matching unit variant instead of the default to avoid over-scaling calories', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue({
      ...eggsRow,
      default_variant: {
        ...eggsRow.default_variant,
        id: 'serving-variant',
        serving_size: 1,
        serving_unit: 'serving',
      },
    });
    vi.mocked(foodRepository.getFoodVariantsByFoodId).mockResolvedValue([
      {
        ...eggsRow.default_variant,
        id: 'serving-variant',
        serving_size: 1,
        serving_unit: 'serving',
      },
      {
        ...eggsRow.default_variant,
        id: 'grams-variant',
        serving_size: 100,
        serving_unit: 'g',
      },
    ]);
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'Eggs',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_name: 'Eggs',
        food_id: FOOD_ID,
        quantity: 100,
        unit: 'g',
        meal_type: 'lunch',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe('✅ Logged "Eggs" (100 g) for Lunch on 2026-06-10.');
    expect(foodEntryService.createFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({
        variant_id: 'grams-variant',
        quantity: 100,
        unit: 'g',
      })
    );
  });

  it('matches plural count and volume units to singular variant units', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue({
      ...eggsRow,
      default_variant: {
        ...eggsRow.default_variant,
        id: 'cup-variant',
        serving_size: 1,
        serving_unit: 'cup',
      },
    });
    vi.mocked(foodRepository.getFoodVariantsByFoodId).mockResolvedValue([
      {
        ...eggsRow.default_variant,
        id: 'piece-variant',
        serving_size: 1,
        serving_unit: 'piece',
      },
      {
        ...eggsRow.default_variant,
        id: 'cup-variant',
        serving_size: 1,
        serving_unit: 'cup',
      },
    ]);
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'Eggs',
    });

    const pieceResult = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_name: 'Eggs',
        food_id: FOOD_ID,
        quantity: 2,
        unit: 'pieces',
        meal_type: 'lunch',
        entry_date: '2026-06-10',
      },
      opts
    );
    const cupResult = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_name: 'Eggs',
        food_id: FOOD_ID,
        quantity: 1,
        unit: 'cups',
        meal_type: 'lunch',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(pieceResult).toBe(
      '✅ Logged "Eggs" (2 piece) for Lunch on 2026-06-10.'
    );
    expect(cupResult).toBe('✅ Logged "Eggs" (1 cup) for Lunch on 2026-06-10.');
    expect(foodEntryService.createFoodEntry).toHaveBeenNthCalledWith(
      1,
      'user-1',
      'user-1',
      expect.objectContaining({
        variant_id: 'piece-variant',
        quantity: 2,
        unit: 'piece',
      })
    );
    expect(foodEntryService.createFoodEntry).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'user-1',
      expect.objectContaining({
        variant_id: 'cup-variant',
        quantity: 1,
        unit: 'cup',
      })
    );
  });

  it('rejects mismatched units when no matching variant is available', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue({
      ...eggsRow,
      default_variant: {
        ...eggsRow.default_variant,
        serving_size: 1,
        serving_unit: 'serving',
      },
    });
    vi.mocked(foodRepository.getFoodVariantsByFoodId).mockResolvedValue([]);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_name: 'Eggs',
        food_id: FOOD_ID,
        quantity: 100,
        unit: 'g',
        meal_type: 'lunch',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      "Error [VALIDATION]: Cannot safely log 100 g for this food because no matching serving variant is available. This food's serving variants: 1 serving. Convert the amount to one of those units and log again, or ask the user."
    );
    expect(foodEntryService.createFoodEntry).not.toHaveBeenCalled();
  });

  // The live failure this guards: "3 whole" eggs against a food whose only
  // variant is 100 g. Without the variant list in the error, the model has no
  // way to self-correct mid-turn and has been seen narrating the item as
  // logged anyway.
  it('names the available variants when rejecting a unit mismatch', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue({
      ...eggsRow,
      default_variant: {
        ...eggsRow.default_variant,
        serving_size: 100,
        serving_unit: 'g',
      },
    });
    vi.mocked(foodRepository.getFoodVariantsByFoodId).mockResolvedValue([]);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_name: 'Eggs',
        food_id: FOOD_ID,
        quantity: 3,
        unit: 'whole',
        meal_type: 'dinner',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      "Error [VALIDATION]: Cannot safely log 3 whole for this food because no matching serving variant is available. This food's serving variants: 100 g. Convert the amount to one of those units and log again, or ask the user."
    );
    expect(foodEntryService.createFoodEntry).not.toHaveBeenCalled();
  });

  // Live failure this block guards: a reply's "1,008 kcal" total leaked into
  // the quantity field and 1008 slices of cheese (~110,000 kcal) were logged
  // without complaint. Counted units cap at 100; measurable at 10 kg / 10 L.
  // The guard judges the EFFECTIVE (quantity, unit) after variant resolution
  // and serving conversion, not the requested pair.
  it('refuses an absurd count-unit quantity after variant resolution', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue({
      ...eggsRow,
      name: 'Cheese',
      default_variant: {
        ...eggsRow.default_variant,
        serving_size: 1,
        serving_unit: 'slice',
      },
    });
    vi.mocked(foodRepository.getFoodVariantsByFoodId).mockResolvedValue([]);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_id: FOOD_ID,
        quantity: 1008,
        unit: 'slice',
        meal_type: 'breakfast',
      },
      opts
    );

    expect(result).toContain('Error [VALIDATION]: Refusing to log 1008 slice');
    expect(foodEntryService.createFoodEntry).not.toHaveBeenCalled();
  });

  it('refuses a measurable quantity above the 10 kg ceiling', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue({
      ...eggsRow,
      default_variant: {
        ...eggsRow.default_variant,
        serving_size: 100,
        serving_unit: 'g',
      },
    });
    vi.mocked(foodRepository.getFoodVariantsByFoodId).mockResolvedValue([]);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_id: FOOD_ID,
        quantity: 12000,
        unit: 'g',
        meal_type: 'breakfast',
      },
      opts
    );

    expect(result).toContain('Error [VALIDATION]: Refusing to log 12000 g');
    expect(foodEntryService.createFoodEntry).not.toHaveBeenCalled();
  });

  // The reviewer-caught regression: an omitted unit resolves to the variant's
  // own unit, so "quantity: 500" against a gram variant is 500 g — a fine
  // amount that a requested-pair guard would have refused as 500 counts.
  it('accepts a large gram amount even when the unit is omitted', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue({
      ...eggsRow,
      default_variant: {
        ...eggsRow.default_variant,
        serving_size: 100,
        serving_unit: 'g',
      },
    });
    vi.mocked(foodRepository.getFoodVariantsByFoodId).mockResolvedValue([]);
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'Eggs',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_id: FOOD_ID,
        quantity: 500,
        meal_type: 'breakfast',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      '✅ Logged "Eggs" (500 g) for Breakfast on 2026-06-10.'
    );
  });

  it('judges a unit-less update against the entry’s own stored unit', async () => {
    vi.mocked(foodRepository.getFoodEntryById).mockResolvedValue({
      id: ENTRY_ID,
      quantity: 2,
      unit: 'slice',
    });

    const refused = await tools.sparky_manage_food.execute!(
      {
        action: 'update_entry',
        entry_id: ENTRY_ID,
        entry_type: 'food_entry',
        quantity: 1008,
      },
      opts
    );
    expect(refused).toContain('Error [VALIDATION]: Refusing to log 1008');
    expect(foodEntryService.updateFoodEntry).not.toHaveBeenCalled();

    vi.mocked(foodRepository.getFoodEntryById).mockResolvedValue({
      id: ENTRY_ID,
      quantity: 100,
      unit: 'g',
    });
    vi.mocked(foodEntryService.updateFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    const accepted = await tools.sparky_manage_food.execute!(
      {
        action: 'update_entry',
        entry_id: ENTRY_ID,
        entry_type: 'food_entry',
        quantity: 500,
      },
      opts
    );
    expect(accepted).not.toContain('Refusing to log');
    expect(foodEntryService.updateFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      ENTRY_ID,
      { quantity: 500, unit: undefined }
    );
  });

  it('refuses an absurd requested count on log_external_food before the lookup', async () => {
    const logged = await tools.sparky_manage_food.execute!(
      {
        action: 'log_external_food',
        food_name: 'Cheese Slices',
        quantity: 500,
        unit: 'slice',
        meal_type: 'snacks',
      },
      opts
    );
    expect(logged).toContain('Error [VALIDATION]: Refusing to log 500 slice');
    expect(foodEntryService.createFoodEntry).not.toHaveBeenCalled();
  });

  // The reviewer-caught gap: 100 servings passes the requested-pair check
  // (100 is exactly the count ceiling), then serving conversion multiplies by
  // the variant's serving_size and 50 kg reaches the write. The effective
  // pair must be re-validated after conversion.
  it('refuses a serving count that converts past the measurable ceiling', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([
      {
        ...eggsRow,
        default_variant: {
          ...eggsRow.default_variant,
          serving_size: 500,
          serving_unit: 'g',
        },
      },
    ]);
    vi.mocked(foodRepository.getFoodVariantsByFoodId).mockResolvedValue([]);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_external_food',
        food_name: 'Eggs',
        quantity: 100,
        unit: 'serving',
        meal_type: 'snacks',
      },
      opts
    );

    expect(result).toContain('Error [VALIDATION]: Refusing to log 50000 g');
    expect(foodEntryService.createFoodEntry).not.toHaveBeenCalled();
  });

  it('refuses an absurd quantity on create_food before saving the food', async () => {
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_food',
        food_name: 'Cheese Slice',
        calories: 109,
        protein: 7,
        carbs: 0,
        fat: 9,
        quantity: 1008,
        unit: 'slice',
        meal_type: 'breakfast',
      },
      opts
    );

    expect(result).toContain('Error [VALIDATION]: Refusing to log 1008 slice');
    expect(foodCoreService.createFood).not.toHaveBeenCalled();
  });

  it('maps a snapshotting failure to a validation error with the service message', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue(eggsRow);
    vi.mocked(foodEntryService.createFoodEntry).mockRejectedValue(
      new Error('Food or variant not found for snapshotting.')
    );

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_food',
        food_name: 'Eggs',
        food_id: FOOD_ID,
        quantity: 1,
        unit: 'g',
        meal_type: 'lunch',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: Food or variant not found for snapshotting.'
    );
  });
});

describe('log_external_food', () => {
  const usdaApple = {
    name: 'Apple',
    brand: 'USDA',
    provider_external_id: '171688',
    default_variant: {
      serving_size: 100,
      serving_unit: 'g',
      calories: 52,
      protein: 0.3,
      carbs: 14,
      fat: 0.2,
      saturated_fat: null,
      dietary_fiber: 2.4,
      sugars: 10,
      sodium: 1,
    },
  };

  function mockUsdaLookup(foods: unknown[]) {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([]);
    vi.mocked(foodRepository.countFoods).mockResolvedValue(0);
    vi.mocked(
      externalProviderRepository.getActiveProvidersByTypes
    ).mockResolvedValue([
      { id: 'prov-1', provider_type: 'usda', provider_name: 'USDA' },
    ]);
    vi.mocked(searchProviderFoods).mockResolvedValue({
      foods,
      pagination: {
        page: 1,
        pageSize: 20,
        totalCount: foods.length,
        hasMore: false,
      },
    });
  }

  // Regression: the cascade ordered providers purely by the repository's
  // sort_order/created_at, ignoring default_food_data_provider_id. With
  // sort_order NULL (the common case) the newest provider won every lookup and
  // the user's chosen default provider had no effect on chat/MCP results.
  it('queries the user default food provider before the others', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([]);
    vi.mocked(foodRepository.countFoods).mockResolvedValue(0);
    vi.mocked(preferenceService.getUserPreferences).mockResolvedValue({
      energy_unit: 'kcal',
      water_display_unit: 'ml',
      default_food_data_provider_id: 'prov-off',
    });
    // Repository order puts fatsecret first, as an unset sort_order would.
    vi.mocked(
      externalProviderRepository.getActiveProvidersByTypes
    ).mockResolvedValue([
      { id: 'prov-fs', provider_type: 'fatsecret', provider_name: 'FatSecret' },
      {
        id: 'prov-off',
        provider_type: 'openfoodfacts',
        provider_name: 'OpenFoodFacts',
      },
    ]);
    vi.mocked(searchProviderFoods).mockResolvedValue({
      foods: [usdaApple],
      pagination: { page: 1, pageSize: 20, totalCount: 1, hasMore: false },
    });

    await tools.sparky_manage_food.execute!(
      { action: 'lookup_food_nutrition', food_name: 'Apple' },
      opts
    );

    // The default provider is consulted first; the cascade stops on its hit,
    // so fatsecret is never queried at all.
    expect(searchProviderFoods).toHaveBeenCalledTimes(1);
    expect(searchProviderFoods).toHaveBeenCalledWith(
      'user-1',
      'openfoodfacts',
      'Apple',
      { providerId: 'prov-off' }
    );
  });

  // Regression: the createFood payload here is hand-enumerated, so the
  // provider photo was dropped and foods logged through the assistant/MCP
  // arrived without the image the same food gets when added from the web UI.
  it('carries the provider image through to createFood', async () => {
    mockUsdaLookup([
      {
        ...usdaApple,
        image_url: 'https://images.example.com/apple-400.jpg',
        image_source_url: 'https://images.example.com/apple-full.jpg',
      },
    ]);
    vi.mocked(foodCoreService.createFood).mockResolvedValue({
      id: FOOD_ID,
      name: 'Apple',
      default_variant: {
        id: VARIANT_ID,
        serving_size: 100,
        serving_unit: 'g',
        calories: 52,
      },
    });
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'Apple',
    });

    await tools.sparky_manage_food.execute!(
      {
        action: 'log_external_food',
        food_name: 'Apple',
        external_id: '171688',
        quantity: 1,
        meal_type: 'breakfast',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(foodCoreService.createFood).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        image_url: 'https://images.example.com/apple-400.jpg',
        image_source_url: 'https://images.example.com/apple-full.jpg',
      })
    );
  });

  it('re-fetches the provider match, saves it with full nutrition, and logs it', async () => {
    mockUsdaLookup([usdaApple]);
    vi.mocked(foodCoreService.createFood).mockResolvedValue({
      id: FOOD_ID,
      name: 'Apple',
      default_variant: {
        id: VARIANT_ID,
        serving_size: 100,
        serving_unit: 'g',
        calories: 52,
      },
    });
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'Apple',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_external_food',
        food_name: 'Apple',
        external_id: '171688',
        quantity: 2,
        meal_type: 'breakfast',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      '✅ Saved "Apple" from usda (52 kcal per 100g) and logged 200 g to Breakfast on 2026-06-10.'
    );
    expect(foodCoreService.createFood).toHaveBeenCalledWith('user-1', {
      user_id: 'user-1',
      name: 'Apple',
      brand: 'USDA',
      serving_size: 100,
      serving_unit: 'g',
      calories: 52,
      protein: 0.3,
      carbs: 14,
      fat: 0.2,
      saturated_fat: null,
      polyunsaturated_fat: null,
      monounsaturated_fat: null,
      trans_fat: null,
      cholesterol: null,
      sodium: 1,
      potassium: null,
      dietary_fiber: 2.4,
      sugars: 10,
      vitamin_a: null,
      vitamin_c: null,
      calcium: null,
      iron: null,
      glycemic_index: null,
      // food_variants.source has a CHECK constraint (manual|ai_estimate|
      // imported); passing the provider name here rolled back the whole insert
      // with an opaque DB error. The provider identity lives on the food.
      source: 'imported',
      provider_type: 'usda',
      provider_external_id: '171688',
      image_url: null,
      image_source_url: null,
    });
    expect(foodEntryService.createFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      {
        user_id: 'user-1',
        food_id: FOOD_ID,
        variant_id: VARIANT_ID,
        entry_date: '2026-06-10',
        quantity: 200,
        unit: 'g',
        meal_type_id: 'default-id',
      }
    );
  });

  it('supports logging a food from swissfood provider', async () => {
    const swissCheese = {
      name: 'Appenzeller Cheese',
      provider_external_id: 'swiss-101',
      default_variant: {
        serving_size: 100,
        serving_unit: 'g',
        calories: 395,
        protein: 25,
        carbs: 0,
        fat: 32,
      },
    };
    vi.mocked(
      externalProviderRepository.getActiveProvidersByTypes
    ).mockResolvedValue([
      {
        id: 'prov-swiss',
        provider_type: 'swissfood',
        provider_name: 'Swiss Food DB',
      },
    ]);
    vi.mocked(searchProviderFoods).mockResolvedValue({
      foods: [swissCheese],
      pagination: { page: 1, pageSize: 20, totalCount: 1, hasMore: false },
    });
    vi.mocked(foodCoreService.createFood).mockResolvedValue({
      id: FOOD_ID,
      name: 'Appenzeller Cheese',
      default_variant: {
        id: VARIANT_ID,
        serving_size: 100,
        serving_unit: 'g',
        calories: 395,
      },
    });
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'Appenzeller Cheese',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_external_food',
        food_name: 'Appenzeller Cheese',
        provider_type: 'swissfood',
        quantity: 1,
        unit: 'g',
        meal_type: 'snacks',
        entry_date: '2026-08-10',
      },
      opts
    );

    expect(result).toContain('Saved "Appenzeller Cheese" from swissfood');
    expect(foodCoreService.createFood).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        provider_type: 'swissfood',
        provider_external_id: 'swiss-101',
      })
    );
  });

  // The provider's other serving units are what let a user log "1 fruit"
  // instead of guessing grams. This insert is best-effort (failures are only
  // warned about), so an invalid `source` silently stripped every count unit
  // off external foods — and forced a gram clarification at log time.
  it('saves the provider alternative serving units with a constraint-valid source', async () => {
    const guava = {
      name: 'Guava, raw',
      provider_external_id: '2709238',
      variants: [
        {
          serving_size: 100,
          serving_unit: 'g',
          calories: 68,
          is_default: true,
        },
        { serving_size: 1, serving_unit: 'fruit', calories: 37 },
      ],
    };
    mockUsdaLookup([guava]);
    vi.mocked(foodCoreService.createFood).mockResolvedValue({
      id: FOOD_ID,
      name: 'Guava, raw',
      default_variant: { id: VARIANT_ID, serving_size: 100, serving_unit: 'g' },
    });
    vi.mocked(foodCoreService.bulkCreateFoodVariants).mockResolvedValue([
      { id: 'variant-fruit', serving_size: 1, serving_unit: 'fruit' },
    ]);
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'Guava, raw',
    });

    await tools.sparky_manage_food.execute!(
      {
        action: 'log_external_food',
        food_name: 'Guava, raw',
        external_id: '2709238',
        quantity: 5,
        unit: 'fruit',
        meal_type: 'dinner',
        entry_date: '2026-07-12',
      },
      opts
    );

    expect(foodCoreService.bulkCreateFoodVariants).toHaveBeenCalledWith(
      'user-1',
      [expect.objectContaining({ serving_unit: 'fruit', source: 'imported' })]
    );
  });

  it('pins the exact provider item by external_id among alternatives', async () => {
    const applePie = {
      name: 'Apple pie',
      provider_external_id: '999999',
      default_variant: {
        serving_size: 125,
        serving_unit: 'g',
        calories: 296,
        protein: 2.4,
        carbs: 43,
        fat: 14,
      },
    };
    mockUsdaLookup([usdaApple, applePie]);
    vi.mocked(foodCoreService.createFood).mockResolvedValue({
      id: FOOD_ID_2,
      name: 'Apple pie',
      default_variant: {
        id: VARIANT_ID,
        serving_size: 125,
        serving_unit: 'g',
        calories: 296,
      },
    });
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'Apple pie',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_external_food',
        food_name: 'Apple',
        external_id: '999999',
        meal_type: 'snacks',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      '✅ Saved "Apple pie" from usda (296 kcal per 125g) and logged 125 g to Snacks on 2026-06-10.'
    );
    expect(foodCoreService.createFood).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ name: 'Apple pie', calories: 296 })
    );
  });

  it('logs directly without creating a food when the lookup resolves internally', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([
      eggsRow,
    ]);
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'Eggs',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_external_food',
        food_name: 'Eggs',
        quantity: 2,
        meal_type: 'breakfast',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      '✅ "Eggs" was already in the food database — logged 200 g for Breakfast on 2026-06-10.'
    );
    expect(foodCoreService.createFood).not.toHaveBeenCalled();
    expect(foodEntryService.createFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({ food_id: FOOD_ID, variant_id: VARIANT_ID })
    );
  });

  it('falls back to a create_food suggestion when nothing matches anywhere', async () => {
    mockUsdaLookup([]);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_external_food',
        food_name: 'dragonfruit smoothie',
        meal_type: 'snacks',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: No external match found for "dragonfruit smoothie". Please estimate the nutrition yourself and call create_food (include meal_type_id (or meal_type) and entry_date to save and log in one step), for example: {"action":"create_food","food_name":"dragonfruit smoothie","calories":300,"protein":15,"carbs":40,"fat":5,"meal_type":"snacks","entry_date":"2026-06-10"}'
    );
    expect(foodCoreService.createFood).not.toHaveBeenCalled();
    expect(foodEntryService.createFoodEntry).not.toHaveBeenCalled();
  });

  // Regression: a custom meal_type_id must survive into the retry example so
  // the model is not steered back to a built-in category (issue #1959).
  it('keeps a custom meal_type_id in the create_food retry example', async () => {
    mockUsdaLookup([]);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_external_food',
        food_name: 'dragonfruit smoothie',
        meal_type_id: MEAL_TYPE_ID,
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toContain('"meal_type_id":"' + MEAL_TYPE_ID + '"');
    expect(result).not.toContain('"meal_type":');
    expect(foodCoreService.createFood).not.toHaveBeenCalled();
    expect(foodEntryService.createFoodEntry).not.toHaveBeenCalled();
  });

  it('is inferred from an external_id when the action is omitted', async () => {
    mockUsdaLookup([usdaApple]);
    vi.mocked(foodCoreService.createFood).mockResolvedValue({
      id: FOOD_ID,
      name: 'Apple',
      default_variant: {
        id: VARIANT_ID,
        serving_size: 100,
        serving_unit: 'g',
        calories: 52,
      },
    });
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
      food_name: 'Apple',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        food_name: 'Apple',
        external_id: '171688',
        quantity: 1,
        meal_type: 'breakfast',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      '✅ Saved "Apple" from usda (52 kcal per 100g) and logged 100 g to Breakfast on 2026-06-10.'
    );
  });
});

describe('create_food', () => {
  it('splits a count-bearing unit ("4 pieces") into serving_size + bare unit', async () => {
    // Regression: quantity=1, unit="4 pieces" used to store serving_size=1,
    // serving_unit="4 pieces", which rendered as the nonsense "14 pieces" and
    // scaled wrong. It must become serving_size=4, serving_unit="pieces".
    vi.mocked(foodCoreService.createFood).mockResolvedValue({
      id: FOOD_ID,
      name: 'Chicken Fingers',
      default_variant: {
        id: VARIANT_ID,
        serving_size: 4,
        serving_unit: 'pieces',
        calories: 520,
      },
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_food',
        food_name: 'Chicken Fingers',
        calories: 520,
        protein: 40,
        carbs: 30,
        fat: 26,
        quantity: 1,
        unit: '4 pieces',
      },
      opts
    );

    expect(result).toBe(
      '✅ Food "Chicken Fingers" created with 520 kcal per 4pieces.'
    );
    expect(foodCoreService.createFood).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ serving_size: 4, serving_unit: 'pieces' })
    );
  });

  it('remaps misfiled serving_size/serving_unit onto quantity/unit', async () => {
    // Regression for an observed live failure: models bleed
    // update_food_variant's field names into create_food. Dropping
    // serving_unit as an unrecognized key fell back to the 100-'serving'
    // base, storing "227 serving" for half a pound of ground beef — which the
    // diary then rendered as ~1 kcal (quantity 1 / serving_size 227 × 250).
    vi.mocked(foodCoreService.createFood).mockResolvedValue({
      id: FOOD_ID,
      name: 'Ground Beef',
      default_variant: {
        id: VARIANT_ID,
        serving_size: 227,
        serving_unit: 'g',
        calories: 250,
      },
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_food',
        food_name: 'Ground Beef',
        calories: 250,
        protein: 23,
        carbs: 0,
        fat: 17,
        serving_size: 227,
        serving_unit: 'g',
      },
      opts
    );

    expect(result).toBe(
      '✅ Food "Ground Beef" created with 250 kcal per 227g.'
    );
    expect(foodCoreService.createFood).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ serving_size: 227, serving_unit: 'g' })
    );
  });

  it('rejects a call carrying conflicting quantity and serving_size values', async () => {
    // quantity: 1 plus serving_size: 227 is ambiguous — remapping either half
    // would store corrupt serving math (1 g of ground beef) — so the model
    // must restate the serving cleanly.
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_food',
        food_name: 'Ground Beef',
        calories: 250,
        protein: 23,
        carbs: 0,
        fat: 17,
        quantity: 1,
        serving_size: 227,
        serving_unit: 'g',
      },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: create_food received conflicting serving fields (quantity/unit vs serving_size/serving_unit). Retry with ONLY quantity and unit describing one serving, for example: {"action":"create_food","food_name":"Ground Beef","calories":100,"protein":1,"carbs":23,"fat":0,"quantity":118,"unit":"g"}'
    );
    expect(foodCoreService.createFood).not.toHaveBeenCalled();
  });

  it.each([
    { unit: '250 ml', serving_size: 250, serving_unit: 'ml' },
    { unit: '0.5 cup', serving_size: 0.5, serving_unit: 'cup' },
  ])(
    'uses a base quantity of 1 for the numeric-prefixed unit "$unit"',
    async ({ unit, serving_size, serving_unit }) => {
      // Without an explicit quantity, a bare mass/volume unit defaults to 100.
      // A numeric prefix already states the serving size, so the base must be 1
      // — otherwise "250 ml" would store 100 * 250 = 25,000 ml.
      vi.mocked(foodCoreService.createFood).mockResolvedValue({
        id: FOOD_ID,
        name: 'Milk',
        default_variant: {
          id: VARIANT_ID,
          serving_size,
          serving_unit,
          calories: 120,
        },
      });

      await tools.sparky_manage_food.execute!(
        {
          action: 'create_food',
          food_name: 'Milk',
          calories: 120,
          protein: 8,
          carbs: 12,
          fat: 5,
          unit,
        },
        opts
      );

      expect(foodCoreService.createFood).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ serving_size, serving_unit })
      );
    }
  );

  it('applies count-unit defaults and the 0-becomes-null storage quirk', async () => {
    vi.mocked(foodCoreService.createFood).mockResolvedValue({
      id: FOOD_ID,
      name: 'Protein Bar',
      brand: 'BrandX',
      default_variant: {
        id: VARIANT_ID,
        serving_size: 1,
        serving_unit: 'serving',
        calories: 220,
      },
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_food',
        food_name: 'Protein Bar',
        brand: 'BrandX',
        calories: 220,
        protein: 20,
        carbs: 25,
        fat: 8,
        saturated_fat: 3,
        sodium: 180,
        fiber: 2,
        sugar: 0,
        gi: 'Low',
      },
      opts
    );

    expect(result).toBe(
      '✅ Food "Protein Bar" created with 220 kcal per 1serving.'
    );
    expect(foodCoreService.createFood).toHaveBeenCalledWith('user-1', {
      user_id: 'user-1',
      name: 'Protein Bar',
      brand: 'BrandX',
      serving_size: 1,
      serving_unit: 'serving',
      calories: 220,
      protein: 20,
      carbs: 25,
      fat: 8,
      saturated_fat: 3,
      polyunsaturated_fat: null,
      monounsaturated_fat: null,
      trans_fat: null,
      cholesterol: null,
      sodium: 180,
      potassium: null,
      dietary_fiber: 2,
      sugars: null,
      vitamin_a: null,
      vitamin_c: null,
      calcium: null,
      iron: null,
      glycemic_index: 'Low',
    });
    expect(foodEntryService.createFoodEntry).not.toHaveBeenCalled();
  });

  it('defaults non-count units to 100 and auto-logs when meal_type is given', async () => {
    vi.mocked(foodCoreService.createFood).mockResolvedValue({
      id: FOOD_ID,
      name: 'Rice',
      brand: null,
      default_variant: {
        id: VARIANT_ID,
        serving_size: 100,
        serving_unit: 'g',
        calories: 130,
      },
    });
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_food',
        food_name: 'Rice',
        calories: 130,
        protein: 2.7,
        carbs: 28,
        fat: 0.3,
        unit: 'g',
        meal_type: 'lunch',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      '✅ Food "Rice" created with 130 kcal per 100g. Also logged to Lunch for 2026-06-10.'
    );
    expect(foodCoreService.createFood).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ serving_size: 100, serving_unit: 'g' })
    );
    expect(foodEntryService.createFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      {
        user_id: 'user-1',
        food_id: FOOD_ID,
        variant_id: VARIANT_ID,
        entry_date: '2026-06-10',
        quantity: 100,
        unit: 'g',
        meal_type_id: 'lunch-id',
      }
    );
  });

  // Live failure ("I had a root beer float"): the model naturally reaches for
  // meal_type 'dessert' and entry_date 'today'; both must succeed on the
  // first call instead of failing enum/date validation.
  it("aliases meal_type 'dessert' to snacks and resolves entry_date 'today'", async () => {
    vi.mocked(foodCoreService.createFood).mockResolvedValue({
      id: FOOD_ID,
      name: 'root beer float',
      brand: 'Homemade',
      default_variant: {
        id: VARIANT_ID,
        serving_size: 1,
        serving_unit: 'serving',
        calories: 400,
      },
    });
    vi.mocked(foodEntryService.createFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
    });
    const today = todayInZone('UTC');

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_food',
        food_name: 'root beer float',
        brand: 'Homemade',
        calories: 400,
        protein: 3,
        carbs: 80,
        fat: 5,
        quantity: 1,
        unit: 'serving',
        meal_type: 'dessert',
        entry_date: 'today',
      },
      opts
    );

    expect(result).toBe(
      `✅ Food "root beer float" created with 400 kcal per 1serving. Also logged to Snacks for ${today}.`
    );
    expect(foodEntryService.createFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({
        meal_type_id: 'snacks-id',
        entry_date: today,
      })
    );
  });

  // Live failure: a food was saved with 0 kcal and all-zero macros (the model
  // skipped its estimation step), then sat in the library silently logging
  // 0-calorie entries. All-zero nutrition must bounce back for an estimate.
  it('rejects create_food when every nutrient is zero', async () => {
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_food',
        food_name: 'mystery crackers',
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        quantity: 1,
        unit: 'serving',
      },
      opts
    );

    expect(result).toBe(
      'Error [VALIDATION]: create_food received all-zero nutrition for "mystery crackers" — estimate the nutrition before saving. Retry with your best estimated values per serving (calories, protein, carbs, fat at minimum). For plain water use log_water. Only if the label is genuinely all zeros, retry with confirmed_zero: true.'
    );
    expect(foodCoreService.createFood).not.toHaveBeenCalled();
  });

  it('allows an all-zero create_food when confirmed_zero attests the label', async () => {
    vi.mocked(foodCoreService.createFood).mockResolvedValue({
      id: FOOD_ID,
      name: 'Sparkling Water',
      brand: null,
      default_variant: {
        id: VARIANT_ID,
        serving_size: 355,
        serving_unit: 'ml',
        calories: 0,
      },
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_food',
        food_name: 'Sparkling Water',
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        confirmed_zero: true,
        quantity: 355,
        unit: 'ml',
      },
      opts
    );

    expect(result).toBe(
      '✅ Food "Sparkling Water" created with 0 kcal per 355ml.'
    );
  });

  it('allows a zero-calorie create_food that carries a non-zero nutrient', async () => {
    vi.mocked(foodCoreService.createFood).mockResolvedValue({
      id: FOOD_ID,
      name: 'Diet Cola',
      brand: null,
      default_variant: {
        id: VARIANT_ID,
        serving_size: 355,
        serving_unit: 'ml',
        calories: 0,
      },
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_food',
        food_name: 'Diet Cola',
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        sodium: 40,
        quantity: 355,
        unit: 'ml',
      },
      opts
    );

    expect(result).toBe('✅ Food "Diet Cola" created with 0 kcal per 355ml.');
  });
});

describe('search_meal', () => {
  it('renders meal templates with their food lists', async () => {
    vi.mocked(mealService.searchMeals).mockResolvedValue([
      {
        id: MEAL_ID,
        name: 'Overnight Oats',
        description: 'Easy breakfast',
        foods: [{ food_name: 'Oats' }, { food_name: 'Milk' }],
      },
      {
        id: FOOD_ID_2,
        name: 'Oatmeal Cookies',
        description: null,
        foods: [],
      },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'search_meal', meal_name: 'oat' },
      opts
    );

    expect(result).toBe(
      `# Meal Search: "oat"\n\n**Overnight Oats** — Easy breakfast\n  Foods: 2 items (Oats, Milk)\n  ID: ${MEAL_ID}\n\n**Oatmeal Cookies**\n  Foods: 0 items\n  ID: ${FOOD_ID_2}`
    );
    expect(mealService.searchMeals).toHaveBeenCalledWith('user-1', 'oat');
  });

  it('marks linked sub-meal ingredients distinctly from foods', async () => {
    vi.mocked(mealService.searchMeals).mockResolvedValue([
      {
        id: MEAL_ID,
        name: 'Big Bowl',
        description: null,
        foods: [
          { food_name: 'Chicken' },
          { item_type: 'meal', child_meal_name: 'Egg Fried Rice' },
        ],
      },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'search_meal', meal_name: 'bowl' },
      opts
    );

    expect(result).toBe(
      `# Meal Search: "bowl"\n\n**Big Bowl**\n  Foods: 2 items (Chicken, [meal] Egg Fried Rice)\n  ID: ${MEAL_ID}`
    );
  });
});

describe('log_meal', () => {
  it('requires meal_id or meal_name', async () => {
    const result = await tools.sparky_manage_food.execute!(
      { action: 'log_meal', meal_type: 'breakfast', entry_date: '2026-06-10' },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Either meal_id or meal_name must be provided'
    );
  });

  it('resolves the meal by exact-insensitive name and logs with v2 serving semantics', async () => {
    vi.mocked(mealService.searchMeals).mockResolvedValue([
      { id: FOOD_ID_2, name: 'Overnight Oats Deluxe', foods: [] },
      { id: MEAL_ID, name: 'Overnight Oats', foods: [] },
    ]);
    vi.mocked(foodEntryService.createFoodEntryMeal).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_meal',
        meal_name: 'overnight oats',
        meal_type: 'breakfast',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      '✅ Meal "Overnight Oats" logged for Breakfast on 2026-06-10.'
    );
    expect(foodEntryService.createFoodEntryMeal).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      {
        user_id: 'user-1',
        meal_template_id: MEAL_ID,
        meal_type_id: 'default-id',
        entry_date: '2026-06-10',
        name: 'Overnight Oats',
        quantity: 1,
        unit: 'serving',
        _clientMealModelVersion: 2,
      }
    );
  });

  it('reports an unknown meal name', async () => {
    vi.mocked(mealService.searchMeals).mockResolvedValue([]);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_meal',
        meal_name: 'Mystery Meal',
        meal_type: 'dinner',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe('Error [VALIDATION]: Meal "Mystery Meal" not found.');
  });

  it('reports an unknown meal id', async () => {
    vi.mocked(mealService.getMealById).mockRejectedValue(
      new Error('Meal not found.')
    );

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'log_meal',
        meal_id: MEAL_ID,
        meal_type: 'dinner',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      `Error [VALIDATION]: Meal with ID "${MEAL_ID}" not found.`
    );
  });
});

describe('list_diary', () => {
  it('renders grouped entries with scaled nutrition and the energy total', async () => {
    vi.mocked(foodEntryService.getFoodEntriesByDate).mockResolvedValue([
      {
        id: ENTRY_ID,
        food_name: 'Oatmeal',
        quantity: 50,
        unit: 'g',
        serving_size: 100,
        serving_unit: 'g',
        meal_type: 'breakfast',
        meal_type_id: MEAL_TYPE_ID,
        calories: 380,
        protein: 13,
        carbs: 67,
        fat: 7,
      },
      {
        id: FOOD_ID_2,
        food_name: 'Banana',
        quantity: 2,
        unit: 'serving',
        serving_size: 1,
        serving_unit: 'serving',
        meal_type: 'snacks',
        calories: 89,
        protein: 1.1,
        carbs: 23,
        fat: 0.3,
      },
    ]);
    vi.mocked(
      foodEntryMealRepository.getFoodEntryMealsByDate
    ).mockResolvedValue([
      {
        id: MEAL_ID,
        name: 'Protein Shake',
        quantity: 1,
        meal_type: 'breakfast',
      },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'list_diary', entry_date: '2026-06-10' },
      opts
    );

    expect(result).toBe(
      `# Food Diary: 2026-06-10\n\n## Breakfast\n- **Oatmeal** — 50 g (190 kcal)\n  ID: ${ENTRY_ID} | Type: food_entry | Meal type: breakfast (${MEAL_TYPE_ID})\n- **Protein Shake** (meal template) — 1x\n  ID: ${MEAL_ID} | Type: food_entry_meal\n\n## Snacks\n- **Banana** — 2 serving (178 kcal)\n  ID: ${FOOD_ID_2} | Type: food_entry\n\n---\n**Total Energy:** 368 kcal`
    );
  });

  it('defaults to today and renders the empty state', async () => {
    vi.mocked(foodEntryService.getFoodEntriesByDate).mockResolvedValue([]);
    vi.mocked(
      foodEntryMealRepository.getFoodEntryMealsByDate
    ).mockResolvedValue([]);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'list_diary' },
      opts
    );

    expect(result).toBe(
      '# Food Diary: Today\n\nNo entries found for this date.'
    );
    expect(foodEntryService.getFoodEntriesByDate).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      todayInZone('UTC')
    );
  });

  it("computes the default 'today' in the user's timezone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T20:00:00Z'));
    try {
      vi.mocked(foodEntryService.getFoodEntriesByDate).mockResolvedValue([]);
      vi.mocked(
        foodEntryMealRepository.getFoodEntryMealsByDate
      ).mockResolvedValue([]);

      const tokyoTools = buildFoodTools('user-1', 'Asia/Tokyo');
      await tokyoTools.sparky_manage_food.execute!(
        { action: 'list_diary' },
        opts
      );
      expect(foodEntryService.getFoodEntriesByDate).toHaveBeenLastCalledWith(
        'user-1',
        'user-1',
        '2026-06-11'
      );

      const utcTools = buildFoodTools('user-1', 'UTC');
      await utcTools.sparky_manage_food.execute!(
        { action: 'list_diary' },
        opts
      );
      expect(foodEntryService.getFoodEntriesByDate).toHaveBeenLastCalledWith(
        'user-1',
        'user-1',
        '2026-06-10'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('converts displayed calories when the user prefers kJ', async () => {
    vi.mocked(preferenceService.getUserPreferences).mockResolvedValue({
      energy_unit: 'kJ',
    });
    vi.mocked(foodEntryService.getFoodEntriesByDate).mockResolvedValue([
      {
        id: ENTRY_ID,
        food_name: 'Oatmeal',
        quantity: 50,
        unit: 'g',
        serving_size: 100,
        serving_unit: 'g',
        meal_type: 'breakfast',
        calories: 380,
        protein: 13,
        carbs: 67,
        fat: 7,
      },
    ]);
    vi.mocked(
      foodEntryMealRepository.getFoodEntryMealsByDate
    ).mockResolvedValue([]);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'list_diary', entry_date: '2026-06-10' },
      opts
    );

    // 380 kcal × 0.5 = 190 kcal → ×4.184 = 794.96 → rounded 795 kJ
    expect(result).toBe(
      `# Food Diary: 2026-06-10\n\n## Breakfast\n- **Oatmeal** — 50 g (795 kJ)\n  ID: ${ENTRY_ID} | Type: food_entry\n\n---\n**Total Energy:** 795 kJ`
    );
  });
});

describe('delete_entry', () => {
  it('advertises the food_name alternative in the tool description', () => {
    const description = tools.sparky_manage_food.description ?? '';
    expect(description).toMatch(/delete_entry\(entry_id\?\|food_name\?/);
    expect(description).toMatch(/update_entry\(entry_id\?\|food_name\?/);
  });

  it('deletes a food entry', async () => {
    vi.mocked(foodEntryService.deleteFoodEntry).mockResolvedValue(true);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'delete_entry', entry_id: ENTRY_ID, entry_type: 'food_entry' },
      opts
    );

    expect(result).toBe('✅ Entry deleted.');
    expect(foodEntryService.deleteFoodEntry).toHaveBeenCalledWith(
      'user-1',
      ENTRY_ID
    );
  });

  it('maps a missing meal entry to NOT_FOUND', async () => {
    vi.mocked(foodEntryService.deleteFoodEntryMeal).mockRejectedValue(
      new Error('Food entry meal not found or not authorized to delete.')
    );

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'delete_entry',
        entry_id: ENTRY_ID,
        entry_type: 'food_entry_meal',
      },
      opts
    );

    expect(result).toBe(
      `Error [NOT_FOUND]: Entry with ID '${ENTRY_ID}' not found.\n\nSuggestion: Check the ID and try again.`
    );
  });

  it('resolves a unique food_name to its entry and deletes without an entry_id', async () => {
    vi.mocked(foodEntryService.getFoodEntriesByDate).mockResolvedValue([
      {
        id: ENTRY_ID,
        food_name: 'Oatmeal',
        quantity: 50,
        unit: 'g',
        meal_type: 'breakfast',
        meal_type_id: 'default-id',
      },
      {
        id: FOOD_ID_2,
        food_name: 'Banana',
        quantity: 2,
        unit: 'serving',
        meal_type: 'snacks',
        meal_type_id: 'snacks-id',
      },
    ]);
    vi.mocked(foodEntryService.deleteFoodEntry).mockResolvedValue(true);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'delete_entry',
        food_name: 'oatmeal',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe('✅ Entry deleted.');
    expect(foodEntryService.getFoodEntriesByDate).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      '2026-06-10'
    );
    expect(foodEntryService.deleteFoodEntry).toHaveBeenCalledWith(
      'user-1',
      ENTRY_ID
    );
  });

  it('narrows same-named entries by meal_type when deleting by name', async () => {
    vi.mocked(foodEntryService.getFoodEntriesByDate).mockResolvedValue([
      {
        id: ENTRY_ID,
        food_name: 'Oatmeal',
        quantity: 50,
        unit: 'g',
        meal_type: 'breakfast',
        meal_type_id: 'default-id',
      },
      {
        id: FOOD_ID_2,
        food_name: 'Oatmeal',
        quantity: 30,
        unit: 'g',
        meal_type: 'snacks',
        meal_type_id: 'snacks-id',
      },
    ]);
    vi.mocked(foodEntryService.deleteFoodEntry).mockResolvedValue(true);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'delete_entry',
        food_name: 'Oatmeal',
        meal_type: 'snacks',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe('✅ Entry deleted.');
    expect(foodEntryService.deleteFoodEntry).toHaveBeenCalledWith(
      'user-1',
      FOOD_ID_2
    );
  });

  it('lists candidates instead of deleting when a name matches multiple entries', async () => {
    vi.mocked(foodEntryService.getFoodEntriesByDate).mockResolvedValue([
      {
        id: ENTRY_ID,
        food_name: 'Oatmeal',
        quantity: 50,
        unit: 'g',
        meal_type: 'breakfast',
        meal_type_id: 'default-id',
      },
      {
        id: FOOD_ID_2,
        food_name: 'Oatmeal',
        quantity: 30,
        unit: 'g',
        meal_type: 'snacks',
        meal_type_id: 'snacks-id',
      },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'delete_entry',
        food_name: 'Oatmeal',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toContain('matches 2 entries');
    expect(result).toContain(ENTRY_ID);
    expect(result).toContain(FOOD_ID_2);
    expect(foodEntryService.deleteFoodEntry).not.toHaveBeenCalled();
  });

  it('reports which names exist when the food_name matches nothing that day', async () => {
    vi.mocked(foodEntryService.getFoodEntriesByDate).mockResolvedValue([
      {
        id: ENTRY_ID,
        food_name: 'Oatmeal',
        quantity: 50,
        unit: 'g',
        meal_type: 'breakfast',
        meal_type_id: 'default-id',
      },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'delete_entry',
        food_name: 'Pancakes',
        entry_date: '2026-06-10',
      },
      opts
    );

    expect(result).toContain('No entry named "Pancakes"');
    expect(result).toContain('Oatmeal');
    expect(foodEntryService.deleteFoodEntry).not.toHaveBeenCalled();
  });
});

describe('delete_food', () => {
  it('requires food_id or food_name', async () => {
    const result = await tools.sparky_manage_food.execute!(
      { action: 'delete_food' },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Either food_id or food_name must be provided'
    );
  });

  it('resolves by name and force-deletes', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([
      eggsRow,
    ]);
    vi.mocked(foodCoreService.deleteFood).mockResolvedValue({
      message: 'Food and all its references deleted permanently.',
      status: 'force_deleted',
    });

    const result = await tools.sparky_manage_food.execute!(
      { action: 'delete_food', food_name: 'eggs' },
      opts
    );

    expect(result).toBe(
      '✅ Food "Eggs" deleted (including variants and diary entries).'
    );
    expect(foodCoreService.deleteFood).toHaveBeenCalledWith(
      'user-1',
      FOOD_ID,
      true
    );
  });

  it('reports the hidden outcome when other users still reference the food', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue(eggsRow);
    vi.mocked(foodCoreService.deleteFood).mockResolvedValue({
      message:
        'Food hidden (marked as quick food). Existing references remain.',
      status: 'hidden',
    });

    const result = await tools.sparky_manage_food.execute!(
      { action: 'delete_food', food_id: FOOD_ID },
      opts
    );

    expect(result).toBe(
      '✅ Food "Eggs" hidden (marked as quick food). Existing references remain.'
    );
  });

  it('maps an unknown food_id to NOT_FOUND', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue(undefined);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'delete_food', food_id: FOOD_ID },
      opts
    );

    expect(result).toBe(
      `Error [NOT_FOUND]: Food with ID '${FOOD_ID}' not found.\n\nSuggestion: Check the ID and try again.`
    );
    expect(foodCoreService.deleteFood).not.toHaveBeenCalled();
  });
});

describe('update_entry', () => {
  it('moves a food entry to a custom meal type without requiring a quantity change', async () => {
    vi.mocked(mealTypeRepository.getMealTypeById).mockResolvedValue({
      id: MEAL_TYPE_ID,
      name: 'Second breakfast',
    });
    vi.mocked(foodEntryService.updateFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_entry',
        entry_id: ENTRY_ID,
        entry_type: 'food_entry',
        meal_type_id: MEAL_TYPE_ID,
      },
      opts
    );

    expect(result).toBe('✅ Entry updated: meal type to Second breakfast.');
    expect(foodEntryService.updateFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      ENTRY_ID,
      {
        quantity: undefined,
        unit: undefined,
        meal_type_id: MEAL_TYPE_ID,
      }
    );
  });

  it('switches from a custom meal type to a built-in meal type by resolving to ID', async () => {
    vi.mocked(mealTypeRepository.getAllMealTypes).mockResolvedValue([
      { id: 'default-id', name: 'Breakfast', sort_order: 1, user_id: null },
      {
        id: MEAL_TYPE_ID,
        name: 'Second breakfast',
        sort_order: 2,
        user_id: 'user-1',
      },
    ]);
    vi.mocked(foodEntryService.updateFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_entry',
        entry_id: ENTRY_ID,
        entry_type: 'food_entry',
        meal_type: 'breakfast',
      },
      opts
    );

    expect(result).toBe('✅ Entry updated: meal type to Breakfast.');
    expect(foodEntryService.updateFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      ENTRY_ID,
      {
        quantity: undefined,
        unit: undefined,
        meal_type_id: 'default-id',
      }
    );
  });

  it('updates a food entry quantity and unit', async () => {
    vi.mocked(foodEntryService.updateFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_entry',
        entry_id: ENTRY_ID,
        entry_type: 'food_entry',
        quantity: 3,
        unit: 'serving',
      },
      opts
    );

    expect(result).toBe('✅ Entry updated to 3 serving.');
    expect(foodEntryService.updateFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      ENTRY_ID,
      { quantity: 3, unit: 'serving' }
    );
  });

  it('resolves a unique food_name and moves the entry to another meal without an entry_id', async () => {
    vi.mocked(foodEntryService.getFoodEntriesByDate).mockResolvedValue([
      {
        id: ENTRY_ID,
        food_name: 'Oatmeal',
        quantity: 50,
        unit: 'g',
        meal_type: 'lunch',
        meal_type_id: 'lunch-id',
      },
    ]);
    vi.mocked(foodEntryService.updateFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_entry',
        food_name: 'Oatmeal',
        entry_date: '2026-06-10',
        meal_type: 'dinner',
      },
      opts
    );

    expect(result).toBe('✅ Entry updated: meal type to Dinner.');
    expect(foodEntryService.updateFoodEntry).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      ENTRY_ID,
      {
        quantity: undefined,
        unit: undefined,
        meal_type_id: 'dinner-id',
      }
    );
  });

  it('lists candidates instead of updating when a name matches multiple entries', async () => {
    vi.mocked(foodEntryService.getFoodEntriesByDate).mockResolvedValue([
      {
        id: ENTRY_ID,
        food_name: 'Oatmeal',
        quantity: 50,
        unit: 'g',
        meal_type: 'breakfast',
        meal_type_id: 'default-id',
      },
      {
        id: FOOD_ID_2,
        food_name: 'Oatmeal',
        quantity: 30,
        unit: 'g',
        meal_type: 'snacks',
        meal_type_id: 'snacks-id',
      },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_entry',
        food_name: 'Oatmeal',
        entry_date: '2026-06-10',
        quantity: 3,
      },
      opts
    );

    expect(result).toContain('matches 2 entries');
    expect(foodEntryService.updateFoodEntry).not.toHaveBeenCalled();
  });

  it('round-trips the template link and foods when updating a meal entry', async () => {
    const componentFoods = [
      { food_id: FOOD_ID, variant_id: VARIANT_ID, quantity: 100, unit: 'g' },
    ];
    vi.mocked(foodEntryService.getFoodEntryMealMeta).mockResolvedValue({
      id: ENTRY_ID,
      quantity: 1,
      unit: 'g',
      meal_type_id: null,
    });
    vi.mocked(
      foodEntryService.getFoodEntryMealWithComponents
    ).mockResolvedValue({
      id: ENTRY_ID,
      meal_template_id: MEAL_ID,
      entry_date: new Date(2026, 5, 10),
      foods: componentFoods,
    });
    vi.mocked(foodEntryService.updateFoodEntryMeal).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_entry',
        entry_id: ENTRY_ID,
        entry_type: 'food_entry_meal',
        quantity: 2,
        unit: 'serving',
      },
      opts
    );

    expect(result).toBe('✅ Entry updated to 2 serving.');
    expect(foodEntryService.updateFoodEntryMeal).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      ENTRY_ID,
      {
        meal_template_id: MEAL_ID,
        entry_date: '2026-06-10',
        quantity: 2,
        unit: 'serving',
        foods: componentFoods,
      }
    );
  });

  // Changing ONLY the meal type of a meal container must be a metadata-only
  // move: it must not round-trip/rebuild the component food_entries (which
  // would rewrite historical nutrition snapshots or drop components whose
  // food/variant no longer exists).
  it('moves a meal entry to a custom meal type without rebuilding its components', async () => {
    vi.mocked(mealTypeRepository.getMealTypeById).mockResolvedValue({
      id: MEAL_TYPE_ID,
      name: 'Second breakfast',
    });
    vi.mocked(foodEntryService.getFoodEntryMealMeta).mockResolvedValue({
      id: ENTRY_ID,
      quantity: 1,
      unit: 'serving',
      meal_type_id: null,
    });
    vi.mocked(foodEntryService.moveFoodEntryMealToMealType).mockResolvedValue({
      id: ENTRY_ID,
      meal_type_id: MEAL_TYPE_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_entry',
        entry_id: ENTRY_ID,
        entry_type: 'food_entry_meal',
        meal_type_id: MEAL_TYPE_ID,
      },
      opts
    );

    expect(result).toBe('✅ Entry updated: meal type to Second breakfast.');
    expect(foodEntryService.moveFoodEntryMealToMealType).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      ENTRY_ID,
      MEAL_TYPE_ID
    );
    expect(
      foodEntryService.getFoodEntryMealWithComponents
    ).not.toHaveBeenCalled();
    expect(foodEntryService.updateFoodEntryMeal).not.toHaveBeenCalled();
  });

  // A redundant quantity copied from list_diary must not trigger a rebuild:
  // when the value equals the container's current quantity the move stays
  // metadata-only.
  it('moves a meal entry when a redundant quantity equals the existing value', async () => {
    vi.mocked(mealTypeRepository.getMealTypeById).mockResolvedValue({
      id: MEAL_TYPE_ID,
      name: 'Second breakfast',
    });
    vi.mocked(foodEntryService.getFoodEntryMealMeta).mockResolvedValue({
      id: ENTRY_ID,
      quantity: 1,
      unit: 'serving',
      meal_type_id: null,
    });
    vi.mocked(foodEntryService.moveFoodEntryMealToMealType).mockResolvedValue({
      id: ENTRY_ID,
      meal_type_id: MEAL_TYPE_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_entry',
        entry_id: ENTRY_ID,
        entry_type: 'food_entry_meal',
        meal_type_id: MEAL_TYPE_ID,
        quantity: 1,
      },
      opts
    );

    expect(result).toBe('✅ Entry updated: meal type to Second breakfast.');
    expect(foodEntryService.moveFoodEntryMealToMealType).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      ENTRY_ID,
      MEAL_TYPE_ID
    );
    expect(foodEntryService.updateFoodEntryMeal).not.toHaveBeenCalled();
    expect(
      foodEntryService.getFoodEntryMealWithComponents
    ).not.toHaveBeenCalled();
  });

  // Same for a redundant unit that equals the existing unit.
  it('moves a meal entry when a redundant unit equals the existing value', async () => {
    vi.mocked(mealTypeRepository.getMealTypeById).mockResolvedValue({
      id: MEAL_TYPE_ID,
      name: 'Second breakfast',
    });
    vi.mocked(foodEntryService.getFoodEntryMealMeta).mockResolvedValue({
      id: ENTRY_ID,
      quantity: 1,
      unit: 'serving',
      meal_type_id: null,
    });
    vi.mocked(foodEntryService.moveFoodEntryMealToMealType).mockResolvedValue({
      id: ENTRY_ID,
      meal_type_id: MEAL_TYPE_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_entry',
        entry_id: ENTRY_ID,
        entry_type: 'food_entry_meal',
        meal_type_id: MEAL_TYPE_ID,
        unit: 'serving',
      },
      opts
    );

    expect(result).toBe('✅ Entry updated: meal type to Second breakfast.');
    expect(foodEntryService.moveFoodEntryMealToMealType).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      ENTRY_ID,
      MEAL_TYPE_ID
    );
    expect(foodEntryService.updateFoodEntryMeal).not.toHaveBeenCalled();
  });

  // A plain no-op (redundant quantity, no meal type change) must not rebuild
  // components and must not fabricate a change message.
  it('no-ops when a redundant quantity equals the existing value and no meal type is given', async () => {
    vi.mocked(foodEntryService.getFoodEntryMealMeta).mockResolvedValue({
      id: ENTRY_ID,
      quantity: 1,
      unit: 'serving',
      meal_type_id: 'default-id',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_entry',
        entry_id: ENTRY_ID,
        entry_type: 'food_entry_meal',
        quantity: 1,
      },
      opts
    );

    expect(result).toBe('✅ Entry already has the requested values.');
    expect(foodEntryService.moveFoodEntryMealToMealType).not.toHaveBeenCalled();
    expect(foodEntryService.updateFoodEntryMeal).not.toHaveBeenCalled();
    expect(
      foodEntryService.getFoodEntryMealWithComponents
    ).not.toHaveBeenCalled();
  });

  // Same meal type + redundant quantity/unit: nothing to do, no fake message.
  it('no-ops when the meal type and quantity are unchanged', async () => {
    vi.mocked(mealTypeRepository.getMealTypeById).mockResolvedValue({
      id: MEAL_TYPE_ID,
      name: 'Second breakfast',
    });
    vi.mocked(foodEntryService.getFoodEntryMealMeta).mockResolvedValue({
      id: ENTRY_ID,
      quantity: 1,
      unit: 'serving',
      meal_type_id: MEAL_TYPE_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_entry',
        entry_id: ENTRY_ID,
        entry_type: 'food_entry_meal',
        meal_type_id: MEAL_TYPE_ID,
        quantity: 1,
      },
      opts
    );

    expect(result).toBe('✅ Entry already has the requested values.');
    expect(foodEntryService.moveFoodEntryMealToMealType).not.toHaveBeenCalled();
    expect(foodEntryService.updateFoodEntryMeal).not.toHaveBeenCalled();
  });

  // A REAL quantity change still uses the full rebuild path (components are
  // re-scaled to the new portion).
  it('rebuilds components when the quantity actually changes', async () => {
    vi.mocked(mealTypeRepository.getMealTypeById).mockResolvedValue({
      id: MEAL_TYPE_ID,
      name: 'Second breakfast',
    });
    vi.mocked(foodEntryService.getFoodEntryMealMeta).mockResolvedValue({
      id: ENTRY_ID,
      quantity: 1,
      unit: 'serving',
      meal_type_id: null,
    });
    vi.mocked(
      foodEntryService.getFoodEntryMealWithComponents
    ).mockResolvedValue({
      id: ENTRY_ID,
      meal_template_id: MEAL_ID,
      entry_date: new Date(2026, 5, 10),
      foods: [
        { food_id: FOOD_ID, variant_id: VARIANT_ID, quantity: 100, unit: 'g' },
      ],
    });
    vi.mocked(foodEntryService.updateFoodEntryMeal).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_entry',
        entry_id: ENTRY_ID,
        entry_type: 'food_entry_meal',
        meal_type_id: MEAL_TYPE_ID,
        quantity: 2,
      },
      opts
    );

    expect(result).toBe(
      '✅ Entry updated: quantity to 2, meal type to Second breakfast.'
    );
    expect(foodEntryService.updateFoodEntryMeal).toHaveBeenCalled();
    expect(foodEntryService.moveFoodEntryMealToMealType).not.toHaveBeenCalled();
  });

  // A real quantity change with an UNCHANGED meal type must still use the full
  // rebuild path, but the confirmation must mention only the quantity — the
  // category did not change.
  it('rebuilds on a real quantity change but does not report an unchanged meal type', async () => {
    vi.mocked(mealTypeRepository.getMealTypeById).mockResolvedValue({
      id: MEAL_TYPE_ID,
      name: 'Second breakfast',
    });
    vi.mocked(foodEntryService.getFoodEntryMealMeta).mockResolvedValue({
      id: ENTRY_ID,
      quantity: 1,
      unit: 'serving',
      meal_type_id: MEAL_TYPE_ID,
    });
    vi.mocked(
      foodEntryService.getFoodEntryMealWithComponents
    ).mockResolvedValue({
      id: ENTRY_ID,
      meal_template_id: MEAL_ID,
      entry_date: new Date(2026, 5, 10),
      foods: [
        { food_id: FOOD_ID, variant_id: VARIANT_ID, quantity: 100, unit: 'g' },
      ],
    });
    vi.mocked(foodEntryService.updateFoodEntryMeal).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_entry',
        entry_id: ENTRY_ID,
        entry_type: 'food_entry_meal',
        meal_type_id: MEAL_TYPE_ID,
        quantity: 2,
      },
      opts
    );

    expect(result).toBe('✅ Entry updated: quantity to 2.');
    expect(result).not.toContain('meal type');
    expect(foodEntryService.updateFoodEntryMeal).toHaveBeenCalled();
    expect(foodEntryService.moveFoodEntryMealToMealType).not.toHaveBeenCalled();
  });

  it('maps a missing meal entry to NOT_FOUND', async () => {
    vi.mocked(foodEntryService.getFoodEntryMealMeta).mockResolvedValue(null);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_entry',
        entry_id: ENTRY_ID,
        entry_type: 'food_entry_meal',
        quantity: 2,
        unit: 'serving',
      },
      opts
    );

    expect(result).toBe(
      `Error [NOT_FOUND]: Entry with ID '${ENTRY_ID}' not found.\n\nSuggestion: Check the ID and try again.`
    );
  });
});

describe('update_food_variant', () => {
  it('updates only the provided fields and renders the updated variant', async () => {
    vi.mocked(foodRepository.getFoodVariantById).mockResolvedValue({
      id: VARIANT_ID,
      food_id: FOOD_ID,
    });
    vi.mocked(foodRepository.getFoodById).mockResolvedValue({
      id: FOOD_ID,
      name: 'Oatmeal',
      user_id: 'user-1',
    });
    vi.mocked(foodRepository.updateFoodVariant).mockResolvedValue({
      id: VARIANT_ID,
      food_id: FOOD_ID,
      calories: 390,
      serving_size: 100,
      serving_unit: 'g',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_food_variant',
        variant_id: VARIANT_ID,
        calories: 390,
        fiber: 10,
      },
      opts
    );

    expect(result).toBe(
      '✅ Food variant updated for "Oatmeal" (390 kcal per 100g).'
    );
    expect(foodRepository.updateFoodVariant).toHaveBeenCalledWith(
      VARIANT_ID,
      { calories: 390, dietary_fiber: 10 },
      'user-1'
    );
    expect(foodCoreService.updateFoodEntriesSnapshot).not.toHaveBeenCalled();
  });

  it('refreshes diary snapshots when update_existing_entries is true', async () => {
    vi.mocked(foodRepository.getFoodVariantById).mockResolvedValue({
      id: VARIANT_ID,
      food_id: FOOD_ID,
    });
    vi.mocked(foodRepository.getFoodById).mockResolvedValue({
      id: FOOD_ID,
      name: 'Oatmeal',
      user_id: 'user-1',
    });
    vi.mocked(foodRepository.updateFoodVariant).mockResolvedValue({
      id: VARIANT_ID,
      food_id: FOOD_ID,
      calories: 390,
      serving_size: 100,
      serving_unit: 'g',
    });
    vi.mocked(foodCoreService.updateFoodEntriesSnapshot).mockResolvedValue({
      message: 'Food entries updated successfully.',
    });

    await tools.sparky_manage_food.execute!(
      {
        action: 'update_food_variant',
        variant_id: VARIANT_ID,
        calories: 390,
        update_existing_entries: true,
      },
      opts
    );

    expect(foodCoreService.updateFoodEntriesSnapshot).toHaveBeenCalledWith(
      'user-1',
      FOOD_ID,
      VARIANT_ID
    );
  });

  it('rejects a default-variant lookup on a food the user does not own', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue({
      id: FOOD_ID,
      name: 'Eggs',
      user_id: 'someone-else',
      default_variant: { id: VARIANT_ID },
    });

    const result = await tools.sparky_manage_food.execute!(
      { action: 'update_food_variant', food_id: FOOD_ID, calories: 100 },
      opts
    );

    expect(result).toBe(
      `Error [VALIDATION]: Default variant for food_id "${FOOD_ID}" not found or not editable.`
    );
  });

  it('returns a DB error when neither id is provided (MCP quirk)', async () => {
    const result = await tools.sparky_manage_food.execute!(
      { action: 'update_food_variant', calories: 100 },
      opts
    );
    expect(result).toBe(DB_ERROR_TEXT);
  });

  it('returns a DB error when no updatable field is provided (MCP quirk)', async () => {
    vi.mocked(foodRepository.getFoodVariantById).mockResolvedValue({
      id: VARIANT_ID,
      food_id: FOOD_ID,
    });
    vi.mocked(foodRepository.getFoodById).mockResolvedValue({
      id: FOOD_ID,
      name: 'Oatmeal',
      user_id: 'user-1',
    });

    const result = await tools.sparky_manage_food.execute!(
      { action: 'update_food_variant', variant_id: VARIANT_ID },
      opts
    );

    expect(result).toBe(DB_ERROR_TEXT);
    expect(foodRepository.updateFoodVariant).not.toHaveBeenCalled();
  });
});

describe('copy_from_yesterday', () => {
  it('defaults to copying all of yesterday into today', async () => {
    const today = todayInZone('UTC');
    const yesterday = addDays(today, -1);
    vi.mocked(foodEntryService.copyAllFoodEntries).mockResolvedValue([
      {},
      {},
      {},
    ]);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'copy_from_yesterday' },
      opts
    );

    expect(result).toBe(`✅ Copied 3 entries to ${today}.`);
    expect(foodEntryService.copyAllFoodEntries).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      yesterday,
      today
    );
  });

  it('copies a single meal slot and reports an empty source', async () => {
    vi.mocked(foodEntryService.copyFoodEntries).mockResolvedValue([]);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'copy_from_yesterday',
        source_date: '2026-06-09',
        target_date: '2026-06-10',
        meal_type: 'breakfast',
      },
      opts
    );

    expect(result).toBe('✅ No entries found to copy from the source date.');
    // The resolved system default is passed through as its ID.
    expect(foodEntryService.copyFoodEntries).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      '2026-06-09',
      'default-id',
      '2026-06-10',
      'default-id'
    );
  });

  it('copies entries using meal_type_id and passes the ID through to the service', async () => {
    vi.mocked(mealTypeRepository.getMealTypeById).mockResolvedValue({
      id: MEAL_TYPE_ID,
      name: 'Second breakfast',
    });
    vi.mocked(foodEntryService.copyFoodEntries).mockResolvedValue([{}]);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'copy_from_yesterday',
        source_date: '2026-06-09',
        target_date: '2026-06-10',
        meal_type_id: MEAL_TYPE_ID,
      },
      opts
    );

    expect(result).toBe('✅ Copied 1 entries to 2026-06-10.');
    // The resolved ID must survive to the end of the flow so the repository
    // query matches exactly this meal type (not any same-named one).
    expect(foodEntryService.copyFoodEntries).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      '2026-06-09',
      MEAL_TYPE_ID,
      '2026-06-10',
      MEAL_TYPE_ID
    );
  });

  // Without a meal name or id, a target/source date must still infer
  // copy_from_yesterday even when meal_type_id is present.
  it('infers copy_from_yesterday for target_date + meal_type_id without meal name or id', async () => {
    vi.mocked(mealTypeRepository.getMealTypeById).mockResolvedValue({
      id: MEAL_TYPE_ID,
      name: 'Second breakfast',
    });
    vi.mocked(foodEntryService.copyFoodEntries).mockResolvedValue([{}]);

    const result = await tools.sparky_manage_food.execute!(
      {
        target_date: '2026-06-10',
        meal_type_id: MEAL_TYPE_ID,
      },
      opts
    );

    expect(result).toBe('✅ Copied 1 entries to 2026-06-10.');
    expect(foodEntryService.copyFoodEntries).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.any(String),
      MEAL_TYPE_ID,
      '2026-06-10',
      MEAL_TYPE_ID
    );
  });
});

describe('save_as_meal_template', () => {
  // Regression tests for action inference
  it('infers log_meal (not save_as_meal_template) when action is omitted', async () => {
    vi.mocked(mealService.searchMeals).mockResolvedValue([
      { id: MEAL_ID, name: 'Overnight Oats' },
    ]);
    vi.mocked(foodEntryService.createFoodEntryMeal).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        meal_name: 'Overnight Oats',
        entry_date: '2026-06-10',
        meal_type: 'breakfast',
      },
      opts
    );

    expect(result).toBe(
      '✅ Meal "Overnight Oats" logged for Breakfast on 2026-06-10.'
    );
    expect(foodEntryService.createFoodEntryMeal).toHaveBeenCalled();
    expect(mealService.createMealFromDiaryEntries).not.toHaveBeenCalled();
  });

  // Regression: a logging date misfiled under target_date must not be
  // interpreted as copy_from_yesterday when a meal selector is present.
  // The action inference checks log_meal before copy_from_yesterday so the
  // salvage logic can remap target_date -> entry_date instead of running a
  // different data-writing operation.
  it('infers log_meal (not copy_from_yesterday) for meal_name + meal_type_id + target_date without action', async () => {
    vi.mocked(mealTypeRepository.getMealTypeById).mockResolvedValue({
      id: MEAL_TYPE_ID,
      name: 'Second breakfast',
    });
    vi.mocked(mealService.searchMeals).mockResolvedValue([
      { id: MEAL_ID, name: 'Overnight Oats' },
    ]);
    vi.mocked(foodEntryService.createFoodEntryMeal).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        meal_name: 'Overnight Oats',
        meal_type_id: MEAL_TYPE_ID,
        target_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      '✅ Meal "Overnight Oats" logged for Second breakfast on 2026-06-10.'
    );
    expect(foodEntryService.createFoodEntryMeal).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      expect.objectContaining({
        meal_template_id: MEAL_ID,
        meal_type_id: MEAL_TYPE_ID,
        entry_date: '2026-06-10',
      })
    );
    expect(foodEntryService.copyFoodEntries).not.toHaveBeenCalled();
    expect(foodEntryService.copyAllFoodEntries).not.toHaveBeenCalled();
  });

  // Regression: an incomplete log_meal (meal_name/meal_id + a date but no meal
  // type selector) must surface a validation error instead of falling through
  // to a full-day copy. The action inference routes any meal intent with a
  // date to log_meal before copy_from_yesterday.
  it('returns MISSING_PARAMS (not a copy) for meal_name + date without a meal type selector', async () => {
    const result = await tools.sparky_manage_food.execute!(
      {
        meal_name: 'Overnight Oats',
        target_date: '2026-06-10',
      },
      opts
    );

    expect(result).toContain(
      'Missing required parameters: meal_type_id (or meal_type)'
    );
    expect(foodEntryService.createFoodEntryMeal).not.toHaveBeenCalled();
    expect(foodEntryService.copyFoodEntries).not.toHaveBeenCalled();
    expect(foodEntryService.copyAllFoodEntries).not.toHaveBeenCalled();
  });

  it('returns MISSING_PARAMS (not a copy) for meal_id + date without a meal type selector', async () => {
    const result = await tools.sparky_manage_food.execute!(
      {
        meal_id: MEAL_ID,
        target_date: '2026-06-10',
      },
      opts
    );

    expect(result).toContain(
      'Missing required parameters: meal_type_id (or meal_type)'
    );
    expect(foodEntryService.createFoodEntryMeal).not.toHaveBeenCalled();
    expect(foodEntryService.copyFoodEntries).not.toHaveBeenCalled();
    expect(foodEntryService.copyAllFoodEntries).not.toHaveBeenCalled();
  });

  // Regression: an incidental date field on an update/delete call must not be
  // reinterpreted as a full-day copy. Entry/food-targeted operations win over
  // target_date/source_date in action inference.
  it('infers update_entry (not a copy) for entry_id + quantity + target_date', async () => {
    vi.mocked(foodEntryService.updateFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        entry_id: ENTRY_ID,
        entry_type: 'food_entry',
        quantity: 2,
        target_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe('✅ Entry updated: quantity to 2.');
    expect(foodEntryService.updateFoodEntry).toHaveBeenCalled();
    expect(foodEntryService.copyFoodEntries).not.toHaveBeenCalled();
    expect(foodEntryService.copyAllFoodEntries).not.toHaveBeenCalled();
  });

  it('infers delete_entry (not a copy) for entry_id + entry_type + source_date', async () => {
    vi.mocked(foodEntryService.deleteFoodEntry).mockResolvedValue(true);

    const result = await tools.sparky_manage_food.execute!(
      {
        entry_id: ENTRY_ID,
        entry_type: 'food_entry',
        source_date: '2026-06-09',
      },
      opts
    );

    expect(result).toBe('✅ Entry deleted.');
    expect(foodEntryService.deleteFoodEntry).toHaveBeenCalledWith(
      'user-1',
      ENTRY_ID
    );
    expect(foodEntryService.copyFoodEntries).not.toHaveBeenCalled();
    expect(foodEntryService.copyAllFoodEntries).not.toHaveBeenCalled();
  });

  it('infers delete_food (not a copy) for food_id + target_date', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue(eggsRow);
    vi.mocked(foodCoreService.deleteFood).mockResolvedValue({
      message: 'Food and all its references deleted permanently.',
      status: 'force_deleted',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        food_id: FOOD_ID,
        target_date: '2026-06-10',
      },
      opts
    );

    expect(result).toBe(
      '✅ Food "Eggs" deleted (including variants and diary entries).'
    );
    expect(foodCoreService.deleteFood).toHaveBeenCalled();
    expect(foodEntryService.copyFoodEntries).not.toHaveBeenCalled();
    expect(foodEntryService.copyAllFoodEntries).not.toHaveBeenCalled();
  });

  // Regression: list_diary rows carry entry_id + entry_type together with
  // food_name/meal_name, so entry-targeted operations must win over log/
  // lookup inference — otherwise the salvage logic would drop entry_id and run
  // a different data-writing operation.
  it('infers update_entry (not log_food) for entry_id + food_name + quantity + meal_type_id', async () => {
    vi.mocked(foodEntryService.updateFoodEntry).mockResolvedValue({
      id: ENTRY_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        entry_id: ENTRY_ID,
        entry_type: 'food_entry',
        food_name: 'Eggs',
        quantity: 2,
        meal_type_id: MEAL_TYPE_ID,
      },
      opts
    );

    expect(result).toContain('✅ Entry updated');
    expect(foodEntryService.updateFoodEntry).toHaveBeenCalled();
    expect(foodEntryService.createFoodEntry).not.toHaveBeenCalled();
    expect(foodCoreService.createFood).not.toHaveBeenCalled();
  });

  it('infers update_entry (not log_meal) for entry_id + meal_name + meal_type_id', async () => {
    vi.mocked(mealTypeRepository.getMealTypeById).mockResolvedValue({
      id: MEAL_TYPE_ID,
      name: 'Second breakfast',
    });
    vi.mocked(foodEntryService.getFoodEntryMealMeta).mockResolvedValue({
      id: ENTRY_ID,
      quantity: 1,
      unit: 'serving',
      meal_type_id: null,
    });
    vi.mocked(foodEntryService.moveFoodEntryMealToMealType).mockResolvedValue({
      id: ENTRY_ID,
      meal_type_id: MEAL_TYPE_ID,
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        entry_id: ENTRY_ID,
        entry_type: 'food_entry_meal',
        meal_name: 'Overnight Oats',
        meal_type_id: MEAL_TYPE_ID,
      },
      opts
    );

    expect(result).toContain('✅ Entry updated');
    expect(foodEntryService.moveFoodEntryMealToMealType).toHaveBeenCalled();
    expect(foodEntryService.createFoodEntryMeal).not.toHaveBeenCalled();
  });

  it('infers delete_entry (not lookup) for entry_id + entry_type + food_name', async () => {
    vi.mocked(foodEntryService.deleteFoodEntry).mockResolvedValue(true);

    const result = await tools.sparky_manage_food.execute!(
      {
        entry_id: ENTRY_ID,
        entry_type: 'food_entry',
        food_name: 'Eggs',
      },
      opts
    );

    expect(result).toBe('✅ Entry deleted.');
    expect(foodEntryService.deleteFoodEntry).toHaveBeenCalledWith(
      'user-1',
      ENTRY_ID
    );
    expect(foodRepository.getFoodsWithPagination).not.toHaveBeenCalled();
  });

  it('requires explicit action for save_as_meal_template', async () => {
    vi.mocked(mealTypeRepository.getMealTypeById).mockResolvedValue({
      id: MEAL_TYPE_ID,
      name: 'Second breakfast',
    });
    vi.mocked(mealService.createMealFromDiaryEntries).mockResolvedValue({
      id: MEAL_ID,
      name: 'My Second Breakfast',
    });
    vi.mocked(mealService.getMealById).mockResolvedValue({
      id: MEAL_ID,
      name: 'My Second Breakfast',
      foods: [{}, {}],
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'save_as_meal_template',
        meal_name: 'My Second Breakfast',
        entry_date: '2026-06-10',
        meal_type_id: MEAL_TYPE_ID,
      },
      opts
    );

    expect(result).toBe(
      '✅ Meal template "My Second Breakfast" saved with 2 food items.'
    );
    // The resolved ID is passed through to the service, not the name.
    expect(mealService.createMealFromDiaryEntries).toHaveBeenCalledWith(
      'user-1',
      '2026-06-10',
      MEAL_TYPE_ID,
      'My Second Breakfast',
      null
    );
    expect(foodEntryService.createFoodEntryMeal).not.toHaveBeenCalled();
  });

  it('saves the slot as a template and counts its foods', async () => {
    vi.mocked(mealService.createMealFromDiaryEntries).mockResolvedValue({
      id: MEAL_ID,
      name: 'My Lunch',
    });
    vi.mocked(mealService.getMealById).mockResolvedValue({
      id: MEAL_ID,
      name: 'My Lunch',
      foods: [{}, {}],
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'save_as_meal_template',
        entry_date: '2026-06-10',
        meal_type: 'lunch',
        meal_name: 'My Lunch',
      },
      opts
    );

    expect(result).toBe('✅ Meal template "My Lunch" saved with 2 food items.');
    // The resolved system default is passed through as its ID.
    expect(mealService.createMealFromDiaryEntries).toHaveBeenCalledWith(
      'user-1',
      '2026-06-10',
      'lunch-id',
      'My Lunch',
      null
    );
  });

  it('saves using meal_type_id and passes the ID through to the service', async () => {
    vi.mocked(mealTypeRepository.getMealTypeById).mockResolvedValue({
      id: MEAL_TYPE_ID,
      name: 'Second breakfast',
    });
    vi.mocked(mealService.createMealFromDiaryEntries).mockResolvedValue({
      id: MEAL_ID,
      name: 'My Second Breakfast',
    });
    vi.mocked(mealService.getMealById).mockResolvedValue({
      id: MEAL_ID,
      name: 'My Second Breakfast',
      foods: [{}, {}],
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'save_as_meal_template',
        entry_date: '2026-06-10',
        meal_type_id: MEAL_TYPE_ID,
        meal_name: 'My Second Breakfast',
      },
      opts
    );

    expect(result).toBe(
      '✅ Meal template "My Second Breakfast" saved with 2 food items.'
    );
    // The resolved ID must survive to the end of the flow so the repository
    // query matches exactly this meal type (not any same-named one).
    expect(mealService.createMealFromDiaryEntries).toHaveBeenCalledWith(
      'user-1',
      '2026-06-10',
      MEAL_TYPE_ID,
      'My Second Breakfast',
      null
    );
  });

  it('surfaces an empty slot as a DB error (message lacks "not found")', async () => {
    vi.mocked(mealService.createMealFromDiaryEntries).mockRejectedValue(
      new Error('No food entries found for Lunch on 2026-06-10.')
    );

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'save_as_meal_template',
        entry_date: '2026-06-10',
        meal_type: 'lunch',
        meal_name: 'My Lunch',
      },
      opts
    );

    expect(result).toBe(DB_ERROR_TEXT);
  });
});

describe('log_water', () => {
  it('inserts a manual water entry and syncs the aggregated daily total', async () => {
    vi.mocked(measurementRepository.insertWaterIntakeLog).mockResolvedValue({
      id: ENTRY_ID,
    });
    vi.mocked(measurementRepository.incrementWaterData).mockResolvedValue({
      water_ml: 750,
    } as any);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'log_water', amount_ml: 500, entry_date: '2026-06-11' },
      opts
    );

    expect(result).toBe('✅ Logged 500ml water for 2026-06-11.');
    expect(measurementRepository.insertWaterIntakeLog).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      '2026-06-11',
      500,
      null,
      null,
      'manual'
    );
    // The aggregated water_intake row (read by the dashboard) must be atomically
    // incremented by the newly logged amount: 500ml.
    expect(measurementRepository.incrementWaterData).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      500,
      '2026-06-11',
      'manual'
    );
  });
});

describe('get_nutritional_summary', () => {
  it('renders per-day macro breakdowns with the conditional Other line', async () => {
    vi.mocked(reportRepository.getDailyNutritionTotalsRange).mockResolvedValue([
      {
        entry_date: new Date(2026, 5, 1),
        calories: 1850.5,
        protein: 95.2,
        carbs: 210,
        fat: 65.5,
        saturated_fat: 12,
        polyunsaturated_fat: 8,
        monounsaturated_fat: 20,
        trans_fat: 0,
        cholesterol: 180,
        sodium: 2300,
        potassium: 3400,
        fiber: 25,
        sugar: 48,
        vitamin_a: 80,
        vitamin_c: 60,
        calcium: 90,
        iron: 70,
      },
      {
        entry_date: new Date(2026, 5, 2),
        calories: 1500,
        protein: 80,
        carbs: 180,
        fat: 50,
        saturated_fat: 0,
        cholesterol: 0,
        sodium: 1800,
        potassium: 0,
        fiber: 20,
        sugar: 30,
      },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'get_nutritional_summary',
        start_date: '2026-06-01',
        end_date: '2026-06-07',
      },
      opts
    );

    expect(result).toBe(
      '# Nutritional Summary (2026-06-01 to 2026-06-07)\n\n**2026-06-01**:\n  Macros: 1850.5 kcal | P: 95.2g | C: 210g | F: 65.5g\n  Fiber: 25g | Sugar: 48g | Sodium: 2300mg\n  Other: SatFat: 12g | Chol: 180mg | Potas: 3400mg\n\n**2026-06-02**:\n  Macros: 1500 kcal | P: 80g | C: 180g | F: 50g\n  Fiber: 20g | Sugar: 30g | Sodium: 1800mg\n'
    );
    expect(reportRepository.getDailyNutritionTotalsRange).toHaveBeenCalledWith(
      'user-1',
      '2026-06-01',
      '2026-06-07'
    );
  });

  it('converts calories to kJ when the user prefers it', async () => {
    vi.mocked(preferenceService.getUserPreferences).mockResolvedValue({
      energy_unit: 'kJ',
    });
    vi.mocked(reportRepository.getDailyNutritionTotalsRange).mockResolvedValue([
      {
        entry_date: new Date(2026, 5, 1),
        calories: 1000,
        protein: 80,
        carbs: 100,
        fat: 30,
        sodium: 1500,
        fiber: 20,
        sugar: 25,
      },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'get_nutritional_summary',
        start_date: '2026-06-01',
        end_date: '2026-06-01',
      },
      opts
    );

    expect(result).toBe(
      '# Nutritional Summary (2026-06-01 to 2026-06-01)\n\n**2026-06-01**:\n  Macros: 4184 kJ | P: 80g | C: 100g | F: 30g\n  Fiber: 20g | Sugar: 25g | Sodium: 1500mg\n'
    );
  });
});

describe('get_water_history', () => {
  it('renders daily totals in ml', async () => {
    vi.mocked(
      measurementRepository.getWaterTotalsByDateRange
    ).mockResolvedValue([
      { entry_date: new Date(2026, 5, 10), total_ml: '2500' },
      { entry_date: new Date(2026, 5, 11), total_ml: '1800' },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'get_water_history', start_date: '2026-06-10' },
      opts
    );

    expect(result).toBe(
      '# Water Intake History\n\n**2026-06-10**: 2500 ml\n\n**2026-06-11**: 1800 ml'
    );
    expect(
      measurementRepository.getWaterTotalsByDateRange
    ).toHaveBeenCalledWith('user-1', '2026-06-10', undefined);
  });

  it('converts totals to oz when the user prefers it', async () => {
    vi.mocked(preferenceService.getUserPreferences).mockResolvedValue({
      water_display_unit: 'oz',
    });
    vi.mocked(
      measurementRepository.getWaterTotalsByDateRange
    ).mockResolvedValue([
      { entry_date: new Date(2026, 5, 10), total_ml: '591' },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'get_water_history' },
      opts
    );

    expect(result).toBe('# Water Intake History\n\n**2026-06-10**: 20 oz');
  });
});

describe('service errors surface as tool error strings', () => {
  it('maps an unexpected service failure to DB_ERROR', async () => {
    vi.mocked(foodEntryService.getFoodEntriesByDate).mockRejectedValue(
      new Error('connection refused')
    );

    const result = await tools.sparky_manage_food.execute!(
      { action: 'list_diary', entry_date: '2026-06-10' },
      opts
    );

    expect(result).toBe(DB_ERROR_TEXT);
  });
});

describe('sparky_list_foods', () => {
  it('returns the paginated catalog with the default variant folded into variants', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([
      {
        id: FOOD_ID,
        name: 'Eggs',
        brand: null,
        is_custom: true,
        user_id: 'user-1',
        default_variant: { id: VARIANT_ID, calories: 155 },
      },
      {
        id: FOOD_ID_2,
        name: 'Quick Add',
        brand: null,
        is_custom: true,
        user_id: 'user-1',
        default_variant: { id: null },
      },
    ]);
    vi.mocked(foodRepository.countFoods).mockResolvedValue(2);

    const result = await tools.sparky_list_foods.execute!(
      { search: 'egg' },
      opts
    );

    // Compact render; per-row projection drops null `brand` and redundant `user_id`.
    expect(result).toBe(
      JSON.stringify({
        data: [
          {
            id: FOOD_ID,
            name: 'Eggs',
            is_custom: true,
            variants: [{ id: VARIANT_ID, calories: 155 }],
          },
          {
            id: FOOD_ID_2,
            name: 'Quick Add',
            is_custom: true,
            variants: [],
          },
        ],
        has_more: false,
        next_offset: null,
        total_count: 2,
      })
    );
    expect(foodRepository.getFoodsWithPagination).toHaveBeenCalledWith(
      'egg',
      null,
      'user-1',
      20,
      0,
      null
    );
  });
});

describe('sparky_get_food_details', () => {
  it('returns the food with all variants', async () => {
    vi.mocked(foodCoreService.getFoodById).mockResolvedValue({
      id: FOOD_ID,
      name: 'Eggs',
      brand: 'Farm Fresh',
      default_variant: { id: VARIANT_ID },
    });
    vi.mocked(foodRepository.getFoodVariantsByFoodId).mockResolvedValue([
      { id: VARIANT_ID, serving_unit: 'g' },
      { id: FOOD_ID_2, serving_unit: 'serving' },
    ]);

    const result = await tools.sparky_get_food_details.execute!(
      { food_id: FOOD_ID },
      opts
    );

    expect(result).toBe(
      JSON.stringify({
        id: FOOD_ID,
        name: 'Eggs',
        brand: 'Farm Fresh',
        variants: [
          { id: VARIANT_ID, serving_unit: 'g' },
          { id: FOOD_ID_2, serving_unit: 'serving' },
        ],
      })
    );
  });

  it('maps a missing food to NOT_FOUND', async () => {
    vi.mocked(foodCoreService.getFoodById).mockRejectedValue(
      new Error('Food not found.')
    );

    const result = await tools.sparky_get_food_details.execute!(
      { food_id: FOOD_ID },
      opts
    );

    expect(result).toBe(
      `Error [NOT_FOUND]: Food with ID '${FOOD_ID}' not found.\n\nSuggestion: Check the ID and try again.`
    );
  });
});

describe('sparky_search_foods', () => {
  it('requires a query', async () => {
    const result = await tools.sparky_search_foods.execute!(
      {} as { query: string },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: query: Invalid input: expected string, received undefined'
    );
  });

  it('searches the catalog by name', async () => {
    vi.mocked(foodRepository.getFoodsWithPagination).mockResolvedValue([]);
    vi.mocked(foodRepository.countFoods).mockResolvedValue(0);

    const result = await tools.sparky_search_foods.execute!(
      { query: 'egg', limit: 5 },
      opts
    );

    expect(result).toBe(
      JSON.stringify({
        data: [],
        has_more: false,
        next_offset: null,
        total_count: 0,
      })
    );
    expect(foodRepository.getFoodsWithPagination).toHaveBeenCalledWith(
      'egg',
      null,
      'user-1',
      5,
      0,
      null
    );
  });
});

describe('sparky_get_food_diary', () => {
  it('uses a single date for both range bounds and returns entries plus meals', async () => {
    const foodEntries = [{ id: ENTRY_ID, food_name: 'Eggs' }];
    const mealEntries = [{ id: MEAL_ID, name: 'Protein Shake' }];
    vi.mocked(foodEntryService.getFoodEntriesByDateRange).mockResolvedValue(
      foodEntries
    );
    vi.mocked(
      foodEntryMealRepository.getFoodEntryMealsByDateRange
    ).mockResolvedValue(mealEntries);

    const result = await tools.sparky_get_food_diary.execute!(
      { date: '2026-06-10' },
      opts
    );

    expect(result).toBe(
      JSON.stringify({
        start_date: '2026-06-10',
        end_date: '2026-06-10',
        food_entries: foodEntries,
        meal_entries: mealEntries,
      })
    );
    expect(foodEntryService.getFoodEntriesByDateRange).toHaveBeenCalledWith(
      'user-1',
      'user-1',
      '2026-06-10',
      '2026-06-10'
    );
    expect(
      foodEntryMealRepository.getFoodEntryMealsByDateRange
    ).toHaveBeenCalledWith('user-1', '2026-06-10', '2026-06-10');
  });

  it('compacts the payload: single line, null/empty/redundant fields dropped, actionable ids kept', async () => {
    vi.mocked(foodEntryService.getFoodEntriesByDateRange).mockResolvedValue([
      {
        id: ENTRY_ID,
        food_id: FOOD_ID,
        meal_id: null,
        meal_type: 'Breakfast',
        meal_type_id: '99999999-9999-4999-8999-999999999999',
        quantity: 2,
        unit: 'serving',
        variant_id: VARIANT_ID,
        entry_date: '2026-06-10',
        meal_plan_template_id: null,
        food_entry_meal_id: null,
        food_name: 'Eggs',
        brand_name: null,
        calories: 155,
        protein: 13,
        vitamin_a: null,
        vitamin_c: null,
        custom_nutrients: {},
      },
    ]);
    vi.mocked(
      foodEntryMealRepository.getFoodEntryMealsByDateRange
    ).mockResolvedValue([
      {
        id: MEAL_ID,
        user_id: 'user-1',
        name: 'Protein Shake',
        meal_type: 'Snacks',
        quantity: 1,
        entry_date: '2026-06-10',
        created_at: '2026-06-10T08:00:00.000Z',
        updated_at: '2026-06-10T08:00:00.000Z',
        created_by_user_id: 'user-1',
        updated_by_user_id: 'user-1',
        meal_template_id: null,
        meal_type_id: '99999999-9999-4999-8999-999999999999',
        legacy_serving_unit_math: false,
      },
    ]);

    const result = await tools.sparky_get_food_diary.execute!(
      { date: '2026-06-10' },
      opts
    );

    // Compact render: no pretty-print whitespace.
    expect(result).not.toContain('\n');

    const parsed = JSON.parse(result as string);
    const entry = parsed.food_entries[0];
    // Actionable ids kept.
    expect(entry.id).toBe(ENTRY_ID);
    expect(entry.food_id).toBe(FOOD_ID);
    // Populated nutrients kept.
    expect(entry).toMatchObject({
      food_name: 'Eggs',
      calories: 155,
      protein: 13,
    });
    // Nulls, empty objects, and non-actionable internal surrogate keys dropped.
    for (const dropped of [
      'meal_id',
      'brand_name',
      'vitamin_a',
      'vitamin_c',
      'custom_nutrients',
      'variant_id',
      'meal_plan_template_id',
      'food_entry_meal_id',
    ]) {
      expect(entry).not.toHaveProperty(dropped);
    }
    // Both fields are kept so MCP clients can round-trip custom meal types.
    expect(entry.meal_type).toBe('Breakfast');
    expect(entry.meal_type_id).toBe('99999999-9999-4999-8999-999999999999');

    const meal = parsed.meal_entries[0];
    expect(meal).toMatchObject({
      id: MEAL_ID,
      name: 'Protein Shake',
      meal_type: 'Snacks',
    });
    for (const dropped of [
      'user_id',
      'created_at',
      'updated_at',
      'created_by_user_id',
      'updated_by_user_id',
      'meal_template_id',
      'legacy_serving_unit_math',
    ]) {
      expect(meal).not.toHaveProperty(dropped);
    }
    expect(meal.meal_type_id).toBe('99999999-9999-4999-8999-999999999999');
  });
});

describe('sparky_get_nutrition_summary', () => {
  it('defaults the range to today', async () => {
    const today = todayInZone('UTC');
    vi.mocked(reportRepository.getDailyNutritionTotalsRange).mockResolvedValue(
      []
    );

    const result = await tools.sparky_get_nutrition_summary.execute!({}, opts);

    expect(result).toBe('[]');
    expect(reportRepository.getDailyNutritionTotalsRange).toHaveBeenCalledWith(
      'user-1',
      today,
      today
    );
  });
});

describe('sparky_get_recent_food_entries', () => {
  it('clamps the limit to 200', async () => {
    vi.mocked(foodRepository.getRecentFoodEntries).mockResolvedValue([]);

    const result = await tools.sparky_get_recent_food_entries.execute!(
      { limit: 200 },
      opts
    );

    expect(result).toBe('[]');
    expect(foodRepository.getRecentFoodEntries).toHaveBeenCalledWith(
      'user-1',
      200
    );
  });
});

describe('sparky_get_food_usage', () => {
  it('returns paginated usage rows with today as the default range', async () => {
    const today = todayInZone('UTC');
    const rows = [{ id: ENTRY_ID, food_id: FOOD_ID }];
    vi.mocked(foodRepository.getFoodUsage).mockResolvedValue({
      rows,
      totalCount: 1,
    });

    const result = await tools.sparky_get_food_usage.execute!(
      { food_id: FOOD_ID },
      opts
    );

    expect(result).toBe(
      JSON.stringify({
        data: rows,
        has_more: false,
        next_offset: null,
        total_count: 1,
      })
    );
    expect(foodRepository.getFoodUsage).toHaveBeenCalledWith(
      'user-1',
      FOOD_ID,
      today,
      today,
      20,
      0
    );
  });
});

describe('create_meal', () => {
  it('creates a meal from scratch and sends normalized ingredients', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue(eggsRow);
    vi.mocked(mealService.createMeal).mockResolvedValue({
      id: MEAL_ID,
      name: 'Protein Oats',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal',
        meal_name: 'Protein Oats',
        description: 'Breakfast staple',
        total_servings: 2,
        foods: [
          { food_id: FOOD_ID, quantity: 80, unit: 'g' },
          {
            child_meal_id: MEAL_ID_2,
            item_type: 'meal',
            quantity: 1,
            unit: 'serving',
          },
        ],
      },
      opts
    );

    expect(result).toBe('✅ Meal "Protein Oats" created with 2 ingredients.');
    expect(mealService.createMeal).toHaveBeenCalledWith('user-1', {
      name: 'Protein Oats',
      description: 'Breakfast staple',
      is_public: false,
      total_servings: 2,
      foods: [
        {
          food_id: FOOD_ID,
          item_type: 'food',
          variant_id: VARIANT_ID,
          quantity: 80,
          unit: 'g',
          ...EGGS_SNAPSHOT,
        },
        {
          child_meal_id: MEAL_ID_2,
          item_type: 'meal',
          quantity: 1,
          unit: 'serving',
        },
      ],
    });
  });

  it('surfaces ingredient validation errors from the service', async () => {
    vi.mocked(mealService.createMeal).mockRejectedValue(
      new ValidationError('Meals can only be nested one level deep.')
    );
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal',
        meal_name: 'Broken',
        foods: [{ child_meal_id: MEAL_ID_2, quantity: 1, unit: 'serving' }],
      },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Meals can only be nested one level deep.'
    );
  });

  it('rejects an ingredient with neither food_id nor child_meal_id', async () => {
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal',
        meal_name: 'Broken',
        foods: [{ quantity: 1, unit: 'g' }],
      },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Each ingredient needs food_id (from search_food) or child_meal_id (from search_meal)'
    );
    expect(mealService.createMeal).not.toHaveBeenCalled();
  });

  it('rejects an ingredient that references both a food and a meal', async () => {
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal',
        meal_name: 'Broken',
        foods: [
          {
            food_id: FOOD_ID,
            child_meal_id: MEAL_ID_2,
            quantity: 1,
            unit: 'g',
          },
        ],
      },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: An ingredient cannot reference both food_id and child_meal_id'
    );
    expect(mealService.createMeal).not.toHaveBeenCalled();
  });

  it('uses an explicit variant after verifying it belongs to the food', async () => {
    vi.mocked(foodRepository.getFoodVariantById).mockResolvedValue({
      ...eggsRow.default_variant,
      food_id: FOOD_ID,
    });
    vi.mocked(mealService.createMeal).mockResolvedValue({
      id: MEAL_ID,
      name: 'Oats',
    });
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal',
        meal_name: 'Oats',
        foods: [
          { food_id: FOOD_ID, variant_id: VARIANT_ID, quantity: 50, unit: 'g' },
        ],
      },
      opts
    );
    expect(result).toBe('✅ Meal "Oats" created with 1 ingredients.');
    expect(foodRepository.getFoodById).not.toHaveBeenCalled();
    expect(mealService.createMeal).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        foods: [
          {
            food_id: FOOD_ID,
            item_type: 'food',
            variant_id: VARIANT_ID,
            quantity: 50,
            unit: 'g',
            ...EGGS_SNAPSHOT,
          },
        ],
      })
    );
  });

  it('rejects a variant that belongs to a different food', async () => {
    vi.mocked(foodRepository.getFoodVariantById).mockResolvedValue({
      ...eggsRow.default_variant,
      food_id: FOOD_ID_2,
    });
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal',
        meal_name: 'Oats',
        foods: [
          { food_id: FOOD_ID, variant_id: VARIANT_ID, quantity: 50, unit: 'g' },
        ],
      },
      opts
    );
    expect(result).toBe(
      `Error [VALIDATION]: Variant '${VARIANT_ID}' does not belong to food '${FOOD_ID}' — use a variant id from search_food, or omit variant_id to use the default serving`
    );
    expect(mealService.createMeal).not.toHaveBeenCalled();
  });

  it('falls back to the first listed variant when the food has no default', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue({
      ...eggsRow,
      default_variant: null,
    });
    vi.mocked(foodRepository.getFoodVariantsByFoodId).mockResolvedValue([
      eggsRow.default_variant,
    ]);
    vi.mocked(mealService.createMeal).mockResolvedValue({
      id: MEAL_ID,
      name: 'Oats',
    });
    await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal',
        meal_name: 'Oats',
        foods: [{ food_id: FOOD_ID, quantity: 50, unit: 'g' }],
      },
      opts
    );
    expect(mealService.createMeal).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        foods: [expect.objectContaining({ variant_id: VARIANT_ID })],
      })
    );
  });

  it('falls back past a null-id default_variant JSON object', async () => {
    // json_build_object under a LEFT JOIN yields a truthy {"id": null, ...}
    // object for foods with no default variant.
    vi.mocked(foodRepository.getFoodById).mockResolvedValue({
      ...eggsRow,
      default_variant: { ...eggsRow.default_variant, id: null },
    });
    vi.mocked(foodRepository.getFoodVariantsByFoodId).mockResolvedValue([
      eggsRow.default_variant,
    ]);
    vi.mocked(mealService.createMeal).mockResolvedValue({
      id: MEAL_ID,
      name: 'Oats',
    });
    await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal',
        meal_name: 'Oats',
        foods: [{ food_id: FOOD_ID, quantity: 50, unit: 'g' }],
      },
      opts
    );
    expect(mealService.createMeal).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        foods: [expect.objectContaining({ variant_id: VARIANT_ID })],
      })
    );
  });

  it('rejects an unknown food before writing anything', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue(null);
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal',
        meal_name: 'Oats',
        foods: [{ food_id: FOOD_ID, quantity: 50, unit: 'g' }],
      },
      opts
    );
    expect(result).toBe(
      `Error [VALIDATION]: Food with ID '${FOOD_ID}' was not found or has no serving data — use search_food to find a valid food_id`
    );
    expect(mealService.createMeal).not.toHaveBeenCalled();
  });

  it('requires at least one ingredient', async () => {
    const result = await tools.sparky_manage_food.execute!(
      { action: 'create_meal', meal_name: 'Empty', foods: [] },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: create_meal call was invalid — foods: Too small: expected array to have >=1 items. Retry sparky_manage_food with all required fields, for example: {"action":"create_meal","meal_name":"Empty","foods":"<foods>"}'
    );
    expect(mealService.createMeal).not.toHaveBeenCalled();
  });
});

describe('update_meal', () => {
  it('requires a meal identifier', async () => {
    const result = await tools.sparky_manage_food.execute!(
      { action: 'update_meal', new_name: 'Renamed' },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Either meal_id or meal_name must be provided'
    );
  });

  it('requires at least one updatable field', async () => {
    const result = await tools.sparky_manage_food.execute!(
      { action: 'update_meal', meal_id: MEAL_ID },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Nothing to update — provide new_name, description, total_servings, serving_unit, or foods'
    );
  });

  it('updates by id after verifying ownership, replacing ingredients', async () => {
    vi.mocked(mealService.getMealById).mockResolvedValue({
      id: MEAL_ID,
      user_id: 'user-1',
      name: 'Protein Oats',
    });
    vi.mocked(foodRepository.getFoodById).mockResolvedValue(eggsRow);
    vi.mocked(mealService.updateMeal).mockResolvedValue({
      id: MEAL_ID,
      name: 'Protein Oats v2',
    });

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_meal',
        meal_id: MEAL_ID,
        new_name: 'Protein Oats v2',
        foods: [{ food_id: FOOD_ID, quantity: 100, unit: 'g' }],
      },
      opts
    );

    expect(result).toBe('✅ Meal "Protein Oats v2" updated.');
    expect(mealService.updateMeal).toHaveBeenCalledWith('user-1', MEAL_ID, {
      name: 'Protein Oats v2',
      foods: [
        {
          food_id: FOOD_ID,
          item_type: 'food',
          variant_id: VARIANT_ID,
          quantity: 100,
          unit: 'g',
          ...EGGS_SNAPSHOT,
        },
      ],
    });
  });

  it("refuses to update another user's public meal", async () => {
    vi.mocked(mealService.getMealById).mockResolvedValue({
      id: MEAL_ID,
      user_id: 'someone-else',
      name: 'Shared Meal',
    });
    const result = await tools.sparky_manage_food.execute!(
      { action: 'update_meal', meal_id: MEAL_ID, new_name: 'Mine now' },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Only your own meals can be updated'
    );
    expect(mealService.updateMeal).not.toHaveBeenCalled();
  });

  it('resolves by name among own meals only and rejects duplicates', async () => {
    vi.mocked(mealService.searchMeals).mockResolvedValue([
      { id: MEAL_ID, name: 'Protein Oats', user_id: 'user-1' },
      { id: MEAL_ID_2, name: 'protein oats', user_id: 'user-1' },
      { id: FOOD_ID_2, name: 'Protein Oats', user_id: 'someone-else' },
    ]);
    const result = await tools.sparky_manage_food.execute!(
      { action: 'update_meal', meal_name: 'Protein Oats', new_name: 'X' },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Multiple meals are named "Protein Oats" — use meal_id (see search_meal)'
    );
  });

  it('updates by name when exactly one own meal matches', async () => {
    vi.mocked(mealService.searchMeals).mockResolvedValue([
      { id: MEAL_ID, name: 'Protein Oats', user_id: 'user-1' },
      { id: FOOD_ID_2, name: 'Protein Oats', user_id: 'someone-else' },
    ]);
    vi.mocked(mealService.updateMeal).mockResolvedValue({
      id: MEAL_ID,
      name: 'Protein Oats',
    });
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_meal',
        meal_name: 'Protein Oats',
        description: 'Updated notes',
      },
      opts
    );
    expect(result).toBe('✅ Meal "Protein Oats" updated.');
    expect(mealService.updateMeal).toHaveBeenCalledWith('user-1', MEAL_ID, {
      description: 'Updated notes',
    });
  });

  it('maps an unknown meal name to NOT_FOUND', async () => {
    vi.mocked(mealService.searchMeals).mockResolvedValue([]);
    const result = await tools.sparky_manage_food.execute!(
      { action: 'update_meal', meal_name: 'Nope', new_name: 'X' },
      opts
    );
    expect(result).toBe(
      "Error [NOT_FOUND]: Meal with ID 'Nope' not found.\n\nSuggestion: Check the ID and try again."
    );
  });
});

describe('meal plans', () => {
  const PLAN_ID = '77777777-7777-4777-8777-777777777777';
  const PLAN_ID_2 = '88888888-8888-4888-8888-888888888888';
  const TODAY = todayInZone('UTC');

  it('get_meal_plans returns full structured plans so a replace-style update can rebuild them', async () => {
    vi.mocked(mealPlanTemplateService.getMealPlanTemplates).mockResolvedValue([
      {
        id: PLAN_ID,
        user_id: 'user-1',
        plan_name: 'Cut Week',
        description: 'High protein',
        start_date: new Date(2026, 7, 17),
        end_date: null,
        is_active: true,
        assignments: [
          {
            id: 'assignment-row-1',
            day_of_week: 1,
            meal_type: 'Breakfast',
            meal_type_id: 'default-id',
            item_type: 'meal',
            meal_id: MEAL_ID,
            meal_name: 'Protein Oats',
            food_id: null,
            food_name: null,
            variant_id: null,
            quantity: '1.00',
            unit: 'serving',
          },
          {
            id: 'assignment-row-2',
            day_of_week: 2,
            meal_type: 'Lunch',
            meal_type_id: 'lunch-id',
            item_type: 'food',
            meal_id: null,
            meal_name: null,
            food_id: FOOD_ID,
            food_name: 'Eggs',
            variant_id: VARIANT_ID,
            quantity: '150.00',
            unit: 'g',
          },
        ],
      },
    ]);

    const result = await tools.sparky_manage_food.execute!(
      { action: 'get_meal_plans' },
      opts
    );

    // Surrogate assignment row ids are dropped: the repository reinserts all
    // assignment rows on update, and the strict update schema would reject
    // them if the model echoed them back.
    expect(result).toBe(
      JSON.stringify([
        {
          id: PLAN_ID,
          plan_name: 'Cut Week',
          description: 'High protein',
          start_date: '2026-08-17',
          end_date: null,
          is_active: true,
          assignments: [
            {
              day: 'Mon',
              day_of_week: 1,
              meal_type: 'Breakfast',
              meal_type_id: 'default-id',
              item_type: 'meal',
              meal_id: MEAL_ID,
              meal_name: 'Protein Oats',
              food_id: null,
              food_name: null,
              variant_id: null,
              quantity: 1,
              unit: 'serving',
            },
            {
              day: 'Tue',
              day_of_week: 2,
              meal_type: 'Lunch',
              meal_type_id: 'lunch-id',
              item_type: 'food',
              meal_id: null,
              meal_name: null,
              food_id: FOOD_ID,
              food_name: 'Eggs',
              variant_id: VARIANT_ID,
              quantity: 150,
              unit: 'g',
            },
          ],
        },
      ])
    );
  });

  it('create_meal_plan resolves meal types and applies defaults', async () => {
    vi.mocked(mealPlanTemplateService.getMealPlanTemplates).mockResolvedValue(
      []
    );
    vi.mocked(mealTypeRepository.getMealTypeById).mockResolvedValue({
      id: MEAL_TYPE_ID,
      name: 'Second breakfast',
    });
    vi.mocked(mealService.getMealById).mockResolvedValue({
      id: MEAL_ID,
      name: 'Protein Oats',
      user_id: 'user-1',
      foods: [{ food_id: FOOD_ID }],
    });
    vi.mocked(foodRepository.getFoodVariantById).mockResolvedValue({
      ...eggsRow.default_variant,
      food_id: FOOD_ID,
    });
    vi.mocked(mealPlanTemplateService.createMealPlanTemplate).mockResolvedValue(
      {
        id: PLAN_ID,
        plan_name: 'Cut Week',
        is_active: false,
      }
    );

    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal_plan',
        plan_name: 'Cut Week',
        assignments: [
          {
            day_of_week: 1,
            meal_type: 'Breakfast',
            item_type: 'meal',
            meal_id: MEAL_ID,
          },
          {
            day_of_week: 2,
            meal_type_id: MEAL_TYPE_ID,
            item_type: 'food',
            food_id: FOOD_ID,
            variant_id: VARIANT_ID,
            quantity: 150,
            unit: 'g',
          },
        ],
      },
      opts
    );

    expect(result).toBe('✅ Meal plan "Cut Week" created: 2 assignments.');
    expect(mealPlanTemplateService.createMealPlanTemplate).toHaveBeenCalledWith(
      'user-1',
      {
        plan_name: 'Cut Week',
        description: '',
        start_date: TODAY,
        end_date: null,
        is_active: false,
        assignments: [
          {
            day_of_week: 1,
            meal_type_id: 'default-id',
            item_type: 'meal',
            meal_id: MEAL_ID,
            quantity: 1,
            unit: 'serving',
          },
          {
            day_of_week: 2,
            meal_type_id: MEAL_TYPE_ID,
            item_type: 'food',
            food_id: FOOD_ID,
            variant_id: VARIANT_ID,
            quantity: 150,
            unit: 'g',
          },
        ],
        currentClientDate: TODAY,
      }
    );
  });

  it('create_meal_plan announces diary generation for active plans', async () => {
    vi.mocked(mealPlanTemplateService.createMealPlanTemplate).mockResolvedValue(
      {
        id: PLAN_ID,
        plan_name: 'Bulk Week',
        is_active: true,
      }
    );
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal_plan',
        plan_name: 'Bulk Week',
        is_active: true,
        assignments: [
          {
            day_of_week: 0,
            meal_type: 'Dinner',
            item_type: 'meal',
            meal_id: MEAL_ID,
          },
        ],
      },
      opts
    );
    expect(result).toBe(
      '✅ Meal plan "Bulk Week" created: 1 assignments. Plan is active — diary food entries were generated.'
    );
  });

  it('create_meal_plan rejects an assignment without a meal type', async () => {
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal_plan',
        plan_name: 'Broken',
        assignments: [{ day_of_week: 1, item_type: 'meal', meal_id: MEAL_ID }],
      },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Assignment for day 1 needs meal_type_id or meal_type'
    );
    expect(
      mealPlanTemplateService.createMealPlanTemplate
    ).not.toHaveBeenCalled();
  });

  it('create_meal_plan rejects an unknown meal type name', async () => {
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal_plan',
        plan_name: 'Broken',
        assignments: [
          {
            day_of_week: 1,
            meal_type: 'Elevenses',
            item_type: 'meal',
            meal_id: MEAL_ID,
          },
        ],
      },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Meal type "Elevenses" was not found or is not available to this user.'
    );
  });

  it('create_meal_plan rejects a food assignment without food_id', async () => {
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal_plan',
        plan_name: 'Broken',
        assignments: [
          { day_of_week: 1, meal_type: 'Lunch', item_type: 'food' },
        ],
      },
      opts
    );
    expect(result).toBe(
      "Error [VALIDATION]: An item_type 'food' assignment needs food_id (and no meal_id)"
    );
  });

  it('create_meal_plan rejects an inverted date range', async () => {
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal_plan',
        plan_name: 'Broken',
        start_date: '2026-09-01',
        end_date: '2026-08-01',
        assignments: [
          {
            day_of_week: 1,
            meal_type: 'Lunch',
            item_type: 'meal',
            meal_id: MEAL_ID,
          },
        ],
      },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: end_date must be on or after start_date'
    );
    expect(
      mealPlanTemplateService.createMealPlanTemplate
    ).not.toHaveBeenCalled();
  });

  it('update_meal_plan requires a plan identifier and an update field', async () => {
    const noId = await tools.sparky_manage_food.execute!(
      { action: 'update_meal_plan', new_name: 'X' },
      opts
    );
    expect(noId).toBe(
      'Error [VALIDATION]: Either plan_id or plan_name must be provided'
    );
    const noFields = await tools.sparky_manage_food.execute!(
      { action: 'update_meal_plan', plan_id: PLAN_ID },
      opts
    );
    expect(noFields).toBe(
      'Error [VALIDATION]: Nothing to update — provide new_name, description, start_date, end_date, is_active, or assignments'
    );
  });

  it('update_meal_plan maps an unknown plan id to NOT_FOUND', async () => {
    vi.mocked(mealPlanTemplateService.getMealPlanTemplates).mockResolvedValue(
      []
    );
    const result = await tools.sparky_manage_food.execute!(
      { action: 'update_meal_plan', plan_id: PLAN_ID, new_name: 'X' },
      opts
    );
    expect(result).toBe(
      `Error [NOT_FOUND]: Meal Plan with ID '${PLAN_ID}' not found.\n\nSuggestion: Check the ID and try again.`
    );
  });

  it('update_meal_plan rejects an ambiguous plan name', async () => {
    vi.mocked(mealPlanTemplateService.getMealPlanTemplates).mockResolvedValue([
      { id: PLAN_ID, plan_name: 'Cut Week', is_active: true },
      { id: PLAN_ID_2, plan_name: 'cut week', is_active: false },
    ]);
    const result = await tools.sparky_manage_food.execute!(
      { action: 'update_meal_plan', plan_name: 'Cut Week', new_name: 'X' },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Multiple meal plans are named "Cut Week" — use plan_id (see get_meal_plans)'
    );
  });

  it('update_meal_plan merges unspecified fields and resends the existing schedule', async () => {
    vi.mocked(mealPlanTemplateService.getMealPlanTemplates).mockResolvedValue([
      {
        id: PLAN_ID,
        plan_name: 'Cut Week',
        description: 'High protein',
        start_date: new Date(2026, 7, 17),
        end_date: null,
        is_active: true,
        assignments: [
          {
            id: 'assignment-row-1',
            day_of_week: 1,
            meal_type: 'Breakfast',
            meal_type_id: 'default-id',
            item_type: 'meal',
            meal_id: MEAL_ID,
            meal_name: 'Protein Oats',
            food_id: null,
            food_name: null,
            variant_id: null,
            quantity: '1.00',
            unit: 'serving',
          },
        ],
      },
    ]);
    vi.mocked(mealPlanTemplateService.updateMealPlanTemplate).mockResolvedValue(
      { id: PLAN_ID, plan_name: 'Cut Week v2' }
    );

    const result = await tools.sparky_manage_food.execute!(
      { action: 'update_meal_plan', plan_id: PLAN_ID, new_name: 'Cut Week v2' },
      opts
    );

    expect(result).toBe('✅ Meal plan "Cut Week v2" updated.');
    // The repository deletes ALL assignment rows unconditionally, so the
    // existing schedule must be resent even though only the name changed.
    expect(mealPlanTemplateService.updateMealPlanTemplate).toHaveBeenCalledWith(
      PLAN_ID,
      'user-1',
      {
        plan_name: 'Cut Week v2',
        description: 'High protein',
        start_date: '2026-08-17',
        end_date: null,
        is_active: true,
        assignments: [
          {
            day_of_week: 1,
            meal_type_id: 'default-id',
            item_type: 'meal',
            meal_id: MEAL_ID,
            food_id: null,
            variant_id: null,
            quantity: 1,
            unit: 'serving',
          },
        ],
        currentClientDate: TODAY,
      }
    );
  });

  it('update_meal_plan resolves a replacement schedule', async () => {
    vi.mocked(foodRepository.getFoodById).mockResolvedValue(eggsRow);
    vi.mocked(mealPlanTemplateService.getMealPlanTemplates).mockResolvedValue([
      {
        id: PLAN_ID,
        plan_name: 'Cut Week',
        description: null,
        start_date: new Date(2026, 7, 17),
        end_date: null,
        is_active: false,
        assignments: [],
      },
    ]);
    vi.mocked(mealPlanTemplateService.updateMealPlanTemplate).mockResolvedValue(
      { id: PLAN_ID, plan_name: 'Cut Week' }
    );

    await tools.sparky_manage_food.execute!(
      {
        action: 'update_meal_plan',
        plan_name: 'Cut Week',
        assignments: [
          {
            day_of_week: 3,
            meal_type: 'Dinner',
            item_type: 'food',
            food_id: FOOD_ID,
            quantity: 200,
            unit: 'g',
          },
        ],
      },
      opts
    );

    expect(mealPlanTemplateService.updateMealPlanTemplate).toHaveBeenCalledWith(
      PLAN_ID,
      'user-1',
      expect.objectContaining({
        assignments: [
          {
            day_of_week: 3,
            meal_type_id: 'dinner-id',
            item_type: 'food',
            food_id: FOOD_ID,
            variant_id: VARIANT_ID,
            quantity: 200,
            unit: 'g',
          },
        ],
      })
    );
  });

  it('create_meal_plan rejects a composed meal whose ingredients would be dropped', async () => {
    vi.mocked(mealPlanTemplateService.getMealPlanTemplates).mockResolvedValue(
      []
    );
    vi.mocked(mealService.getMealById).mockResolvedValue({
      id: MEAL_ID,
      name: 'Meal Prep Combo',
      user_id: 'user-1',
      foods: [{ food_id: FOOD_ID }, { child_meal_id: MEAL_ID_2 }],
    });
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal_plan',
        plan_name: 'Combo Week',
        assignments: [
          {
            day_of_week: 1,
            meal_type: 'Breakfast',
            item_type: 'meal',
            meal_id: MEAL_ID,
          },
        ],
      },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: Meal "Meal Prep Combo" contains nested meals — meal plans can only schedule meals made of plain foods (nested ingredients would be dropped when diary entries are generated)'
    );
    expect(
      mealPlanTemplateService.createMealPlanTemplate
    ).not.toHaveBeenCalled();
  });

  it('create_meal_plan rejects an unknown meal id before writing', async () => {
    vi.mocked(mealPlanTemplateService.getMealPlanTemplates).mockResolvedValue(
      []
    );
    vi.mocked(mealService.getMealById).mockRejectedValue(
      new Error('Meal not found.')
    );
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal_plan',
        plan_name: 'Ghost Week',
        assignments: [
          {
            day_of_week: 1,
            meal_type: 'Breakfast',
            item_type: 'meal',
            meal_id: MEAL_ID,
          },
        ],
      },
      opts
    );
    expect(result).toBe(
      `Error [VALIDATION]: Meal with ID '${MEAL_ID}' was not found — use search_meal to find a valid meal_id`
    );
  });

  it('create_meal_plan refuses to duplicate an existing plan name', async () => {
    vi.mocked(mealPlanTemplateService.getMealPlanTemplates).mockResolvedValue([
      { id: PLAN_ID, plan_name: 'Cut Week', is_active: true },
    ]);
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'create_meal_plan',
        plan_name: 'cut week',
        assignments: [
          {
            day_of_week: 1,
            meal_type: 'Breakfast',
            item_type: 'meal',
            meal_id: MEAL_ID,
          },
        ],
      },
      opts
    );
    expect(result).toBe(
      `Error [VALIDATION]: A meal plan named "cut week" already exists (plan_id ${PLAN_ID}) — use update_meal_plan to change it, or choose a different name`
    );
    expect(
      mealPlanTemplateService.createMealPlanTemplate
    ).not.toHaveBeenCalled();
  });

  it('update_meal_plan accepts a schedule echoed back from get_meal_plans', async () => {
    vi.mocked(mealPlanTemplateService.getMealPlanTemplates).mockResolvedValue([
      {
        id: PLAN_ID,
        plan_name: 'Cut Week',
        description: null,
        start_date: new Date(2026, 7, 17),
        end_date: null,
        is_active: false,
        assignments: [],
      },
    ]);
    vi.mocked(mealTypeRepository.getMealTypeById).mockResolvedValue({
      id: MEAL_TYPE_ID,
      name: 'Second breakfast',
    });
    vi.mocked(mealService.getMealById).mockResolvedValue({
      id: MEAL_ID,
      name: 'Protein Oats',
      user_id: 'user-1',
      foods: [{ food_id: FOOD_ID }],
    });
    vi.mocked(mealPlanTemplateService.updateMealPlanTemplate).mockResolvedValue(
      { id: PLAN_ID, plan_name: 'Cut Week' }
    );

    // A get_meal_plans assignment row verbatim: display fields and SQL nulls
    // must be stripped by normalization instead of failing strict parsing.
    const result = await tools.sparky_manage_food.execute!(
      {
        action: 'update_meal_plan',
        plan_id: PLAN_ID,
        assignments: [
          {
            day: 'Mon',
            day_of_week: 1,
            meal_type: 'Second breakfast',
            meal_type_id: MEAL_TYPE_ID,
            item_type: 'meal',
            meal_id: MEAL_ID,
            meal_name: 'Protein Oats',
            food_id: null,
            food_name: null,
            variant_id: null,
            quantity: 1,
            unit: 'serving',
          },
        ],
      } as unknown as Parameters<
        NonNullable<typeof tools.sparky_manage_food.execute>
      >[0],
      opts
    );
    expect(result).toBe('✅ Meal plan "Cut Week" updated.');
  });

  it('update_meal_plan rejects a merged inverted date range', async () => {
    vi.mocked(mealPlanTemplateService.getMealPlanTemplates).mockResolvedValue([
      {
        id: PLAN_ID,
        plan_name: 'Cut Week',
        description: null,
        start_date: new Date(2026, 7, 17),
        end_date: null,
        is_active: true,
        assignments: [],
      },
    ]);
    const result = await tools.sparky_manage_food.execute!(
      { action: 'update_meal_plan', plan_id: PLAN_ID, end_date: '2026-08-01' },
      opts
    );
    expect(result).toBe(
      'Error [VALIDATION]: end_date must be on or after start_date'
    );
    expect(
      mealPlanTemplateService.updateMealPlanTemplate
    ).not.toHaveBeenCalled();
  });
});

describe('get_grocery_list', () => {
  it('renders the summed shopping list and flags unexpanded nested meals', async () => {
    vi.mocked(mealPlanTemplateRepository.getGroceryListItems).mockResolvedValue(
      {
        items: [
          {
            food_name: 'Chicken breast',
            unit: 'g',
            total_quantity: 600,
            times: 3,
          },
          {
            food_name: 'Greek yogurt',
            unit: null,
            total_quantity: null,
            times: 2,
          },
        ],
        unexpanded_meal_count: 1,
      }
    );

    const result = await tools.sparky_manage_food.execute!(
      { action: 'get_grocery_list', week_start: '2026-08-24' },
      opts
    );

    expect(result).toBe(
      '# Grocery list (plan week of 2026-08-24)\n\n' +
        '- Chicken breast — 600 g (3× this week)\n' +
        '- Greek yogurt — amount not set (2× this week)\n' +
        '\n1 nested meal(s) inside planned meals were NOT expanded — open those meals to add their ingredients.'
    );
    expect(mealPlanTemplateRepository.getGroceryListItems).toHaveBeenCalledWith(
      'user-1',
      '2026-08-24'
    );
  });

  it('explains when no active plan covers the requested week', async () => {
    vi.mocked(mealPlanTemplateRepository.getGroceryListItems).mockResolvedValue(
      { items: [], unexpanded_meal_count: 0 }
    );

    const result = await tools.sparky_manage_food.execute!(
      { action: 'get_grocery_list' },
      opts
    );

    expect(result).toBe(
      `No active meal plan covers ${todayInZone('UTC')}, so there is nothing to buy. Create or activate a meal plan first (create_meal_plan / update_meal_plan).`
    );
  });

  it('infers get_grocery_list from a bare week_start', async () => {
    vi.mocked(mealPlanTemplateRepository.getGroceryListItems).mockResolvedValue(
      { items: [], unexpanded_meal_count: 0 }
    );

    await tools.sparky_manage_food.execute!({ week_start: '2026-08-24' }, opts);

    expect(mealPlanTemplateRepository.getGroceryListItems).toHaveBeenCalledWith(
      'user-1',
      '2026-08-24'
    );
  });
});
