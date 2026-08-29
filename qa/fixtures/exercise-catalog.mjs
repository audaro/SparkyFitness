/**
 * The synthetic exercise catalog the suggested-workout scenario is generated
 * from, and the single definition both ends of it read.
 *
 * WHY A CATALOG HAS TO BE SEEDED AT ALL. A fresh QA database has zero
 * exercises — the server ships no bundled catalog, and the real ones are
 * imported by the user from upstream datasets. The workout generator does not
 * simply produce a smaller workout when a target muscle has no candidate: it
 * reaches out to free-exercise-db over the network, imports an exercise and
 * downloads its images (`importMissingMuscles` in
 * SparkyFitnessServer/services/workoutRecommendationService.ts). That is a
 * third party in the middle of a QA run, and the exercise it picks is whatever
 * upstream happens to return today — so the run would be neither offline nor
 * deterministic. Covering every canonical muscle locally is what stops the
 * fallback from ever being reached, and the oracle asserts it never was.
 *
 * WHY IT IS INVENTED RATHER THAN REAL. Nothing here is copied from a dataset:
 * the names are obviously synthetic, and this repo is public. It also makes the
 * assertions sharper — a workout built out of "QA Catalog Chest 1" could not
 * have come from anywhere but this file.
 *
 * The muscle vocabulary is imported from the app's own taxonomy rather than
 * retyped. Node strips the types out of the shared `.ts` sources on its own, so
 * a plain .mjs in this harness can read the same constant the planner does, and
 * a muscle added upstream lands here on the next run instead of quietly leaving
 * a hole for the network fallback to fill.
 */
import { MUSCLES } from '../../shared/src/constants/exerciseTaxonomy.ts';

/**
 * Two per muscle, and the second one matters.
 *
 * One would be enough to keep the fallback from firing, but it would also make
 * every choice forced: a planner that ignored its scoring entirely and took
 * whatever the query returned first would produce exactly the same workout as
 * one that ranked properly. A second candidate per muscle means the pick is a
 * pick. It is also what a future Swap assertion needs — `swap: true` excludes
 * the previous workout's exercise ids, and with one per muscle there is nowhere
 * for it to go.
 */
const PER_MUSCLE = [
  { suffix: '1', mechanic: 'compound', level: 'beginner', force: 'push' },
  { suffix: '2', mechanic: 'isolation', level: 'intermediate', force: 'pull' },
];

/**
 * `body only` is the one equipment value that is available whatever gym profile
 * is active (EQUIPMENT_ALWAYS_AVAILABLE in the shared taxonomy), so a catalog
 * built on it is performable for every account this harness creates — including
 * one that has since been given a restrictive gym profile. `strength` keeps
 * every row out of the mobility branch, which the generator treats as no cover
 * at all.
 */
export const CATALOG = MUSCLES.flatMap((muscle) =>
  PER_MUSCLE.map((variant) => ({
    name: `QA Catalog ${muscle} ${variant.suffix}`,
    category: 'strength',
    modality: 'weight_reps',
    description: null,
    equipment: ['body only'],
    primary_muscles: [muscle],
    secondary_muscles: [],
    level: variant.level,
    mechanic: variant.mechanic,
    force: variant.force,
    // Read by the oracle, never sent: which muscle this row exists to cover.
    qaMuscle: muscle,
  }))
);

/** Every name in the catalog, for the oracle's "nothing else got in" check. */
export const CATALOG_NAMES = CATALOG.map((exercise) => exercise.name);

/** The prefix that identifies a seeded row in the database. */
export const CATALOG_PREFIX = 'QA Catalog ';

/**
 * The name suffix of the compound of each pair, so the oracle can tell the two
 * variants apart without re-deriving the planner's slotting. Nothing sends it;
 * it is how "compounds come first" is checkable at all from a payload that
 * carries no slot.
 */
export const COMPOUND_SUFFIX = '1';
