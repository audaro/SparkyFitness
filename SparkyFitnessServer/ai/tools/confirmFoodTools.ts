import { tool } from 'ai';
import { z } from 'zod';
import {
  CONFIRM_FOOD_TOOL_NAME,
  MAX_FOOD_CANDIDATES,
  MIN_FOOD_CANDIDATES,
} from '@workspace/shared';
import { formatZodError } from './errors.js';

// Mirrors FoodCandidate in @workspace/shared (constants/chatFoodConfirm.ts):
// display fields the card renders plus the identifiers a follow-up turn needs
// to log the pick without a fresh lookup.
const FoodCandidateSchema = z
  .object({
    label: z
      .string()
      .min(1)
      .max(200)
      .describe('Food display name exactly as the lookup returned it'),
    brand: z.string().max(120).optional(),
    serving_size: z.coerce
      .number()
      .positive()
      .describe('The serving the nutrition below describes'),
    serving_unit: z.string().min(1).max(50),
    calories: z.coerce.number().min(0).describe('Per serving'),
    protein: z.coerce.number().min(0).optional().describe('Grams per serving'),
    carbs: z.coerce.number().min(0).optional().describe('Grams per serving'),
    fat: z.coerce.number().min(0).optional().describe('Grams per serving'),
    source: z
      .string()
      .min(1)
      .max(50)
      .describe(
        "'internal', an external provider type (openfoodfacts, usda, ...), or 'ai_estimate'"
      ),
    food_id: z
      .string()
      .max(100)
      .optional()
      .describe(
        'Internal matches only: the id from the lookup — copy it verbatim, never invent it'
      ),
    external_id: z
      .string()
      .max(200)
      .optional()
      .describe('External matches only: the External ID from the lookup'),
    provider_type: z
      .string()
      .max(50)
      .optional()
      .describe('External matches only: the provider the id belongs to'),
  })
  .strict();

const ConfirmFoodSchema = z.object({
  question: z
    .string()
    .min(1)
    .describe(
      "Shown above the cards (e.g. 'Is this the right one?'). Also state it in your normal reply text."
    ),
  quantity: z.coerce
    .number()
    .positive()
    .optional()
    .describe('What will be logged once confirmed — display-only context'),
  unit: z.string().max(50).optional(),
  meal_type: z.string().max(50).optional(),
  candidates: z
    .array(FoodCandidateSchema)
    .min(MIN_FOOD_CANDIDATES)
    .max(MAX_FOOD_CANDIDATES)
    .describe(
      `${MIN_FOOD_CANDIDATES}-${MAX_FOOD_CANDIDATES} candidates, best match first. One card confirming a single uncertain match is normal.`
    ),
});

/**
 * Chat-only food-confirmation tool: renders the candidates as tappable cards
 * (name, brand, serving, calories, macros, source badge) in the chat UI.
 * Tapping one sends an ordinary user message identifying the pick, so the
 * model sees a normal reply; the server replays this call's input — ids
 * included — as text, so the follow-up turn can log the choice directly.
 *
 * The agent loop stops as soon as this is called — see the
 * hasToolCall(CONFIRM_FOOD_TOOL_NAME) stop condition in services/chatService.ts
 * — so the model cannot confirm its own question. execute() is a stateless
 * echo, exactly like sparky_ask_user: it exists so the tool call always has a
 * matching tool result and the memoized tool map stays shareable. The cards
 * render from the recorded tool call's input, not from this return value.
 *
 * Not part of the MCP surface: an MCP client has no card UI and would just
 * receive a dead question.
 */
export function buildConfirmFoodTools() {
  return {
    [CONFIRM_FOOD_TOOL_NAME]: tool({
      description:
        'Shows the user the food match(es) you found as tappable confirmation cards with full nutrition details, BEFORE logging. ' +
        'Use it when the match is uncertain: several genuinely different candidates, a fuzzy or external-source match, or your own AI estimate. ' +
        'Do NOT use it when the lookup returned one clear internal match for exactly what the user said — just log that. ' +
        'Copy every id (food_id / external_id / provider_type) verbatim from the lookup result. Log NOTHING until the user picks a card.',
      inputSchema: ConfirmFoodSchema,
      execute: async (rawArgs) => {
        const parsed = ConfirmFoodSchema.safeParse(rawArgs);
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        const n = parsed.data.candidates.length;
        return `Presented ${n} food candidate card${n === 1 ? '' : 's'} to the user. Stop and wait for their choice — do not log anything until they confirm.`;
      },
    }),
  };
}
