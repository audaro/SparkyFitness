import * as Device from 'expo-device';
import type { CaptureMeta, CaptureMode } from '../types/checkInPhotos';

/**
 * Builds the capture-conditions payload that rides along with a progress-photo
 * upload.
 *
 * A before/after comparison is only worth as much as the pair's consistency, so
 * every shot records what the app knew at the shutter: how it was taken, on
 * which camera, against which previous photo, and at what local time. What it
 * deliberately does not record is anything identifying — the marketing model
 * name is the whole of the device fingerprint, and there is no location field.
 *
 * Fields the app cannot know are left out rather than defaulted. Tilt is the
 * live example: the sensor-backed level needs a native module and so cannot
 * ship over the air, and a comparison that read a missing tilt as 0° would
 * call a crooked pair perfectly level.
 */
export function buildCaptureMeta(params: {
  mode: CaptureMode;
  facing?: 'front' | 'back';
  referencePhotoId?: string | null;
  referenceOpacity?: number;
  timerSeconds?: number;
  now?: Date;
}): CaptureMeta {
  const {
    mode,
    facing,
    referencePhotoId,
    referenceOpacity,
    timerSeconds,
    now = new Date(),
  } = params;

  return {
    v: 1,
    capture_mode: mode,
    // `modelName` is null on a simulator and on web; omit the key entirely
    // rather than storing null, so "unknown" has one representation.
    ...(Device.modelName ? { device: Device.modelName } : {}),
    ...(facing ? { facing } : {}),
    ...(referencePhotoId ? { reference_photo_id: referencePhotoId } : {}),
    ...(referenceOpacity !== undefined
      ? { reference_opacity: referenceOpacity }
      : {}),
    ...(timerSeconds !== undefined ? { timer_seconds: timerSeconds } : {}),
    local_time: toLocalIsoWithOffset(now),
  };
}

/**
 * ISO 8601 in the device's own zone, offset included — `2026-09-18T07:12:00-05:00`.
 *
 * `toISOString()` would normalize to UTC and lose the wall-clock hour, which is
 * the only part that matters here: body weight, water and gut fill swing more
 * across a day than across a week of training, so a comparison wants to know
 * whether two shots were taken at the same hour, not the same instant.
 */
function toLocalIsoWithOffset(date: Date): string {
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offsetMinutes / 60)}:${pad(offsetMinutes % 60)}`
  );
}
