import { apiFetch } from './apiClient';

/**
 * One-shot voice/text quick-log: the server runs a single bounded AI turn with
 * the chatbot tool registry and returns a confirmation. Successful entries are
 * prefixed with a checkmark by the server; failures come back as plain error
 * text in `text` (HTTP 200), so callers surface `text` verbatim either way.
 * POST /api/chat/quick-log
 */

/** One executed tool call, e.g. { toolName: 'sparky_manage_food', summary: '✅ Logged …' }. */
export interface QuickLogAction {
  toolName: string;
  summary: string;
}

export interface QuickLogResult {
  text: string;
  actions: QuickLogAction[];
}

export const postQuickLog = (
  message: string,
  serviceConfigId?: string
): Promise<QuickLogResult> =>
  apiFetch<QuickLogResult>({
    endpoint: '/api/chat/quick-log',
    serviceName: 'Chat API',
    operation: 'quick log',
    method: 'POST',
    body: {
      message,
      ...(serviceConfigId ? { service_config_id: serviceConfigId } : {}),
    },
  });
