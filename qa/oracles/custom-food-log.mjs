#!/usr/bin/env node
/**
 * The verdict for qa/flows/custom-food-log.yaml.
 *
 * The flow only proves that taps landed. Everything that makes the feature
 * correct is here: that the numbers typed into the form are the numbers stored,
 * that the diary entry points at the food and the variant that were actually
 * created rather than at some other row with the same name, that the entry's
 * denormalized nutrition agrees with the variant it claims to come from, and
 * that the day is today's calendar day rather than a UTC-shifted one.
 *
 * Two failure modes are specifically why this exists, because both leave a
 * green flow and a plausible screen behind them:
 *   - keyboard occlusion typed "50" and "212" into ONE field, saving 505212 as
 *     the serving size and no calories at all;
 *   - a food left over from a previous run satisfied the search, so the flow
 *     logged last run's food and never noticed this run's Save had failed.
 */
import { createReport } from './lib/report.mjs';
import { query, qaAccount, lit } from './lib/db.mjs';

const report = createReport('custom-food-log');
const runDir = process.env.QA_RUN_DIR;
const { userId } = qaAccount();

// What the flow types. Kept here as one object so the flow and the oracle can
// be read against each other; a change to either is meant to be obvious.
const EXPECTED = {
  name: 'QA Harness Oat Bar',
  servingSize: 50,
  servingUnit: 'serving',
  calories: 212,
};

// The app dates an entry by the device's calendar day, and the simulator shares
// this machine's timezone — so the expected day is the local one. Deriving it
// from `toISOString()` would be the very timezone bug this check exists to
// catch, in the checker.
const today = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const num = (v) => (v === null || v === undefined ? null : Number(v));

// --- the custom food --------------------------------------------------------
const foods = query(`
  SELECT id, name, is_custom, is_quick_food, user_id
  FROM foods
  WHERE user_id = ${lit(userId)} AND name = ${lit(EXPECTED.name)}
`);

if (
  !report.check(
    'food.created',
    foods.length === 1,
    `${foods.length} food row(s) named "${EXPECTED.name}" for the QA user (expected 1)`,
    foods
  )
) {
  // Nothing below can mean anything without the food, and a cascade of
  // failures about missing variants would bury the one that matters.
  report.finish(runDir);
}

const food = foods[0];
report.check(
  'food.is-custom',
  food.is_custom === true,
  `saved as a custom food (is_custom = ${food.is_custom})`,
  food
);

const variants = query(`
  SELECT id, serving_size, serving_unit, calories, is_default
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
report.check(
  'variant.serving-size',
  num(variant.serving_size) === EXPECTED.servingSize,
  `serving size stored as ${variant.serving_size} (typed ${EXPECTED.servingSize})`,
  variant
);
report.check(
  'variant.serving-unit',
  variant.serving_unit === EXPECTED.servingUnit,
  `serving unit stored as "${variant.serving_unit}"`,
  variant
);
report.check(
  'variant.calories',
  num(variant.calories) === EXPECTED.calories,
  `calories stored as ${variant.calories} (typed ${EXPECTED.calories})`,
  variant
);

// --- the diary entry --------------------------------------------------------
const entries = query(`
  SELECT e.id, e.food_id, e.variant_id, e.quantity, e.unit, e.entry_date::text AS entry_date,
         e.food_name, e.serving_size, e.serving_unit, e.calories, e.meal_type_id,
         m.name AS meal_name
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

// The linkage checks are the ones a same-named leftover row would fail: the
// entry has to point at the food and the variant this run created, not merely
// at something that prints the same on screen.
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
  'entry.date-is-today',
  entry.entry_date === today,
  `logged on ${entry.entry_date} (today is ${today})`,
  { entryDate: entry.entry_date, expected: today }
);

// Quantity is not pinned to a typed value: the detail sheet pre-fills it from
// the variant and the flow accepts that default, so the honest assertion is
// that something positive was recorded. Pinning it would need a testID on the
// sheet's stepper input, which is the follow-up if this ever needs to be
// stronger.
report.check(
  'entry.quantity-positive',
  num(entry.quantity) > 0,
  `quantity recorded as ${entry.quantity}`,
  entry
);
report.check(
  'entry.meal-type',
  Boolean(entry.meal_type_id),
  entry.meal_type_id ? `filed under "${entry.meal_name}"` : 'no meal type on the entry',
  entry
);

// The entry carries its own copy of the nutrition so the diary still reads
// correctly after the food is edited or deleted. A mismatch here means the
// snapshot was taken from something other than the variant it links to —
// which is invisible on screen until the food changes months later.
const snapshotMismatches = [];
if (entry.food_name !== food.name) {
  snapshotMismatches.push({ field: 'food_name', stored: entry.food_name, expected: food.name });
}
if (num(entry.serving_size) !== num(variant.serving_size)) {
  snapshotMismatches.push({
    field: 'serving_size',
    stored: entry.serving_size,
    expected: variant.serving_size,
  });
}
if (entry.serving_unit !== variant.serving_unit) {
  snapshotMismatches.push({
    field: 'serving_unit',
    stored: entry.serving_unit,
    expected: variant.serving_unit,
  });
}
if (num(entry.calories) !== num(variant.calories)) {
  snapshotMismatches.push({
    field: 'calories',
    stored: entry.calories,
    expected: variant.calories,
  });
}
report.check(
  'entry.snapshot-matches-variant',
  snapshotMismatches.length === 0,
  snapshotMismatches.length === 0
    ? 'denormalized nutrition on the entry matches the variant'
    : `${snapshotMismatches.length} field(s) disagree with the variant`,
  snapshotMismatches
);

report.finish(runDir);
