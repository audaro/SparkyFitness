import { getClient } from '../db/poolManager.js';
import type { CoachProfileAlias } from '@workspace/shared';

export interface CoachProfileRow {
  id: string;
  user_id: string;
  goals: string | null;
  training_days_per_week: number | null;
  session_minutes: number | null;
  equipment: string[];
  limitations: string[];
  food_preferences: Record<string, unknown>;
  aliases: Record<string, CoachProfileAlias>;
  created_at: Date;
  updated_at: Date;
}

export interface CoachProfilePatch {
  goals?: string;
  training_days_per_week?: number;
  session_minutes?: number;
  equipment?: string[];
  limitations?: string[];
  food_preferences?: Record<string, unknown>;
  aliases?: Record<string, CoachProfileAlias>;
}

const PROFILE_COLS =
  'id, user_id, goals, training_days_per_week, session_minutes, equipment, limitations, food_preferences, aliases, created_at, updated_at';

// Columns that hold jsonb. Their values must be serialized explicitly:
// node-postgres renders a JS array parameter as a Postgres array literal,
// which a jsonb column rejects.
const JSONB_COLS = new Set([
  'equipment',
  'limitations',
  'food_preferences',
  'aliases',
]);

const PATCHABLE_COLS = [
  'goals',
  'training_days_per_week',
  'session_minutes',
  'equipment',
  'limitations',
  'food_preferences',
  'aliases',
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
    return JSONB_COLS.has(key) ? JSON.stringify(value) : value;
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

export { getCoachProfile, upsertCoachProfile };

export default {
  getCoachProfile,
  upsertCoachProfile,
};
