import { z } from "zod";

/** The three angles the server accepts for a check-in progress photo. */
export const PHOTO_TYPES = ["front", "back", "side"] as const;

export const photoTypeSchema = z.enum(PHOTO_TYPES);

/** How the photo reached the app. Recorded so a later comparison knows how much
 * to trust the pair: only `guided` shots were framed against the previous
 * photo, and `library` imports carry no capture conditions at all. */
export const CAPTURE_MODES = ["guided", "os_camera", "library"] as const;

export const captureModeSchema = z.enum(CAPTURE_MODES);

/**
 * What the app knows about the conditions a progress photo was taken under.
 *
 * Stored on `check_in_photos.capture_meta` and null for every photo taken
 * before guided capture shipped, which is why every field below is optional:
 * the comparison pipeline treats absence as "unknown", never as zero. Nothing
 * here identifies the device beyond its marketing model name, and there is
 * deliberately no location field — these are photos of the user's body.
 *
 * `v` is the payload version. A reader must tolerate a payload it does not
 * recognise (ignore it) rather than fail the photo it is attached to.
 */
export const captureMetaSchema = z.object({
  v: z.literal(1),
  capture_mode: captureModeSchema,
  /** Marketing model name, e.g. "iPhone 16 Pro". Never a device identifier. */
  device: z.string().max(120).optional(),
  /** Which camera took it; front and back lenses frame a body differently. */
  facing: z.enum(["front", "back"]).optional(),
  /** The photo that was ghosted under the viewfinder while framing this one. */
  reference_photo_id: z.string().uuid().nullish(),
  /** Opacity the ghost was shown at, 0-1. A faint ghost aligns less tightly. */
  reference_opacity: z.number().min(0).max(1).optional(),
  /** Self-timer delay in seconds, 0 when the shutter was pressed directly. */
  timer_seconds: z.number().int().min(0).max(60).optional(),
  /**
   * Device tilt at the shutter, in degrees. Absent until the sensor-backed
   * level ships (it needs a native module, so it cannot ride an OTA update);
   * the comparison pipeline already reads them as optional.
   */
  pitch_deg: z.number().min(-180).max(180).optional(),
  roll_deg: z.number().min(-180).max(180).optional(),
  /** Local wall-clock time of capture, ISO 8601 with offset. Time of day moves
   * a body more than a week of training does (food, water, sodium), so it is
   * worth knowing whether two shots were taken at the same hour. */
  local_time: z.string().max(40).optional(),
});

/**
 * One photo in the progress gallery, paired with the weight recorded on the
 * same day.
 *
 * `file_path` is deliberately absent: clients fetch the image bytes through the
 * authenticated /file/{id} route, so the on-disk layout stays a server detail.
 * `weight` is in kilograms, as stored, and is null when that day has no
 * check-in measurement or the measurement carries no weight.
 */
export const checkInPhotoWithWeightSchema = z.object({
  id: z.string().uuid(),
  entry_date: z.string(),
  photo_type: photoTypeSchema,
  weight: z.number().nullable(),
});

/** Response of GET /measurements/check-in-photos, newest day first. */
export const checkInPhotoGalleryResponseSchema = z.array(
  checkInPhotoWithWeightSchema,
);

/** A photo row as returned by GET /measurements/check-in-photos/:date. */
export const checkInPhotoResponseSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  check_in_measurement_id: z.string().uuid().nullable(),
  entry_date: z.string(),
  photo_type: photoTypeSchema,
  file_path: z.string(),
  created_at: z.string(),
  // Null for photos taken before guided capture shipped, and for library
  // imports. Nullish rather than required so an older server, which does not
  // select the column, still parses here.
  capture_meta: captureMetaSchema.nullish(),
});

export type PhotoType = z.infer<typeof photoTypeSchema>;
export type CaptureMode = z.infer<typeof captureModeSchema>;
export type CaptureMeta = z.infer<typeof captureMetaSchema>;
export type CheckInPhotoWithWeight = z.infer<
  typeof checkInPhotoWithWeightSchema
>;
export type CheckInPhotoGalleryResponse = z.infer<
  typeof checkInPhotoGalleryResponseSchema
>;
export type CheckInPhotoResponse = z.infer<typeof checkInPhotoResponseSchema>;
