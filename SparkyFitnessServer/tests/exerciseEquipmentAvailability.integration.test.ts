/**
 * Gym-profile equipment availability — integration test.
 *
 * WHY THIS EXISTS
 * ---------------
 * The availability predicate is SQL semantics, and the rest of the exercise
 * suite mocks `db/poolManager.js`, so a unit test can only assert the query
 * text — never that the query means what we think. These cases each encode a
 * defect that the original `equipment::jsonb ?|` overlap filter shipped with
 * and that only a real Postgres can demonstrate:
 *
 *   - a multi-equipment exercise overlapping a profile it cannot actually be
 *     performed under (`["dumbbell","barbell"]` vs a dumbbell-only profile),
 *   - equipment-free exercises (NULL / '' / `[]`) being dropped entirely, which
 *     hid every user-created custom exercise the moment a profile was active,
 *   - a legacy scalar value (`"dumbbell"` rather than `["dumbbell"]`) raising
 *     "cannot extract elements from a scalar",
 *   - a user's own `["Dumbbell"]` being invisible to their `dumbbell` profile,
 *     because nothing canonicalizes the casing a custom exercise is stored
 *     with.
 *
 * HOW TO RUN
 * ----------
 * Runs automatically whenever a database is reachable (locally as part of
 * `pnpm test`, and in the CI migration-check job) and skips cleanly otherwise,
 * using the same probe-then-skip approach as `rlsPermissionMatrix`. It seeds
 * and deletes only its own synthetic user and exercises.
 */
import pg from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import exerciseDb from '../models/exercise.js';
import { getSystemClient, endPool } from '../db/poolManager.js';

