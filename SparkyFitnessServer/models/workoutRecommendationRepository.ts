import { getClient } from '../db/poolManager.js';
import {
  normalizeMuscleName,
  resolveExerciseModality,
  type CandidateExercise,
  type MuscleFatigueInput,
  type WorkoutRecommendationPayload,
  type WorkoutRecommendationStatus,
} from '@workspace/shared';
import { parseJsonArrayField } from '../utils/exerciseJsonFields.js';

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
 * Every logged entry from `sinceDate` through `untilDate` (both inclusive),
 * reduced to the muscles it trained and how many working sets it carried.
 *
 * `untilDate` is the user's today. Without the upper bound, a workout-plan
 * session prescribed for next week would count against today's freshness at
 * full weight (the scorer clamps future ages to zero rather than extrapolating
 * them) — the same reason `getFrequentSets` bounds at today.
 *
 * Reads the entry **snapshot** columns rather than joining `exercises`: the
 * snapshot is the record of what was actually trained, and it survives the
 * exercise being edited or deleted afterwards.
 *
 * `COUNT(...) FILTER (...)` excludes warm-ups with the same predicate the rest
 * of the server uses (`models/exerciseEntry.ts:1380`) — kept byte-identical so
 * the two cannot drift. It also requires plan-linked sets to carry a
 * `completed_at` stamp, matching the server-wide "performed" rule
 * (`models/exerciseEntry.ts:1523`): plan-generated entries insert their
 * prescribed sets up front, and a prescription is not fatigue. A `LEFT JOIN`
 * keeps set-less entries (cardio, imports) in the result at
 * `working_set_count: 0`; they still establish `lastTrained` without adding
 * fatigue.
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
  sinceDate: string,
  untilDate: string
): Promise<MuscleFatigueInput[]> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT ee.entry_date::TEXT AS entry_date,
              ee.primary_muscles,
              ee.secondary_muscles,
              COUNT(ees.id) FILTER (
                WHERE (ees.set_type IS NULL
                   OR regexp_replace(LOWER(ees.set_type), '[^a-z0-9]', '', 'g') NOT LIKE 'warmup%')
                  AND (ee.workout_plan_assignment_id IS NULL
                   OR ees.completed_at IS NOT NULL)
              ) AS working_set_count
         FROM exercise_entries ee
         LEFT JOIN exercise_entry_sets ees ON ees.exercise_entry_id = ee.id
        WHERE ee.user_id = $1
          AND ee.entry_date IS NOT NULL
          AND ee.entry_date >= $2::date
          AND ee.entry_date <= $3::date
        GROUP BY ee.id, ee.entry_date, ee.primary_muscles, ee.secondary_muscles
        ORDER BY ee.entry_date, ee.id`,
      [userId, sinceDate, untilDate]
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

// ---------------------------------------------------------------------------
// Candidate catalog
// ---------------------------------------------------------------------------

interface CandidateRow {
  id: string;
  name: string;
  modality: string | null;
  category: string | null;
  source: string | null;
  source_id: string | null;
  primary_muscles: string | null;
  secondary_muscles: string | null;
  equipment: string | null;
  mechanic: string | null;
  level: string | null;
  images: string | null;
  times_performed: string | number | null;
}

function toStringArray(raw: string | null, context: string): string[] {
  return parseJsonArrayField(raw, context).filter(
    (value): value is string => typeof value === 'string'
  );
}

function mapCandidateRow(row: CandidateRow): CandidateExercise {
  return {
    id: row.id,
    name: row.name,
    modality: resolveExerciseModality(row.modality, row.category),
    // Carried raw as well as folded into the modality above. The modality
    // derivation only knows `cardio` and `isometric`, so `stretching` reaches
    // the planner as `weight_reps` and would be programmed as three sets of
    // ten; the engine reads the category itself to decide the prescription
    // shape (`isMobilityExercise`).
    category: row.category,
    // `source`/`source_id` key the apparatus overrides — the pull-up bar and
    // bench that `body only` does not admit to needing.
    source: row.source ?? '',
    sourceId: row.source_id,
    primaryMuscles: toStringArray(
      row.primary_muscles,
      `primary_muscles for exercise ${row.id}`
    ),
    secondaryMuscles: toStringArray(
      row.secondary_muscles,
      `secondary_muscles for exercise ${row.id}`
    ),
    equipment: toStringArray(row.equipment, `equipment for exercise ${row.id}`),
    mechanic: row.mechanic,
    level: row.level,
    images: toStringArray(row.images, `images for exercise ${row.id}`),
    // COUNT is bigint, which node-postgres hands back as a string.
    timesPerformed: Number(row.times_performed ?? 0),
  };
}

const CANDIDATE_COLS = `e.id,
              e.name,
              e.modality,
              e.category,
              e.source,
              e.source_id,
              e.primary_muscles,
              e.secondary_muscles,
              e.equipment,
              e.mechanic,
              e.level,
              e.images,
              COALESCE(h.times_performed, 0) AS times_performed`;

const CANDIDATE_HISTORY_JOIN = `LEFT JOIN (
                SELECT exercise_id, COUNT(*) AS times_performed
                  FROM exercise_entries
                 WHERE user_id = $1
                 GROUP BY exercise_id
              ) h ON h.exercise_id = e.id`;

/**
 * "Does this muscle column name any of `$n`", case-insensitively.
 *
 * Same `jsonb_array_elements_text` shape as `buildEquipmentSubsetClause` in
 * `models/exercise.ts`, including its scalar guard — a legacy row may hold
 * `"chest"` rather than `["chest"]`, and extracting elements from a scalar
 * raises rather than returning nothing. `NULLIF(btrim(...), '')` covers the
 * empty-string case, which would otherwise fail the `::jsonb` cast outright.
 */
function muscleMatchClause(column: string, paramIndex: number): string {
  const json = `NULLIF(btrim(${column}), '')::jsonb`;
  return `EXISTS (
                SELECT 1
                  FROM jsonb_array_elements_text(
                         CASE WHEN jsonb_typeof(${json}) = 'array'
                              THEN ${json}
                              ELSE jsonb_build_array(${json})
                         END
                       ) AS m(item)
                 WHERE lower(btrim(m.item)) = ANY($${paramIndex}::text[])
              )`;
}

/**
 * Every exercise that primarily trains one of `muscles`, with how many times
 * the user has logged it.
 *
 * Matching is case-insensitive, unlike the catalog browse filter's
 * `primary_muscles::jsonb ?| ARRAY[...]`, which is exact. That operator is
 * right for a browse filter fed canonical values from a picker and wrong here:
 * nothing canonicalizes the column on write, so a user's own `"Chest"` would be
 * invisible to their own chest workout.
 *
 * `includeSecondary` widens the match to exercises that merely assist the
 * muscle. The planner does not want those — it slots on the primary mover — but
 * the alternatives endpoint does, because a replacement that hits the muscle
 * secondarily is a real if weaker option, and its scoring needs both kinds
 * present to rank between them.
 *
 * Equipment and limitations are deliberately NOT filtered here even though the
 * SQL to do it exists. The planner filters both in JavaScript
 * (`isEquipmentAvailable`, `isExcludedByLimitations`) where the rules are unit
 * tested; a second copy in SQL would be a second thing to keep in step, and
 * the muscle predicate already bounds the result to something small enough to
 * filter in memory.
 *
 * `is_quick_exercise` rows are excluded: they are the "logged 30 minutes of
 * something" placeholders, not programmable movements.
 */
async function getCandidateExercises(
  userId: string,
  muscles: readonly string[],
  includeSecondary = false
): Promise<CandidateExercise[]> {
  if (muscles.length === 0) return [];
  const matchClause = includeSecondary
    ? `(${muscleMatchClause('e.primary_muscles', 2)} OR ${muscleMatchClause('e.secondary_muscles', 2)})`
    : muscleMatchClause('e.primary_muscles', 2);
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT ${CANDIDATE_COLS}
         FROM exercises e
         ${CANDIDATE_HISTORY_JOIN}
        WHERE e.is_quick_exercise = FALSE
          AND ${matchClause}
        -- Total order. The planner breaks score ties on id, so this is not
        -- what makes the pick deterministic; it makes the *input* stable,
        -- which is what makes a failing run reproducible.
        ORDER BY e.id`,
      [userId, muscles.map((muscle) => muscle.trim().toLowerCase())]
    );
    return result.rows.map(mapCandidateRow);
  } finally {
    client.release();
  }
}

