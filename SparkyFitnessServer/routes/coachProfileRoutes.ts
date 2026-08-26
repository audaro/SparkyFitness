import express, { RequestHandler } from 'express';
import {
  coachProfileResponseSchema,
  updateCoachProfileRequestSchema,
  type CoachProfileResponse,
} from '@workspace/shared';
import { authenticate } from '../middleware/authMiddleware.js';
import checkPermissionMiddleware from '../middleware/checkPermissionMiddleware.js';
import coachProfileRepository, {
  type CoachProfilePatch,
  type CoachProfileRow,
} from '../models/coachProfileRepository.js';
import { invalidateChatContextInputs } from '../services/chatContextCache.js';

const router = express.Router();

router.use(authenticate);
// The coach profile states training constraints that every exercise surface
// reads, so it rides the diary permission like the rest of that domain.
router.use(checkPermissionMiddleware('diary'));

/**
 * `coach_profiles` RLS is owner-only: the policy matches `user_id` against
 * `authenticated_user_id()`, the real caller, not the switched context. A
 * delegate with diary access on someone else's account therefore cannot see or
 * write that row no matter what the permission check says — a delegated GET
 * would report an empty profile as though the owner had stated nothing, and a
 * delegated PATCH would fail inside Postgres and surface as a 500.
 *
 * Rather than lie on read and explode on write, say so. Copied deliberately
 * from `weeklySetTargetRoutes.ts`, which guards the same table.
 */
const requireSelf: RequestHandler = (req, res, next) => {
  const authUserId = req.originalUserId ?? req.authenticatedUserId;
  if (!authUserId || authUserId !== req.userId) {
    res.status(403).json({
      error: 'The coach profile can only be read or changed by its owner.',
    });
    return;
  }
  next();
};

router.use(requireSelf);

/**
 * A user who has never been through the AI chat has no row at all, which is
 * the same thing to every reader as a row with nothing set. Both answer with
 * every field null rather than a 404 the client would have to special-case.
 */
function toResponse(row: CoachProfileRow | null): CoachProfileResponse {
  return coachProfileResponseSchema.parse({
    goals: row?.goals ?? null,
    training_days_per_week: row?.training_days_per_week ?? null,
    session_minutes: row?.session_minutes ?? null,
    experience_level: row?.experience_level ?? null,
    limitations: row?.limitations ?? [],
  });
}

/**
 * @swagger
 * /coach-profile:
 *   get:
 *     summary: The user's stated training constraints
 *     tags: [Exercise & Workouts]
 *     description: |
 *       Session length, training days per week, goals, experience level, and limitations. These
 *       are the fields a person edits directly; equipment lives in gym profiles and weekly set
 *       targets have their own endpoint. `experience_level` uses the exercises.level vocabulary
 *       (`beginner` | `intermediate` | `expert`) and biases which exercises the workout generator
 *       selects.
 *
 *       A user with no profile row gets every field null rather than a 404 — "no profile yet" and
 *       "profile with nothing stated" mean the same thing to every reader. `training_days_per_week`
 *       of null is what makes weekly set targets report themselves as derived.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: The stated constraints, with null for anything unstated.
 *       401:
 *         description: Unauthenticated.
 *       403:
 *         description: Forbidden (not the owner, or no diary permission for the active context).
 */
const getHandler: RequestHandler = async (req, res, next) => {
  try {
    const row = await coachProfileRepository.getCoachProfile(req.userId);
    res.status(200).json(toResponse(row));
  } catch (error: unknown) {
    next(error);
  }
};

/**
 * @swagger
 * /coach-profile:
 *   patch:
 *     summary: Change the user's stated training constraints
 *     tags: [Exercise & Workouts]
 *     description: |
 *       A partial patch: only the fields present are written, and the row is created on first
 *       write. Sending null for a scalar clears it back to unstated, which is a real edit and not
 *       the same as omitting the field. `limitations` clears with `[]`. An empty body is rejected
 *       rather than treated as a no-op, so a client that drops its payload fails loudly.
 *
 *       Returns the stored profile, so the client never has to guess what the server made of the
 *       edit.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: The profile as stored after the patch.
 *       400:
 *         description: Invalid request body.
 *       401:
 *         description: Unauthenticated.
 *       403:
 *         description: Forbidden (not the owner, or no diary permission for the active context).
 */
const updateHandler: RequestHandler = async (req, res, next) => {
  try {
    const bodyResult = updateCoachProfileRequestSchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: bodyResult.error.flatten().fieldErrors,
      });
      return;
    }
    // Parsed keys only: the schema is strict, so this cannot smuggle a column
    // the contract does not expose into the patch.
    const row = await coachProfileRepository.upsertCoachProfile(
      req.userId,
      bodyResult.data as CoachProfilePatch
    );
    // Every coaching system prompt embeds a summary built from these exact
    // columns, cached per user for 60 seconds. Without this the coach would
    // keep planning around the old session length or training days for up to a
    // minute after the user changed them. `sparky_manage_coach_profile` does
    // the same after its own write; the cache is keyed by the authenticated
    // user, which `requireSelf` has already established is `req.userId`.
    invalidateChatContextInputs(req.userId);
    res.status(200).json(toResponse(row));
  } catch (error: unknown) {
    next(error);
  }
};

router.get('/', getHandler);
router.patch('/', updateHandler);

export default router;
