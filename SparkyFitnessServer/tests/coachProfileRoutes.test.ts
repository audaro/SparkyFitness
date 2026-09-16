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
  primary_goal: 'build_muscle',
  physique_target: 'muscular',
  priority_muscle_groups: ['push', 'pull'],
  enhancement: {
    status: 'trt',
    testosterone_mg_per_week: 120,
    ester: 'cypionate',
  },
  plan_completed_at: new Date('2026-09-15T10:00:00Z'),
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
      primary_goal: 'build_muscle',
      physique_target: 'muscular',
      priority_muscle_groups: ['push', 'pull'],
      enhancement: {
        status: 'trt',
        testosterone_mg_per_week: 120,
        ester: 'cypionate',
      },
      plan_completed_at: '2026-09-15T10:00:00.000Z',
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
      primary_goal: null,
      physique_target: null,
      priority_muscle_groups: null,
      enhancement: null,
      plan_completed_at: null,
    });
  });

  // The owner's own client needs this to pre-fill the questionnaire. It is the
  // chat model that must never see it, which the renderer tests cover.
  it('returns the enhancement answer to the owner', async () => {
    const res = await request(app).get('/coach-profile');
    expect(res.body.enhancement).toEqual({
      status: 'trt',
      testosterone_mg_per_week: 120,
      ester: 'cypionate',
    });
  });
});

describe('PATCH /coach-profile — training plan fields', () => {
  it('accepts the questionnaire answers', async () => {
    const res = await request(app)
      .patch('/coach-profile')
      .send({
        primary_goal: 'recomp',
        physique_target: 'athletic',
        priority_muscle_groups: ['legs'],
        enhancement: { status: 'natural' },
        plan_completed_at: '2026-09-15T10:00:00.000Z',
      });
    expect(res.status).toBe(200);
    expect(coachProfileRepository.upsertCoachProfile).toHaveBeenCalledWith(
      'owner-1',
      {
        primary_goal: 'recomp',
        physique_target: 'athletic',
        priority_muscle_groups: ['legs'],
        enhancement: { status: 'natural' },
        plan_completed_at: '2026-09-15T10:00:00.000Z',
      }
    );
  });

  // Null clears an answer back to "not answered". For the priority list that is
  // a different statement from `[]`, which means "I prioritise nothing".
  it('distinguishes clearing priorities from prioritising nothing', async () => {
    await request(app)
      .patch('/coach-profile')
      .send({ priority_muscle_groups: null });
    expect(coachProfileRepository.upsertCoachProfile).toHaveBeenCalledWith(
      'owner-1',
      { priority_muscle_groups: null }
    );
    await request(app)
      .patch('/coach-profile')
      .send({ priority_muscle_groups: [] });
    expect(coachProfileRepository.upsertCoachProfile).toHaveBeenLastCalledWith(
      'owner-1',
      { priority_muscle_groups: [] }
    );
  });

  it('rejects a goal outside the vocabulary', async () => {
    const res = await request(app)
      .patch('/coach-profile')
      .send({ primary_goal: 'bulking' });
    expect(res.status).toBe(400);
    expect(coachProfileRepository.upsertCoachProfile).not.toHaveBeenCalled();
  });

  // Past two, each priority stops taking meaningful share from the others and
  // the plan no longer differs from an even split.
  it('rejects more than two priority groups', async () => {
    const res = await request(app)
      .patch('/coach-profile')
      .send({ priority_muscle_groups: ['push', 'pull', 'legs'] });
    expect(res.status).toBe(400);
  });

  it('rejects a repeated priority group', async () => {
    const res = await request(app)
      .patch('/coach-profile')
      .send({ priority_muscle_groups: ['push', 'push'] });
    expect(res.status).toBe(400);
  });

  // Stating a dose alongside 'natural' is a client bug. Dropping half the
  // payload silently would leave the user reading an answer they never gave.
  it('rejects a dose stated alongside a natural status', async () => {
    const res = await request(app)
      .patch('/coach-profile')
      .send({
        enhancement: { status: 'natural', testosterone_mg_per_week: 200 },
      });
    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range dose', async () => {
    const res = await request(app)
      .patch('/coach-profile')
      .send({
        enhancement: { status: 'enhanced', testosterone_mg_per_week: 99999 },
      });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown key inside enhancement', async () => {
    const res = await request(app)
      .patch('/coach-profile')
      .send({ enhancement: { status: 'trt', compound: 'something else' } });
    expect(res.status).toBe(400);
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
