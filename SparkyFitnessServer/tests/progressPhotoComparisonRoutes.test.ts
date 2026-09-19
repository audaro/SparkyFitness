import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'supertest'
import request from 'supertest';
import express from 'express';
import progressPhotoComparisonRoutes from '../routes/progressPhotoComparisonRoutes.js';
import comparisonService, {
  ComparisonRequestError,
} from '../services/progressPhotoComparisonService.js';
import {
  visionHealth,
  VisionServiceError,
} from '../integrations/vision/visionService.js';
import errorHandler from '../middleware/errorHandler.js';

vi.mock('../services/progressPhotoComparisonService.js', async () => {
  const actual = await import('../services/progressPhotoComparisonService.js');
  return {
    ...actual,
    default: {
      createComparison: vi.fn(),
      findComparison: vi.fn(),
      getComparisonById: vi.fn(),
      listComparisons: vi.fn(),
    },
  };
});
vi.mock('../integrations/vision/visionService.js', async () => {
  const actual = await import('../integrations/vision/visionService.js');
  return { ...actual, visionHealth: vi.fn() };
});
vi.mock('../middleware/authMiddleware', () => ({
  authenticate: vi.fn((req: any, _res: any, next: any) => {
    req.userId = 'test-user-id';
    next();
  }),
}));
vi.mock('../middleware/checkPermissionMiddleware', () => ({
  default: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

const app = express();
app.use(express.json());
app.use('/', progressPhotoComparisonRoutes);
app.use(errorHandler);

const BEFORE_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const AFTER_ID = 'b2c3d4e5-f6a7-4901-bcde-f12345678901';

const comparison = {
  id: 'c3d4e5f6-a7b8-4012-8def-123456789012',
  before_photo_id: BEFORE_ID,
  after_photo_id: AFTER_ID,
  days_between: 56,
  verdict: 'comparable',
  reasons: [],
  deterministic: null,
  created_at: '2026-09-18T10:00:00.000Z',
};

describe('progressPhotoComparisonRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports the vision service as unavailable rather than hiding it', async () => {
    // A client that cannot tell "not installed" from "broken" either offers a
    // button that always fails or hides a feature that works.
    vi.mocked(visionHealth).mockResolvedValue({
      configured: true,
      ok: false,
      engine: null,
    });

    const res = await request(app).get('/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: true, ok: false, engine: null });
  });

  it('creates a comparison', async () => {
    vi.mocked(comparisonService.createComparison).mockResolvedValue(
      comparison as never
    );

    const res = await request(app)
      .post('/')
      .send({ before_photo_id: BEFORE_ID, after_photo_id: AFTER_ID });

    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('comparable');
    expect(comparisonService.createComparison).toHaveBeenCalledWith(
      'test-user-id',
      BEFORE_ID,
      AFTER_ID,
      false
    );
  });

  it('rejects a body that is not two photo ids', async () => {
    const res = await request(app)
      .post('/')
      .send({ before_photo_id: 'not-a-uuid', after_photo_id: AFTER_ID });

    expect(res.status).toBe(400);
    expect(comparisonService.createComparison).not.toHaveBeenCalled();
  });

  it('returns 422 when the photo is the problem', async () => {
    // The user can act on this one: retake the photo with their whole body in
    // frame.
    vi.mocked(comparisonService.createComparison).mockRejectedValue(
      new VisionServiceError('landmark_not_visible:ankles', true, 'no ankles')
    );

    const res = await request(app)
      .post('/')
      .send({ before_photo_id: BEFORE_ID, after_photo_id: AFTER_ID });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('landmark_not_visible:ankles');
  });

  it('returns 503 when the service is the problem', async () => {
    // And not 422: telling someone their photo is unusable because a container
    // is down would send them off to retake a perfectly good picture.
    vi.mocked(comparisonService.createComparison).mockRejectedValue(
      new VisionServiceError('ECONNREFUSED', false, 'refused')
    );

    const res = await request(app)
      .post('/')
      .send({ before_photo_id: BEFORE_ID, after_photo_id: AFTER_ID });

    expect(res.status).toBe(503);
  });

  it('passes a request-level refusal through with its own status', async () => {
    vi.mocked(comparisonService.createComparison).mockRejectedValue(
      new ComparisonRequestError(400, 'Photos must be the same angle')
    );

    const res = await request(app)
      .post('/')
      .send({ before_photo_id: BEFORE_ID, after_photo_id: AFTER_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Photos must be the same angle');
  });

  it('404s a comparison the caller cannot see', async () => {
    // RLS makes another user's row invisible rather than forbidden, and the
    // route must not distinguish the two.
    vi.mocked(comparisonService.getComparisonById).mockResolvedValue(null);

    const res = await request(app).get(`/${comparison.id}`);

    expect(res.status).toBe(404);
  });

  it('lists comparisons with a bounded limit', async () => {
    vi.mocked(comparisonService.listComparisons).mockResolvedValue([
      comparison,
    ] as never);

    const ok = await request(app).get('/?limit=10');
    expect(ok.status).toBe(200);
    expect(comparisonService.listComparisons).toHaveBeenCalledWith(
      'test-user-id',
      10
    );

    const tooMany = await request(app).get('/?limit=5000');
    expect(tooMany.status).toBe(400);
  });
});
