/**
 * The one set-type vocabulary **writers** use.
 *
 * Three clients historically disagreed on the stored string — the server AI
 * tool enum (`ai/tools/schemas/common.ts:59-61`), the web display list
 * (`SparkyFitnessFrontend/src/constants/excerciseWorkoutSetTypes.ts`, 10
 * entries including `'Warm-up'`), and mobile's picker
 * (`SparkyFitnessMobile/src/utils/workoutSession.ts` `SET_TYPE_OPTIONS`).
 *
 * That drift is **display-level, not data-level**, and needs no data
 * migration: warm-up detection is already normalization-based everywhere —
 * the server SQL filter
 * `regexp_replace(LOWER(set_type), '[^a-z0-9]', '', 'g') NOT LIKE 'warmup%'`
 * (`models/exerciseEntry.ts:1380`) and mobile's `isWarmupSetType` both fold
 * every variant. Display lists may stay richer than this canonical write set;
 * never "fix" stored values with a migration.
 */
export const CANONICAL_SET_TYPES = [
  "Working Set",
  "Warmup",
  "Drop Set",
  "Failure",
] as const;
export type CanonicalSetType = (typeof CANONICAL_SET_TYPES)[number];

/** What an unspecified set is: a plain working set that counts toward volume. */
export const DEFAULT_SET_TYPE: CanonicalSetType = "Working Set";

const CANONICAL_SET_TYPE_SET: ReadonlySet<string> = new Set(
  CANONICAL_SET_TYPES,
);

/** Exact membership in the canonical write vocabulary. */
export function isCanonicalSetType(value: string): value is CanonicalSetType {
  return CANONICAL_SET_TYPE_SET.has(value);
}

/**
 * True when `setType` names a warmup — mirrors the SQL in
 * `models/exerciseEntry.ts:1380` step for step: lowercase, strip every
 * non-alphanumeric character, prefix-match `warmup`. Catches `'Warmup'`,
 * `'Warm-up'`, `'warm up'`, `'WARMUP'`, `'Warm-up Set'`.
 *
 * NULL/undefined counts as a working set, exactly as the SQL's
 * `set_type IS NULL OR ...` branch does.
 */
export function isWarmupSetType(setType: string | null | undefined): boolean {
  if (setType == null) return false;
  return setType
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .startsWith("warmup");
}
