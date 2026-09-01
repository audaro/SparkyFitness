import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error TS(7016): no types for supertest
import request from 'supertest';
import express from 'express';

// The Withings OAuth callback used to run unauthenticated and take the user id
// straight from the request body's `state`, letting anyone holding a Withings
// authorization code bind that account to an arbitrary user. These cover both
// halves of the fix: the route is authenticated, and the user id comes from the
// session while `state` is only the CSRF nonce.
const { authState } = vi.hoisted(() => ({
  authState: { signedIn: true },
}));

vi.mock('../middleware/authMiddleware.js', () => ({
  default: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authenticate: (req: any, res: any, next: any) => {
      if (!authState.signedIn) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      req.userId = 'session-user';
      next();
    },
  },
}));
vi.mock('../middleware/checkPermissionMiddleware.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../integrations/withings/withingsService.js', () => ({
  default: {
    exchangeCodeForTokens: vi
      .fn()
      .mockResolvedValue({ success: true, userId: 'withings-user-1' }),
  },
}));
vi.mock('../services/withingsService.js', () => ({ default: {} }));

import withingsRoutes from '../routes/withingsRoutes.js';
import withingsIntegrationService from '../integrations/withings/withingsService.js';

const app = express();
app.use(express.json());
app.use('/withings', withingsRoutes);

beforeEach(() => {
  vi.clearAllMocks();
  authState.signedIn = true;
  vi.mocked(withingsIntegrationService.exchangeCodeForTokens).mockResolvedValue(
    { success: true, userId: 'withings-user-1' }
  );
});

describe('POST /withings/callback', () => {
  it('returns 401 when the request is not authenticated', async () => {
    authState.signedIn = false;

    const res = await request(app)
      .post('/withings/callback')
      .send({ code: 'auth-code', state: 'victim-user-uuid' });

    expect(res.statusCode).toBe(401);
    expect(
      withingsIntegrationService.exchangeCodeForTokens
    ).not.toHaveBeenCalled();
  });

  it('binds the tokens to the signed-in user, not to the posted state', async () => {
    const res = await request(app)
      .post('/withings/callback')
      .send({ code: 'auth-code', state: 'issued-nonce' });

    expect(res.statusCode).toBe(200);
    expect(
      withingsIntegrationService.exchangeCodeForTokens
    ).toHaveBeenCalledWith(
      'session-user',
      'auth-code',
      'issued-nonce',
      expect.stringContaining('/withings/callback')
    );
  });

  it('rejects a callback with no state', async () => {
    const res = await request(app)
      .post('/withings/callback')
      .send({ code: 'auth-code' });

    expect(res.statusCode).toBe(400);
    expect(
      withingsIntegrationService.exchangeCodeForTokens
    ).not.toHaveBeenCalled();
  });

  it('rejects a callback with no code', async () => {
    const res = await request(app)
      .post('/withings/callback')
      .send({ state: 'issued-nonce' });

    expect(res.statusCode).toBe(400);
    expect(
      withingsIntegrationService.exchangeCodeForTokens
    ).not.toHaveBeenCalled();
  });

  it('surfaces a provider-reported OAuth error without exchanging anything', async () => {
    const res = await request(app)
      .post('/withings/callback')
      .send({ error: 'access_denied' });

    expect(res.statusCode).toBe(400);
    expect(
      withingsIntegrationService.exchangeCodeForTokens
    ).not.toHaveBeenCalled();
  });
});
