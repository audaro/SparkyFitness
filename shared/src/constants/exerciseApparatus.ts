import { normalizeEquipmentName, type Equipment } from "./exerciseTaxonomy.ts";

/**
 * Equipment metadata richer than free-exercise-db ships.
 *
 * The pinned vocabulary in `exerciseTaxonomy.ts` is the upstream enum verbatim,
 * and it has to stay that way — the catalog filters `equipment::jsonb ?|`, an
 * exact case-sensitive comparison against the stored strings. But that enum has
 * no `pull-up bar` and no `bench`, so 21 of the 111 `body only` exercises claim
 * to need nothing while actually needing apparatus: you cannot do a Chin-Up
 * without something to hang from, and "Flat Bench Lying Leg Raise" is not a
 * floor exercise.
 *
 * `ALWAYS_AVAILABLE_EQUIPMENT` accepts that gap deliberately for *search*, where
 * the cost is an occasional unusable row. It is not acceptable for the
 * recommendation engine, where the cost is a set the user physically cannot
 * perform, prescribed to them by name. (Blueprint W8 item 8; the trigger it
 * named — "do it when the engine starts prescribing these" — fired in the W7
 * live gate, which offered Chin-Up to a dumbbells-and-bands home profile.)
 *
 * This module is that divergence, kept out of `exerciseTaxonomy.ts` on purpose
 * so nothing here can be mistaken for the upstream vocabulary. It is a code
 * constant rather than the override *table* the blueprint sketched because the
 * data it overrides is itself a pinned, versioned dataset: a table would need
 * seeding from this same list plus a backfill for every already-imported row,
 * and would then be one more copy to keep in step. Keyed on `source_id`, which
 * is the upstream id the importer stores verbatim
 * (`exerciseService.addFreeExerciseDBExerciseToUserExercises`) and which — unlike
 * the name — the user cannot edit out from under us.
 */

/**
 * Apparatus a `body only` exercise can need. Deliberately NOT part of
 * {@link Equipment}: these values must never reach a `?|` catalog filter or a
 * gym profile's stored list, both of which are validated against the upstream
 * enum. They exist only for the engine's performability test.
 */
export const EXERCISE_APPARATUS = [
  "pull-up bar",
  "dip station",
  "squat rack",
  "bench",
] as const;
export type ExerciseApparatus = (typeof EXERCISE_APPARATUS)[number];

/**
 * free-exercise-db `source_id` -> the apparatus it actually needs, for rows
 * whose stated equipment does not say so.
 *
 * The bar is "no ordinary household substitute". Hanging is the clearest case:
 * without a fixed overhead bar the movement is not harder, it is impossible.
 * Bench entries are the ones whose instructions have the lifter lying or seated
 * *on* a bench (hips off the end, hands gripping the sides), not the ones that
 * merely want a raised surface — Incline Push-Up, Bench Jump, Step-up and
 * Push-Ups With Feet Elevated all work off a chair or a step and are therefore
 * absent on purpose. Erring either way costs something, and this is the side
 * that keeps push-ups, squats, lunges and planks available to a home profile.
 *
 * Verified against `dist/exercises.json` on 2026-08-23; every key is a real
 * upstream id and every one of them carries `"equipment": "body only"`.
 */
export const APPARATUS_BY_SOURCE_ID: Readonly<
  Record<string, readonly ExerciseApparatus[]>
> = {
  // Hanging from a fixed overhead bar.
  "Chin-Up": ["pull-up bar"],
  Pullups: ["pull-up bar"],
  "V-Bar_Pullup": ["pull-up bar"],
  "Wide-Grip_Rear_Pull-Up": ["pull-up bar"],
  Hanging_Leg_Raise: ["pull-up bar"],
  Hanging_Pike: ["pull-up bar"],
  Gorilla_Chin_Crunch: ["pull-up bar"],
  Wind_Sprints: ["pull-up bar"],

  // Parallel bars.
  "Dips_-_Triceps_Version": ["dip station"],

  // A bar set in a rack at chest height.
  Body_Tricep_Press: ["squat rack"],

  // Lying or seated on a bench.
  Bench_Dips: ["bench"],
  Decline_Crunch: ["bench"],
  Decline_Oblique_Crunch: ["bench"],
  Decline_Reverse_Crunch: ["bench"],
  "Flat_Bench_Leg_Pull-In": ["bench"],
  Flat_Bench_Lying_Leg_Raise: ["bench"],
  "Seated_Flat_Bench_Leg_Pull-In": ["bench"],
  Flutter_Kicks: ["bench"],
  Seated_Leg_Tucks: ["bench"],
  Hyperextensions_With_No_Hyperextension_Bench: ["bench"],
  Natural_Glute_Ham_Raise: ["bench"],
};

