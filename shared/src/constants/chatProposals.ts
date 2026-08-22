/**
 * The chat-only `sparky_propose_workout_preset` tool: how Sparky proposes a
 * fully programmed workout routine as an interactive card instead of writing
 * it to the database itself.
 *
 * Shared source of truth so the server (which publishes the tool schema and
 * stops the agent loop on this call) and the frontend (which registers the
 * assistant-ui card renderer for this tool name) cannot drift.
 *
 * Why propose-then-accept rather than create-then-correct: tool results are
 * stripped from the LLM window (see toCoreMessages in services/chatService.ts),
 * so the model never learns the id of anything it creates and cannot reliably
 * undo or amend it. Instead the model only *proposes* the complete payload
 * here; the card commits on Accept through the normal authenticated REST
 * route, and the client — which does hold the created id — owns Undo and Edit.
 */
export const PROPOSE_WORKOUT_PRESET_TOOL_NAME = 'sparky_propose_workout_preset';

export const PROPOSAL_PART_TYPES = [
  `tool-${PROPOSE_WORKOUT_PRESET_TOOL_NAME}`,
] as const;

export type ProposalPartType = (typeof PROPOSAL_PART_TYPES)[number];

/**
 * Display+commit payload. Superset of the WorkoutPresetCreateRequest commit
 * shape plus display-only fields (`exercise_name`, `modality`, `rationale`)
 * the card needs to render without extra fetches. Stored values are always
 * metric (kg / seconds / km); the UI converts for display.
 */
export interface ProposedPresetSet {
  set_number: number; // 1-based
  set_type?: string | null; // 'Working Set' | 'Warmup' | 'Drop Set' | 'Failure'
  reps?: number | null;
  weight?: number | null; // kg, metric always (UI converts for display)
  duration?: number | null; // integer SECONDS
  distance?: number | null; // km
  rest_time?: number | null; // seconds
  notes?: string | null;
}

export interface ProposedPresetExercise {
  exercise_id: string; // UUID or external source id (server resolves)
  exercise_name: string; // display-only
  modality?: string | null; // display-only: weight_reps|reps_only|duration|duration_distance
  sort_order: number;
  superset_group?: number | null;
  sets: ProposedPresetSet[];
}

export interface ProposeWorkoutPresetInput {
  name: string;
  description?: string | null;
  /** Display-only "why this routine" — rendered on the card, never persisted. */
  rationale?: string;
  exercises: ProposedPresetExercise[];
}
