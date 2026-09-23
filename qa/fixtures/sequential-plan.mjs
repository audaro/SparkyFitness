/**
 * The three-session rotation the sequential-plan scenario runs, and the single
 * definition both ends of it read.
 *
 * A SEQUENTIAL plan is not a calendar: it has no day_of_week at all, and which
 * session is "today's" is derived from what has been logged against the plan so
 * far (computeSequentialPlanProgression, server-side). That is the whole reason
 * this scenario exists — the position is a computed claim, the banner renders
 * it verbatim, and the two cases that must not be confused (a session that was
 * *finished* and one that was merely *started*) look identical on screen.
 *
 * WHY THREE SESSIONS and not two. With two, "advanced by one" and "wrapped
 * around to the start" are the same answer, so a progression that miscounted
 * would still land on a plausible session. Three makes 1 -> 2 -> 3 a direction.
 *
 * WHY EACH SESSION IS ONE PRESET of two exercises. A session is complete once
 * every ASSIGNMENT in it has an entry, and one preset assignment expands to
 * several entries — which is exactly the shape that makes the start-vs-finish
 * distinction observable: starting the session writes both entries and all four
 * sets at once, empty, before a single rep exists.
 *
 * The exercises are the synthetic catalog qa/fixtures/exercise-catalog.mjs
 * seeds (see its header for why it is invented rather than real). Nothing here
 * is copied from a dataset, and a name like "QA Catalog chest 1" could not have
 * come from anywhere but this harness.
 */

/** The plan's name, as the banner prints it. */
export const PLAN_NAME = 'QA Rotation';

/**
 * The rotation, in order. `muscles` picks the catalog rows the session's preset
 * is built out of; the names are deliberately unlike a real split's ("QA Push")
 * so a banner reading one of them cannot have come from seeded data elsewhere.
 */
export const SESSIONS = [
  { index: 1, name: 'QA Push', muscles: ['chest', 'shoulders'] },
  { index: 2, name: 'QA Pull', muscles: ['lats', 'biceps'] },
  { index: 3, name: 'QA Legs', muscles: ['quadriceps', 'hamstrings'] },
];

/**
 * Sets per exercise in a session's preset. Four sets per session (two
 * exercises x two sets) is what makes "exactly one set was completed" a sharp
 * claim rather than a coincidence — with one set each, completing one would
 * leave a session that is half done by any definition.
 */
export const SETS_PER_EXERCISE = 2;

/** The compound variant of a muscle's pair, which is what the presets use. */
export const catalogExerciseName = (muscle) => `QA Catalog ${muscle} 1`;

/** The preset backing one session. */
export const presetName = (session) => `QA Preset ${session.name}`;

/** Every exercise name the plan pulls in, in session order. */
export const PLAN_EXERCISE_NAMES = SESSIONS.flatMap((session) =>
  session.muscles.map(catalogExerciseName)
);
