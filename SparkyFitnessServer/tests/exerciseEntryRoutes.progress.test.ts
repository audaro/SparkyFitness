import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'supertest'
import request from 'supertest';
import express from 'express';
import multer from 'multer';
import exerciseEntryRoutes from '../routes/exerciseEntryRoutes.js';
import exerciseService from '../services/exerciseService.js';

vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: vi.fn((req: any, _res: any, next: any) => {
    req.userId = 'user-123';
    req.originalUserId = 'actor-123';
    next();
  }),
}));
vi.mock('../middleware/checkPermissionMiddleware.js', () => ({
  default: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));
vi.mock('../middleware/uploadMiddleware.js', () => ({
  createUploadMiddleware: vi.fn(() =>
    multer({ storage: multer.memoryStorage() })
  ),
}));
vi.mock('../services/exerciseService.js', () => ({
  default: { getExerciseProgressData: vi.fn() },
}));
vi.mock('../services/exerciseEntryService.js', () => ({ default: {} }));
vi.mock('../services/fitImportService.js', () => ({ default: {} }));
vi.mock('../utils/permissionUtils.js', () => ({
  canAccessUserData: vi.fn(),
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const app = express();
app.use(express.json());
app.use('/exercise-entries', exerciseEntryRoutes);
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(500).json({ error: err.message });
});

const EXERCISE_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exerciseService.getExerciseProgressData).mockResolvedValue([]);
});

describe('GET /exercise-entries/progress/:exerciseId', () => {
  it('rejects the literal path segment "null" with 400, not a raw DB error', async () => {
    // A client deriving its exercise list from exercise_entries can carry a
    // null exercise_id for a library-deleted exercise whose diary snapshot
    // survives (ON DELETE SET NULL). If that null slips into a request URL,
    // Express stringifies it to the literal "null" here.
    const res = await request(app)
      .get('/exercise-entries/progress/null')
      .query({ startDate: '2026-08-01', endDate: '2026-08-31' })
      .expect(400);

    expect(res.body.error).toBe('Invalid exercise ID.');
    expect(exerciseService.getExerciseProgressData).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID exerciseId with 400', async () => {
    await request(app)
      .get('/exercise-entries/progress/not-a-uuid')
      .query({ startDate: '2026-08-01', endDate: '2026-08-31' })
      .expect(400);

    expect(exerciseService.getExerciseProgressData).not.toHaveBeenCalled();
  });

  it('passes a real UUID through to the service', async () => {
    await request(app)
      .get(`/exercise-entries/progress/${EXERCISE_ID}`)
      .query({ startDate: '2026-08-01', endDate: '2026-08-31' })
      .expect(200);

    expect(exerciseService.getExerciseProgressData).toHaveBeenCalledWith(
      'user-123',
      EXERCISE_ID,
      '2026-08-01',
      '2026-08-31'
    );
  });
});
