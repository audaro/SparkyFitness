import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'supertest'
import request from 'supertest';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import chatService from '../services/chatService.js';
import { resolveIsAdmin } from '../utils/adminCheck.js';
import chatRoutes from '../routes/chatRoutes.js';

vi.mock('../services/chatService.js', () => ({
  default: {
    processQuickLog: vi.fn(),
  },
}));
vi.mock('../models/globalSettingsRepository.js', () => ({
  default: {
    isUserAiConfigAllowed: vi.fn(),
  },
}));
vi.mock('../utils/adminCheck.js', () => ({
  resolveIsAdmin: vi.fn(async () => false),
}));
// Distinct active vs authenticated ids so the delegated-identity pass-through
// is actually asserted, not accidentally satisfied by a shared value.
vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.userId = 'active-user-1';
    req.authenticatedUserId = 'actor-user-2';
    next();
  },
}));
vi.mock('../config/logging.js', () => ({
  log: vi.fn(),
}));

const app = express();
app.use(express.json());
app.use('/api/chat', chatRoutes);
app.use(
  (
    err: Error & { status?: number },
    _req: Request,
    res: Response,
    _next: NextFunction
  ) => {
    res.status(err.status ?? 500).json({ error: err.message });
  }
);

describe('POST /api/chat/quick-log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveIsAdmin).mockResolvedValue(false);
  });

  it('returns the service result and passes the delegated identity pair through', async () => {
    vi.mocked(chatService.processQuickLog).mockResolvedValue({
      text: 'Logged 2 eggs for breakfast.',
      actions: [{ toolName: 'sparky_manage_food', summary: '✅ Logged Eggs.' }],
    });

    const res = await request(app)
      .post('/api/chat/quick-log')
      .send({ message: 'log 2 eggs for breakfast' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      text: 'Logged 2 eggs for breakfast.',
      actions: [{ toolName: 'sparky_manage_food', summary: '✅ Logged Eggs.' }],
    });
    expect(chatService.processQuickLog).toHaveBeenCalledWith(
      'log 2 eggs for breakfast',
      'active-user-1',
      'actor-user-2',
      false,
      undefined
    );
  });

  it('forwards an explicit service_config_id and the admin flag', async () => {
    vi.mocked(resolveIsAdmin).mockResolvedValue(true);
    vi.mocked(chatService.processQuickLog).mockResolvedValue({
      text: 'ok',
      actions: [],
    });
    const configId = '3f2f1a10-6a1b-4c58-9c37-0d9a35c2b111';

    const res = await request(app)
      .post('/api/chat/quick-log')
      .send({ message: 'log a coffee', service_config_id: configId });

    expect(res.statusCode).toBe(200);
    expect(chatService.processQuickLog).toHaveBeenCalledWith(
      'log a coffee',
      'active-user-1',
      'actor-user-2',
      true,
      configId
    );
  });

  it('rejects a missing message with 400 before touching the service', async () => {
    const res = await request(app).post('/api/chat/quick-log').send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Invalid request');
    expect(chatService.processQuickLog).not.toHaveBeenCalled();
  });

  it('rejects an over-long message with 400', async () => {
    const res = await request(app)
      .post('/api/chat/quick-log')
      .send({ message: 'x'.repeat(1001) });

    expect(res.statusCode).toBe(400);
    expect(chatService.processQuickLog).not.toHaveBeenCalled();
  });

  it('rejects a malformed service_config_id with 400', async () => {
    const res = await request(app)
      .post('/api/chat/quick-log')
      .send({ message: 'log an apple', service_config_id: 'not-a-uuid' });

    expect(res.statusCode).toBe(400);
    expect(chatService.processQuickLog).not.toHaveBeenCalled();
  });

  it('maps a missing AI service configuration to 404', async () => {
    vi.mocked(chatService.processQuickLog).mockRejectedValue(
      new Error('AI service setting not found for quick-log.')
    );

    const res = await request(app)
      .post('/api/chat/quick-log')
      .send({ message: 'log an apple' });

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('AI service setting not found for quick-log.');
  });

  it('lets unexpected failures fall through to the error handler as 500', async () => {
    vi.mocked(chatService.processQuickLog).mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .post('/api/chat/quick-log')
      .send({ message: 'log an apple' });

    expect(res.statusCode).toBe(500);
  });
});
