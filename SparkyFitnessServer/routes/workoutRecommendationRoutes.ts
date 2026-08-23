import express, { RequestHandler } from 'express';
import { muscleRecoveryResponseSchema } from '@workspace/shared';
import { authenticate } from '../middleware/authMiddleware.js';
import checkPermissionMiddleware from '../middleware/checkPermissionMiddleware.js';
import workoutRecommendationService from '../services/workoutRecommendationService.js';

const router = express.Router();

router.use(authenticate);
// Recovery is derived entirely from logged exercise entries, so it rides the
// same permission as the diary those entries live in.
router.use(checkPermissionMiddleware('diary'));

/**
 * @swagger
 * /workout-recommendations/recovery:
 *   get:
 *     summary: Per-muscle recovery, freshest first
 *     tags: [Exercise & Workouts]
 *     description: |
 *       Freshness per muscle on a 0 (fully fatigued) to 1 (fully fresh) scale, derived from the
 *       working sets logged over the recent history window with an exponential decay — nothing is
 *       logged or configured for this. Every canonical muscle is present; one never trained in the
 *       window scores 1 with a null `last_trained`. `tunables` echoes the constants the scores were
 *       computed with, so clients need not hard-code a copy.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: The user's muscle recovery vector for today, in their timezone.
 *       401:
 *         description: Unauthenticated.
 *       403:
 *         description: Forbidden (no diary permission when acting on behalf of another user).
 */
const recoveryHandler: RequestHandler = async (req, res, next) => {
  try {
    const recovery = await workoutRecommendationService.getMuscleRecovery(
      req.userId
    );
    res.status(200).json(muscleRecoveryResponseSchema.parse(recovery));
  } catch (error: unknown) {
    next(error);
  }
};

router.get('/recovery', recoveryHandler);

export default router;
