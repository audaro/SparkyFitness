/**
 * Canonical exercise vocabulary = the free-exercise-db JSON-schema enums,
 * pinned verbatim.
 *
 * Why verbatim matters: `exercises.equipment` / `primary_muscles` /
 * `secondary_muscles` are TEXT columns holding JSON-encoded string arrays, and
 * the catalog search filters them with `equipment::jsonb ?| ARRAY[...]` /
 * `(primary_muscles::jsonb ?| ... OR secondary_muscles::jsonb ?| ...)`
 * (SparkyFitnessServer/models/exercise.ts:372-398). `?|` is **exact,
 * case-sensitive string equality on array elements** — a value that is not
 * byte-identical simply does not match, silently returning zero rows.
 *
 * The stored values arrive from free-exercise-db imports
 * (services/exerciseService.ts:1330-1436), so they are these exact strings:
 * lowercase, space-separated. NEVER title-case them.
 *
 * Source of truth, fetched 2026-08-23:
 * https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/schema.json
 * (`properties.primaryMuscles.items[0].enum`, `properties.equipment.enum`,
 * `properties.force.enum`, `properties.level.enum`,
 * `properties.mechanic.enum`, `properties.category.enum` — `null` members
 * dropped, since a nullable column is modelled as `T | null` in TS).
 */

/** Canonical muscle vocabulary. `secondaryMuscles` shares this exact enum. */
export const MUSCLES = [
  "abdominals",
  "abductors",
  "adductors",
  "biceps",
  "calves",
  "chest",
  "forearms",
  "glutes",
  "hamstrings",
  "lats",
  "lower back",
  "middle back",
  "neck",
  "quadriceps",
  "shoulders",
  "traps",
  "triceps",
] as const;
export type Muscle = (typeof MUSCLES)[number];

/** Canonical equipment vocabulary (schema `null` member dropped). */
export const EQUIPMENT = [
  "bands",
  "barbell",
  "body only",
  "cable",
  "dumbbell",
  "e-z curl bar",
  "exercise ball",
  "foam roll",
  "kettlebells",
  "machine",
  "medicine ball",
  "other",
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

/** Canonical force vocabulary (schema `null` member dropped). */
export const EXERCISE_FORCES = ["pull", "push", "static"] as const;
export type ExerciseForce = (typeof EXERCISE_FORCES)[number];

/** Canonical experience-level vocabulary. */
export const EXERCISE_LEVELS = ["beginner", "intermediate", "expert"] as const;
export type ExerciseLevel = (typeof EXERCISE_LEVELS)[number];

/** Canonical mechanic vocabulary (schema `null` member dropped). */
export const EXERCISE_MECHANICS = ["compound", "isolation"] as const;
export type ExerciseMechanic = (typeof EXERCISE_MECHANICS)[number];

/** Canonical category vocabulary. */
export const EXERCISE_CATEGORIES = [
  "cardio",
  "olympic weightlifting",
  "plyometrics",
  "powerlifting",
  "strength",
  "stretching",
  "strongman",
] as const;
export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];

/**
 * Equipment that is always "available" regardless of the active gym profile:
 * bodyweight movements need nothing, and `other` is the catalog's escape hatch
 * for unclassified equipment — excluding it would silently hide exercises a
 * user can perform anywhere.
 */
export const ALWAYS_AVAILABLE_EQUIPMENT: readonly Equipment[] = [
  "body only",
  "other",
];

/**
 * Lower-body muscles. Drives the 5% (vs 2.5% upper-body) progression increment
 * — big lower-body lifts add absolute load far faster — and the upper/lower
 * balance guard in workout generation.
 */
export const LOWER_BODY_MUSCLES: readonly Muscle[] = [
  "abductors",
  "adductors",
  "calves",
  "glutes",
  "hamstrings",
  "quadriceps",
];

const MUSCLE_SET: ReadonlySet<string> = new Set(MUSCLES);
const EQUIPMENT_SET: ReadonlySet<string> = new Set(EQUIPMENT);
const LOWER_BODY_MUSCLE_SET: ReadonlySet<string> = new Set(LOWER_BODY_MUSCLES);

/**
 * Fold a muscle string toward the canonical form. Handles the only drift the
 * catalog actually carries (stray whitespace, casing from hand-entered or
 * foreign-source rows); it does NOT translate synonyms — foreign vocabularies
 * go through their own mappers (`wgerNameMapping.ts`,
 * `garminExerciseMapper.ts:56-80`) before reaching here.
 */
export function normalizeMuscleName(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Equipment counterpart of {@link normalizeMuscleName}. */
export function normalizeEquipmentName(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Exact membership test — deliberately NOT normalizing.
 *
 * A value only belongs to the vocabulary if it is byte-identical to a pinned
 * enum member, because that is the bar `::jsonb ?|` sets. Accepting
 * `'Quadriceps'` here would let a caller carry a filter value that matches
 * nothing. Normalize first (or use {@link toCanonicalMuscle}).
 */
export function isKnownMuscle(value: string): value is Muscle {
  return MUSCLE_SET.has(value);
}

/** Exact membership test for equipment. See {@link isKnownMuscle}. */
export function isKnownEquipment(value: string): value is Equipment {
  return EQUIPMENT_SET.has(value);
}

/**
 * Normalize then match: the safe way to turn an arbitrary stored/user string
 * into a value that can be handed to a `?|` filter. Returns null when the
 * string is outside the vocabulary — callers decide whether to drop it or fail.
 */
export function toCanonicalMuscle(raw: string): Muscle | null {
  const normalized = normalizeMuscleName(raw);
  return isKnownMuscle(normalized) ? normalized : null;
}

/** Equipment counterpart of {@link toCanonicalMuscle}. */
export function toCanonicalEquipment(raw: string): Equipment | null {
  const normalized = normalizeEquipmentName(raw);
  return isKnownEquipment(normalized) ? normalized : null;
}

/** True for a canonical lower-body muscle. Normalizes its input. */
export function isLowerBodyMuscle(raw: string): boolean {
  return LOWER_BODY_MUSCLE_SET.has(normalizeMuscleName(raw));
}
