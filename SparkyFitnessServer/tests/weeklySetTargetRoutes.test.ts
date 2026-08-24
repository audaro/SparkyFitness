import { vi, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
// @ts-expect-error TS(7016): no type declarations shipped for supertest
import request from 'supertest';
import weeklySetTargetService from '../services/weeklySetTargetService.js';
import weeklySetTargetRoutes from '../routes/weeklySetTargetRoutes.js';

vi.mock('../services/weeklySetTargetService.js', () => ({
  default: {
    getWeeklySetTargets: vi.fn(),
    updateWeeklySetTargets: vi.fn(),
    MAX_HISTORY_WEEKS: 12,
  },
  MAX_HISTORY_WEEKS: 12,
}));
vi.mock('../utils/permissionUtils.js', () => ({
  canAccessUserData: vi.fn().mockResolvedValue(true),
}));

// The active context is switchable per request so the owner-only guard can be
// exercised: `userId` is who the request acts on, `authenticatedUserId` is who
// is really calling.
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

const payload = {
  current: {
    week_start: '2026-08-23',
    week_end: '2026-08-29',
    groups: [
      { group: 'push', completed: 0, target: 12, remaining: 12, percent: 0 },
      { group: 'pull', completed: 0, target: 12, remaining: 12, percent: 0 },
      { group: 'legs', completed: 0, target: 12, remaining: 12, percent: 0 },
      { group: 'core', completed: 0, target: 5, remaining: 5, percent: 0 },
    ],
    overall_percent: 0,
  },
  history: [],
  targets_are_custom: false,
};

const app = express();
app.use(express.json());
app.use('/weekly-set-targets', weeklySetTargetRoutes);

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  context.userId = 'owner-1';
  context.authenticatedUserId = 'owner-1';
  mocked(weeklySetTargetService.getWeeklySetTargets).mockResolvedValue(payload);
  mocked(weeklySetTargetService.updateWeeklySetTargets).mockResolvedValue(
    payload
  );
});

describe('GET /weekly-set-targets', () => {
  it('returns the summary for the owner', async () => {
    const res = await request(app).get('/weekly-set-targets');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
    expect(weeklySetTargetService.getWeeklySetTargets).toHaveBeenCalledWith(
      'owner-1',
      0
    );
  });

  it('passes the requested history depth through', async () => {
    const res = await request(app).get('/weekly-set-targets?history_weeks=8');
    expect(res.status).toBe(200);
    expect(weeklySetTargetService.getWeeklySetTargets).toHaveBeenCalledWith(
      'owner-1',
      8
    );
  });

  it('rejects a history depth beyond the server ceiling', async () => {
    const res = await request(app).get('/weekly-set-targets?history_weeks=99');
    expect(res.status).toBe(400);
    expect(weeklySetTargetService.getWeeklySetTargets).not.toHaveBeenCalled();
  });
});

// coach_profiles is owner-only at the RLS layer: its policy matches user_id
// against the authenticated caller, not the switched context. Without this
// guard a delegate would read derived defaults as though the owner had set
// nothing, and a delegated write would fail inside Postgres as a 500.
describe('delegated access', () => {
  beforeEach(() => {
    context.userId = 'owner-1';
    context.authenticatedUserId = 'delegate-2';
  });

  it('refuses to read another user targets', async () => {
    const res = await request(app).get('/weekly-set-targets');
    expect(res.status).toBe(403);
    expect(weeklySetTargetService.getWeeklySetTargets).not.toHaveBeenCalled();
  });

  it('refuses to write another user targets', async () => {
    const res = await request(app)
      .put('/weekly-set-targets')
      .send({ targets: { legs: 20 } });
    expect(res.status).toBe(403);
    expect(
      weeklySetTargetService.updateWeeklySetTargets
    ).not.toHaveBeenCalled();
  });
});

describe('PUT /weekly-set-targets', () => {
  it('forwards a partial target map', async () => {
    const res = await request(app)
      .put('/weekly-set-targets')
      .send({ targets: { legs: 20 } });
    expect(res.status).toBe(200);
    expect(weeklySetTargetService.updateWeeklySetTargets).toHaveBeenCalledWith(
      'owner-1',
      { legs: 20 },
      0
    );
  });

  it('rejects an unknown training group', async () => {
    const res = await request(app)
      .put('/weekly-set-targets')
      .send({ targets: { shoulders: 12 } });
    expect(res.status).toBe(400);
    expect(
      weeklySetTargetService.updateWeeklySetTargets
    ).not.toHaveBeenCalled();
  });

  it('rejects a negative target', async () => {
    const res = await request(app)
      .put('/weekly-set-targets')
      .send({ targets: { push: -1 } });
    expect(res.status).toBe(400);
    expect(
      weeklySetTargetService.updateWeeklySetTargets
    ).not.toHaveBeenCalled();
  });
});
