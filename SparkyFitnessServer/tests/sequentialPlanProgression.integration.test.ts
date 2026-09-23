/**
 * Sequential workout plan progression — integration test.
 *
 * WHY THIS EXISTS
 * ---------------
 * `computeSequentialPlanProgression` is pure and already unit-tested, but it is
 * only as honest as the rows it is handed. Which entries count as a finished
 * session is decided in SQL, inside `getActiveWorkoutPlanForDate`, and a mocked
 * pool cannot prove a predicate. It matters more here than in most reads: a
 * live plan session is created server-side the moment it is *started*, with
 * every prescribed set written up front, so before this predicate existed the
 * banner advanced to the next session as soon as the user tapped Start — the
 * defect was reproduced on a device, where a plan sat at 3/3 "Legs" with
 * session 2 open and nothing logged.
 *
 * The three behaviors asserted here are the whole contract: a started session
 * does not advance the plan, one ticked set does, and a plan-linked entry with
 * no set rows at all (a hand-logged or imported session) still does, because
 * nothing in it could have been ticked and excluding it would freeze the plan
 * on one session forever.
 *
 * It seeds and deletes only its own synthetic rows. The gate does a
 * short-timeout connection probe, so it SKIPS cleanly when no database is
 * reachable (mirrors exerciseEntryStats.integration.test.ts).
 */
import pg from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getSystemClient, endPool } from '../db/poolManager.js';
import workoutPlanTemplateRepository from '../models/workoutPlanTemplateRepository.js';

