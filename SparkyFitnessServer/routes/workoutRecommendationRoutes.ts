import express, { RequestHandler } from 'express';
import { z } from 'zod';
import {
  alternativeExercisesResponseSchema,
  generateWorkoutRecommendationRequestSchema,
  muscleRecoveryResponseSchema,
  updateWorkoutRecommendationRequestSchema,
  workoutRecommendationResponseSchema,
} from '@workspace/shared';
import { authenticate } from '../middleware/authMiddleware.js';
import checkPermissionMiddleware from '../middleware/checkPermissionMiddleware.js';
import workoutRecommendationService, {
  WorkoutGenerationError,
} from '../services/workoutRecommendationService.js';

const router = express.Router();

const idParamsSchema = z.object({ id: z.string().uuid() });
const alternativesParamsSchema = z.object({ exerciseId: z.string().uuid() });
const alternativesQuerySchema = z.object({
  // `coerce` because query strings are strings; the default matches the
  // blueprint's `?limit=10`.
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

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

/**
 * @swagger
 * /workout-recommendations:
 *   get:
 *     summary: The user's current suggested workout
 *     tags: [Exercise & Workouts]
 *     description: |
 *       The stored "Up Next" workout. There is at most one per user; generating again replaces it.
 *       404 when the user has never generated one — that is the normal first-run state, not an error
 *       condition, and clients should offer generation rather than reporting a failure.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: The stored recommendation.
 *       404:
 *         description: No workout has been generated for this user yet.
 */
const getHandler: RequestHandler = async (req, res, next) => {
  try {
    const recommendation = await workoutRecommendationService.getRecommendation(
      req.userId
    );
    if (!recommendation) {
      res.status(404).json({ error: 'No workout recommendation yet.' });
      return;
    }
    res
      .status(200)
      .json(workoutRecommendationResponseSchema.parse(recommendation));
  } catch (error: unknown) {
    next(error);
  }
};

/**
 * @swagger
 * /workout-recommendations/generate:
 *   post:
 *     summary: Generate (or regenerate) the suggested workout
 *     tags: [Exercise & Workouts]
 *     description: |
 *       Builds a workout from the user's muscle recovery, their catalog, their active gym profile and
 *       their coach profile, then stores it as the one "Up Next" row, replacing any previous one.
 *
 *       This is also Swap. Generation is deterministic, so calling this twice with no new training
 *       logged returns the identical workout by design; sending `swap: true` passes the current
 *       workout's exercises to the planner as a scoring penalty so it prefers different movements for
 *       the same muscles.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: The generated recommendation.
 *       422:
 *         description: Nothing could be programmed — the catalog is empty or the gym profile too narrow.
 */
const generateHandler: RequestHandler = async (req, res, next) => {
  try {
    const parsed = generateWorkoutRecommendationRequestSchema.safeParse(
      req.body ?? {}
    );
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Invalid request body.', details: parsed.error.issues });
      return;
    }
    const recommendation =
      await workoutRecommendationService.generateRecommendation(req.userId, {
        durationMinutes: parsed.data.duration_minutes,
        gymProfileId: parsed.data.gym_profile_id,
        swap: parsed.data.swap,
      });
    res
      .status(200)
      .json(workoutRecommendationResponseSchema.parse(recommendation));
  } catch (error: unknown) {
    if (error instanceof WorkoutGenerationError) {
      res.status(422).json({ error: error.message });
      return;
    }
    next(error);
  }
};

/**
 * @swagger
 * /workout-recommendations/alternatives/{exerciseId}:
 *   get:
 *     summary: Ranked replacements for one exercise
 *     tags: [Exercise & Workouts]
 *     description: |
 *       Candidates that train the same primary muscle, best first. `source: 'local'` rows can be
 *       selected immediately; `source: 'external'` rows are free-exercise-db results appended only
 *       when the local catalog is too thin, and must be imported before use.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Ranked alternatives (possibly empty).
 */
const alternativesHandler: RequestHandler = async (req, res, next) => {
  try {
    const params = alternativesParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: 'Invalid exercise id.' });
      return;
    }
    const query = alternativesQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: 'Invalid limit.' });
      return;
    }
    const alternatives = await workoutRecommendationService.getAlternatives(
      req.userId,
      params.data.exerciseId,
      query.data.limit
    );
    res
      .status(200)
      .json(alternativeExercisesResponseSchema.parse({ alternatives }));
  } catch (error: unknown) {
    next(error);
  }
};

/**
 * @swagger
 * /workout-recommendations/{id}:
 *   patch:
 *     summary: Mark the suggested workout started, completed or dismissed
 *     tags: [Exercise & Workouts]
 *     description: |
 *       Lifecycle only — the workout itself is never client-edited. Nothing server-side branches on
 *       the status yet; it exists so a client can tell a fresh suggestion from one already acted on.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: The updated recommendation.
 *       404:
 *         description: No such recommendation for this user.
 */
const patchHandler: RequestHandler = async (req, res, next) => {
  try {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: 'Invalid recommendation id.' });
      return;
    }
    const parsed = updateWorkoutRecommendationRequestSchema.safeParse(
      req.body ?? {}
    );
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Invalid request body.', details: parsed.error.issues });
      return;
    }
    const updated =
      await workoutRecommendationService.updateRecommendationStatus(
        req.userId,
        params.data.id,
        parsed.data.status
      );
    if (!updated) {
      res.status(404).json({ error: 'No workout recommendation yet.' });
      return;
    }
    res.status(200).json(workoutRecommendationResponseSchema.parse(updated));
  } catch (error: unknown) {
    next(error);
  }
};

router.get('/', getHandler);
router.post('/generate', generateHandler);
router.get('/alternatives/:exerciseId', alternativesHandler);
router.patch('/:id', patchHandler);

export default router;
