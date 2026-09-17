import pg from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getSystemClient, endPool } from '../db/poolManager.js';
import exerciseDb from '../models/exercise.js';
import workoutPresetRepository from '../models/workoutPresetRepository.js';

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
    try {
      await probe.end();
    } catch {
      // ignore close errors
    }
  }
}

describe('exercise delete preset and future plan cascade integration test', () => {
  let canRun = false;
  let adminClient: pg.PoolClient | null = null;
  const testEmail = `exercise-cascade-${Date.now()}@example.test`;
  let userId: string;
  let exerciseId: string;
  let presetId: number;
  let templateId: number;
  let assignmentId: number;
  const pastDate = '2026-09-10';
  const today = '2026-09-12';
  const futureDate = '2026-09-15';

  beforeAll(async () => {
    canRun = await dbReachable();
    if (!canRun) return;

    adminClient = await getSystemClient();
    if (!adminClient) {
      canRun = false;
      return;
    }

    // 1. Create test user
    const userRes = await adminClient.query(
      `INSERT INTO "user" (id, email, name, email_verified, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'Cascade Test User', true, NOW(), NOW())
       RETURNING id`,
      [testEmail]
    );
    userId = userRes.rows[0].id;

    // 2. Create test exercise
    const exRes = await adminClient.query(
      `INSERT INTO exercises (name, category, user_id, is_custom, source, created_at, updated_at)
       VALUES ('Integration Test Dumbbell Press', 'Strength', $1, true, 'custom', NOW(), NOW())
       RETURNING id`,
      [userId]
    );
    exerciseId = exRes.rows[0].id;

    // 3. Create test workout preset
    const presetRes = await adminClient.query(
      `INSERT INTO workout_presets (user_id, name, description, created_at, updated_at)
       VALUES ($1, 'Full Body Routine', 'Preset for cascade test', NOW(), NOW())
       RETURNING id`,
      [userId]
    );
    presetId = presetRes.rows[0].id;

    // 4. Attach exercise to preset
    const wpeRes = await adminClient.query(
      `INSERT INTO workout_preset_exercises (workout_preset_id, exercise_id, sort_order, created_at, updated_at)
       VALUES ($1, $2, 0, NOW(), NOW())
       RETURNING id`,
      [presetId, exerciseId]
    );
    const wpeId = wpeRes.rows[0].id;

    await adminClient.query(
      `INSERT INTO workout_preset_exercise_sets (workout_preset_exercise_id, set_number, reps, weight)
       VALUES ($1, 1, 10, 20.0)`,
      [wpeId]
    );

    // 5. Create workout plan template & assignment
    const templateRes = await adminClient.query(
      `INSERT INTO workout_plan_templates (user_id, plan_name, is_active, created_at, updated_at)
       VALUES ($1, 'Weekly Hypertrophy', true, NOW(), NOW())
       RETURNING id`,
      [userId]
    );
    templateId = templateRes.rows[0].id;

    const assignmentRes = await adminClient.query(
      `INSERT INTO workout_plan_template_assignments (template_id, day_of_week, exercise_id, sort_order)
       VALUES ($1, 0, $2, 0)
       RETURNING id`,
      [templateId, exerciseId]
    );
    assignmentId = assignmentRes.rows[0].id;

    // 6a. Create past diary entry generated from workout plan (past plan history to preserve)
    await adminClient.query(
      `INSERT INTO exercise_entries (user_id, exercise_id, exercise_name, entry_date, duration_minutes, calories_burned, workout_plan_assignment_id, created_at, updated_at)
       VALUES ($1, $2, 'Integration Test Dumbbell Press', $3, 30, 150, $4, NOW(), NOW())`,
      [userId, exerciseId, pastDate, assignmentId]
    );

    // 6b. Create today's diary entry (current log to preserve)
    await adminClient.query(
      `INSERT INTO exercise_entries (user_id, exercise_id, exercise_name, entry_date, duration_minutes, calories_burned, created_at, updated_at)
       VALUES ($1, $2, 'Integration Test Dumbbell Press', $3, 30, 150, NOW(), NOW())`,
      [userId, exerciseId, today]
    );

    // 7. Create future diary entry generated from workout plan (to clean up)
    await adminClient.query(
      `INSERT INTO exercise_entries (user_id, exercise_id, exercise_name, entry_date, duration_minutes, calories_burned, workout_plan_assignment_id, created_at, updated_at)
       VALUES ($1, $2, 'Integration Test Dumbbell Press', $3, 30, 150, $4, NOW(), NOW())`,
      [userId, exerciseId, futureDate, assignmentId]
    );
  });

  afterAll(async () => {
    if (adminClient && userId) {
      await adminClient.query('DELETE FROM "user" WHERE id = $1', [userId]);
      adminClient.release();
    }
    await endPool();
  });

  it('deleting exercise removes it from presets, cleans up future plan entries, and preserves past and today diary', async (ctx) => {
    if (!canRun) {
      ctx.skip();
      return;
    }

    // Verify initial state: preset has 1 exercise
    const initialPreset = await workoutPresetRepository.getWorkoutPresetById(
      presetId,
      userId
    );
    expect(initialPreset?.exercises?.length).toBe(1);

    // Execute deleteExerciseAndDependencies with today date
    const deleteRes = await exerciseDb.deleteExerciseAndDependencies(
      exerciseId,
      userId,
      today
    );
    expect(deleteRes.success).toBe(true);

    // 1. Verify preset exercises cascaded: preset now has 0 exercises
    const updatedPreset = await workoutPresetRepository.getWorkoutPresetById(
      presetId,
      userId
    );
    expect(updatedPreset?.exercises?.length).toBe(0);

    // 2. Verify workout plan assignment cascaded
    const assignmentsRes = await adminClient!.query(
      'SELECT COUNT(*) FROM workout_plan_template_assignments WHERE exercise_id = $1',
      [exerciseId]
    );
    expect(parseInt(assignmentsRes.rows[0].count, 10)).toBe(0);

    // 3a. Verify past planned diary entry is preserved with exercise_id set to NULL
    const pastEntryRes = await adminClient!.query(
      'SELECT id, exercise_id, exercise_name FROM exercise_entries WHERE user_id = $1 AND entry_date = $2',
      [userId, pastDate]
    );
    expect(pastEntryRes.rows.length).toBe(1);
    expect(pastEntryRes.rows[0].exercise_id).toBeNull();
    expect(pastEntryRes.rows[0].exercise_name).toBe(
      'Integration Test Dumbbell Press'
    );

    // 3b. Verify today diary entry is preserved with exercise_id set to NULL
    const todayEntryRes = await adminClient!.query(
      'SELECT id, exercise_id, exercise_name FROM exercise_entries WHERE user_id = $1 AND entry_date = $2',
      [userId, today]
    );
    expect(todayEntryRes.rows.length).toBe(1);
    expect(todayEntryRes.rows[0].exercise_id).toBeNull();
    expect(todayEntryRes.rows[0].exercise_name).toBe(
      'Integration Test Dumbbell Press'
    );

    // 4. Verify future planned diary entry is cleaned up
    const futureEntryRes = await adminClient!.query(
      'SELECT id FROM exercise_entries WHERE user_id = $1 AND entry_date = $2',
      [userId, futureDate]
    );
    expect(futureEntryRes.rows.length).toBe(0);
  });

  it('force delete (delete_with_history) removes exercise from presets, workout plans, and all diary entries', async (ctx) => {
    if (!canRun) {
      ctx.skip();
      return;
    }

    // Create another exercise for force delete test
    const exRes = await adminClient!.query(
      `INSERT INTO exercises (name, category, user_id, is_custom, source, created_at, updated_at)
       VALUES ('Force Delete Exercise', 'Strength', $1, true, 'custom', NOW(), NOW())
       RETURNING id`,
      [userId]
    );
    const forceExId = exRes.rows[0].id;

    // Attach to preset
    const wpeRes = await adminClient!.query(
      `INSERT INTO workout_preset_exercises (workout_preset_id, exercise_id, sort_order, created_at, updated_at)
       VALUES ($1, $2, 0, NOW(), NOW())
       RETURNING id`,
      [presetId, forceExId]
    );
    await adminClient!.query(
      `INSERT INTO workout_preset_exercise_sets (workout_preset_exercise_id, set_number, reps, weight)
       VALUES ($1, 1, 12, 25.0)`,
      [wpeRes.rows[0].id]
    );

    // Attach to plan template
    const forceAssignmentRes = await adminClient!.query(
      `INSERT INTO workout_plan_template_assignments (template_id, day_of_week, exercise_id, sort_order)
       VALUES ($1, 1, $2, 0)
       RETURNING id`,
      [templateId, forceExId]
    );
    const forceAssignmentId = forceAssignmentRes.rows[0].id;

    // Add entry for today
    await adminClient!.query(
      `INSERT INTO exercise_entries (user_id, exercise_id, exercise_name, entry_date, duration_minutes, calories_burned, created_at, updated_at)
       VALUES ($1, $2, 'Force Delete Exercise', $3, 20, 100, NOW(), NOW())`,
      [userId, forceExId, today]
    );

    // Add entry for future plan
    await adminClient!.query(
      `INSERT INTO exercise_entries (user_id, exercise_id, exercise_name, entry_date, duration_minutes, calories_burned, workout_plan_assignment_id, created_at, updated_at)
       VALUES ($1, $2, 'Force Delete Exercise', $3, 20, 100, $4, NOW(), NOW())`,
      [userId, forceExId, futureDate, forceAssignmentId]
    );

    // Perform deleteExercise with mode 'delete_with_history'
    const { default: exerciseService } =
      await import('../services/exerciseService.js');
    const deleteResult = await exerciseService.deleteExercise(
      userId,
      forceExId,
      'delete_with_history',
      today
    );
    expect(deleteResult.status).toBe('deleted_with_history');

    // 1. Verify preset exercises cascaded: preset has 0 exercises
    const updatedPreset = await workoutPresetRepository.getWorkoutPresetById(
      presetId,
      userId
    );
    expect(updatedPreset?.exercises?.length).toBe(0);

    // 2. Verify workout plan assignment cascaded
    const assignmentsRes = await adminClient!.query(
      'SELECT COUNT(*) FROM workout_plan_template_assignments WHERE exercise_id = $1',
      [forceExId]
    );
    expect(parseInt(assignmentsRes.rows[0].count, 10)).toBe(0);

    // 3. Verify all diary entries (today and future) for this exercise are deleted
    const allEntriesRes = await adminClient!.query(
      'SELECT id FROM exercise_entries WHERE user_id = $1 AND exercise_name = $2',
      [userId, 'Force Delete Exercise']
    );
    expect(allEntriesRes.rows.length).toBe(0);
  });
});
