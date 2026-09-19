import { z } from "zod";

export const checkInPhotoAnalysisIdSchema = z.string().or(z.number());

/**
 * Cached pose measurements for one progress photo.
 *
 * The jsonb columns are kept loose here because this layer mirrors the column
 * types; `photoMetricsSchema` in `../api/ProgressPhotoComparison.api.zod.ts`
 * is what validates the shape on the way in from the vision service.
 *
 * Either the analysis succeeded (`metrics` and `landmarks` set) or it did not
 * (`failure_reason` set) -- a database CHECK enforces that, so nothing can
 * store half an answer.
 */
export const checkInPhotoAnalysisSchema = z.object({
  id: z.string().optional(),
  user_id: z.string(),
  photo_id: z.string(),
  engine: z.string(),
  metrics: z.record(z.string(), z.unknown()).nullable().optional(),
  landmarks: z.array(z.array(z.number())).nullable().optional(),
  failure_reason: z.string().nullable().optional(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const checkInPhotoAnalysisInitializerSchema = z.object({
  id: z.string().optional(),
  user_id: z.string().optional(),
  photo_id: z.string().optional(),
  engine: z.string().optional(),
  metrics: z.record(z.string(), z.unknown()).nullable().optional(),
  landmarks: z.array(z.array(z.number())).nullable().optional(),
  failure_reason: z.string().nullable().optional(),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

export const checkInPhotoAnalysisMutatorSchema =
  checkInPhotoAnalysisInitializerSchema.partial();

export type CheckInPhotoAnalysis = z.infer<typeof checkInPhotoAnalysisSchema>;
export type CheckInPhotoAnalysisInitializer = z.infer<
  typeof checkInPhotoAnalysisInitializerSchema
>;
export type CheckInPhotoAnalysisMutator = z.infer<
  typeof checkInPhotoAnalysisMutatorSchema
>;
