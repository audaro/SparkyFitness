import { vi, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
// @ts-expect-error TS(7016): no type declarations shipped for supertest
import request from 'supertest';
import coachProfileRepository from '../models/coachProfileRepository.js';
import coachProfileRoutes from '../routes/coachProfileRoutes.js';
import { invalidateChatContextInputs } from '../services/chatContextCache.js';

vi.mock('../models/coachProfileRepository.js', () => ({
  default: {
    getCoachProfile: vi.fn(),
    upsertCoachProfile: vi.fn(),
  },
}));
vi.mock('../utils/permissionUtils.js', () => ({
  canAccessUserData: vi.fn().mockResolvedValue(true),
}));
vi.mock('../services/chatContextCache.js', () => ({
  invalidateChatContextInputs: vi.fn(),
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

const row = {
  id: 'profile-1',
  user_id: 'owner-1',
  goals: 'Get stronger',
  training_days_per_week: 4,
  session_minutes: 60,
  experience_level: 'intermediate',
  equipment: ['barbell'],
  limitations: ['left shoulder'],
  food_preferences: {},
  aliases: {},
  weekly_set_targets: {},
  created_at: new Date('2026-08-24T00:00:00Z'),
  updated_at: new Date('2026-08-24T00:00:00Z'),
};

const app = express();
app.use(express.json());
app.use('/coach-profile', coachProfileRoutes);

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  context.userId = 'owner-1';
  context.authenticatedUserId = 'owner-1';
  mocked(coachProfileRepository.getCoachProfile).mockResolvedValue(row);
  mocked(coachProfileRepository.upsertCoachProfile).mockResolvedValue(row);
});

describe('GET /coach-profile', () => {
  it('returns the stated constraints', async () => {
    const res = await request(app).get('/coach-profile');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      goals: 'Get stronger',
      training_days_per_week: 4,
      session_minutes: 60,
      experience_level: 'intermediate',
      limitations: ['left shoulder'],
    });
  });

  // Equipment belongs to gym profiles and weekly set targets have their own
  // endpoint with partial-merge semantics; leaking them here would invite a
  // client to round-trip them through PATCH.
  it('does not expose the columns this contract leaves out', async () => {
    const res = await request(app).get('/coach-profile');
    expect(res.body).not.toHaveProperty('equipment');
    expect(res.body).not.toHaveProperty('weekly_set_targets');
    expect(res.body).not.toHaveProperty('aliases');
    expect(res.body).not.toHaveProperty('food_preferences');
  });

  // A user who never went through the AI chat has no row at all. That is the
  // same thing to every reader as a row with nothing stated, so it must not be
  // a 404 the client has to special-case.
  it('answers with an empty profile when no row exists', async () => {
    mocked(coachProfileRepository.getCoachProfile).mockResolvedValue(null);
    const res = await request(app).get('/coach-profile');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      goals: null,
      training_days_per_week: null,
      session_minutes: null,
      experience_level: null,
      limitations: [],
    });
  });
});

