#!/usr/bin/env node
/**
 * The verdict for qa/flows/saved-meal.yaml.
 *
 * A meal is the app's one composite write: saving it touches `meals` and
 * `meal_foods`, logging it writes a `food_entry_meals` header AND a
 * `food_entries` row per ingredient, and editing the servings has to rescale
 * those component rows without disturbing anything else in the diary. Every
 * one of those steps renders identically when the row underneath is wrong,
 * which is why the flow asserts none of it and this does.
 *
 * The failure modes it is built around:
 *   - the ingredient saves at the sheet's default quantity rather than the
 *     one the food actually carries, so the meal's nutrition is a fraction of
 *     what the screen totalled;
 *   - the log files itself under the meal type the screen OPENED with (which
 *     is derived from the clock) rather than the one that was picked, so the
 *     same run passes at 8am and fails at 8pm;
 *   - the servings edit updates the header and leaves the component food at
 *     its old quantity, so the diary total and the meal detail disagree;
 *   - logging a meal adopts or rewrites the loose entry that was already in
 *     the diary, which is invisible until that entry's own numbers move.
 */
import { createReport } from './lib/report.mjs';
import { query, qaAccount, lit } from './lib/db.mjs';

const report = createReport('saved-meal');
const runDir = process.env.QA_RUN_DIR;
const { userId } = qaAccount();

// What the flow builds and picks. One object so the flow and the oracle can be
// read against each other; a change to either is meant to be obvious.
const EXPECTED = {
  // From lib/create-and-log-food.yaml, which this scenario stands on.
  foodName: 'QA Harness Oat Bar',
  // The ingredient goes in at the food's own serving, which the sheet
  // pre-fills — the flow accepts it, so the meal must store exactly that.
  ingredientQuantity: 50,
  ingredientUnit: 'serving',
  mealName: 'QA Harness Bowl',
  // MealAdd's untouched defaults.
  mealTotalServings: 1,
  mealServingSize: 1,
  mealServingUnit: 'serving',
  // Picked on FoodEntryAdd rather than accepted, precisely so this is not a
  // function of what time the run happened to start.
  mealTypeName: 'dinner',
  // The logged meal opens at one serving; the flow presses the stepper once
  // and it steps by a half.
  loggedServings: 1.5,
};

// The component entry is the meal's ingredient scaled by the servings logged.
// Computed rather than written down: the point of the check is that the app
// did this multiplication, and a hardcoded 75 would still pass if the flow's
// stepper press had silently done nothing and the ingredient had gone in at 75.
const EXPECTED_COMPONENT_QUANTITY = EXPECTED.ingredientQuantity * EXPECTED.loggedServings;

// The app dates an entry by the device's calendar day, and the simulator
// shares this machine's timezone — so the expected day is the local one.
// Deriving it from `toISOString()` would be the very timezone bug this check
// exists to catch, in the checker.
const today = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const num = (v) => (v === null || v === undefined ? null : Number(v));

// --- the food the meal is built from ----------------------------------------
const foods = query(`
  SELECT f.id, f.name, v.id AS variant_id
  FROM foods f
  JOIN food_variants v ON v.food_id = f.id
  WHERE f.user_id = ${lit(userId)} AND f.name = ${lit(EXPECTED.foodName)}
`);
if (
  !report.check(
    'ingredient-food.exists',
    foods.length === 1,
    `${foods.length} food/variant pair(s) named "${EXPECTED.foodName}" (expected 1)`,
    foods
  )
) {
  // custom-food-log.mjs is the oracle that judges this food in detail; without
  // it there is no meal to judge at all, so stop rather than cascade.
  report.finish(runDir);
}
const food = foods[0];

// --- the saved meal ---------------------------------------------------------
const meals = query(`
  SELECT id, name, is_public, serving_size, serving_unit, total_servings
  FROM meals
  WHERE user_id = ${lit(userId)}
`);
if (
  !report.check(
    'meal.created',
    meals.length === 1 && meals[0].name === EXPECTED.mealName,
    meals.length === 1
      ? `one meal, named "${meals[0].name}" (expected "${EXPECTED.mealName}")`
      : `${meals.length} meal(s) for the QA user (expected 1)`,
    meals
  )
) {
  report.finish(runDir);
}
const meal = meals[0];

// A meal built in the app is the user's own. is_public is a one-way door on
// this server — sharing a meal shares every food inside it — so a default that
// drifted to true would publish an account's diary without anyone asking.
report.check(
  'meal.is-private',
  meal.is_public === false,
  `is_public = ${meal.is_public} (a meal saved without touching the share control must be private)`,
  meal
);
report.check(
  'meal.serving-defaults',
  num(meal.total_servings) === EXPECTED.mealTotalServings &&
    num(meal.serving_size) === EXPECTED.mealServingSize &&
    meal.serving_unit === EXPECTED.mealServingUnit,
  `makes ${meal.total_servings} × ${meal.serving_size} ${meal.serving_unit}` +
    ` (expected ${EXPECTED.mealTotalServings} × ${EXPECTED.mealServingSize} ${EXPECTED.mealServingUnit})`,
  meal
);

