import { z } from "zod";

export const checkInPhotosIdSchema = z.string().or(z.number());

/**
 * Versioned capture conditions; see `captureMetaSchema` in
 * `../api/CheckInPhotos.api.zod.ts` for the shape. Kept loose here because this
 * layer mirrors the column (jsonb, nullable), while the API layer is what
 * validates a payload on the way in.
 */
const captureMetaColumnSchema = z.record(z.string(), z.unknown());

export const checkInPhotosSchema = z.object({
  id: z.string().optional(),
  user_id: z.string(),
  check_in_measurement_id: z.string().nullable().optional(),
  entry_date: z.date(),
  photo_type: z.string(),
  file_path: z.string(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
  capture_meta: captureMetaColumnSchema.nullable().optional(),
});

export const checkInPhotosInitializerSchema = z.object({
  id: z.string().optional(),
  user_id: z.string().optional(),
  check_in_measurement_id: z.string().nullable().optional(),
  entry_date: z.date().optional(),
  photo_type: z.string().optional(),
  file_path: z.string().optional(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
  capture_meta: captureMetaColumnSchema.nullable().optional(),
});

export const checkInPhotosMutatorSchema =
  checkInPhotosInitializerSchema.partial();

export type CheckInPhotos = z.infer<typeof checkInPhotosSchema>;
export type CheckInPhotosInitializer = z.infer<
  typeof checkInPhotosInitializerSchema
>;
export type CheckInPhotosMutator = z.infer<typeof checkInPhotosMutatorSchema>;
