import type { useChatRuntime } from '@assistant-ui/react-ai-sdk';
import { ASK_USER_TOOL_NAME, CONFIRM_FOOD_PART_TYPE, PROPOSAL_PART_TYPES } from '@workspace/shared';
import { apiFetch } from './apiClient';

/**
 * Server-side Sparky chat persistence. The streaming endpoint auto-saves each
 * completed exchange on `onFinish`, so the client only needs to read the
 * history back (to seed the runtime on open) and clear it.
 */

/** A single stored chat message as returned by the server. */
export interface ChatHistoryEntry {
  id: string;
  message_type: 'user' | 'assistant';
  content: string;
  parts?: unknown;
  metadata?: unknown;
  created_at: string;
}

/**
 * The `messages` option of `useChatRuntime` — the seed (initial) messages.
 * Imported as a type only so this module stays free of the assistant-ui
 * runtime's ESM/web-fetch dependency chain (it's loaded in plain unit tests).
 */
type InitialMessages = NonNullable<Parameters<typeof useChatRuntime>[0]>['messages'];

/**
 * Fetches the user's recent chat history (server returns the ~50 most recent
 * messages in chronological order). The GET handler ignores the web's
 * `autoClearHistory` query param, so no params are needed here.
 * GET /api/chat/sparky-chat-history
 */
export const loadChatHistory = (): Promise<ChatHistoryEntry[]> =>
  apiFetch<ChatHistoryEntry[]>({
    endpoint: '/api/chat/sparky-chat-history',
    serviceName: 'Chat API',
    operation: 'load chat history',
  });

/**
 * Clears all stored chat history for the user.
 * POST /api/chat/clear-all-history
 */
export const clearAllChatHistory = (): Promise<void> =>
  apiFetch<void>({
    endpoint: '/api/chat/clear-all-history',
    serviceName: 'Chat API',
    operation: 'clear chat history',
    method: 'POST',
    body: {},
  });

/**
 * Chat-only interactive tool parts mobile can re-render after a reload: the
 * quick-reply chips, the food-confirmation cards and the workout proposal
 * card (WorkoutProposalCard renders the reloaded part as a stale, read-only
 * routine).
 */
const SEEDABLE_TOOL_PART_TYPES: readonly string[] = [
  `tool-${ASK_USER_TOOL_NAME}`,
  CONFIRM_FOOD_PART_TYPE,
  ...PROPOSAL_PART_TYPES,
];

/** True when `parts` only contains parts mobile can seed: text parts and the
 * chat-only interactive tool parts (which are stored in the AI-SDK UIMessage
 * shape the runtime already consumes from the live stream). */
function isSeedableParts(parts: unknown): parts is { type: string }[] {
  return (
    Array.isArray(parts) &&
    parts.length > 0 &&
    parts.every((part) => {
      if (!part || typeof part !== 'object') return false;
      const type = (part as { type?: unknown }).type;
      if (type === 'text') {
        return typeof (part as { text?: unknown }).text === 'string';
      }
      return typeof type === 'string' && SEEDABLE_TOOL_PART_TYPES.includes(type);
    })
  );
}

/**
 * Maps server history rows to the AI-SDK initial-message shape consumed by
 * `useChatRuntime`. Assistant rows are stored as text parts plus, when the
 * turn ended on chips or food-confirmation cards, the recorded tool-call part
 * those re-render from — both pass through as-is. If a row's `parts` contains
 * anything else (e.g. a web image attachment) we fall back to the `content`
 * string — the surrounding text is preserved, the unrenderable part is
 * dropped (mobile can neither render nor send images). The `id` fallback
 * guards a missing key colliding in the AI-SDK store.
 */
export function mapHistoryToInitialMessages(entries: ChatHistoryEntry[]): InitialMessages {
  return entries.map((entry, i) => {
    const parts = isSeedableParts(entry.parts)
      ? entry.parts
      : [{ type: 'text' as const, text: entry.content }];

    return {
      id: entry.id || `history-${i}`,
      role: entry.message_type === 'user' ? ('user' as const) : ('assistant' as const),
      content: entry.content,
      parts,
    };
  }) as unknown as InitialMessages;
}
