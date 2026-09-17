import type { ToolExecutionOptions } from 'ai';

/**
 * The options object every chatbot tool test passes as the second argument to
 * `execute`. AI SDK v7 made `context` required on `ToolExecutionOptions`; these
 * tools declare no context schema, so it is always empty here.
 *
 * Shared rather than redeclared per file so the next change to this shape is
 * one edit instead of twenty-seven.
 */
export const toolOpts: ToolExecutionOptions<Record<string, unknown>> = {
  toolCallId: 'tc-1',
  messages: [],
  context: {},
};
