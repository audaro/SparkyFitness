import {
  type Equipment,
  toCanonicalEquipment,
} from "../constants/exerciseTaxonomy.ts";

/**
 * Strength math shared by the server recommendation engine, mobile, and web.
 *
 * Every weight here is **kilograms**, the storage and computation unit
 * everywhere server-side; UI converts for display only.
 *
 * Previously mobile owned `epley1RmKg`/`estimateRepMaxKg` privately
 * (`SparkyFitnessMobile/src/utils/workoutSession.ts`); those now delegate here
 * so the engine and the set row cannot drift apart.
 */

/**
 * Epley estimated one-rep max: `1RM = w × (1 + reps/30)`.
 *
 * Returns 0 when weight or reps are missing or non-positive — an unknown 1RM,
 * not a zero one; callers treat 0 as "no estimate". A single rep short-circuits
 * to the lifted weight rather than inflating it by 3.3%.
 */
export function epley1RmKg(
  weightKg: number | null | undefined,
  reps: number | null | undefined,
): number {
  if (weightKg == null || reps == null || weightKg <= 0 || reps <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

/**
 * Inverse Epley: the weight that should yield `targetReps` at a given 1RM.
 * `w = oneRm / (1 + targetReps/30)`. Returns 0 for an unknown 1RM or a
 * non-positive target.
 *
 * Note the deliberate asymmetry with {@link epley1RmKg}: there is no
 * `targetReps === 1` short-circuit, so a 1RM round-trip through
 * `targetReps = 1` comes back ~3.2% light. That is the behaviour mobile's
 * set-row estimate has always had; the engine never prescribes singles.
 */
export function weightForRepsKg(oneRmKg: number, targetReps: number): number {
  if (!Number.isFinite(oneRmKg) || oneRmKg <= 0 || targetReps <= 0) return 0;
  return oneRmKg / (1 + targetReps / 30);
}

/** Estimated weight liftable for `targetReps`, derived from an observed set. */
export function estimateRepMaxKg(
  weightKg: number | null | undefined,
  reps: number | null | undefined,
  targetReps: number,
): number {
  return weightForRepsKg(epley1RmKg(weightKg, reps), targetReps);
}

/**
 * Smallest real-world load step per equipment type, in kg.
 *
 * Keyed by the canonical free-exercise-db equipment enum so adding a new
 * equipment value is a compile error until someone decides its increment.
 * `0` means "no meaningful step" — resistance is continuous or not a load at
 * all — and makes {@link quantizeLoadKg} a pass-through.
 *
 * Machine and cable stacks are pinned in 5 lb plates in most gyms, hence
 * 2.27 kg rather than a round metric step.
 */
export const EQUIPMENT_INCREMENT_KG: Readonly<Record<Equipment, number>> = {
  bands: 0,
  barbell: 2.5, // 1.25 kg plate per side
  "body only": 0,
  cable: 2.27, // 5 lb stack pin
  dumbbell: 2.0, // next pair up, per hand
  "e-z curl bar": 2.5,
  "exercise ball": 0,
  "foam roll": 0,
  kettlebells: 4.0, // 4 kg between competition bells
  machine: 2.27, // 5 lb stack pin
  "medicine ball": 1.0,
  other: 1.0,
};

/** Step used when the equipment is unknown or outside the canonical enum. */
export const DEFAULT_INCREMENT_KG = 1.0;

/**
 * The load step for an equipment string, canonicalizing first. Unknown or
 * missing equipment falls back to {@link DEFAULT_INCREMENT_KG}.
 */
export function incrementForEquipmentKg(
  equipment: string | null | undefined,
): number {
  if (equipment == null) return DEFAULT_INCREMENT_KG;
  const canonical = toCanonicalEquipment(equipment);
  if (canonical == null) return DEFAULT_INCREMENT_KG;
  return EQUIPMENT_INCREMENT_KG[canonical];
}

/**
 * Round a computed load to the nearest step that actually exists on the gym
 * floor — a prescription of 61.29 kg on a barbell is not loadable, 62.5 is.
 *
 * Zero-increment equipment (bands, bodyweight) returns the input untouched;
 * a non-positive or non-finite load returns 0 ("no load prescribed").
 * Otherwise the result is rounded to 2 dp, matching the
 * `DECIMAL(10,2)` storage precision so a persisted value echoes back
 * identical — distinct from mobile's `quantizeSetWeightKg`, which does only
 * that storage rounding and must stay as it is.
 */
export function quantizeLoadKg(
  kg: number,
  equipment: string | null | undefined,
): number {
  if (!Number.isFinite(kg) || kg <= 0) return 0;
  const increment = incrementForEquipmentKg(equipment);
  if (increment <= 0) return kg;
  const snapped = Math.round(kg / increment) * increment;
  return Math.round(snapped * 100) / 100;
}
