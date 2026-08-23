/**
 * The chat-only `sparky_confirm_food` tool: how Sparky shows the user WHICH
 * food it matched — as rich candidate cards (brand, serving, calories, macros,
 * source) — and waits for a tap before logging anything.
 *
 * Shared source of truth so the server (which publishes the tool schema and
 * stops the agent loop on this call) and the web/mobile clients (which register
 * the card renderer for this tool name) cannot drift.
 *
 * Like `sparky_ask_user`, this is always asked BEFORE the log, never after it:
 * tool results are stripped from the LLM window (see toCoreMessages in
 * services/chatService.ts), so the model could not reliably fix a wrong entry
 * it already wrote. Unlike the plain quick-reply chips, the candidates carry
 * the identifiers needed to log the pick (food_id / external_id +
 * provider_type), and the server replays them as text so the follow-up turn
 * can log the user's choice without a fresh lookup.
 */
export const CONFIRM_FOOD_TOOL_NAME = 'sparky_confirm_food';

export const CONFIRM_FOOD_PART_TYPE = `tool-${CONFIRM_FOOD_TOOL_NAME}`;

/**
 * One card per candidate; a single card is valid (confirming the ONLY fuzzy
 * or external match is the common case), and past a handful the list stops
 * being scannable on a phone.
 */
export const MIN_FOOD_CANDIDATES = 1;
export const MAX_FOOD_CANDIDATES = 4;

/**
 * Where a candidate's nutrition came from. 'internal' = the user's own food
 * database (log with log_food + food_id); 'ai_estimate' = the model's own
 * numbers (create_food then log); anything else is an external provider type
 * (openfoodfacts, usda, fatsecret, ... — log with log_external_food +
 * external_id + provider_type).
 */
export type FoodCandidateSource = 'internal' | 'ai_estimate' | (string & {});

/** Display + relog payload for one candidate card. */
export interface FoodCandidate {
  /** Food display name as the source reports it. */
  label: string;
  brand?: string;
  /** The serving the calories/macros below describe (e.g. 30 g, 1 cracker). */
  serving_size: number;
  serving_unit: string;
  /** Per-serving nutrition — the "telling information" on the card. */
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  source: FoodCandidateSource;
  /** Internal foods only: the id log_food needs. */
  food_id?: string;
  /** External matches only: the id + provider log_external_food needs. */
  external_id?: string;
  provider_type?: string;
}

export interface ConfirmFoodInput {
  /** Shown above the cards (e.g. 'Which crackers are these?'). */
  question: string;
  /** What will be logged once confirmed — display-only context. */
  quantity?: number;
  unit?: string;
  meal_type?: string;
  candidates: FoodCandidate[];
}

/**
 * The user text a card tap sends, shared by web and mobile so the model sees
 * the identical phrasing either way. `index` is 1-based and matches the
 * numbering the server uses when it replays the candidates as text, so the
 * model can resolve the pick back to the candidate's ids.
 */
export function confirmFoodPickMessage(
  index: number,
  candidate: Pick<FoodCandidate, 'label' | 'brand'>
): string {
  const brand = candidate.brand ? ` (${candidate.brand})` : '';
  return `I confirm option ${index}: "${candidate.label}"${brand} — log that one.`;
}

/** The user text the "none of these" action sends. */
export const CONFIRM_FOOD_REJECT_MESSAGE =
  'None of those are right — search again or ask me for details.';
