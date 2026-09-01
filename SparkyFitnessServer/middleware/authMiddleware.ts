import { log } from '../config/logging.js';
import userRepository from '../models/userRepository.js';
import { auth } from '../auth.js';
import { canAccessUserData } from '../utils/permissionUtils.js';
import { resolveIsAdmin } from '../utils/adminCheck.js';
import { dbContextStorage } from '../db/poolManager.js';
import {
  getCachedSession,
  setCachedSession,
} from '../utils/apiKeySessionCache.js';
import { bridgeBearerAuthHeader } from '../utils/bearerAuthBridge.js';
import type { NextFunction, Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import type { RouteParams } from '../types/expressHandlers.js';
const authenticate = async (
  req: Request<RouteParams>,
  res: Response,
  next: NextFunction
) => {
  //log("debug", `authenticate middleware: req.path = ${req.path}, req.headers.cookie = ${req.headers.cookie}`);
  // 1. Better Auth Session & API Key Check (Unified Identity)
  // Tracks the raw API key when this request is API-key-authed, so we can
  // short-circuit Better Auth's per-request verify (which ticks the per-key
  // rate-limit bucket — see issue #1302).
  try {
    // Route Bearer tokens to the correct auth mechanism (shared with the early
    // /api/auth interceptor in SparkyFitnessServer.ts):
    // - API keys (64+ alphanumeric chars, no dots) → x-api-key header
    // - Session tokens (shorter, or contain dots) → signed session cookie
    let apiKeyToken: string | null = (await bridgeBearerAuthHeader(req))
      .apiKeyToken;
    // Pre-existing x-api-key header (i.e. not from the Bearer mapping above)
    // is also subject to the same per-key rate-limit ticking. Treat it the
    // same as a mapped Bearer for cache purposes.
    if (!apiKeyToken && typeof req.headers['x-api-key'] === 'string') {
      apiKeyToken = req.headers['x-api-key'];
    }
    // Short-circuit Better Auth's per-request verify when we have a cached
    // session for this API key. Better Auth's api-key plugin treats every
    // getSession() call as a verification tick and increments
    // api_key.request_count, which trivially exhausts the default
    // 100-req/60s bucket under normal mobile/SPA traffic (issue #1302).
    // Session cookie auth is unaffected and never cached here.
    let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
    if (apiKeyToken) {
      session = getCachedSession(apiKeyToken) as typeof session;
    }
    if (!session) {
      session = await auth.api.getSession({
        // Node's IncomingHttpHeaders is not a fetch Headers; better-auth ships
        // the adapter, and the other getSession call sites already use it.
        headers: fromNodeHeaders(req.headers),
      });
      if (session && session.user && apiKeyToken) {
        setCachedSession(apiKeyToken, session);
      }
    }
    if (session && session.user) {
      req.authenticatedUserId = session.user.id;
      req.originalUserId = req.authenticatedUserId;
      req.user = session.user; // Full user object (includes role)

      // Asynchronously update last login if it hasn't been updated in the last hour
      // better-auth's user type does not declare the last-login column this
      // deployment adds, so it is read and written through a widened view of
      // the same object rather than a cast at each access.
      const sessionUser = session.user as Record<string, unknown>;
      const lastLogin = sessionUser.lastLoginAt || sessionUser.last_login_at;
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      if (!lastLogin || new Date(String(lastLogin)) < oneHourAgo) {
        const nowStr = new Date().toISOString();
        sessionUser.lastLoginAt = nowStr;
        sessionUser.last_login_at = nowStr;
        userRepository.updateUserLastLogin(session.user.id).catch((err) => {
          log('error', 'Failed to update user last login in middleware:', err);
        });
      }
      // Handle 'sparky_active_user_id' cookie for context switching
      const activeUserId = req.cookies.sparky_active_user_id;
      if (activeUserId && activeUserId !== req.authenticatedUserId) {
        // Must stay in sync with authService.switchUserContext: any permission
        // that lets a delegate switch context must also be honored here, or the
        // cookie is set on switch but silently reverted on every later request.
        const [hasReports, hasDiary, hasCheckin, hasMedications] =
          await Promise.all([
            canAccessUserData(activeUserId, 'reports', req.authenticatedUserId),
            canAccessUserData(activeUserId, 'diary', req.authenticatedUserId),
            canAccessUserData(activeUserId, 'checkin', req.authenticatedUserId),
            canAccessUserData(
              activeUserId,
              'medications',
              req.authenticatedUserId
            ),
          ]);
        if (hasReports || hasDiary || hasCheckin || hasMedications) {
          req.activeUserId = activeUserId;
          log(
            'info',
            `Authentication: Context switched. User ${req.authenticatedUserId} acting as ${req.activeUserId}`
          );
        } else {
          log(
            'warn',
            `Authentication: Context access denied for User ${req.authenticatedUserId} -> ${activeUserId}`
          );
          req.activeUserId = req.authenticatedUserId;
        }
      } else {
        req.activeUserId = req.authenticatedUserId;
      }
      req.userId = req.activeUserId; // RLS context
      // Ensure user initialization
      try {
        await userRepository.ensureUserInitialization(
          session.user.id,
          session.user.name
        );
      } catch (err) {
        log(
          'error',
          `Lazy Initialization failed for user ${session.user.id}:`,
          err
        );
      }
      return dbContextStorage.run(
        { authenticatedUserId: req.originalUserId || req.authenticatedUserId },
        next
      );
    }
  } catch (error) {
    log('error', 'Error checking Better Auth identity:', error);
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    const code = error?.body?.code;
    if (code === 'RATE_LIMITED') {
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      const retryAfterMs = error.body?.details?.tryAgainIn;
      if (retryAfterMs) {
        res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      }
      return res.status(429).json({ error: 'Rate limit exceeded.' });
    }
    if (code === 'KEY_DISABLED') {
      return res.status(403).json({ error: 'API key is disabled.' });
    }
    if (code === 'KEY_EXPIRED') {
      return res.status(401).json({ error: 'API key has expired.' });
    }
    if (code === 'USAGE_EXCEEDED') {
      return res.status(429).json({ error: 'API key usage limit exceeded.' });
    }
  }
  // No valid authentication found
  log('warn', `Authentication: No valid identity provided for ${req.path}`);
  return res.status(401).json({ error: 'Authentication required.' });
};
const isAdmin = async (
  req: Request<RouteParams>,
  res: Response,
  next: NextFunction
) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  // Admin predicate lives in utils/adminCheck.ts (checks the AUTHENTICATED user,
  // never the context-switched one, to prevent privilege escalation).
  if (await resolveIsAdmin(req.user, req.authenticatedUserId)) {
    return next();
  }
  log('warn', `Admin Check: Access denied for User ${req.userId}`);
  return res.status(403).json({ error: 'Admin access required.' });
};
export { authenticate };
export { isAdmin };
export default {
  authenticate,
  isAdmin,
};
