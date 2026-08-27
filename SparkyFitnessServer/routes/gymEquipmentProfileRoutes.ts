import express, { RequestHandler } from 'express';
import { z } from 'zod';
import {
  createGymEquipmentProfileRequestSchema,
  gymEquipmentProfileResponseSchema,
  gymEquipmentProfilesListResponseSchema,
  updateGymEquipmentProfileRequestSchema,
  type GymEquipmentProfileResponse,
} from '@workspace/shared';
import { authenticate } from '../middleware/authMiddleware.js';
import checkPermissionMiddleware from '../middleware/checkPermissionMiddleware.js';
import gymEquipmentProfileRepository, {
  type GymEquipmentProfileRow,
} from '../models/gymEquipmentProfileRepository.js';
import { log } from '../config/logging.js';
import { isDuplicateNameError } from '../utils/errors.js';

const router = express.Router();

router.use(authenticate);
// Gym profiles constrain what the diary's workout surfaces recommend, so they
// ride the diary permission like the rest of the exercise domain. RLS is
// owner-only regardless — a delegate hitting these gets an empty list.
router.use(checkPermissionMiddleware('diary'));

const profileIdParamSchema = z.object({ id: z.string().uuid() });

// Postgres hands back `Date` for timestamptz (poolManager only overrides
// DATE), but the contract puts ISO strings on the wire.
function toResponse(row: GymEquipmentProfileRow): GymEquipmentProfileResponse {
  return gymEquipmentProfileResponseSchema.parse({
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    equipment: row.equipment,
    is_active: row.is_active,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  });
}

/**
 * @swagger
 * /gym-equipment-profiles:
 *   get:
 *     summary: List the user's gym equipment profiles
 *     tags: [Exercise & Workouts]
 *     description: Named, switchable equipment sets. The active profile is returned first.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: The user's gym equipment profiles.
 *       401:
 *         description: Unauthenticated.
 *       403:
 *         description: Forbidden (no diary permission when acting on behalf of another user).
 */
const listHandler: RequestHandler = async (req, res, next) => {
  try {
    const rows = await gymEquipmentProfileRepository.listGymProfiles(
      req.userId
    );
    const response = gymEquipmentProfilesListResponseSchema.parse({
      profiles: rows.map(toResponse),
    });
    res.status(200).json(response);
  } catch (error: unknown) {
    next(error);
  }
};

/**
 * @swagger
 * /gym-equipment-profiles:
 *   post:
 *     summary: Create a gym equipment profile
 *     tags: [Exercise & Workouts]
 *     description: |
 *       Equipment values must be canonical free-exercise-db strings (lowercase, e.g. `dumbbell`,
 *       `body only`); anything else is rejected, because the catalog matches them case-sensitively.
 *       Passing `is_active: true` deactivates the previous active profile in the same transaction.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       201:
 *         description: Profile created.
 *       400:
 *         description: Invalid request body (including an unknown equipment value).
 *       409:
 *         description: A profile with this name already exists.
 */
const createHandler: RequestHandler = async (req, res, next) => {
  try {
    const bodyResult = createGymEquipmentProfileRequestSchema.safeParse(
      req.body
    );
    if (!bodyResult.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: bodyResult.error.flatten().fieldErrors,
      });
      return;
    }
    const row = await gymEquipmentProfileRepository.createGymProfile(
      req.userId,
      bodyResult.data
    );
    res.status(201).json(toResponse(row));
  } catch (error: unknown) {
    if (isDuplicateNameError(error)) {
      res
        .status(409)
        .json({ error: 'A gym profile with this name already exists.' });
      return;
    }
    next(error);
  }
};

/**
 * @swagger
 * /gym-equipment-profiles/{id}:
 *   put:
 *     summary: Rename a gym equipment profile or change its equipment
 *     tags: [Exercise & Workouts]
 *     description: |
 *       Only the supplied fields are written. `is_active` is not accepted here — activation is a
 *       cross-row operation owned by `POST /{id}/activate`.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Profile updated.
 *       400:
 *         description: Invalid id or request body.
 *       404:
 *         description: Profile not found.
 *       409:
 *         description: A profile with this name already exists.
 */
const updateHandler: RequestHandler = async (req, res, next) => {
  try {
    const paramResult = profileIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({
        error: 'Invalid profile id',
        details: paramResult.error.flatten().fieldErrors,
      });
      return;
    }
    const bodyResult = updateGymEquipmentProfileRequestSchema.safeParse(
      req.body
    );
    if (!bodyResult.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: bodyResult.error.flatten().fieldErrors,
      });
      return;
    }
    const row = await gymEquipmentProfileRepository.updateGymProfile(
      req.userId,
      paramResult.data.id,
      bodyResult.data
    );
    if (!row) {
      res.status(404).json({ error: 'Gym profile not found.' });
      return;
    }
    res.status(200).json(toResponse(row));
  } catch (error: unknown) {
    if (isDuplicateNameError(error)) {
      res
        .status(409)
        .json({ error: 'A gym profile with this name already exists.' });
      return;
    }
    next(error);
  }
};

/**
 * @swagger
 * /gym-equipment-profiles/{id}:
 *   delete:
 *     summary: Delete a gym equipment profile
 *     tags: [Exercise & Workouts]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Profile deleted.
 *       400:
 *         description: Invalid id.
 *       404:
 *         description: Profile not found.
 */
const deleteHandler: RequestHandler = async (req, res, next) => {
  try {
    const paramResult = profileIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({
        error: 'Invalid profile id',
        details: paramResult.error.flatten().fieldErrors,
      });
      return;
    }
    const deleted = await gymEquipmentProfileRepository.deleteGymProfile(
      req.userId,
      paramResult.data.id
    );
    if (!deleted) {
      res.status(404).json({ error: 'Gym profile not found.' });
      return;
    }
    res.status(200).json({ message: 'Gym profile deleted.' });
  } catch (error: unknown) {
    next(error);
  }
};

/**
 * @swagger
 * /gym-equipment-profiles/{id}/activate:
 *   post:
 *     summary: Make this the user's active gym equipment profile
 *     tags: [Exercise & Workouts]
 *     description: Deactivates the previously active profile in the same transaction.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Profile activated.
 *       400:
 *         description: Invalid id.
 *       404:
 *         description: Profile not found.
 */
const activateHandler: RequestHandler = async (req, res, next) => {
  try {
    const paramResult = profileIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({
        error: 'Invalid profile id',
        details: paramResult.error.flatten().fieldErrors,
      });
      return;
    }
    const row = await gymEquipmentProfileRepository.setActiveGymProfile(
      req.userId,
      paramResult.data.id
    );
    if (!row) {
      res.status(404).json({ error: 'Gym profile not found.' });
      return;
    }
    log('info', `Activated gym equipment profile ${row.id} for ${req.userId}`);
    res.status(200).json(toResponse(row));
  } catch (error: unknown) {
    next(error);
  }
};

router.get('/', listHandler);
router.post('/', createHandler);
router.put('/:id', updateHandler);
router.delete('/:id', deleteHandler);
router.post('/:id/activate', activateHandler);

export default router;
