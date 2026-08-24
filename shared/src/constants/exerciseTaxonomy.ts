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
 * Equipment that is always "available" regardless of the active gym profile.
 *
 * `body only` is the whole list, and deliberately so. `other` looks like a
 * reasonable second entry — it reads as "unclassified" — but in
 * free-exercise-db it is a grab-bag of 122 exercises that need very specific
 * gear: Atlas Stones, Car Deadlift, Battling Ropes, sled drags, Circus Bell.
 * Auto-admitting it would offer someone with dumbbells and a band at home a
 * car deadlift, which is exactly the recommendation gym profiles exist to
 * prevent. A user who owns that gear can add `other` to their profile.
 *
 * KNOWN LIMITATION, deliberately accepted: `body only` is not perfectly
 * equipment-free either. 12 of its 111 entries need a bar or a bench —
 * Pullups, Chin-Up, V-Bar Pullup, Hanging Leg Raise, Bench Dips and friends.
 * It stays on the list anyway because the alternative is worse: drop it and a
 * "dumbbells and a band at home" profile returns no push-up, squat, lunge or
 * plank at all, trading ~12 wrong suggestions for ~99 missing correct ones.
 *
 * This is not fixable by filter logic. The pinned vocabulary has no
 * `pull-up bar` or `bench` value, so "needs a bar" is simply not expressible
 * — the fix is richer equipment metadata than free-exercise-db ships, which
 * means diverging from the upstream enum.
 *
 * That divergence now exists, in `exerciseApparatus.ts`, and the recommendation
 * engine applies it (`isPerformable`): there, prescribing an unperformable
 * exercise costs the user a set. It is deliberately NOT applied to search,
 * which is what this list still governs — a search result the user can look at
 * and ignore is cheap, and the vocabulary here has to stay byte-identical to
 * upstream for `?|` to match anything at all.
 */
export const ALWAYS_AVAILABLE_EQUIPMENT: readonly Equipment[] = ["body only"];

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

/**
 * Training groups a muscle can belong to, for weekly set targets.
 *
 * These are training buckets, not anatomy: `pull` holds every posterior-chain
 * and elbow-flexor muscle rather than only the ones a "pulling" movement
 * pattern hits. The point is that a user can hold three or four numbers in
 * their head, which is what makes a weekly set target usable at all.
 *
 * `core` exists because the alternative is worse. Every canonical muscle has
 * to land somewhere: dropping abdominals from the taxonomy would silently
 * discard logged ab work, and a target screen that quietly ignores sets the
 * user performed is a bug that looks like a design.
 */
export const MUSCLE_GROUPS = ["push", "pull", "legs", "core"] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

/**
 * Every muscle in {@link MUSCLES} appears exactly once across these lists.
 * `exerciseTaxonomy.test.ts` asserts both halves of that (total coverage and
 * no muscle in two groups), so adding a muscle upstream fails the suite here
 * rather than silently vanishing from someone's weekly totals.
 */
export const MUSCLE_GROUP_MEMBERS: Readonly<
  Record<MuscleGroup, readonly Muscle[]>
> = {
  push: ["chest", "shoulders", "triceps"],
  pull: [
    "biceps",
    "forearms",
    "lats",
    "lower back",
    "middle back",
    "neck",
    "traps",
  ],
  legs: [
    "abductors",
    "adductors",
    "calves",
    "glutes",
    "hamstrings",
    "quadriceps",
  ],
  core: ["abdominals"],
};

const MUSCLE_TO_GROUP: ReadonlyMap<string, MuscleGroup> = new Map(
  MUSCLE_GROUPS.flatMap((group) =>
    MUSCLE_GROUP_MEMBERS[group].map(
      (muscle) => [muscle, group] as [string, MuscleGroup],
    ),
  ),
);

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

/**
 * The training group a muscle belongs to, or null when the string is outside
 * the canonical vocabulary. Normalizes its input, so it is safe to hand it a
 * raw value straight off an `exercise_entries` muscle snapshot.
 */
