import express from 'express';
import { authenticate } from '../middleware/authMiddleware.js';
import checkPermissionMiddleware from '../middleware/checkPermissionMiddleware.js';
import checkInPhotoUpload, {
  getImageExtension,
} from '../middleware/checkInPhotoUpload.js';
import checkInPhotoService from '../services/checkInPhotoService.js';
import { demoGuard } from '../middleware/demoGuardMiddleware.js';
import { log } from '../config/logging.js';
import {
  CheckInPhotoDateParamSchema,
  CheckInPhotoUploadParamSchema,
  CheckInPhotoIdParamSchema,
  CheckInPhotoGalleryResponseSchema,
  CheckInPhotoCaptureMetaSchema,
  type CaptureMeta,
} from '../schemas/checkInPhotoSchemas.js';

const router = express.Router();

/**
 * Reads the optional `capture_meta` multipart field off an upload.
 *
 * Three outcomes, and the middle one is the point: absent means the client sent
 * no capture conditions (an older app, or a library import) and the photo is
 * stored with none; valid means they are stored; **malformed is a hard error**.
 * Dropping an unparseable payload would leave a photo that looks guided but
 * carries no conditions, and a later comparison would quietly score the pair as
 * if it had been framed against its predecessor. A 400 the client can surface
 * beats a plausible-but-wrong report weeks later.
 */
const parseCaptureMeta = (
  raw: unknown
): { ok: true; value?: CaptureMeta } | { ok: false; error: string } => {
  if (raw === undefined || raw === null || raw === '') return { ok: true };
  if (typeof raw !== 'string') {
    return { ok: false, error: 'capture_meta must be a JSON string' };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'capture_meta is not valid JSON' };
  }
  const parsed = CheckInPhotoCaptureMetaSchema.safeParse(decoded);
  if (!parsed.success) {
    return {
      ok: false,
      error: `capture_meta is invalid: ${parsed.error.issues[0]?.message}`,
    };
  }
  return { ok: true, value: parsed.data };
};

/**
 * @swagger
 * /measurements/check-in-photos:
 *   get:
 *     summary: List every progress photo with the weight logged that day
 *     description: >
 *       Returns all of the user's progress photos, newest day first, each with
 *       the weight recorded on the same calendar day (null when that day has no
 *       weight). Backs the mobile progress gallery, the side-by-side comparison
 *       and the time-lapse player in a single request. Image bytes are fetched
 *       separately through /file/{id}. Registered before /:date so it is not
 *       shadowed by it.
 *     tags: [Wellness & Metrics]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Array of photos with their matching weight.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   entry_date:
 *                     type: string
 *                     format: date
 *                   photo_type:
 *                     type: string
 *                     enum: [front, back, side]
 *                   weight:
 *                     type: number
 *                     nullable: true
 */
router.get(
  '/',
  authenticate,
  checkPermissionMiddleware('checkin'),
  async (req, res) => {
    try {
      const photos = await checkInPhotoService.getAllPhotosWithWeight(
        req.userId
      );
      res.json(CheckInPhotoGalleryResponseSchema.parse(photos));
    } catch (err) {
      log('error', 'Failed to fetch check-in photo gallery', err);
      res.status(500).json({ error: 'Failed to fetch check-in photo gallery' });
    }
  }
);

/**
 * @swagger
 * /measurements/check-in-photos/dates:
 *   get:
 *     summary: List the dates on which the user has progress photos
 *     description: >
 *       Returns the distinct calendar days (YYYY-MM-DD, newest first) that have
 *       at least one progress photo. Used to mark those days on the check-in
 *       calendar. Registered before /:date so it is not shadowed by it.
 *     tags: [Wellness & Metrics]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Array of YYYY-MM-DD date strings.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *                 format: date
 */
router.get(
  '/dates',
  authenticate,
  checkPermissionMiddleware('checkin'),
  async (req, res) => {
    try {
      const dates = await checkInPhotoService.getPhotoDates(req.userId);
      res.json(dates);
    } catch (err) {
      log('error', 'Failed to fetch check-in photo dates', err);
      res.status(500).json({ error: 'Failed to fetch check-in photo dates' });
    }
  }
);

/**
 * @swagger
 * /measurements/check-in-photos/{date}:
 *   get:
 *     summary: Get progress photos for a check-in date
 *     tags: [Wellness & Metrics]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Array of photo records for the given date.
 *       400:
 *         description: Invalid date format.
 */
router.get(
  '/:date',
  authenticate,
  checkPermissionMiddleware('checkin'),
  async (req, res) => {
    const parsed = CheckInPhotoDateParamSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message });
      return;
    }
    try {
      const photos = await checkInPhotoService.getPhotosByDate(
        req.userId,
        parsed.data.date
      );
      res.json(photos);
    } catch (err) {
      log('error', 'Failed to fetch check-in photos', err);
      res.status(500).json({ error: 'Failed to fetch check-in photos' });
    }
  }
);

