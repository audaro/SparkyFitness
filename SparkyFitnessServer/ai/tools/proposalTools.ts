import { tool } from 'ai';
import { z } from 'zod';
import { PROPOSE_WORKOUT_PRESET_TOOL_NAME } from '@workspace/shared';
import { setTypeEnum } from './schemas/common.js';
import { formatZodError } from './errors.js';

// Mirrors ProposedPresetSet in @workspace/shared (constants/chatProposals.ts):
// commit fields for POST /api/workout-presets plus nothing extra — display
// conversion happens client-side, so stored values are metric (kg/seconds/km).
const ProposedSetSchema = z
  .object({
    set_number: z.coerce
      .number()
      .int()
      .positive()
      .describe('1-based set number'),
    set_type: setTypeEnum.optional(),
    reps: z.coerce.number().int().min(0).optional(),
    weight: z.coerce.number().min(0).optional().describe('Weight in kg'),
    duration: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Seconds — for duration/cardio sets'),
    distance: z.coerce
      .number()
      .min(0)
      .optional()
      .describe('Km — for duration_distance sets'),
    rest_time: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Rest after this set, seconds'),
    notes: z.string().max(500).optional(),
  })
  .strict();

// Mirrors ProposedPresetExercise: exercise_id commits; exercise_name and
// modality are display-only so the card renders without extra fetches.
const ProposedExerciseSchema = z
  .object({
    exercise_id: z
      .string()
      .min(1)
      .describe(
        'Exercise UUID or external source id — get real ids from search_exercises first, never invent them'
      ),
    exercise_name: z
      .string()
      .min(1)
      .max(200)
      .describe('Exercise display name, shown on the card'),
    modality: z
      .string()
      .max(50)
      .optional()
      .describe(
        'Display-only set style: weight_reps | reps_only | duration | duration_distance'
      ),
    sort_order: z.coerce.number().int().min(0).describe('0-based position'),
    superset_group: z.coerce
      .number()
      .int()
      .optional()
      .describe('Same number on 2+ exercises marks them a superset'),
    sets: z.array(ProposedSetSchema).min(1),
  })
  .strict();

const ProposeWorkoutPresetSchema = z
  .object({
    name: z.string().min(1).max(200).describe('Name for the proposed routine'),
    description: z
      .string()
      .max(1000)
      .optional()
      .describe('Short description saved with the preset'),
    rationale: z
      .string()
      .max(2000)
      .optional()
      .describe(
        'Why this routine fits the user — shown on the card, never persisted'
      ),
    exercises: z.array(ProposedExerciseSchema).min(1),
  })
  .strict();

/**
 * Chat-only proposal tool: renders a fully programmed workout routine as an
 * interactive card the user can Accept, Edit, or ask to revise. Accepting
 * commits through the normal authenticated REST route client-side — the model
 * only ever proposes; it cannot create the preset through this tool.
 *
 * The agent loop stops as soon as this is called — see the
 * hasToolCall(PROPOSE_WORKOUT_PRESET_TOOL_NAME) stop condition in
 * services/chatService.ts — so the model cannot accept its own proposal.
 * execute() is a stateless echo, exactly like sparky_ask_user: it exists so
 * the tool call always has a matching tool result and the memoized tool map
 * stays shareable. The card renders from the recorded tool call's input, not
 * from this return value.
 */
export function buildProposalTools() {
  return {
    [PROPOSE_WORKOUT_PRESET_TOOL_NAME]: tool({
      description:
        'Proposes a complete workout routine to the user as an interactive card they can accept, edit, or reject. ' +
        'Use this whenever the user asks you to build, design, or generate a workout routine/program — do NOT create it directly with create_workout_preset. ' +
        'First call search_exercises to get real exercise ids, then propose the FULL programming: every exercise with per-set reps, weight (kg), duration (seconds), distance (km), and rest times. ' +
        'If search_exercises finds no matches (common on a fresh install), do not stall: describe the routine in text, ask the user to confirm, and once they do, create it with create_workout_preset using exercise_name entries. ' +
        'After calling this, stop and wait — never claim the routine was created; only the user accepting the card creates it.',
      inputSchema: ProposeWorkoutPresetSchema,
      execute: async (rawArgs) => {
        const parsed = ProposeWorkoutPresetSchema.safeParse(rawArgs);
        if (!parsed.success) {
          return formatZodError(parsed.error);
        }
        return `Proposed workout preset "${parsed.data.name}" to the user (${parsed.data.exercises.length} exercises). Stop and wait for their decision — do not create it yourself.`;
      },
    }),
  };
}
