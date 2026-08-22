import { z } from 'zod';

// Body contract for POST /api/chat/quick-log. Deliberately tiny: one short
// user note plus an optional explicit AI service selection (defaults to the
// user's active AI service).
export const quickLogRequestSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  service_config_id: z.string().uuid().optional(),
});

export type QuickLogRequest = z.infer<typeof quickLogRequestSchema>;
