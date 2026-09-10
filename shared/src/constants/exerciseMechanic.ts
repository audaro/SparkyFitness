/**
 * Corrections to the `mechanic` a catalog row arrived with.
 *
 * free-exercise-db tags a handful of single-joint movements `compound` —
 * curls, flyes, raises, crunches — and the planner treats mechanic as
 * structural: the compound slot for a muscle is filled from compound rows
 * before any isolation row is considered. So `High Cable Curls`, the one
 * biceps row upstream marks compound, took the biceps slot of every machine
 * day outright, ahead of a machine curl the user had logged fifty times, and
 * the duration fitter then deleted that curl as the "second" biceps movement.
 *
 * The correction is applied at read time ({@link effectiveMechanic}) rather
 * than by rewriting rows, so it covers rows imported before it existed and
 * rows a user imports tomorrow alike, and the stored catalog value stays
 * upstream's. Keyed on `source_id` like the apparatus overrides, and for the
 * same reason: the id is stable across installs, the uuid is not.
 *
 * Only clear-cut single-joint movements are listed. `Glute Ham Raise` and
 * `Gorilla Chin/Crunch` are also tagged compound upstream and genuinely are.
 */
import {
  EXERCISE_MECHANICS,
  type ExerciseMechanic,
} from "./exerciseTaxonomy.ts";

export const MECHANIC_OVERRIDE_SOURCE = "free-exercise-db";

export const MECHANIC_OVERRIDES_BY_SOURCE_ID: Readonly<
  Record<string, ExerciseMechanic>
> = {
  "Back_Flyes_-_With_Bands": "isolation",
  Barbell_Incline_Shoulder_Raise: "isolation",
  "Bent-Knee_Hip_Raise": "isolation",
  "Cross-Body_Crunch": "isolation",
  Decline_Dumbbell_Flyes: "isolation",
  Decline_Oblique_Crunch: "isolation",
  Decline_Reverse_Crunch: "isolation",
  Drag_Curl: "isolation",
  Dumbbell_Raise: "isolation",
  Glute_Kickback: "isolation",
  High_Cable_Curls: "isolation",
  Incline_Dumbbell_Flyes: "isolation",
  "Incline_Dumbbell_Flyes_-_With_A_Twist": "isolation",
};

// A Map rather than the literal for lookups: the key is a database value, and
// `OVERRIDES["constructor"]` would hand back a function.
const MECHANIC_OVERRIDE_LOOKUP: ReadonlyMap<string, ExerciseMechanic> = new Map(
  Object.entries(MECHANIC_OVERRIDES_BY_SOURCE_ID),
);

const MECHANIC_SET: ReadonlySet<string> = new Set(EXERCISE_MECHANICS);

/**
 * The mechanic the engine should believe for a row: the curated correction
 * when one exists for this catalog id, otherwise the stored value, normalized
 * to the canonical vocabulary (`null` for anything outside it).
 */
export function effectiveMechanic(
  source: string | null | undefined,
  sourceId: string | null | undefined,
  storedMechanic: string | null | undefined,
): ExerciseMechanic | null {
  if (source?.trim().toLowerCase() === MECHANIC_OVERRIDE_SOURCE && sourceId) {
    const override = MECHANIC_OVERRIDE_LOOKUP.get(sourceId.trim());
    if (override !== undefined) return override;
  }
  const normalized = storedMechanic?.trim().toLowerCase() ?? "";
  return MECHANIC_SET.has(normalized) ? (normalized as ExerciseMechanic) : null;
}