describe('PATCH /coach-profile', () => {
  it('forwards a partial patch', async () => {
    const res = await request(app)
      .patch('/coach-profile')
      .send({ session_minutes: 45 });
    expect(res.status).toBe(200);
    expect(coachProfileRepository.upsertCoachProfile).toHaveBeenCalledWith(
      'owner-1',
      { session_minutes: 45 }
    );
  });

  // Null clears a stated value back to unstated, which is a real edit and not
  // the same as omitting the field — a null training_days_per_week is what
  // makes weekly set targets report themselves as derived.
  it('passes null through to clear a stated value', async () => {
    const res = await request(app)
      .patch('/coach-profile')
      .send({ training_days_per_week: null });
    expect(res.status).toBe(200);
    expect(coachProfileRepository.upsertCoachProfile).toHaveBeenCalledWith(
      'owner-1',
      { training_days_per_week: null }
    );
  });

  // The coaching system prompt embeds a summary built from these columns,
  // cached per user for 60 seconds. Without the drop the coach would keep
  // planning around the old session length for up to a minute after the edit.
  it('drops the cached chat context so the coach sees the edit', async () => {
    await request(app).patch('/coach-profile').send({ session_minutes: 45 });
    expect(invalidateChatContextInputs).toHaveBeenCalledWith('owner-1');
  });

  it('leaves the cached chat context alone when the patch is rejected', async () => {
    await request(app).patch('/coach-profile').send({ session_minutes: 1 });
    expect(invalidateChatContextInputs).not.toHaveBeenCalled();
  });

  // The vocabulary is exercises.level's, and the enum is what keeps a mismatch
  // at the write side: the generator compares the stored value to candidate
  // levels with an exact string match, so "advanced" or "Beginner" would not be
  // a synonym — it would silently match nothing.
  it('accepts each experience level token, and null to clear', async () => {
    for (const value of ['beginner', 'intermediate', 'expert', null]) {
      mocked(coachProfileRepository.upsertCoachProfile).mockClear();
      const res = await request(app)
        .patch('/coach-profile')
        .send({ experience_level: value });
      expect(res.status).toBe(200);
      expect(coachProfileRepository.upsertCoachProfile).toHaveBeenCalledWith(
        'owner-1',
        { experience_level: value }
      );
    }
  });

  it('rejects an experience level outside the vocabulary', async () => {
    for (const value of ['advanced', 'Beginner', 'novice', 3]) {
      const res = await request(app)
        .patch('/coach-profile')
        .send({ experience_level: value });
      expect(res.status).toBe(400);
    }
    expect(coachProfileRepository.upsertCoachProfile).not.toHaveBeenCalled();
  });

  it('rejects a training week longer than a week', async () => {
    const res = await request(app)
      .patch('/coach-profile')
      .send({ training_days_per_week: 9 });
    expect(res.status).toBe(400);
    expect(coachProfileRepository.upsertCoachProfile).not.toHaveBeenCalled();
  });

  it('rejects a session length outside the guard', async () => {
    const res = await request(app)
      .patch('/coach-profile')
      .send({ session_minutes: 1 });
    expect(res.status).toBe(400);
    expect(coachProfileRepository.upsertCoachProfile).not.toHaveBeenCalled();
  });

  // The schema is strict, so a column this contract does not expose cannot be
  // smuggled into the patch by spreading a wider object into the payload.
  it('rejects a column outside the contract', async () => {
    const res = await request(app)
      .patch('/coach-profile')
      .send({ weekly_set_targets: { legs: 20 } });
    expect(res.status).toBe(400);
    expect(coachProfileRepository.upsertCoachProfile).not.toHaveBeenCalled();
  });

  // An empty patch is a client that dropped its payload, not a no-op the
  // server should absorb by touching updated_at.
  it('rejects an empty patch', async () => {
    const res = await request(app).patch('/coach-profile').send({});
    expect(res.status).toBe(400);
    expect(coachProfileRepository.upsertCoachProfile).not.toHaveBeenCalled();
  });
});

// coach_profiles is owner-only at the RLS layer: its policy matches user_id
// against the authenticated caller, not the switched context. Without this
// guard a delegate would read an empty profile as though the owner had stated
// nothing, and a delegated write would fail inside Postgres as a 500.
describe('delegated access', () => {
  beforeEach(() => {
    context.userId = 'owner-1';
    context.authenticatedUserId = 'delegate-2';
  });

  it('refuses to read another user profile', async () => {
    const res = await request(app).get('/coach-profile');
    expect(res.status).toBe(403);
    expect(coachProfileRepository.getCoachProfile).not.toHaveBeenCalled();
  });

  it('refuses to write another user profile', async () => {
    const res = await request(app)
      .patch('/coach-profile')
      .send({ session_minutes: 45 });
    expect(res.status).toBe(403);
    expect(coachProfileRepository.upsertCoachProfile).not.toHaveBeenCalled();
  });
});