async function testDbReachable(): Promise<boolean> {
  if (process.env.SKIP_RLS_MATRIX === '1') return false;
  if (
    !process.env.SPARKY_FITNESS_APP_DB_USER ||
    !process.env.SPARKY_FITNESS_DB_HOST
  ) {
    return false;
  }
  const probe = new pg.Client({
    host: process.env.SPARKY_FITNESS_DB_HOST,
    port: Number(process.env.SPARKY_FITNESS_DB_PORT) || 5432,
    database: process.env.SPARKY_FITNESS_DB_NAME,
    user: process.env.SPARKY_FITNESS_APP_DB_USER,
    password: process.env.SPARKY_FITNESS_APP_DB_PASSWORD,
    connectionTimeoutMillis: 2000,
  });
  try {
    await probe.connect();
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}

const RUN = await testDbReachable();

const OWNER = '00000000-0000-4000-b000-0000000000e1';
const PREFIX = 'EquipAvail';

/** name -> raw `equipment` TEXT column value (null = SQL NULL). */
const SEED: ReadonlyArray<readonly [string, string | null]> = [
  [`${PREFIX} Dumbbell Only`, '["dumbbell"]'],
  [`${PREFIX} Bands Only`, '["bands"]'],
  [`${PREFIX} Barbell Only`, '["barbell"]'],
  [`${PREFIX} Dumbbell And Barbell`, '["dumbbell","barbell"]'],
  [`${PREFIX} Bodyweight`, '["body only"]'],
  [`${PREFIX} Strongman Other`, '["other"]'],
  [`${PREFIX} Null Equipment`, null],
  [`${PREFIX} Empty String Equipment`, ''],
  [`${PREFIX} Empty Array Equipment`, '[]'],
  [`${PREFIX} Legacy Scalar`, '"dumbbell"'],
  // Nothing validates the casing a custom exercise is stored with — the
  // column is free TEXT, and this route family's own Swagger example
  // advertised `"equipment": ["None"]` with title-cased muscles until it was
  // corrected. Real rows look like this.
  [`${PREFIX} Title Case`, '["Dumbbell"]'],
  [`${PREFIX} Padded Case`, '["  BARBELL "]'],
];

async function namesFor(
  availableEquipment: string[] | null
): Promise<string[]> {
  const rows = await exerciseDb.searchExercises(
    PREFIX,
    OWNER,
    [],
    [],
    availableEquipment
  );
  return rows.map((row: any) => row.name).sort();
}

describe.runIf(RUN)('gym-profile equipment availability', () => {
  beforeAll(async () => {
    const sys = await getSystemClient();
    try {
      // Idempotent clean slate. The exercises are deleted explicitly rather
      // than left to the user delete: several counts here are exact, so a row
      // surviving from an interrupted run would silently inflate them.
      await sys.query('DELETE FROM exercises WHERE user_id = $1', [OWNER]);
      await sys.query('DELETE FROM public."user" WHERE id = $1', [OWNER]);
      await sys.query(
        'INSERT INTO public."user" (id, email, email_verified) VALUES ($1, $2, true) ON CONFLICT (id) DO NOTHING',
        [OWNER, `equip-avail-${OWNER}@example.test`]
      );
      for (const [name, equipment] of SEED) {
        await sys.query(
          `INSERT INTO exercises
             (user_id, name, category, calories_per_hour, is_custom, source, equipment)
           VALUES ($1, $2, 'strength', 300, true, 'custom', $3)`,
          [OWNER, name, equipment]
        );
      }
    } finally {
      sys.release();
    }
  });

  afterAll(async () => {
    const sys = await getSystemClient();
    try {
      await sys.query('DELETE FROM exercises WHERE user_id = $1', [OWNER]);
      await sys.query('DELETE FROM public."user" WHERE id = $1', [OWNER]);
    } finally {
      sys.release();
    }
    await endPool();
  });

  it('returns everything when no profile is in play', async () => {
    const names = await namesFor(null);
    expect(names).toHaveLength(SEED.length);
  });

  it('excludes an exercise that also needs gear the profile lacks', async () => {
    const names = await namesFor(['dumbbell', 'body only']);
    // The core overlap bug: this row lists 'dumbbell', so `?|` matched it even
    // though the lifter owns no barbell.
    expect(names).not.toContain(`${PREFIX} Dumbbell And Barbell`);
    expect(names).toContain(`${PREFIX} Dumbbell Only`);
  });

  it('keeps exercises that need no equipment at all', async () => {
    const names = await namesFor(['dumbbell', 'body only']);
    // NULL / '' / [] all mean "needs nothing" and are available everywhere.
    // The overlap filter dropped all three, hiding every custom exercise.
    expect(names).toContain(`${PREFIX} Null Equipment`);
    expect(names).toContain(`${PREFIX} Empty String Equipment`);
    expect(names).toContain(`${PREFIX} Empty Array Equipment`);
  });

  it('treats a legacy scalar value as a one-item requirement', async () => {
    expect(await namesFor(['dumbbell', 'body only'])).toContain(
      `${PREFIX} Legacy Scalar`
    );
    // Not "no equipment": a barbell-only gym cannot perform it.
    expect(await namesFor(['barbell'])).not.toContain(
      `${PREFIX} Legacy Scalar`
    );
  });

  it("does not admit 'other' unless the profile lists it", async () => {
    expect(await namesFor(['dumbbell', 'body only'])).not.toContain(
      `${PREFIX} Strongman Other`
    );
    expect(await namesFor(['other', 'body only'])).toContain(
      `${PREFIX} Strongman Other`
    );
  });

  it('leaves only the equipment-free exercises for an empty profile', async () => {
    const names = await namesFor([]);
    expect(names).toEqual(
      [
        `${PREFIX} Empty Array Equipment`,
        `${PREFIX} Empty String Equipment`,
        `${PREFIX} Null Equipment`,
      ].sort()
    );
  });

  it('admits an exercise whose whole requirement list is covered', async () => {
    const names = await namesFor(['dumbbell', 'barbell']);
    expect(names).toContain(`${PREFIX} Dumbbell And Barbell`);
    expect(names).not.toContain(`${PREFIX} Bands Only`);
  });

  it('matches stored equipment regardless of case or padding', async () => {
    // A user's own `["Dumbbell"]` must be visible to their `dumbbell`
    // profile. Being strict here drops a row the user owns, silently, and it
    // reads as data loss rather than as a filter.
    expect(await namesFor(['dumbbell'])).toContain(`${PREFIX} Title Case`);
    expect(await namesFor(['barbell'])).toContain(`${PREFIX} Padded Case`);
  });

  it('still excludes a mis-cased requirement the profile lacks', async () => {
    // Normalization must not degrade into "matches anything": `["Dumbbell"]`
    // is still a dumbbell requirement.
    expect(await namesFor(['bands', 'body only'])).not.toContain(
      `${PREFIX} Title Case`
    );
  });
});
