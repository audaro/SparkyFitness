import { TtlCache } from '../utils/ttlCache.js';

// Per-user cache of the DB lookups behind every chat turn (timezone, custom
// categories, coach profile summary). Lives in its own module so the tools
// that EDIT this context (e.g. sparky_manage_coach_profile) can invalidate it
// without importing chatService and creating an import cycle.
export interface ChatContextInputs {
  chatTz: string;
  customCategoriesList: string;
  coachProfileSummary: string;
}

export const chatContextInputsCache = new TtlCache<ChatContextInputs>(60_000);

// Call after mutating anything the cached context is derived from, so the very
// next chat turn sees the change instead of waiting out the 60s TTL.
export function invalidateChatContextInputs(userId: string): void {
  chatContextInputsCache.delete(userId);
}