/** One catalog row in the same shape the planner and the ranker consume. */
async function getCandidateExerciseById(
  userId: string,
  exerciseId: string
): Promise<CandidateExercise | null> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT ${CANDIDATE_COLS}
         FROM exercises e
         ${CANDIDATE_HISTORY_JOIN}
        WHERE e.id = $2`,
      [userId, exerciseId]
    );
    const row = result.rows[0];
    return row ? mapCandidateRow(row) : null;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// The stored recommendation
// ---------------------------------------------------------------------------

export interface WorkoutRecommendationRow {
  id: string;
  user_id: string;
  gym_profile_id: string | null;
  target_duration_minutes: number;
  payload: unknown;
  status: WorkoutRecommendationStatus;
  generated_at: Date;
  created_at: Date;
  updated_at: Date;
}

const RECOMMENDATION_COLS =
  'id, user_id, gym_profile_id, target_duration_minutes, payload, status, generated_at, created_at, updated_at';

async function getWorkoutRecommendation(
  userId: string
): Promise<WorkoutRecommendationRow | null> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT ${RECOMMENDATION_COLS} FROM workout_recommendations WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

/**
 * Write the user's one recommendation, replacing whatever was there.
 *
 * An upsert on the `UNIQUE(user_id)` index rather than a delete-then-insert:
 * one statement, so two concurrent generations cannot interleave into a
 * unique-violation 500. Same shape as
 * `coachProfileRepository.upsertCoachProfile`.
 *
 * `status` resets to `'active'` and `generated_at` to now on every write. A
 * regenerated workout is a new suggestion — carrying `'completed'` forward
 * would tell the client the fresh workout had already been done.
 *
 * `payload` is serialized explicitly and cast: node-postgres renders a JS
 * object parameter for a jsonb column correctly, but an *array* parameter
 * would go out as a Postgres array literal, and the column would reject it.
 * Stringifying makes the shape irrelevant.
 */
async function upsertWorkoutRecommendation(
  userId: string,
  input: {
    gymProfileId: string | null;
    targetDurationMinutes: number;
    payload: WorkoutRecommendationPayload;
  }
): Promise<WorkoutRecommendationRow> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `INSERT INTO workout_recommendations
         (user_id, gym_profile_id, target_duration_minutes, payload, status, generated_at)
       VALUES ($1, $2, $3, $4::jsonb, 'active', now())
       ON CONFLICT (user_id) DO UPDATE
          SET gym_profile_id = EXCLUDED.gym_profile_id,
              target_duration_minutes = EXCLUDED.target_duration_minutes,
              payload = EXCLUDED.payload,
              status = 'active',
              generated_at = now(),
              updated_at = now()
       RETURNING ${RECOMMENDATION_COLS}`,
      [
        userId,
        input.gymProfileId,
        input.targetDurationMinutes,
        JSON.stringify(input.payload),
      ]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Rewrite the payload of the user's existing recommendation in place.
 *
 * Deliberately not `upsertWorkoutRecommendation`: that resets `status` to
 * `'active'` and `generated_at` to now, which is right for a regenerate and
 * wrong for a one-exercise replace. Swapping a movement does not make the
 * suggestion newly generated, and it must not un-start a workout the user has
 * already begun.
 *
 * Compare-and-set on `expectedPayload`, because the caller reads the payload,
 * splices one exercise into it, and writes it back — on a different connection
 * and several queries later. A regenerate landing inside that window would be
 * silently undone by the spliced copy of the workout it replaced. No row
 * matches then, and the caller reports the conflict rather than resurrecting a
 * stale workout.
 *
 * The guard is the payload itself rather than `updated_at`: Postgres keeps
 * microseconds, `pg` hands back a JS `Date` truncated to milliseconds, so a
 * timestamp round-tripped through the caller would rarely compare equal and
 * every replace would look like a conflict. `jsonb = jsonb` is semantic, so
 * key order does not matter either.
 *
 * Returns null when nothing matched — no recommendation, or one that moved.
 */
async function updateWorkoutRecommendationPayload(
  userId: string,
  payload: WorkoutRecommendationPayload,
  expectedPayload: unknown
): Promise<WorkoutRecommendationRow | null> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `UPDATE workout_recommendations
          SET payload = $2::jsonb, updated_at = now()
        WHERE user_id = $1
          AND payload = $3::jsonb
        RETURNING ${RECOMMENDATION_COLS}`,
      [userId, JSON.stringify(payload), JSON.stringify(expectedPayload)]
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

/**
 * Lifecycle only — the payload is never client-edited.
 *
 * Returns null when the id does not name a row this user can see, so the route
 * answers 404 rather than reporting a successful no-op.
 */
async function updateWorkoutRecommendationStatus(
  userId: string,
  id: string,
  status: WorkoutRecommendationStatus
): Promise<WorkoutRecommendationRow | null> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `UPDATE workout_recommendations
          SET status = $3, updated_at = now()
        WHERE id = $2 AND user_id = $1
        RETURNING ${RECOMMENDATION_COLS}`,
      [userId, id, status]
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

/**
 * Working sets for the weekly-target screen, counted more strictly than
 * `getMuscleFatigueInputs` counts them.
 *
 * Fatigue asks "how hard has this muscle been worked lately", and its answer is
 * smoothed over days, so counting a set the moment it is written costs little.
 * A weekly ring asks "how much have I actually done", and gets that question
 * wrong in a way the user can see: a live workout started from a preset carries
 * no `workout_plan_assignment_id`, so under the fatigue predicate every set the
 * session laid out is credited the instant the app autosaves — the ring fills
 * before a single rep is lifted, then never moves.
 *
 * So an uncompleted set counts only where nothing shows a sign of having been
 * tracked live. `session_has_completed` is that sign, and it is measured over
 * the whole **session** — `exercise_preset_entry_id`, the id that groups one
 * workout's entries — not over the single entry. Per entry it would barely
 * help: tick a set on the first exercise of a six-exercise session and the
 * other five are each still "an entry where nothing is ticked", so five sixths
 * of the workout stays credited in advance. Session-wide, the first tick
 * anywhere marks the whole session live and only ticked sets count from then
 * on. An entry with no session falls back to itself.
 *
 * A session where nothing at all is ticked still counts in full, and that is
 * deliberate: it is indistinguishable from a plain diary log, which is exactly
 * what `exercise_preset_entries` also records when a preset is logged without
 * live tracking. Excluding those would silently drop real work. Closing that
 * last gap needs a persisted live-session marker, which is a schema change, not
 * a predicate change.
 *
 * The plan-assignment exclusion stays on top of that, because a prescribed
 * session is pre-created with nothing completed and would otherwise read as a
 * manual log of work that has not happened.
 *
 * This deliberately does not change `getMuscleFatigueInputs`. That predicate is
 * shared with volume, PR detection and the recommendation engine; tightening it
 * here keeps the ring honest without silently restating four other features.
 */
async function getWeeklySetCountInputs(
  userId: string,
  sinceDate: string,
  untilDate: string
): Promise<MuscleFatigueInput[]> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `WITH entry_sets AS (
         SELECT ee.id AS entry_id,
                ee.entry_date,
                ee.primary_muscles,
                ee.secondary_muscles,
                ee.workout_plan_assignment_id,
                ees.id AS set_id,
                ees.set_type,
                ees.completed_at,
                bool_or(ees.completed_at IS NOT NULL)
                  OVER (
                    PARTITION BY COALESCE(ee.exercise_preset_entry_id, ee.id)
                  ) AS session_has_completed
           FROM exercise_entries ee
           LEFT JOIN exercise_entry_sets ees ON ees.exercise_entry_id = ee.id
          WHERE ee.user_id = $1
            AND ee.entry_date IS NOT NULL
            AND ee.entry_date >= $2::date
            AND ee.entry_date <= $3::date
       )
       SELECT entry_date::TEXT AS entry_date,
              primary_muscles,
              secondary_muscles,
              COUNT(set_id) FILTER (
                WHERE (set_type IS NULL
                   OR regexp_replace(LOWER(set_type), '[^a-z0-9]', '', 'g') NOT LIKE 'warmup%')
                  AND (completed_at IS NOT NULL
                   OR (workout_plan_assignment_id IS NULL
                       AND NOT COALESCE(session_has_completed, FALSE)))
              ) AS working_set_count
         FROM entry_sets
        GROUP BY entry_id, entry_date, primary_muscles, secondary_muscles
        ORDER BY entry_date, entry_id`,
      [userId, sinceDate, untilDate]
    );
    return result.rows.map((row: FatigueRow) => ({
      entryDate: row.entry_date,
      primaryMuscles: parseMuscleColumn(row.primary_muscles),
      secondaryMuscles: parseMuscleColumn(row.secondary_muscles),
      workingSetCount: Number(row.working_set_count ?? 0),
    }));
  } finally {
    client.release();
  }
}

export {
  getMuscleFatigueInputs,
  getWeeklySetCountInputs,
  getCandidateExercises,
  getCandidateExerciseById,
  getWorkoutRecommendation,
  upsertWorkoutRecommendation,
  updateWorkoutRecommendationPayload,
  updateWorkoutRecommendationStatus,
};
export default {
  getMuscleFatigueInputs,
  getWeeklySetCountInputs,
  getCandidateExercises,
  getCandidateExerciseById,
  getWorkoutRecommendation,
  upsertWorkoutRecommendation,
  updateWorkoutRecommendationPayload,
  updateWorkoutRecommendationStatus,
};
