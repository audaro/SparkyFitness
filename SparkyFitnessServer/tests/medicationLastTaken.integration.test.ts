/**
 * `listMedications`' last-taken aggregate — integration test.
 *
 * WHY THIS EXISTS
 * ---------------
 * `tests/medicationRepository.test.ts` mocks the pg client, so it can only assert the *shape*
 * of the SQL string: that it groups by `medication_id`, filters the statuses and is handed the
 * right parameters. Three things it cannot prove run inside Postgres:
 *
 *   1. `medication_id = ANY($1)` with a JS string array against a UUID column. The query relies
 *      on parameter type inference rather than an explicit `::uuid[]` cast (the neighbouring
 *      exercise integration test casts). If the inference did not hold, every list read would
 *      fail at runtime while the whole mocked suite stayed green.
 *   2. That `MAX(taken_at)` and the status filter actually pick the dose a user would call
 *      their last one.
 *   3. That RLS does not hide the aggregate from the very user it is computed for —
 *      `listMedications` runs it on the RLS-enforced `getClient(userId)` connection.
 *
 * It seeds and deletes only its own synthetic `@example.test` user. The gate does a real
 * short-timeout connection probe, so it SKIPS cleanly when no database is reachable — mirroring
 * `rlsPermissionMatrix.integration.test.ts` and `exerciseEntryStats.integration.test.ts`.
 */
import pg from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getSystemClient, endPool } from '../db/poolManager.js';
import medicationRepository from '../models/medicationRepository.js';