export function muscleGroupOf(raw: string): MuscleGroup | null {
  return MUSCLE_TO_GROUP.get(normalizeMuscleName(raw)) ?? null;
}

/** True for a canonical lower-body muscle. Normalizes its input. */
export function isLowerBodyMuscle(raw: string): boolean {
  return LOWER_BODY_MUSCLE_SET.has(normalizeMuscleName(raw));
}

/**
 * Training splits a user can ask for by name, for choosing what to train.
 *
 * Deliberately NOT the same thing as {@link MUSCLE_GROUPS}, and deliberately
 * not built on it. Groups are a *partition* — every canonical muscle in exactly
 * one bucket, asserted by `weeklySetTargets.test.ts` — because a weekly set
 * total that double counts or silently drops a muscle is wrong. Splits
 * **overlap** by nature: chest is in Push, in Upper body and in Full body.
 * Folding splits into the group map would break the partition and with it the
 * weekly set target ring, so the two vocabularies stay separate even where
 * their members coincide.
 *
 * "Recovered muscles" is not in this list. It is the *absence* of a muscle
 * constraint — the generator's own freshness ranking, which is what it does
 * when a request names no muscles at all. Enumerating it here would turn a
 * default into a fixed list that stops tracking recovery.
 */
export const MUSCLE_SPLITS = [
  "push",
  "pull",
  "upper body",
  "lower body",
  "full body",
] as const;
export type MuscleSplit = (typeof MUSCLE_SPLITS)[number];

/**
 * Upper body is defined as "not lower body" rather than as a second hand-kept
 * list. One list means the two halves cannot drift apart, and a muscle added
 * upstream lands in upper body by default instead of falling out of both.
 *
 * That places `abdominals` and `neck` in upper body, which is the conventional
 * reading of an upper/lower split and the same bucketing the group map already
 * uses for `neck`.
 */
const UPPER_BODY_MUSCLES: readonly Muscle[] = MUSCLES.filter(
  (muscle) => !isLowerBodyMuscle(muscle),
);

/**
 * The canonical muscles each split resolves to.
 *
 * Resolution happens on the client and the wire carries muscles, never split
 * names: the server has no reason to learn a training vocabulary, and it keeps
 * the split list and the per-muscle grid on one code path.
 *
 * Push and Pull are the classical movement-pattern reading — Push is the
 * chest/shoulder/triceps chain, Pull is the back, elbow flexors and the traps
 * and neck that pulling loads. `abdominals` belongs to neither; it is reachable
 * through Upper body, Full body, or by picking it directly, which is better
 * than attaching core work to one arbitrary half of a push/pull program.
 */
export const MUSCLE_SPLIT_MEMBERS: Readonly<
  Record<MuscleSplit, readonly Muscle[]>
> = {
  push: ["chest", "shoulders", "triceps"],
  pull: [
    "biceps",
    "forearms",
    "lats",
    "lower back",
    "middle back",
    "neck",
    "traps",
  ],
  "upper body": UPPER_BODY_MUSCLES,
  "lower body": LOWER_BODY_MUSCLES,
  "full body": MUSCLES,
};

const MUSCLE_SPLIT_SET: ReadonlySet<string> = new Set(MUSCLE_SPLITS);

/** Exact membership test for a split name. See {@link isKnownMuscle}. */
export function isKnownMuscleSplit(value: string): value is MuscleSplit {
  return MUSCLE_SPLIT_SET.has(value);
}

/**
 * The canonical muscles a split names, or null when the string is outside the
 * split vocabulary. Normalizes its input, so a display label round-trips.
 */
export function musclesForSplit(raw: string): readonly Muscle[] | null {
  const normalized = raw.trim().toLowerCase();
  return isKnownMuscleSplit(normalized)
    ? MUSCLE_SPLIT_MEMBERS[normalized]
    : null;
}
