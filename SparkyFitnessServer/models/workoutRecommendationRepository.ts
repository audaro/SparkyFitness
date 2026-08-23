import { getClient } from '../db/poolManager.js';
import {
  normalizeMuscleName,
  type MuscleFatigueInput,
} from '@workspace/shared';

/**
 * Reads for the workout recommendation engine.
 *
 * Everything here is a query plus a defensive parse; the scoring lives in
 * `@workspace/shared` (`muscleRecovery.ts`) so it stays pure and testable.
 */

interface FatigueRow {
  entry_date: string;
  primary_muscles: string | null;
  secondary_muscles: string | null;
  working_set_count: string | number | null;
}

/**
 * `exercises.primary_muscles` / `secondary_muscles` — and the snapshots
 * `exercise_entries` copies from them — are TEXT columns holding a
 * JSON-encoded array, not jsonb and not a Postgres array. Migration
 * `20260816192818_normalize_exercise_json_array_fields.sql` normalized the
 * legacy comma-separated text, but this parses defensively anyway, mirroring
 * `reportService.ts:615`: a single unparseable row must not fail the whole
 * recovery read.
 *
 * Values are normalized on the way out so that a hand-entered `'Quadriceps'`
 * still scores against `quadriceps`. That is a looser bar than the catalog's
 * `::jsonb ?|` filter deliberately: matching here is a JS string compare we
 * control, not a case-sensitive Postgres operator.
 */
function parseMuscleColumn(raw: unknown): string[] {
  if (!raw) return [];
  // The column is TEXT today, but node-postgres hands back a real array for a
  // jsonb column. Accepting both means a future column-type migration cannot
  // silently reduce every muscle list to empty.
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((value): value is string => typeof value === 'string')
    .map(normalizeMuscleName)
    .filter((value) => value.length > 0);
}

/**
 * Every logged entry from `sinceDate` onward, reduced to the muscles it trained
 * and how many working sets it carried.
 *
 * Reads the entry **snapshot** columns rather than joining `exercises`: the
 * snapshot is the record of what was actually trained, and it survives the
 * exercise being edited or deleted afterwards.
 *
 * `COUNT(...) FILTER (...)` excludes warm-ups with the same predicate the rest
 * of the server uses (`models/exerciseEntry.ts:1380`) — kept byte-identical so
 * the two cannot drift. A `LEFT JOIN` keeps set-less entries (cardio, imports)
 * in the result at `working_set_count: 0`; they still establish `lastTrained`
 * without adding fatigue.
 *
 * The `ORDER BY` is not cosmetic. Fatigue is a float sum, so the accumulation
 * order decides the last bits of the result; an unordered `GROUP BY` may hand
 * back rows in a different order on a later call and make an endpoint that is
 * supposed to be reproducible differ in the 16th digit.
 *
 * `entry_date IS NOT NULL` is likewise load-bearing rather than decorative.
 * The column is nullable, and `computeMuscleFreshness` treats a malformed day
 * string as a caller bug and throws — deliberately, so a real defect surfaces
 * instead of being scored as though it happened today. The `>= $2::date` bound
 * happens to drop NULL rows already (a NULL comparison is not TRUE), but that
 * is incidental: relax the window bound and one null-dated entry would take the
 * whole endpoint down with it. The guard says so out loud.
 */
async function getMuscleFatigueInputs(
  userId: string,
  sinceDate: string
): Promise<MuscleFatigueInput[]> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT ee.entry_date::TEXT AS entry_date,
              ee.primary_muscles,
              ee.secondary_muscles,
              COUNT(ees.id) FILTER (
                WHERE ees.set_type IS NULL
                   OR regexp_replace(LOWER(ees.set_type), '[^a-z0-9]', '', 'g') NOT LIKE 'warmup%'
              ) AS working_set_count
         FROM exercise_entries ee
         LEFT JOIN exercise_entry_sets ees ON ees.exercise_entry_id = ee.id
        WHERE ee.user_id = $1
          AND ee.entry_date IS NOT NULL
          AND ee.entry_date >= $2::date
        GROUP BY ee.id, ee.entry_date, ee.primary_muscles, ee.secondary_muscles
        ORDER BY ee.entry_date, ee.id`,
      [userId, sinceDate]
    );
    return result.rows.map((row: FatigueRow) => ({
      entryDate: row.entry_date,
      primaryMuscles: parseMuscleColumn(row.primary_muscles),
      secondaryMuscles: parseMuscleColumn(row.secondary_muscles),
      // COUNT is bigint, which node-postgres hands back as a string.
      workingSetCount: Number(row.working_set_count ?? 0),
    }));
  } finally {
    client.release();
  }
}

export { getMuscleFatigueInputs };
export default { getMuscleFatigueInputs };
