#!/usr/bin/env node
/**
 * The verdict for qa/flows/food-photo.yaml.
 *
 * This scenario has two independent bodies of evidence, and it needs both.
 *
 * The database says what was written: a food carrying the estimate's numbers,
 * a variant sized by the weight the flow typed rather than by the estimate's
 * own total, and a diary row that points at both. That is the same shape every
 * other oracle here has.
 *
 * The stub's request log says what was *sent*, and nothing in the database can
 * stand in for it. A photo flow that silently dropped the image, uploaded a
 * thumbnail, or ignored the description and weight typed into the Improve
 * screen would still write a perfectly good-looking row — because the numbers
 * in that row come from the provider's answer, which the stub gives back
 * regardless of what it was asked. So the request log is where "the photograph
 * actually got there" is checked, and it is checked against the seeded file's
 * real dimensions.
 */
import { readFileSync } from 'node:fs';
import { createReport } from './lib/report.mjs';
import { query, qaAccount, lit } from './lib/db.mjs';
import { ESTIMATE, PHOTO_WIDTH, PHOTO_HEIGHT } from '../fixtures/food-photo.mjs';

const report = createReport('food-photo');
const runDir = process.env.QA_RUN_DIR;
const { userId } = qaAccount();

// What the flow types into the Improve screen, and what it picks on the log
// screen. Kept here so the flow and the oracle can be read against each other.
const EXPECTED = {
  description: 'qa stub grilled chicken and rice',
  totalWeight: 400,
  weightUnit: 'g',
  servings: 2,
  mealType: 'dinner',
};
// The log screen multiplies servings by the serving size to get the quantity
// it stores, which is what makes 2 servings distinguishable from 1.
const EXPECTED_QUANTITY = EXPECTED.servings * EXPECTED.totalWeight;

// The app dates an entry by the device's calendar day and the simulator shares
// this machine's timezone, so the expected day is the local one. Deriving it
// from toISOString() would reproduce, in the checker, the timezone bug the
// check exists to catch.
const today = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const num = (v) => (v === null || v === undefined ? null : Number(v));

