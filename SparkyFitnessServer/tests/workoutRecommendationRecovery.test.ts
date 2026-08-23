import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'supertest'
import request from 'supertest';
import express from 'express';
import { MUSCLES, RECOVERY_TUNABLES } from '@workspace/shared';
import workoutRecommendationService from '../services/workoutRecommendationService.js';
import workoutRecommendationRepository from '../models/workoutRecommendationRepository.js';
import workoutRecommendationRoutes from '../routes/workoutRecommendationRoutes.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';

vi.mock('../models/workoutRecommendationRepository.js', () => ({
  default: { getMuscleFatigueInputs: vi.fn() },
  getMuscleFatigueInputs: vi.fn(),
}));

vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn(),
}));

vi.mock('../middleware/authMiddleware.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = 'test-user-id';
    req.authenticatedUserId = 'test-user-id';
    next();
  },
}));

vi.mock('../middleware/checkPermissionMiddleware.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: () => (_req: any, _res: any, next: any) => next(),
}));

const app = express();
app.use(express.json());
app.use('/api/workout-recommendations', workoutRecommendationRoutes);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.status || 500).json({ error: err.message });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const repo = workoutRecommendationRepository as any;

describe('workoutRecommendationService.getMuscleRecovery', () => {
  // An assertion that throws would otherwise leave the clock frozen for every
  // later test in the file.
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadUserTimezone).mockResolvedValue('UTC');
    repo.getMuscleFatigueInputs.mockResolvedValue([]);
  });

  it("reads a windowDays-wide history ending at the user's today", async () => {
    // 2026-08-23T04:00Z is still 2026-08-22 in Los Angeles. Resolving the day
    // in the server's zone instead would age every entry by a day, which at a
    // 2-day half-life is a ~30% error in the score.
    vi.mocked(loadUserTimezone).mockResolvedValue('America/Los_Angeles');
    vi.setSystemTime(new Date('2026-08-23T04:00:00.000Z'));

    const result =
      await workoutRecommendationService.getMuscleRecovery('user-1');

    expect(result.date).toBe('2026-08-22');
    expect(repo.getMuscleFatigueInputs).toHaveBeenCalledWith(
      'user-1',
      '2026-08-08' // 2026-08-22 minus windowDays (14)
    );
  });

  it('returns every canonical muscle, freshest first, with a total order', async () => {
    vi.setSystemTime(new Date('2026-08-23T12:00:00.000Z'));
    repo.getMuscleFatigueInputs.mockResolvedValue([
      {
        entryDate: '2026-08-23',
        primaryMuscles: ['chest'],
        secondaryMuscles: ['triceps'],
        workingSetCount: 10,
      },
      {
        entryDate: '2026-08-21',
        primaryMuscles: ['quadriceps'],
        secondaryMuscles: [],
        workingSetCount: 6,
      },
    ]);

    const result =
      await workoutRecommendationService.getMuscleRecovery('user-1');

    expect(result.muscles).toHaveLength(MUSCLES.length);
    const freshness = result.muscles.map((m) => m.freshness);
    expect([...freshness].sort((a, b) => b - a)).toEqual(freshness);

    // chest took 10 primary sets today: fully fatigued and therefore last.
    expect(result.muscles[result.muscles.length - 1]).toEqual({
      muscle: 'chest',
      freshness: 0,
      fatigue_sets: 10,
      last_trained: '2026-08-23',
    });
    // quadriceps: 6 sets one half-life ago -> 3 decayed sets of 10.
    const quads = result.muscles.find((m) => m.muscle === 'quadriceps');
    expect(quads).toEqual({
      muscle: 'quadriceps',
      freshness: 0.7,
      fatigue_sets: 3,
      last_trained: '2026-08-21',
    });

    // Every untrained muscle sits at the 1.0 plateau, so the tiebreak decides
    // their order; it must be alphabetical and not merely "some" order.
    const plateau = result.muscles
      .filter((m) => m.freshness === 1)
      .map((m) => m.muscle);
    expect(plateau).toEqual([...plateau].sort());
  });

  it('echoes the tunables the scores were computed with', async () => {
    const result =
      await workoutRecommendationService.getMuscleRecovery('user-1');

    expect(result.tunables).toEqual({
      window_days: RECOVERY_TUNABLES.windowDays,
      half_life_days: RECOVERY_TUNABLES.halfLifeDays,
      secondary_weight: RECOVERY_TUNABLES.secondaryWeight,
      full_fatigue_sets: RECOVERY_TUNABLES.fullFatigueSets,
    });
  });

  it('reports a user with no history as fully fresh everywhere', async () => {
    const result =
      await workoutRecommendationService.getMuscleRecovery('user-1');

    expect(result.muscles).toHaveLength(MUSCLES.length);
    expect(
      result.muscles.every(
        (m) =>
          m.freshness === 1 && m.fatigue_sets === 0 && m.last_trained === null
      )
    ).toBe(true);
  });

  it('produces identical output on repeated calls', async () => {
    vi.setSystemTime(new Date('2026-08-23T12:00:00.000Z'));
    repo.getMuscleFatigueInputs.mockResolvedValue([
      {
        entryDate: '2026-08-20',
        primaryMuscles: ['lats', 'middle back'],
        secondaryMuscles: ['biceps'],
        workingSetCount: 9,
      },
    ]);

    const first =
      await workoutRecommendationService.getMuscleRecovery('user-1');
    const second =
      await workoutRecommendationService.getMuscleRecovery('user-1');

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('GET /api/workout-recommendations/recovery', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadUserTimezone).mockResolvedValue('UTC');
    repo.getMuscleFatigueInputs.mockResolvedValue([]);
  });

  it('returns the recovery vector', async () => {
    vi.setSystemTime(new Date('2026-08-23T12:00:00.000Z'));
    repo.getMuscleFatigueInputs.mockResolvedValue([
      {
        entryDate: '2026-08-23',
        primaryMuscles: ['glutes'],
        secondaryMuscles: [],
        workingSetCount: 5,
      },
    ]);

    const res = await request(app).get('/api/workout-recommendations/recovery');

    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-08-23');
    expect(res.body.muscles).toHaveLength(MUSCLES.length);
    expect(
      res.body.muscles.find((m: { muscle: string }) => m.muscle === 'glutes')
    ).toEqual({
      muscle: 'glutes',
      freshness: 0.5,
      fatigue_sets: 5,
      last_trained: '2026-08-23',
    });
  });

  it('passes the acting user through to the read', async () => {
    await request(app).get('/api/workout-recommendations/recovery');

    expect(repo.getMuscleFatigueInputs).toHaveBeenCalledWith(
      'test-user-id',
      expect.any(String)
    );
  });

  it('forwards a read failure to the error handler rather than a partial body', async () => {
    repo.getMuscleFatigueInputs.mockRejectedValue(new Error('db down'));

    const res = await request(app).get('/api/workout-recommendations/recovery');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'db down' });
  });
});
