import express from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware.js';
import checkPermissionMiddleware from '../middleware/checkPermissionMiddleware.js';
import { log } from '../config/logging.js';
import { createComparisonRequestSchema } from '@workspace/shared';
import comparisonService, {
  ComparisonRequestError,
} from '../services/progressPhotoComparisonService.js';
import {
  visionHealth,
  VisionServiceError,
} from '../integrations/vision/visionService.js';

const router = express.Router();

const IdParamSchema = z.object({ id: z.string().uuid() });

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const CreateBodySchema = createComparisonRequestSchema.extend({
  /** Re-measure a pair that is already cached; for a sidecar upgrade. */
  force: z.boolean().optional(),
});

/**
 * Turn any failure into the right status.
 *
 * The distinction that matters is whose fault it is: a photo the model could
 * not read is a 422 the user can act on, an unreachable sidecar is a 503 they
 * cannot, and confusing the two would send someone off to retake a perfectly
 * good photo because a container was down.
 */
const respondToError = (
  res: express.Response,
  err: unknown,
  context: string
): void => {
  if (err instanceof ComparisonRequestError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof VisionServiceError) {
    if (err.isPhotoProblem) {
      res.status(422).json({ error: err.message, reason: err.reason });
      return;
    }
    log('error', `[progressPhotoComparison] ${context}`, err);
    res.status(503).json({
      error: 'Photo comparison is temporarily unavailable',
      reason: err.reason,
    });
    return;
  }
  log('error', `[progressPhotoComparison] ${context}`, err);
  res.status(500).json({ error: 'Failed to compare progress photos' });
};

/**
 * @swagger
 * /progress-photo-comparisons/status:
 *   get:
 *     summary: Whether progress-photo comparison is available on this server
 *     description: >
 *       The vision sidecar is optional. This reports whether it is configured
 *       and reachable, and which engine it runs, so a client can hide the
 *       feature instead of offering a button that always fails.
 *     tags: [Wellness & Metrics]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Availability of the vision service.
 */
router.get('/status', authenticate, async (_req, res) => {
  res.json(await visionHealth());
});

/**
 * @swagger
 * /progress-photo-comparisons:
 *   get:
 *     summary: List the caller's stored photo comparisons, newest first
 *     tags: [Wellness & Metrics]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Array of comparisons.
 */
router.get(
  '/',
  authenticate,
  checkPermissionMiddleware('checkin'),
  async (req, res) => {
    const parsed = ListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message });
      return;
    }
    try {
      res.json(
        await comparisonService.listComparisons(req.userId, parsed.data.limit)
      );
    } catch (err) {
      respondToError(res, err, 'list');
    }
  }
);

/**
 * @swagger
 * /progress-photo-comparisons:
 *   post:
 *     summary: Compare two progress photos
 *     description: >
 *       Measures both photos through the vision sidecar and stores the result.
 *       Idempotent: the same pair returns the cached row unless `force` is set.
 *       The two photos must be the same angle and the before photo must be the
 *       earlier one. The response carries a comparability verdict, which is
 *       recomputed from the stored measurements on every read.
 *     tags: [Wellness & Metrics]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: The comparison.
 *       422:
 *         description: A photo the model could not measure.
 *       503:
 *         description: The vision service is not configured or not reachable.
 */
router.post(
  '/',
  authenticate,
  checkPermissionMiddleware('checkin'),
  async (req, res) => {
    const parsed = CreateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message });
      return;
    }
    try {
      res.json(
        await comparisonService.createComparison(
          req.userId,
          parsed.data.before_photo_id,
          parsed.data.after_photo_id,
          parsed.data.force ?? false
        )
      );
    } catch (err) {
      respondToError(res, err, 'create');
    }
  }
);

/**
 * @swagger
 * /progress-photo-comparisons/{id}:
 *   get:
 *     summary: Fetch one stored comparison
 *     tags: [Wellness & Metrics]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: The comparison.
 *       404:
 *         description: No such comparison, or it is not visible to the caller.
 */
router.get(
  '/:id',
  authenticate,
  checkPermissionMiddleware('checkin'),
  async (req, res) => {
    const parsed = IdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message });
      return;
    }
    try {
      const comparison = await comparisonService.getComparisonById(
        req.userId,
        parsed.data.id
      );
      if (!comparison) {
        res.status(404).json({ error: 'Comparison not found' });
        return;
      }
      res.json(comparison);
    } catch (err) {
      respondToError(res, err, 'get');
    }
  }
);

/**
 * @swagger
 * /progress-photo-comparisons/{id}/aligned:
 *   get:
 *     summary: Both photos of a comparison, warped into one frame
 *     description: >
 *       Returns the pair as base64 JPEG, ready for a before/after slider: the
 *       before photo as shot, and the after photo fitted onto it by the same
 *       similarity transform the comparison measured, with its exposure matched
 *       to the before photo's. Nothing is stored, so this costs a round trip to
 *       the vision sidecar each time it is asked for.
 *     tags: [Wellness & Metrics]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: The aligned pair.
 *       404:
 *         description: No such comparison, or it is not visible to the caller.
 *       422:
 *         description: The pair was never measurable, so there is nothing to align.
 *       503:
 *         description: The vision service is not configured or not reachable.
 */
router.get(
  '/:id/aligned',
  authenticate,
  checkPermissionMiddleware('checkin'),
  async (req, res) => {
    const parsed = IdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message });
      return;
    }
    try {
      res.json(
        await comparisonService.getAlignedPair(req.userId, parsed.data.id)
      );
    } catch (err) {
      respondToError(res, err, 'aligned');
    }
  }
);

export default router;
