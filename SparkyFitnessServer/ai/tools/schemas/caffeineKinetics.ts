import { z } from 'zod';
import { optionalDateSchema } from './common.js';

export const CAFFEINE_KINETICS_ACTIONS = ['active_caffeine'] as const;

export const caffeineKineticsSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('active_caffeine'),
      date: optionalDateSchema.describe(
        'The calendar day (YYYY-MM-DD) to evaluate. Defaults to today.'
      ),
      dose_mg: z.coerce
        .number()
        .positive()
        .optional()
        .describe(
          'Size in mg of a next planned dose, used to compute the latest safe time to take it before bedtime. Defaults to 200 (about one cup of coffee).'
        ),
    })
    .strict(),
]);

export type CaffeineKineticsInput = z.infer<typeof caffeineKineticsSchema>;

// Flat shape published to the LLM as `inputSchema`.
export const caffeineKineticsInput = z.object({
  action: z.enum(CAFFEINE_KINETICS_ACTIONS).optional(),
  date: z.string().optional(),
  dose_mg: z.coerce.number().positive().optional(),
});
