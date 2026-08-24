import express, { RequestHandler } from 'express';
import { z } from 'zod';
import {
  updateWeeklySetTargetsRequestSchema,
  weeklySetTargetsResponseSchema,
} from '@workspace/shared';
import { authenticate } from '../middleware/authMiddleware.js';
import checkPermissionMiddleware from '../middleware/checkPermissionMiddleware.js';
import weeklySetTargetService, {
  MAX_HISTORY_WEEKS,
} from '../services/weeklySetTargetService.js';

const router = express.Router();

router.use(authenticate);
// Weekly set targets read logged training and set training intent, so they ride
// the diary permission like the rest of the exercise domain.
router.use(checkPermissionMiddleware('diary'));

/**
 * Targets live in `coach_profiles`, whose RLS policy is owner-only: it matches
 * `user_id` against `authenticated_user_id()`, the real caller, not the
 * switched context. So a delegate with diary access on someone else's account
 * cannot see or write that row no matter what the permission check says — a
 * delegated GET would silently report derived defaults as though the owner had
 * never set a target, and a delegated PUT would fail deep in the database and
 * surface as a 500.
 *
 * Rather than lie on read and explode on write, say so: this endpoint is
 * owner-only until targets move to storage that is deliberately delegatable.
 */
const requireSelf: RequestHandler = (req, res, next) => {
  const authUserId = req.originalUserId ?? req.authenticatedUserId;
  if (!authUserId || authUserId !== req.userId) {
    res.status(403).json({
      error: 'Weekly set targets can only be read or changed by their owner.',
    });
    return;
  }
  next();
};

router.use(requireSelf);

const historyQuerySchema = z.object({
  history_weeks: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_HISTORY_WEEKS)
    .optional(),
});

/**
 * @swagger
 * /weekly-set-targets:
 *   get:
 *     summary: Weekly working-set progress per training group
 *     tags: [Exercise & Workouts]
 *     description: |
 *       Working sets performed this week per training group (push/pull/legs/core), against the
 *       user's targets. A muscle trained as a secondary mover counts as half a set, and an entry
 *       credits each group once at its strongest claim, so a compound lift is not double counted.
 *       Warm-up sets are excluded. Weeks run Sunday to Saturday in the user's timezone.
 *
 *       When the user has not set targets, they are derived from `training_days_per_week` and
 *       `targets_are_custom` is false.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: history_weeks
 *         schema:
 *           type: integer
 *           minimum: 0
 *           maximum: 12
 *         description: Earlier weeks to include, oldest first. Defaults to 0.
 *     responses:
 *       200:
 *         description: This week's progress, plus any requested history.
 *       400:
 *         description: Invalid query parameters.
 *       401:
 *         description: Unauthenticated.
 *       403:
 *         description: Forbidden (not the owner, or no diary permission for the active context).
 */
const getHandler: RequestHandler = async (req, res, next) => {
  try {
    const queryResult = historyQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({
        error: 'Invalid query parameters',
        details: queryResult.error.flatten().fieldErrors,
      });
      return;
    }
    const result = await weeklySetTargetService.getWeeklySetTargets(
      req.userId,
      queryResult.data.history_weeks ?? 0
    );
    res.status(200).json(weeklySetTargetsResponseSchema.parse(result));
  } catch (error: unknown) {
    next(error);
  }
};

/**
 * @swagger
 * /weekly-set-targets:
 *   put:
 *     summary: Set weekly working-set targets
 *     tags: [Exercise & Workouts]
 *     description: |
 *       Accepts a partial map keyed by training group, so sending `{"targets":{"legs":20}}` changes
 *       legs and leaves the rest untouched. A target of 0 means the group is not being trained this
 *       block and is treated as met rather than as an unreachable goal. Returns the recomputed
 *       screen, so the client never has to guess what the server made of the edit.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: history_weeks
 *         schema:
 *           type: integer
 *           minimum: 0
 *           maximum: 12
 *         description: Earlier weeks to include in the returned payload. Defaults to 0.
 *     responses:
 *       200:
 *         description: Targets saved; the recomputed progress is returned.
 *       400:
 *         description: Invalid request body or query parameters.
 *       401:
 *         description: Unauthenticated.
 *       403:
 *         description: Forbidden (not the owner, or no diary permission for the active context).
 */
const updateHandler: RequestHandler = async (req, res, next) => {
  try {
    const queryResult = historyQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({
        error: 'Invalid query parameters',
        details: queryResult.error.flatten().fieldErrors,
      });
      return;
    }
    const bodyResult = updateWeeklySetTargetsRequestSchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: bodyResult.error.flatten().fieldErrors,
      });
      return;
    }
    const result = await weeklySetTargetService.updateWeeklySetTargets(
      req.userId,
      bodyResult.data.targets,
      queryResult.data.history_weeks ?? 0
    );
    res.status(200).json(weeklySetTargetsResponseSchema.parse(result));
  } catch (error: unknown) {
    next(error);
  }
};

router.get('/', getHandler);
router.put('/', updateHandler);

export default router;
