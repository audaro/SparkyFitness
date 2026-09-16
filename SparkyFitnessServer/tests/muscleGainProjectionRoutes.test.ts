import { vi, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
// @ts-expect-error TS(7016): no type declarations shipped for supertest
import request from 'supertest';
import coachProfileRepository from '../models/coachProfileRepository.js';
import measurementRepository from '../models/measurementRepository.js';
import userRepository from '../models/userRepository.js';
import weeklySetTargetService from '../services/weeklySetTargetService.js';
import coachProfileRoutes from '../routes/coachProfileRoutes.js';

/**
 * `GET /coach-profile/projection`.
 *
 * The arithmetic is covered by `muscleGainProjection.test.ts` against the
 * studies it is anchored on. What is tested here is everything the database
 * contributes: which columns become which input, how adherence is measured,
 * and — the one that matters most — that the stated dose never appears in the
 * response payload.
 */

vi.mock('../models/coachProfileRepository.js', () => ({
  default: { getCoachProfile: vi.fn(), upsertCoachProfile: vi.fn() },
}));
vi.mock('../models/userRepository.js', () => ({
  default: { getUserProfile: vi.fn() },
}));
vi.mock('../models/measurementRepository.js', () => ({
  default: { getLatestCheckInMeasurementsOnOrBeforeDate: vi.fn() },
}));
vi.mock('../services/weeklySetTargetService.js', () => ({
  default: { getWeeklySetTargets: vi.fn() },
}));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn().mockResolvedValue('UTC'),
}));
vi.mock('../utils/permissionUtils.js', () => ({
  canAccessUserData: vi.fn().mockResolvedValue(true),
}));
vi.mock('../services/chatContextCache.js', () => ({
  invalidateChatContextInputs: vi.fn(),
}));

const context = { userId: 'owner-1', authenticatedUserId: 'owner-1' };

vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.userId = context.userId;
    req.authenticatedUserId = context.authenticatedUserId;
    req.originalUserId = context.authenticatedUserId;
    next();
  },
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const app = express();
app.use(express.json());
app.use('/coach-profile', coachProfileRoutes);

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function week(weekStart: string, overallPercent: number, completed = 20) {
  return {
    week_start: weekStart,
    week_end: weekStart,
    groups: [
      {
        group: 'push' as const,
        completed,
        target: 14,
        remaining: 0,
        percent: overallPercent,
      },
    ],
    overall_percent: overallPercent,
  };
}

const profile = {
  id: 'profile-1',
  user_id: 'owner-1',
  goals: null,
  training_days_per_week: 4,
  session_minutes: 60,
  experience_level: 'intermediate' as const,
  primary_goal: 'build_muscle' as const,
  physique_target: 'muscular' as const,
  priority_muscle_groups: ['push' as const],
  enhancement: null,
  plan_completed_at: null,
  equipment: [],
  limitations: [],
  food_preferences: {},
  aliases: {},
  weekly_set_targets: {},
  created_at: new Date('2026-08-24T00:00:00Z'),
  updated_at: new Date('2026-08-24T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  context.userId = 'owner-1';
  context.authenticatedUserId = 'owner-1';
  mocked(coachProfileRepository.getCoachProfile).mockResolvedValue(profile);
  mocked(userRepository.getUserProfile).mockResolvedValue({ gender: 'male' });
  mocked(
    measurementRepository.getLatestCheckInMeasurementsOnOrBeforeDate
  ).mockResolvedValue({ weight: 82 });
  mocked(weeklySetTargetService.getWeeklySetTargets).mockResolvedValue({
    current: week('2026-09-13', 0.2),
    history: [
      week('2026-08-16', 0.8),
      week('2026-08-23', 0.6),
      week('2026-08-30', 1),
      week('2026-09-06', 0.8),
    ],
    targets_are_custom: false,
  });
});