const ingredients = query(`
  SELECT meal_id, food_id, variant_id, quantity, unit
  FROM meal_foods
  WHERE meal_id = ${lit(meal.id)}
`);
if (
  report.check(
    'meal.one-ingredient',
    ingredients.length === 1,
    `${ingredients.length} ingredient row(s) on the meal (expected 1)`,
    ingredients
  )
) {
  const ingredient = ingredients[0];
  // The linkage is what a same-named leftover food would fail: the ingredient
  // has to point at the food AND the variant this run created, not merely at
  // something that prints the same on screen.
  report.check(
    'meal.ingredient-links-food-and-variant',
    ingredient.food_id === food.id && ingredient.variant_id === food.variant_id,
    'the ingredient points at the food and variant this run created',
    { ingredient, foodId: food.id, variantId: food.variant_id }
  );
  report.check(
    'meal.ingredient-quantity',
    num(ingredient.quantity) === EXPECTED.ingredientQuantity &&
      ingredient.unit === EXPECTED.ingredientUnit,
    `stored ${ingredient.quantity} ${ingredient.unit}` +
      ` (expected ${EXPECTED.ingredientQuantity} ${EXPECTED.ingredientUnit})`,
    ingredient
  );
}

// --- the logged meal --------------------------------------------------------
const logged = query(`
  SELECT fem.id, fem.meal_template_id, fem.entry_date::text AS entry_date, fem.name,
         fem.quantity, fem.unit, fem.meal_type_id, mt.name AS meal_type_name
  FROM food_entry_meals fem
  LEFT JOIN meal_types mt ON mt.id = fem.meal_type_id
  WHERE fem.user_id = ${lit(userId)}
`);
if (
  !report.check(
    'logged-meal.created',
    logged.length === 1,
    `${logged.length} logged meal(s) for the QA user (expected 1)`,
    logged
  )
) {
  report.finish(runDir);
}
const loggedMeal = logged[0];

report.check(
  'logged-meal.links-template',
  loggedMeal.meal_template_id === meal.id && loggedMeal.name === EXPECTED.mealName,
  `logged "${loggedMeal.name}" from template ${loggedMeal.meal_template_id}` +
    ` (expected the meal this run saved, ${meal.id})`,
  { loggedMeal, mealId: meal.id }
);
report.check(
  'logged-meal.date-is-today',
  loggedMeal.entry_date === today,
  `logged on ${loggedMeal.entry_date} (today is ${today})`,
  { entryDate: loggedMeal.entry_date, expected: today }
);
report.check(
  'logged-meal.meal-type-is-the-one-picked',
  loggedMeal.meal_type_name === EXPECTED.mealTypeName,
  `filed under "${loggedMeal.meal_type_name}" (expected "${EXPECTED.mealTypeName}" — the picker's` +
    ' choice, not the time-of-day default the screen opened with)',
  loggedMeal
);
report.check(
  'logged-meal.servings-were-edited',
  num(loggedMeal.quantity) === EXPECTED.loggedServings,
  `${loggedMeal.quantity} ${loggedMeal.unit} logged (expected ${EXPECTED.loggedServings} —` +
    ' one press of the stepper on EditLoggedMeal, saved)',
  loggedMeal
);

// --- what the log wrote into the diary --------------------------------------
const componentEntries = query(`
  SELECT id, food_id, variant_id, quantity, unit, entry_date::text AS entry_date,
         meal_type_id, food_entry_meal_id
  FROM food_entries
  WHERE user_id = ${lit(userId)} AND food_entry_meal_id = ${lit(loggedMeal.id)}
`);
if (
  report.check(
    'component-entry.created',
    componentEntries.length === 1,
    `${componentEntries.length} diary row(s) under the logged meal (expected 1, one per ingredient)`,
    componentEntries
  )
) {
  const component = componentEntries[0];
  report.check(
    'component-entry.links-food-and-variant',
    component.food_id === food.id && component.variant_id === food.variant_id,
    'the component row points at the food and variant the meal was built from',
    { component, foodId: food.id, variantId: food.variant_id }
  );
  // The servings edit is only real if it reached this row: the header alone
  // would leave the diary's totals disagreeing with the meal's own detail.
  report.check(
    'component-entry.rescaled-with-the-servings',
    num(component.quantity) === EXPECTED_COMPONENT_QUANTITY,
    `${component.quantity} ${component.unit} (expected ${EXPECTED_COMPONENT_QUANTITY} =` +
      ` ${EXPECTED.ingredientQuantity} in the meal × ${EXPECTED.loggedServings} servings logged)`,
    component
  );
  report.check(
    'component-entry.follows-the-header',
    component.meal_type_id === loggedMeal.meal_type_id && component.entry_date === today,
    `filed on ${component.entry_date} under the header's meal type` +
      ` (expected ${today}, and the same meal type as the logged meal)`,
    { component, headerMealTypeId: loggedMeal.meal_type_id }
  );
}

// The loose entry lib/create-and-log-food.yaml put in the diary before any of
// this. Logging a meal must leave it alone: adopting it into the meal, or
// rescaling it alongside the components, is invisible on screen until its own
// numbers move.
const looseEntries = query(`
  SELECT id, quantity, unit, food_entry_meal_id
  FROM food_entries
  WHERE user_id = ${lit(userId)} AND food_entry_meal_id IS NULL
`);
report.check(
  'standalone-entry.untouched',
  looseEntries.length === 1 && num(looseEntries[0].quantity) === EXPECTED.ingredientQuantity,
  looseEntries.length === 1
    ? `the entry logged before the meal still reads ${looseEntries[0].quantity} ${looseEntries[0].unit}` +
      ` (expected ${EXPECTED.ingredientQuantity})`
    : `${looseEntries.length} diary row(s) outside the meal (expected 1)`,
  looseEntries
);

report.finish(runDir);