/** The source these overrides describe. Rows from anywhere else are left alone. */
export const APPARATUS_OVERRIDE_SOURCE = "free-exercise-db";

/**
 * A Map, not the object literal above, because the lookup key is a database
 * value: `APPARATUS_BY_SOURCE_ID["constructor"]` hands back a function, which
 * has a truthy `.length` and would read as "this needs one apparatus".
 */
const APPARATUS_LOOKUP: ReadonlyMap<string, readonly ExerciseApparatus[]> =
  new Map(Object.entries(APPARATUS_BY_SOURCE_ID));

/**
 * Canonical equipment whose presence in a gym profile implies the apparatus
 * above is on hand.
 *
 * This is an inference, and it is the only one available: the profile schema
 * validates against the upstream enum, so a user literally cannot declare a
 * pull-up bar. What these three values do separate cleanly is the case that
 * matters — a room with dumbbells and a band has none of them, and anywhere
 * with a cable stack, a machine or a loaded barbell has a bar and a bench.
 *
 * A garage with a barbell but no pull-up bar is the case it gets wrong, and it
 * gets it wrong in the recoverable direction: the user swaps one exercise.
 * Letting the user state their apparatus directly is the durable fix and needs
 * a vocabulary that is no longer upstream's.
 */
export const APPARATUS_IMPLYING_EQUIPMENT: readonly Equipment[] = [
  "barbell",
  "cable",
  "machine",
];

/**
 * Equipment that is never assumed, not even with no gym profile at all.
 *
 * `other` is free-exercise-db's grab-bag of 122 exercises needing very specific
 * gear — Atlas Stones, Car Deadlift, Battling Ropes, sled drags, Circus Bell.
 * The gym-profile filter already keeps it out of a profiled session, because a
 * profile lists what the user has and nobody lists `other` by accident. With no
 * profile the filter is off entirely, and the W7 live run duly prescribed an
 * Atlas Stone Trainer.
 *
 * "No profile" means the user has not told us where they train; it should not
 * mean they own a strongman yard. So `other` stays opt-in in both cases: a
 * profile that names it gets it, and nothing else does.
 */
export const OPT_IN_EQUIPMENT: readonly Equipment[] = ["other"];

const OPT_IN_EQUIPMENT_SET: ReadonlySet<string> = new Set(OPT_IN_EQUIPMENT);

/** True for equipment that has to be named explicitly before it is available. */
export function isOptInEquipment(raw: string): boolean {
  return OPT_IN_EQUIPMENT_SET.has(normalizeEquipmentName(raw));
}

/**
 * The apparatus an exercise needs beyond its stated equipment. Empty for
 * everything not in the override map, which is almost everything.
 */
export function requiredApparatus(
  source: string | null | undefined,
  sourceId: string | null | undefined,
): readonly ExerciseApparatus[] {
  if (source?.trim().toLowerCase() !== APPARATUS_OVERRIDE_SOURCE) return [];
  if (!sourceId) return [];
  return APPARATUS_LOOKUP.get(sourceId.trim()) ?? [];
}

/**
 * Whether the training place implied by `availableEquipment` has this
 * apparatus.
 *
 * `null` — no gym profile — passes, matching every other availability rule in
 * the engine: not having said where you train is not the same as having said
 * "nothing".
 */
export function isApparatusAvailable(
  required: readonly ExerciseApparatus[],
  availableEquipment: readonly string[] | null,
): boolean {
  if (required.length === 0) return true;
  if (availableEquipment === null) return true;
  const available = new Set(availableEquipment.map(normalizeEquipmentName));
  return APPARATUS_IMPLYING_EQUIPMENT.some((item) => available.has(item));
}