describe('GET /coach-profile/projection', () => {
  it('projects from the profile, the latest weigh-in and the weekly ring', async () => {
    const res = await request(app).get('/coach-profile/projection');
    expect(res.status).toBe(200);
    expect(res.body.horizon_weeks).toBe(12);
    expect(res.body.inputs).toEqual({
      sex: 'male',
      experience_level: 'intermediate',
      bodyweight_kg: 82,
      // (0.8 + 0.6 + 1 + 0.8) / 4
      adherence: 0.8,
      adherence_basis: 'measured',
      adherence_weeks: 4,
      enhancement_stated: false,
    });
    expect(res.body.projection.natural_kg.low_kg).toBeGreaterThan(0);
    expect(res.body.projection.enhanced_kg).toBeNull();
    expect(res.body.projection.unmodelled).toEqual(['no_stated_dose']);
    expect(res.body.projection.sources.join(' ')).toContain('Bhasin');
  });

  // The current week is partial by definition. Averaging a Tuesday into the
  // mean would report every user as slipping every Monday.
  it('excludes the partial current week from adherence', async () => {
    const res = await request(app).get('/coach-profile/projection');
    // The current week sits at 0.2 and would drag a five-week mean to 0.68.
    expect(res.body.inputs.adherence).toBeCloseTo(0.8, 5);
  });

  it('assumes the targets are met when there is no history to measure', async () => {
    mocked(weeklySetTargetService.getWeeklySetTargets).mockResolvedValue({
      current: week('2026-09-13', 0, 0),
      history: [week('2026-09-06', 0, 0), week('2026-08-30', 0, 0)],
      targets_are_custom: false,
    });
    const res = await request(app).get('/coach-profile/projection');
    expect(res.body.inputs.adherence_basis).toBe('no_history');
    expect(res.body.inputs.adherence).toBe(1);
    expect(res.body.inputs.adherence_weeks).toBe(0);
    // A user who has just answered the questionnaire has not failed at
    // anything, so they must not be shown a projection of zero.
    expect(res.body.projection.total_kg.high_kg).toBeGreaterThan(0);
  });

  it('reports a missing bodyweight rather than inventing one', async () => {
    mocked(
      measurementRepository.getLatestCheckInMeasurementsOnOrBeforeDate
    ).mockResolvedValue({ weight: null });
    const res = await request(app).get('/coach-profile/projection');
    expect(res.status).toBe(200);
    expect(res.body.inputs.bodyweight_kg).toBeNull();
    expect(res.body.projection.natural_kg).toBeNull();
    expect(res.body.projection.unmodelled).toContain('bodyweight_unknown');
  });

  it('survives a user with no check-in row and no identity row at all', async () => {
    mocked(
      measurementRepository.getLatestCheckInMeasurementsOnOrBeforeDate
    ).mockResolvedValue(undefined);
    mocked(userRepository.getUserProfile).mockResolvedValue(undefined);
    mocked(coachProfileRepository.getCoachProfile).mockResolvedValue(null);
    const res = await request(app).get('/coach-profile/projection');
    expect(res.status).toBe(200);
    expect(res.body.inputs.sex).toBeNull();
    expect(res.body.inputs.experience_level).toBeNull();
    expect(res.body.inputs.bodyweight_kg).toBeNull();
  });

  it('honours a requested horizon', async () => {
    const twelve = await request(app).get('/coach-profile/projection?weeks=12');
    const twentyFour = await request(app).get(
      '/coach-profile/projection?weeks=24'
    );
    expect(twentyFour.body.horizon_weeks).toBe(24);
    expect(twentyFour.body.projection.total_kg.high_kg).toBeGreaterThan(
      twelve.body.projection.total_kg.high_kg
    );
  });

  // Rejected rather than clamped: a client asking for 500 weeks has a bug, and
  // silently answering a different question hides it.
  it('rejects a horizon outside the supported range', async () => {
    for (const weeks of ['0', '500', '-3', 'twelve', '12.5']) {
      const res = await request(app).get(
        `/coach-profile/projection?weeks=${weeks}`
      );
      expect(res.status).toBe(400);
    }
  });

  // The column is plain TEXT with no CHECK constraint, so a token outside the
  // vocabulary is reachable from the database. The response schema pins the
  // enum, and a read-only endpoint must not 500 on a row it can still project
  // from.
  it('reads an out-of-vocabulary experience level as unstated', async () => {
    mocked(coachProfileRepository.getCoachProfile).mockResolvedValue({
      ...profile,
      experience_level: 'grandmaster' as never,
    });
    const res = await request(app).get('/coach-profile/projection');
    expect(res.status).toBe(200);
    expect(res.body.inputs.experience_level).toBeNull();
    expect(res.body.projection.natural_kg.high_kg).toBeGreaterThan(0);
  });

  it('is owner-only, like the rest of the coach profile', async () => {
    context.userId = 'someone-else';
    const res = await request(app).get('/coach-profile/projection');
    expect(res.status).toBe(403);
  });
});

describe('the projection payload never carries the stated dose', () => {
  const dosed = {
    ...profile,
    enhancement: {
      status: 'trt' as const,
      testosterone_mg_per_week: 137,
      ester: 'cypionate' as const,
    },
  };

  it('estimates from the dose without reporting it', async () => {
    mocked(coachProfileRepository.getCoachProfile).mockResolvedValue(dosed);
    const res = await request(app).get('/coach-profile/projection');
    expect(res.status).toBe(200);

    // The dose did reach the model: the estimate is larger than the same
    // profile with nothing stated.
    expect(res.body.projection.enhanced_kg.high_kg).toBeGreaterThan(0);
    expect(res.body.inputs.enhancement_stated).toBe(true);

    // And nothing in the payload spells it out. Checked against the whole
    // serialized body rather than field by field, because the risk is a future
    // author spreading the profile row into the response.
    const serialized = JSON.stringify(res.body).toLowerCase();
    for (const term of [
      'enhancement"',
      'testosterone_mg',
      'cypionate',
      '"trt"',
      '137',
    ]) {
      expect(serialized).not.toContain(term);
    }
  });

  it('says a dose exists without estimating one it has no data for', async () => {
    mocked(coachProfileRepository.getCoachProfile).mockResolvedValue(dosed);
    mocked(userRepository.getUserProfile).mockResolvedValue({
      gender: 'female',
    });
    const res = await request(app).get('/coach-profile/projection');
    expect(res.body.projection.enhanced_kg).toBeNull();
    expect(res.body.projection.unmodelled).toContain(
      'dose_not_modelled_for_sex'
    );
    expect(res.body.inputs.enhancement_stated).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('137');
  });
});
