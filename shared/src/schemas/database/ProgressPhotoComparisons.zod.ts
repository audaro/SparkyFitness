import { z } from "zod";

export const progressPhotoComparisonsIdSchema = z.string().or(z.number());

/**
 * One cached before/after pair.
 *
 * There is no `verdict` column: comparability is decided by thresholds in
 * `../api/ProgressPhotoComparison.api.zod.ts` and recomputed on every read, so
 * tuning them takes effect on pairs that were measured months earlier.
 */
export const progressPhotoComparisonsSchema = z.object({
  id: z.string().optional(),
  user_id: z.string(),
  before_photo_id: z.string(),
  after_photo_id: z.string(),
  engine: z.string(),
  deterministic: z.record(z.string(), z.unknown()).nullable().optional(),
  failure_reason: z.string().nullable().optional(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const progressPhotoComparisonsInitializerSchema = z.object({
  id: z.string().optional(),
  user_id: z.string().optional(),
  before_photo_id: z.string().optional(),
  after_photo_id: z.string().optional(),
  engine: z.string().optional(),
  deterministic: z.record(z.string(), z.unknown()).nullable().optional(),
  failure_reason: z.string().nullable().optional(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const progressPhotoComparisonsMutatorSchema =
  progressPhotoComparisonsInitializerSchema.partial();

export type ProgressPhotoComparisons = z.infer<
  typeof progressPhotoComparisonsSchema
>;
export type ProgressPhotoComparisonsInitializer = z.infer<
  typeof progressPhotoComparisonsInitializerSchema
>;
export type ProgressPhotoComparisonsMutator = z.infer<
  typeof progressPhotoComparisonsMutatorSchema
>;
