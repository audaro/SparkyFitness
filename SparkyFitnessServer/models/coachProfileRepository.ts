import { getClient } from '../db/poolManager.js';
import type {
  CoachProfileAlias,
  CoachProfileEnhancement,
  ExperienceLevel,
  MuscleGroup,
  PhysiqueTarget,
  PrimaryGoal,
} from '@workspace/shared';

export interface CoachProfileRow {
  id: string;
  user_id: string;
  goals: string | null;
  training_days_per_week: number | null;
  session_minutes: number | null;
  experience_level: ExperienceLevel | null;
  primary_goal: PrimaryGoal | null;
  physique_target: PhysiqueTarget | null;
  priority_muscle_groups: MuscleGroup[] | null;
  // SENSITIVE — never include this in anything sent to the chat model. See the
  // migration that adds the column, and the renderer tests that assert it.
  enhancement: CoachProfileEnhancement | null;
  plan_completed_at: Date | null;
  equipment: string[];
  limitations: string[];
  food_preferences: Record<string, unknown>;
  aliases: Record<string, CoachProfileAlias>;
  weekly_set_targets: Record<string, number>;
  created_at: Date;
  updated_at: Date;
}

export interface CoachProfilePatch {
  // The three nullable scalars accept null explicitly: clearing a stated value
  // back to "not stated" is a distinct operation from leaving it alone, and
  // `training_days_per_week` of null is what makes weekly set targets report
  // themselves as derived. `undefined` still means "do not touch this column".
  goals?: string | null;
  training_days_per_week?: number | null;
  session_minutes?: number | null;
  experience_level?: ExperienceLevel | null;
  primary_goal?: PrimaryGoal | null;
  physique_target?: PhysiqueTarget | null;
  priority_muscle_groups?: MuscleGroup[] | null;
  enhancement?: CoachProfileEnhancement | null;
  plan_completed_at?: Date | string | null;
  equipment?: string[];
  limitations?: string[];
  food_preferences?: Record<string, unknown>;
  aliases?: Record<string, CoachProfileAlias>;
  weekly_set_targets?: Record<string, number>;
}

const PROFILE_COLS =
  'id, user_id, goals, training_days_per_week, session_minutes, experience_level, primary_goal, physique_target, priority_muscle_groups, enhancement, plan_completed_at, equipment, limitations, food_preferences, aliases, weekly_set_targets, created_at, updated_at';

// Columns that hold jsonb. Their values must be serialized explicitly:
// node-postgres renders a JS array parameter as a Postgres array literal,
// which a jsonb column rejects.
const JSONB_COLS = new Set([
  'equipment',
  'limitations',
  'food_preferences',
  'aliases',
  'weekly_set_targets',
  'priority_muscle_groups',
  'enhancement',
]);

/**
 * Serialize a value bound for a jsonb column.
 *
 * The naive `JSON.stringify(value)` turns JS null into the string "null",
 * which `::jsonb` stores as *jsonb null* — a value, distinct from SQL NULL. On
 * the nullable columns here (`priority_muscle_groups`, `enhancement`) SQL NULL
 * is what "not answered" means, so clearing an answer has to reach the column
 * as a real NULL. Same fix, same reason, as `toJsonbParam` in
 * gymEquipmentProfileRepository.
 *
 * The NOT NULL jsonb columns on this table never receive null, so routing them
 * through here costs nothing and keeps one rule for the whole set.
 */
function toJsonbParam(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

const PATCHABLE_COLS = [
  'goals',
  'training_days_per_week',
  'session_minutes',
  'experience_level',
  'primary_goal',
  'physique_target',
  'priority_muscle_groups',
  'enhancement',
  'plan_completed_at',
  'equipment',
  'limitations',
  'food_preferences',
  'aliases',
  'weekly_set_targets',
] as const;

async function getCoachProfile(
  userId: string
): Promise<CoachProfileRow | null> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT ${PROFILE_COLS} FROM coach_profiles WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

// Partial upsert: only the provided fields are written; on conflict the
// existing row keeps every column the patch does not mention.
async function upsertCoachProfile(
  userId: string,
  patch: CoachProfilePatch
): Promise<CoachProfileRow> {
  const keys = PATCHABLE_COLS.filter(
    (key) => (patch as Record<string, unknown>)[key] !== undefined
  );
  if (keys.length === 0) {
    throw new Error('upsertCoachProfile called with an empty patch');
  }
  const values = keys.map((key) => {
    const value = (patch as Record<string, unknown>)[key];
    return JSONB_COLS.has(key) ? toJsonbParam(value) : value;
  });
  const placeholders = keys.map(
    (key, i) => `$${i + 2}${JSONB_COLS.has(key) ? '::jsonb' : ''}`
  );
  const updates = keys.map((key) => `${key} = EXCLUDED.${key}`);
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `INSERT INTO coach_profiles (user_id, ${keys.join(', ')})
       VALUES ($1, ${placeholders.join(', ')})
       ON CONFLICT (user_id)
       DO UPDATE SET ${updates.join(', ')}, updated_at = now()
       RETURNING ${PROFILE_COLS}`,
      [userId, ...values]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Merges keys into `weekly_set_targets` inside a single statement.
 *
 * Reading the map, merging in JavaScript and writing it back would lose an
 * edit whenever two of them overlap: the web client saving `legs` and the phone
 * saving `push` both read the same map, and whichever writes second puts back a
 * copy that never saw the other's change. `||` merges right-onto-left in the
 * database, so each statement only ever contributes its own keys.
 *
 * Returns the merged map so a caller can report what was actually stored rather
 * than what it hoped to store.
 */
async function mergeWeeklySetTargets(
  userId: string,
  patch: Record<string, number>
): Promise<Record<string, number>> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `INSERT INTO coach_profiles (user_id, weekly_set_targets)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id)
       DO UPDATE SET
         weekly_set_targets = coach_profiles.weekly_set_targets || EXCLUDED.weekly_set_targets,
         updated_at = now()
       RETURNING weekly_set_targets`,
      [userId, JSON.stringify(patch)]
    );
    return result.rows[0]?.weekly_set_targets ?? {};
  } finally {
    client.release();
  }
}

export { getCoachProfile, upsertCoachProfile, mergeWeeklySetTargets };

export default {
  getCoachProfile,
  upsertCoachProfile,
  mergeWeeklySetTargets,
};