async function medsDbReachable(): Promise<boolean> {
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

const RUN = await medsDbReachable();

// Stable, namespaced UUIDs so cleanup is unambiguous.
const U = '00000000-0000-4000-b000-0000000000fa';
const OTHER = '00000000-0000-4000-b000-0000000000fb';

const M_RECENT = '00000000-0000-4000-b000-0000000000d1';
const M_OLD = '00000000-0000-4000-b000-0000000000d2';
const M_NEVER = '00000000-0000-4000-b000-0000000000d3';
const M_REFUSED = '00000000-0000-4000-b000-0000000000d4';
const M_OTHERS = '00000000-0000-4000-b000-0000000000d5';

const ALL_MEDS = [M_RECENT, M_OLD, M_NEVER, M_REFUSED, M_OTHERS];

type MedRow = { id: string; name: string; last_taken_at: Date | null };

async function seedUser(sys: pg.PoolClient, id: string, email: string) {
  await sys.query(
    `INSERT INTO public."user" (id, email, email_verified)
     VALUES ($1, $2, true) ON CONFLICT (id) DO NOTHING`,
    [id, email]
  );
}

async function seedMedication(
  sys: pg.PoolClient,
  id: string,
  userId: string,
  name: string
) {
  await sys.query(
    `INSERT INTO medications (id, user_id, name, is_active)
     VALUES ($1, $2, $3, TRUE)`,
    [id, userId, name]
  );
}

async function seedEntry(
  sys: pg.PoolClient,
  medId: string,
  userId: string,
  status: string,
  takenAt: string
) {
  await sys.query(
    `INSERT INTO medication_entries (medication_id, user_id, status, taken_at, entry_date)
     VALUES ($1, $2, $3, $4::timestamptz, ($4::timestamptz)::date)`,
    [medId, userId, status, takenAt]
  );
}

describe.runIf(RUN)(
  'listMedications last-taken aggregate (real Postgres)',
  () => {
    let rows: MedRow[];

    beforeAll(async () => {
      const sys = await getSystemClient();
      try {
        // Idempotent clean slate. Entries first: medication_id is ON DELETE SET NULL, so
        // deleting medications would orphan them rather than remove them.
        await sys.query(
          'DELETE FROM medication_entries WHERE user_id = ANY($1::uuid[])',
          [[U, OTHER]]
        );
        await sys.query('DELETE FROM medications WHERE id = ANY($1::uuid[])', [
          ALL_MEDS,
        ]);
        await sys.query(
          'DELETE FROM public."user" WHERE id = ANY($1::uuid[])',
          [[U, OTHER]]
        );

        await seedUser(sys, U, 'medlasttaken@example.test');
        await seedUser(sys, OTHER, 'medlasttaken-other@example.test');

        // Named so that alphabetical order and recency order disagree — otherwise the
        // "does not reorder" assertion below would pass for the wrong reason.
        await seedMedication(sys, M_RECENT, U, 'Zafirlukast');
        await seedMedication(sys, M_OLD, U, 'Amoxicillin');
        await seedMedication(sys, M_NEVER, U, 'Betamethasone');
        await seedMedication(sys, M_REFUSED, U, 'Ceftriaxone');
        await seedMedication(sys, M_OTHERS, U, 'Doxycycline');

        // Two real doses, latest wins.
        await seedEntry(sys, M_RECENT, U, 'taken', '2026-08-20T09:00:00Z');
        await seedEntry(sys, M_RECENT, U, 'taken', '2026-08-24T09:00:00Z');
        // A PRN dose counts as taken.
        await seedEntry(sys, M_OLD, U, 'prn_taken', '2026-01-05T09:00:00Z');
        // Only refusals: evidence against use, so this one reads as never taken.
        await seedEntry(sys, M_REFUSED, U, 'skipped', '2026-08-25T09:00:00Z');
        await seedEntry(sys, M_REFUSED, U, 'snoozed', '2026-08-25T10:00:00Z');
        // Another user's dose on this user's medication must not leak across.
        await seedEntry(sys, M_OTHERS, OTHER, 'taken', '2026-08-25T09:00:00Z');
      } finally {
        sys.release();
      }

      rows = await medicationRepository.listMedications(U);
    });

    afterAll(async () => {
      const sys = await getSystemClient();
      try {
        await sys.query(
          'DELETE FROM medication_entries WHERE user_id = ANY($1::uuid[])',
          [[U, OTHER]]
        );
        await sys.query('DELETE FROM medications WHERE id = ANY($1::uuid[])', [
          ALL_MEDS,
        ]);
        await sys.query(
          'DELETE FROM public."user" WHERE id = ANY($1::uuid[])',
          [[U, OTHER]]
        );
      } finally {
        sys.release();
      }
      await endPool();
    });

    const find = (id: string) => rows.find((r) => r.id === id);
    const takenAt = (id: string) => {
      const value = find(id)?.last_taken_at ?? null;
      return value === null ? null : new Date(value).toISOString();
    };

    it('runs at all — ANY($1) infers a uuid[] from a JS string array', () => {
      // The whole point of this file: the mocked suite cannot catch a type-inference
      // failure here, and it would break every medications list read.
      expect(rows).toHaveLength(5);
    });

    it('reports the most recent dose, not the first', () => {
      expect(takenAt(M_RECENT)).toBe('2026-08-24T09:00:00.000Z');
    });

    it('counts a PRN dose as taken', () => {
      expect(takenAt(M_OLD)).toBe('2026-01-05T09:00:00.000Z');
    });

    it('reports null for a medication with no doses at all', () => {
      expect(find(M_NEVER)?.last_taken_at).toBeNull();
    });

    it('does not count a skipped or snoozed dose as use', () => {
      // Both entries are newer than every real dose above; a status leak would make this
      // the most recently used medication in the cabinet.
      expect(find(M_REFUSED)?.last_taken_at).toBeNull();
    });

    it("does not read another user's doses", () => {
      expect(find(M_OTHERS)?.last_taken_at).toBeNull();
    });

    it('leaves the list alphabetical, active-first', () => {
      // The aggregate must not reorder the medications page: the recency signal is for
      // the name search's tier 1 only.
      expect(rows.map((r) => r.name)).toEqual([
        'Amoxicillin',
        'Betamethasone',
        'Ceftriaxone',
        'Doxycycline',
        'Zafirlukast',
      ]);
    });
  }
);