// --- what the provider was actually sent -------------------------------------
const logLines = readFileSync(process.env.QA_AI_STUB_REQUESTS, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

// expo-dev-launcher scans localhost ports looking for dev servers, so the stub
// fields a few stray `GET /`s on every run. They are recorded rather than
// ignored — a provider row pointing at the wrong path would look exactly like
// this — but they are not estimate requests.
const strays = logLines.filter((entry) => entry.unexpected || entry.error);
const requests = logLines.filter((entry) => Array.isArray(entry.images));
if (strays.length > 0) {
  report.observe(
    'provider.stray-requests',
    `${strays.length} non-estimate request(s) reached the stub`,
    strays.slice(0, 5)
  );
}

if (
  !report.check(
    'provider.one-estimate-request',
    requests.length === 1,
    `${requests.length} estimate request(s) reached the stub (expected 1)`,
    requests.map((r) => ({ at: r.at, images: r.images.length }))
  )
) {
  // Without the request there is nothing to say about what was uploaded, and
  // the database checks below would only describe a row nobody sent for.
  report.finish(runDir);
}

const request = requests[0];

report.check(
  'provider.one-image',
  request.images.length === 1,
  `${request.images.length} image(s) in the request (expected 1)`,
  request.images
);

const image = request.images[0] ?? {};
report.check(
  'provider.image-is-the-seeded-photo',
  image.width === PHOTO_WIDTH && image.height === PHOTO_HEIGHT,
  image.width
    ? `uploaded image is ${image.width}x${image.height} (seeded photo is ${PHOTO_WIDTH}x${PHOTO_HEIGHT})`
    : 'the uploaded image could not be measured',
  image
);
report.check(
  'provider.image-not-empty',
  num(image.bytes) > 0,
  `uploaded image carried ${image.bytes} bytes as ${image.mimeType}`,
  image
);

// The description and the weight are typed into the Improve screen and reach
// the provider only through the prompt the server builds. Nothing downstream
// depends on them, so a screen that dropped either one would be invisible in
// every row this run wrote.
report.check(
  'provider.prompt-carries-description',
  (request.prompt ?? '').includes(EXPECTED.description),
  `the prompt ${(request.prompt ?? '').includes(EXPECTED.description) ? 'carries' : 'is missing'} the typed description`,
  { description: EXPECTED.description, prompt: (request.prompt ?? '').slice(0, 600) }
);
const weightSlot = `${EXPECTED.totalWeight} ${EXPECTED.weightUnit}`;
report.check(
  'provider.prompt-carries-weight',
  (request.prompt ?? '').includes(weightSlot),
  `the prompt ${(request.prompt ?? '').includes(weightSlot) ? 'carries' : 'is missing'} the typed total weight ("${weightSlot}")`,
  { weightSlot, prompt: (request.prompt ?? '').slice(0, 600) }
);

// --- the food the estimate became -------------------------------------------
const foods = query(`
  SELECT id, name, provider_type, user_id
  FROM foods
  WHERE user_id = ${lit(userId)}
`);

if (
  !report.check(
    'food.created',
    foods.length === 1 && foods[0].name === ESTIMATE.meal_summary,
    `${foods.length} food row(s) for the QA user (expected 1, named "${ESTIMATE.meal_summary}")`,
    foods
  )
) {
  report.finish(runDir);
}

const food = foods[0];
// The one field that says this food came from the photo flow rather than from
// any other way of creating a food: everything else about it could have been
// typed by hand.
report.check(
  'food.provider-type',
  food.provider_type === 'food_photo_estimate',
  `saved with provider_type "${food.provider_type}"`,
  food
);

const variants = query(`
  SELECT id, serving_size, serving_unit, calories, protein, carbs, fat,
         dietary_fiber, sugars, is_default
  FROM food_variants
  WHERE food_id = ${lit(food.id)}
`);

if (
  !report.check(
    'variant.created',
    variants.length === 1,
    `${variants.length} variant(s) for the food (expected 1)`,
    variants
  )
) {
  report.finish(runDir);
}

const variant = variants[0];

// The serving size is the ONE number on the review form that is not the
// provider's. The estimate said 465 g; the flow typed 400 g into the Improve
// screen, and the review form is supposed to prefer what the user said.
report.check(
  'variant.serving-size-is-the-typed-weight',
  num(variant.serving_size) === EXPECTED.totalWeight &&
    variant.serving_unit === EXPECTED.weightUnit,
  `serving stored as ${variant.serving_size} ${variant.serving_unit} (typed ${EXPECTED.totalWeight} ${EXPECTED.weightUnit}; the estimate's own total was ${ESTIMATE.totals.total_grams} g)`,
  variant
);

// Every macro the provider returned, end to end. These are the numbers the
// stub invented, so any of them arriving changed means something between the
// provider dispatch and the food row rewrote it.
const macroMismatches = [];
for (const [column, expected] of [
  ['calories', ESTIMATE.totals.calories_kcal],
  ['protein', ESTIMATE.totals.protein_g],
  ['carbs', ESTIMATE.totals.carbs_g],
  ['fat', ESTIMATE.totals.fat_g],
  ['dietary_fiber', ESTIMATE.totals.fiber_g],
  ['sugars', ESTIMATE.totals.sugar_g],
]) {
  if (num(variant[column]) !== expected) {
    macroMismatches.push({ column, stored: variant[column], expected });
  }
}
report.check(
  'variant.macros-match-the-estimate',
  macroMismatches.length === 0,
  macroMismatches.length === 0
    ? "the variant carries the provider's totals unchanged"
    : `${macroMismatches.length} macro(s) differ from what the provider returned`,
  macroMismatches
);

// --- the diary entry ---------------------------------------------------------
const entries = query(`
  SELECT e.id, e.food_id, e.variant_id, e.quantity, e.unit,
         e.entry_date::text AS entry_date, e.food_name, e.calories,
         e.meal_type_id, m.name AS meal_name
  FROM food_entries e
  LEFT JOIN meal_types m ON m.id = e.meal_type_id
  WHERE e.user_id = ${lit(userId)}
`);

if (
  !report.check(
    'entry.created',
    entries.length === 1,
    `${entries.length} diary entr(y/ies) for the QA user (expected 1)`,
    entries
  )
) {
  report.finish(runDir);
}

const entry = entries[0];
report.check(
  'entry.links-food',
  entry.food_id === food.id,
  'entry points at the food this run created',
  { entryFoodId: entry.food_id, foodId: food.id }
);
report.check(
  'entry.links-variant',
  entry.variant_id === variant.id,
  'entry points at that food’s variant',
  { entryVariantId: entry.variant_id, variantId: variant.id }
);
report.check(
  'entry.quantity',
  num(entry.quantity) === EXPECTED_QUANTITY && entry.unit === EXPECTED.weightUnit,
  `logged ${entry.quantity} ${entry.unit}; expected ${EXPECTED_QUANTITY} ${EXPECTED.weightUnit} (${EXPECTED.servings} servings x ${EXPECTED.totalWeight} ${EXPECTED.weightUnit})`,
  entry
);
report.check(
  'entry.date-is-today',
  entry.entry_date === today,
  `logged on ${entry.entry_date} (today is ${today})`,
  { entryDate: entry.entry_date, expected: today }
);
// The meal type is picked on the log screen rather than accepted, so this is
// an assertion about a tap and not about the clock.
report.check(
  'entry.meal-type',
  entry.meal_name === EXPECTED.mealType,
  `filed under "${entry.meal_name}" (the flow picked ${EXPECTED.mealType})`,
  entry
);
report.check(
  'entry.snapshot-matches-food',
  entry.food_name === food.name && num(entry.calories) === ESTIMATE.totals.calories_kcal,
  'the entry’s denormalized name and calories match the food it links to',
  { foodName: entry.food_name, calories: entry.calories }
);

report.finish(runDir);
