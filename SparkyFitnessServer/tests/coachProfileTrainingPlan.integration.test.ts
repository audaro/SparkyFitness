/**
 * `upsertCoachProfile` and the training-plan columns — integration test.
 *
 * WHY THIS EXISTS
 * ---------------
 * `tests/coachProfileRoutes.test.ts` mocks the repository, so it can prove the
 * contract accepts and forwards these fields and nothing more. Three things it
 * cannot prove run inside Postgres, and all three have a failure mode that
 * leaves the whole mocked suite green:
 *
 *   1. **Clearing a nullable jsonb column reaches it as SQL NULL.** The naive
 *      `JSON.stringify(value)` turns JS null into the string "null", which
 *      `::jsonb` stores as *jsonb null* — a value that is not NULL, so
 *      `WHERE enhancement IS NULL` stops matching a profile the user cleared.
 *      `toJsonbParam` is the fix; this is the test that would notice it being
 *      removed. The same trap already bit `gym_equipment_profiles.apparatus`.
 *   2. **A jsonb array parameter binds at all.** node-postgres renders a JS
 *      array as a Postgres array literal, which a jsonb column rejects at
 *      runtime — the reason JSONB_COLS exists.
 *   3. **The round trip preserves the values' shape**, so a stored enhancement
 *      object comes back as an object rather than a string.
 *
 * It seeds and deletes only its own synthetic `@example.test` user, and SKIPS
 * cleanly when no database is reachable, mirroring
 * `medicationLastTaken.integration.test.ts`.
 */
import pg from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getSystemClient, endPool } from '../db/poolManager.js';
import coachProfileRepository from '../models/coachProfileRepository.js';

async function dbReachable(): Promise<boolean> {
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

const RUN = await dbReachable();

// Namespaced so cleanup is unambiguous.
const USER = '00000000-0000-4000-b000-0000000000c1';

describe.runIf(RUN)(
  'coach profile training-plan columns (real Postgres)',
  () => {
    beforeAll(async () => {
      const sys = await getSystemClient();
      try {
        await sys.query('DELETE FROM coach_profiles WHERE user_id = $1', [
          USER,
        ]);
        await sys.query('DELETE FROM public."user" WHERE id = $1', [USER]);
        await sys.query(
          `INSERT INTO public."user" (id, email, email_verified)
         VALUES ($1, $2, true) ON CONFLICT (id) DO NOTHING`,
          [USER, 'training-plan@example.test']
        );
      } finally {
        sys.release();
      }
    });

    afterAll(async () => {
      const sys = await getSystemClient();
      try {
        await sys.query('DELETE FROM coach_profiles WHERE user_id = $1', [
          USER,
        ]);
        await sys.query('DELETE FROM public."user" WHERE id = $1', [USER]);
      } finally {
        sys.release();
      }
      await endPool();
    });

    it('round-trips every training-plan column', async () => {
      const stamp = new Date('2026-09-15T10:00:00.000Z');
      const row = await coachProfileRepository.upsertCoachProfile(USER, {
        primary_goal: 'build_muscle',
        physique_target: 'muscular',
        priority_muscle_groups: ['push', 'pull'],
        enhancement: {
          status: 'trt',
          testosterone_mg_per_week: 120,
          ester: 'cypionate',
        },
        plan_completed_at: stamp,
      });

      expect(row.primary_goal).toBe('build_muscle');
      expect(row.physique_target).toBe('muscular');
      // An array bound to jsonb, not a Postgres array literal.
      expect(row.priority_muscle_groups).toEqual(['push', 'pull']);
      // An object, not the string "{...}".
      expect(row.enhancement).toEqual({
        status: 'trt',
        testosterone_mg_per_week: 120,
        ester: 'cypionate',
      });
      expect(row.plan_completed_at?.toISOString()).toBe(stamp.toISOString());
    });

    // The REST contract sends `plan_completed_at` as an ISO string, never a
    // Date, and the route forwards it untouched. Only a real database can say
    // whether that string reaches a TIMESTAMPTZ column intact; the route test
    // mocks the repository and would pass on a value Postgres rejects.
    it('accepts the ISO string the REST contract actually sends', async () => {
      const iso = '2026-09-15T10:00:00.000Z';
      const row = await coachProfileRepository.upsertCoachProfile(USER, {
        plan_completed_at: iso,
      });
      expect(row.plan_completed_at).toBeInstanceOf(Date);
      expect(row.plan_completed_at?.toISOString()).toBe(iso);
    });

    it('reopens the questionnaire by clearing the completion stamp', async () => {
      await coachProfileRepository.upsertCoachProfile(USER, {
        plan_completed_at: '2026-09-15T10:00:00.000Z',
      });
      const row = await coachProfileRepository.upsertCoachProfile(USER, {
        plan_completed_at: null,
      });
      expect(row.plan_completed_at).toBeNull();
    });

    // The one that a mocked suite cannot see: jsonb null is a value, SQL NULL is
    // the absence of one, and "not answered" has to be the second.
    it('clears a jsonb answer to SQL NULL, not to jsonb null', async () => {
      await coachProfileRepository.upsertCoachProfile(USER, {
        enhancement: { status: 'enhanced', testosterone_mg_per_week: 500 },
        priority_muscle_groups: ['legs'],
      });
      await coachProfileRepository.upsertCoachProfile(USER, {
        enhancement: null,
        priority_muscle_groups: null,
      });

      const sys = await getSystemClient();
      try {
        const { rows } = await sys.query(
          `SELECT enhancement IS NULL              AS enhancement_is_sql_null,
                priority_muscle_groups IS NULL   AS priorities_is_sql_null
           FROM coach_profiles WHERE user_id = $1`,
          [USER]
        );
        expect(rows[0].enhancement_is_sql_null).toBe(true);
        expect(rows[0].priorities_is_sql_null).toBe(true);
      } finally {
        sys.release();
      }
    });

    // An empty priority list is a real answer ("I prioritise nothing in
    // particular") and must survive as `[]` rather than collapsing to NULL.
    it('keeps an empty priority list distinct from a cleared one', async () => {
      const row = await coachProfileRepository.upsertCoachProfile(USER, {
        priority_muscle_groups: [],
      });
      expect(row.priority_muscle_groups).toEqual([]);

      const sys = await getSystemClient();
      try {
        const { rows } = await sys.query(
          'SELECT priority_muscle_groups IS NULL AS is_sql_null FROM coach_profiles WHERE user_id = $1',
          [USER]
        );
        expect(rows[0].is_sql_null).toBe(false);
      } finally {
        sys.release();
      }
    });

    // A patch that names no plan column must leave every one of them alone —
    // this is the partial-upsert promise the whole table is built on.
    it('leaves unmentioned plan columns untouched', async () => {
      await coachProfileRepository.upsertCoachProfile(USER, {
        primary_goal: 'strength',
        enhancement: { status: 'natural' },
      });
      const row = await coachProfileRepository.upsertCoachProfile(USER, {
        session_minutes: 45,
      });
      expect(row.session_minutes).toBe(45);
      expect(row.primary_goal).toBe('strength');
      expect(row.enhancement).toEqual({ status: 'natural' });
    });
  }
);