/**
 * @swagger
 * /measurements/check-in-photos/file/{id}:
 *   get:
 *     summary: Serve a progress photo image (authenticated, owner/family only)
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
 *         description: The image file.
 *         content:
 *           image/*:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Photo not found or not accessible.
 */
router.get(
  '/file/:id',
  authenticate,
  checkPermissionMiddleware('checkin'),
  async (req, res) => {
    const parsed = CheckInPhotoIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message });
      return;
    }
    try {
      const absolutePath = await checkInPhotoService.getPhotoFileById(
        req.userId,
        parsed.data.id
      );
      if (!absolutePath) {
        res.status(404).json({ error: 'Photo not found' });
        return;
      }
      // Stored uploads are user-supplied; stop the browser from MIME-sniffing
      // the response into an executable type.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // sendFile streams asynchronously, so a transmission error won't reach the
      // surrounding try/catch — handle it in the callback and only respond if the
      // headers/stream haven't started yet.
      res.sendFile(absolutePath, (err) => {
        if (err) {
          log('error', 'Failed to stream check-in photo', err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to serve check-in photo' });
          }
        }
      });
    } catch (err) {
      log('error', 'Failed to serve check-in photo', err);
      res.status(500).json({ error: 'Failed to serve check-in photo' });
    }
  }
);

/**
 * @swagger
 * /measurements/check-in-photos/{date}/{type}:
 *   post:
 *     summary: Upload a progress photo (front, back, or side)
 *     tags: [Wellness & Metrics]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [front, back, side]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *               capture_meta:
 *                 type: string
 *                 description: >
 *                   Optional JSON describing how the photo was taken
 *                   (capture_mode, device, facing, reference_photo_id,
 *                   reference_opacity, timer_seconds, pitch_deg, roll_deg,
 *                   local_time). Omit it for a library import or an older
 *                   client; a malformed payload is rejected rather than
 *                   dropped, so a later comparison never scores a pair on
 *                   conditions it never had.
 *     responses:
 *       200:
 *         description: Photo uploaded successfully.
 *       400:
 *         description: Invalid parameters, file type, or capture_meta payload.
 */
router.post(
  '/:date/:type',
  authenticate,
  checkPermissionMiddleware('checkin'),
  demoGuard,
  (req, res, next) => {
    const parsed = CheckInPhotoUploadParamSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message });
      return;
    }
    next();
  },
  checkInPhotoUpload.single('photo'),
  async (req, res) => {
    const file = req.file as { buffer: Buffer } | undefined;
    if (!file) {
      res.status(400).json({ error: 'No photo file provided' });
      return;
    }
    const { date, type } = req.params as {
      date: string;
      type: 'front' | 'back' | 'side';
    };
    // The multer fileFilter only trusts the client-supplied filename/mime type;
    // verify the real bytes and derive the stored extension from them so the
    // served Content-Type can never be spoofed by a mismatched filename.
    const extension = getImageExtension(file.buffer);
    if (!extension) {
      res.status(400).json({
        error: 'Uploaded file is not a valid image (jpeg, png, gif, webp)',
      });
      return;
    }
    // multer puts the multipart text fields on req.body; this one rides along
    // with the image so the conditions and the photo land in one transaction.
    const captureMeta = parseCaptureMeta(
      (req.body as { capture_meta?: unknown } | undefined)?.capture_meta
    );
    if (!captureMeta.ok) {
      res.status(400).json({ error: captureMeta.error });
      return;
    }
    try {
      const photo = await checkInPhotoService.upsertPhoto(
        req.userId,
        date,
        type,
        extension,
        file.buffer,
        captureMeta.value
      );
      res.json(photo);
    } catch (err) {
      log('error', 'Failed to save check-in photo', err);
      res.status(500).json({ error: 'Failed to save check-in photo' });
    }
  }
);

/**
 * @swagger
 * /measurements/check-in-photos/photo/{id}:
 *   delete:
 *     summary: Delete a progress photo by ID
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
 *       204:
 *         description: Photo deleted.
 *       400:
 *         description: Invalid ID.
 */
router.delete(
  '/photo/:id',
  authenticate,
  checkPermissionMiddleware('checkin'),
  demoGuard,
  async (req, res) => {
    const parsed = CheckInPhotoIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message });
      return;
    }
    try {
      await checkInPhotoService.deletePhoto(req.userId, parsed.data.id);
      res.status(204).send();
    } catch (err) {
      log('error', 'Failed to delete check-in photo', err);
      res.status(500).json({ error: 'Failed to delete check-in photo' });
    }
  }
);

export default router;