async function planDbReachable(): Promise<boolean> {
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

const RUN = await planDbReachable();

// Stable, namespaced UUIDs so cleanup is unambiguous.
const U = '00000000-0000-4000-b000-0000000000a1';
const EX = [
  '00000000-0000-4000-b000-0000000000f1',
  '00000000-0000-4000-b000-0000000000f2',
  '00000000-0000-4000-b000-0000000000f3',
];
const EN_PUSH = '00000000-0000-4000-b000-000000000701';
const EN_PULL = '00000000-0000-4000-b000-000000000702';
const EN_LEGS = '00000000-0000-4000-b000-000000000703';

// The plan window and the read date are fixed, so nothing here depends on
// today: `getActiveWorkoutPlanForDate` takes the day it answers for.
const PLAN_START = '2026-01-01';
const READ_DATE = '2026-01-05';

const SESSIONS = ['QA Push', 'QA Pull', 'QA Legs'] as const;

let templateId: number;
let assignmentIds: number[] = [];

async function positionOn(date: string) {
  const plans = await workoutPlanTemplateRepository.getActiveWorkoutPlanForDate(
    U,
    date
  );
  const plan = plans.find((p) => p.id === templateId);
  return plan?.sequence_position ?? null;
}

describe.runIf(RUN)('sequential plan progression SQL', () => {
  beforeAll(async () => {
    const sys = await getSystemClient();
    try {
      // Idempotent clean slate (entries cascade their sets, assignments
      // cascade from the template).
      await sys.query(
        'DELETE FROM public.exercise_entries WHERE user_id = $1',
        [U]
      );
      await sys.query(
        'DELETE FROM public.workout_plan_templates WHERE user_id = $1',
        [U]
      );
      await sys.query(
        'DELETE FROM public.exercises WHERE id = ANY($1::uuid[])',
        [EX]
      );
      await sys.query('DELETE FROM public."user" WHERE id = $1', [U]);

      await sys.query(
        'INSERT INTO public."user" (id, email, email_verified) VALUES ($1, $2, true) ON CONFLICT (id) DO NOTHING',
        [U, `plan-progression-${U}@example.test`]
      );
      for (const [index, id] of EX.entries()) {
        await sys.query(
          'INSERT INTO public.exercises (id, name, source, user_id, is_custom) VALUES ($1, $2, $3, $4, true)',
          [id, `Plan Progression Exercise ${index + 1}`, 'test', U]
        );
      }

      const template = await sys.query(
        `INSERT INTO public.workout_plan_templates
           (user_id, plan_name, start_date, is_active, schedule_type, entry_mode)
         VALUES ($1, $2, $3, TRUE, 'sequential', 'prompt')
         RETURNING id`,
        [U, 'QA Rotation', PLAN_START]
      );
      templateId = template.rows[0].id;

      assignmentIds = [];
      for (const [index, name] of SESSIONS.entries()) {
        // day_of_week stays NULL: a sequential plan's sessions are ordered by
        // session_index and are not pinned to weekdays.
        const assignment = await sys.query(
          `INSERT INTO public.workout_plan_template_assignments
             (template_id, exercise_id, session_index, session_name, sort_order)
           VALUES ($1, $2, $3, $4, 0)
           RETURNING id`,
          [templateId, EX[index], index + 1, name]
        );
        assignmentIds.push(assignment.rows[0].id);
      }
    } finally {
      sys.release();
    }
  });

  afterAll(async () => {
    if (!RUN) return;
    const sys = await getSystemClient();
    try {
      await sys.query(
        'DELETE FROM public.exercise_entries WHERE user_id = $1',
        [U]
      );
      await sys.query(
        'DELETE FROM public.workout_plan_templates WHERE user_id = $1',
        [U]
      );
      await sys.query(
        'DELETE FROM public.exercises WHERE id = ANY($1::uuid[])',
        [EX]
      );
      await sys.query('DELETE FROM public."user" WHERE id = $1', [U]);
    } finally {
      sys.release();
    }
    await endPool();
  });

  // Helpers seed the two shapes a plan session can arrive in: a live session
  // (sets written with their prescription, `completed_at` NULL until ticked)
  // and a hand-logged one (no set rows at all).
  async function startSession(
    entryId: string,
    assignmentIndex: number,
    entryDate = READ_DATE
  ) {
    const sys = await getSystemClient();
    try {
      await sys.query(
        `INSERT INTO public.exercise_entries
           (id, user_id, exercise_id, duration_minutes, calories_burned, entry_date,
            workout_plan_assignment_id, exercise_name)
         VALUES ($1, $2, $3, 0, 0, $4, $5, $6)`,
        [
          entryId,
          U,
          EX[assignmentIndex],
          entryDate,
          assignmentIds[assignmentIndex],
          `Plan Progression Exercise ${assignmentIndex + 1}`,
        ]
      );
      for (const setNumber of [1, 2, 3]) {
        await sys.query(
          `INSERT INTO public.exercise_entry_sets
             (exercise_entry_id, set_number, set_type, weight, reps)
           VALUES ($1, $2, 'Working Set', 40, 10)`,
          [entryId, setNumber]
        );
      }
    } finally {
      sys.release();
    }
  }

  async function completeOneSet(entryId: string) {
    const sys = await getSystemClient();
    try {
      await sys.query(
        `UPDATE public.exercise_entry_sets
            SET completed_at = now()
          WHERE exercise_entry_id = $1 AND set_number = 1`,
        [entryId]
      );
    } finally {
      sys.release();
    }
  }

  async function logSetlessSession(
    entryId: string,
    assignmentIndex: number,
    entryDate = READ_DATE
  ) {
    const sys = await getSystemClient();
    try {
      await sys.query(
        `INSERT INTO public.exercise_entries
           (id, user_id, exercise_id, duration_minutes, calories_burned, entry_date,
            workout_plan_assignment_id, exercise_name)
         VALUES ($1, $2, $3, 30, 200, $4, $5, $6)`,
        [
          entryId,
          U,
          EX[assignmentIndex],
          entryDate,
          assignmentIds[assignmentIndex],
          `Plan Progression Exercise ${assignmentIndex + 1}`,
        ]
      );
    } finally {
      sys.release();
    }
  }

  it('starts at the first session with nothing logged', async () => {
    expect(await positionOn(READ_DATE)).toEqual({
      current: 1,
      total: 3,
      session_name: 'QA Push',
    });
  });

  it('does not advance for a session that was started but never logged', async () => {
    await startSession(EN_PUSH, 0);

    // This is the defect this predicate exists for: the entry and all three
    // of its sets are in the database, and the plan must still be on Push.
    expect(await positionOn(READ_DATE)).toEqual({
      current: 1,
      total: 3,
      session_name: 'QA Push',
    });
    // And it must stay on Push tomorrow, too — the read is date-scoped, so a
    // predicate that only held for the day of the entry would hide the bug.
    expect(await positionOn('2026-01-06')).toEqual({
      current: 1,
      total: 3,
      session_name: 'QA Push',
    });
  });

  it('advances once a single set in the session is completed', async () => {
    await completeOneSet(EN_PUSH);

    // One ticked set of three: a session cut short is still a session done.
    expect(await positionOn(READ_DATE)).toEqual({
      current: 2,
      total: 3,
      session_name: 'QA Pull',
    });
  });

  it('holds on the second session while it is merely started', async () => {
    await startSession(EN_PULL, 1);

    expect(await positionOn(READ_DATE)).toEqual({
      current: 2,
      total: 3,
      session_name: 'QA Pull',
    });
  });

  it('counts a plan-linked entry that has no sets at all', async () => {
    await completeOneSet(EN_PULL);
    expect(await positionOn(READ_DATE)).toEqual({
      current: 3,
      total: 3,
      session_name: 'QA Legs',
    });

    // A hand-logged or imported session (cardio, duration only) has no set
    // rows, so it carries no `completed_at` and never could. It counts, and
    // the plan wraps to the top of the next cycle.
    await logSetlessSession(EN_LEGS, 2);
    expect(await positionOn(READ_DATE)).toEqual({
      current: 1,
      total: 3,
      session_name: 'QA Push',
    });
  });
});
