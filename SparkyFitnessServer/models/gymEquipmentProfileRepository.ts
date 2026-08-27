import { getClient } from '../db/poolManager.js';
import type {
  ExerciseApparatus,
  GymEquipmentValue,
  LoadLimits,
} from '@workspace/shared';

export interface GymEquipmentProfileRow {
  id: string;
  user_id: string;
  name: string;
  equipment: GymEquipmentValue[];
  // Tri-state: null = never stated (engine infers apparatus from
  // barbell/cable/machine); [] = stated none; array = stated exactly these.
  apparatus: ExerciseApparatus[] | null;
  // Per-equipment ceilings/steps, kg; null = none stated (no cap).
  load_limits: LoadLimits | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface GymEquipmentProfileCreate {
  name: string;
  equipment: GymEquipmentValue[];
  apparatus?: ExerciseApparatus[] | null;
  load_limits?: LoadLimits | null;
  is_active?: boolean;
}

/**
 * Only the keys actually present are written. Deliberately NOT modelled as a
 * full row with `?? ''` fallbacks the way the preset repositories are — that
 * pattern blanks every column the caller did not mention.
 */
export interface GymEquipmentProfilePatch {
  name?: string;
  equipment?: GymEquipmentValue[];
  /** Explicit null clears back to "never stated". */
  apparatus?: ExerciseApparatus[] | null;
  /** Explicit null clears every limit; a map replaces the whole column. */
  load_limits?: LoadLimits | null;
}

const PROFILE_COLS =
  'id, user_id, name, equipment, apparatus, load_limits, is_active, created_at, updated_at';

// node-postgres renders a JS array parameter as a Postgres array literal,
// which a jsonb column rejects — serialize explicitly and cast.
const PATCHABLE_COLS = [
  'name',
  'equipment',
  'apparatus',
  'load_limits',
] as const;
const JSONB_COLS = new Set<string>(['equipment', 'apparatus', 'load_limits']);

/**
 * Serialize a value bound for a nullable jsonb column. The naive
 * `JSON.stringify(value)` turns JS null into the string "null", which
 * `::jsonb` stores as *jsonb null* — truthy-ish in reads and distinct from
 * SQL NULL, which is what the apparatus tri-state contract requires.
 */
function toJsonbParam(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

async function listGymProfiles(
  userId: string
): Promise<GymEquipmentProfileRow[]> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT ${PROFILE_COLS} FROM gym_equipment_profiles
        WHERE user_id = $1
        ORDER BY is_active DESC, name ASC`,
      [userId]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

async function getGymProfile(
  userId: string,
  profileId: string
): Promise<GymEquipmentProfileRow | null> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT ${PROFILE_COLS} FROM gym_equipment_profiles
        WHERE user_id = $1 AND id = $2`,
      [userId, profileId]
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

/**
 * The user's active profile, or null when they have none — which callers
 * read as "no constraint", not "no equipment".
 */
async function getActiveGymProfile(
  userId: string
): Promise<GymEquipmentProfileRow | null> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT ${PROFILE_COLS} FROM gym_equipment_profiles
        WHERE user_id = $1 AND is_active
        LIMIT 1`,
      [userId]
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

/**
 * Serializes every write that can leave a row active, per user.
 *
 * The deactivate-then-activate pair is not enough on its own. Under READ
 * COMMITTED, two concurrent activations of *different* profiles both clear the
 * one currently-active row, then each set their own target active: the second
 * statement's snapshot was taken before the first committed, so it never sees
 * the row the other transaction just activated. Both commit an active row, the
 * partial unique index rejects one, and a legitimate double-tap surfaces as a
 * 500. Taking this lock first makes the loser wait and then win cleanly
 * (last-writer-wins), which is what a user tapping two profiles expects.
 *
 * An advisory lock rather than `SELECT ... FOR UPDATE`: the first profile a
 * user creates has no row to lock. Mirrors `genericHealthRepository`'s
 * `pg_advisory_xact_lock(hashtext($1))`; it releases with the transaction.
 */
async function lockUserProfiles(
  client: Awaited<ReturnType<typeof getClient>>,
  userId: string
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `gym_equipment_profiles:${userId}`,
  ]);
}

/**
 * Creating a profile as active clears the previous active row in the same
 * transaction: the partial unique index permits only one active row per user,
 * so the two writes cannot be separated.
 */
async function createGymProfile(
  userId: string,
  profile: GymEquipmentProfileCreate
): Promise<GymEquipmentProfileRow> {
  const isActive = profile.is_active === true;
  const client = await getClient(userId);
  try {
    await client.query('BEGIN');
    if (isActive) {
      await lockUserProfiles(client, userId);
      await client.query(
        `UPDATE gym_equipment_profiles
            SET is_active = FALSE, updated_at = now()
          WHERE user_id = $1 AND is_active`,
        [userId]
      );
    }
    const result = await client.query(
      `INSERT INTO gym_equipment_profiles (user_id, name, equipment, apparatus, load_limits, is_active)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6)
       RETURNING ${PROFILE_COLS}`,
      [
        userId,
        profile.name,
        JSON.stringify(profile.equipment),
        toJsonbParam(profile.apparatus),
        toJsonbParam(profile.load_limits),
        isActive,
      ]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateGymProfile(
  userId: string,
  profileId: string,
  patch: GymEquipmentProfilePatch
): Promise<GymEquipmentProfileRow | null> {
  const keys = PATCHABLE_COLS.filter(
    (key) => (patch as Record<string, unknown>)[key] !== undefined
  );
  if (keys.length === 0) {
    throw new Error('updateGymProfile called with an empty patch');
  }
  const assignments = keys.map((key, i) => {
    const cast = JSONB_COLS.has(key) ? '::jsonb' : '';
    return `${key} = $${i + 3}${cast}`;
  });
  const values = keys.map((key) => {
    const value = (patch as Record<string, unknown>)[key];
    return JSONB_COLS.has(key) ? toJsonbParam(value) : value;
  });
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `UPDATE gym_equipment_profiles
          SET ${assignments.join(', ')}, updated_at = now()
        WHERE user_id = $1 AND id = $2
        RETURNING ${PROFILE_COLS}`,
      [userId, profileId, ...values]
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

async function deleteGymProfile(
  userId: string,
  profileId: string
): Promise<boolean> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      'DELETE FROM gym_equipment_profiles WHERE user_id = $1 AND id = $2',
      [userId, profileId]
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

/**
 * Deactivate-then-activate, in one transaction and in that order: the partial
 * unique index would reject the second active row if the clear came after.
 * Returns null when the profile does not belong to the user.
 */
async function setActiveGymProfile(
  userId: string,
  profileId: string
): Promise<GymEquipmentProfileRow | null> {
  const client = await getClient(userId);
  try {
    await client.query('BEGIN');
    await lockUserProfiles(client, userId);
    await client.query(
      `UPDATE gym_equipment_profiles
          SET is_active = FALSE, updated_at = now()
        WHERE user_id = $1 AND is_active AND id <> $2`,
      [userId, profileId]
    );
    const result = await client.query(
      `UPDATE gym_equipment_profiles
          SET is_active = TRUE, updated_at = now()
        WHERE user_id = $1 AND id = $2
        RETURNING ${PROFILE_COLS}`,
      [userId, profileId]
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export {
  listGymProfiles,
  getGymProfile,
  getActiveGymProfile,
  createGymProfile,
  updateGymProfile,
  deleteGymProfile,
  setActiveGymProfile,
};

export default {
  listGymProfiles,
  getGymProfile,
  getActiveGymProfile,
  createGymProfile,
  updateGymProfile,
  deleteGymProfile,
  setActiveGymProfile,
};
