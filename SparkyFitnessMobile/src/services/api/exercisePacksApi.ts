import { apiFetch } from './apiClient';

const SERVICE_NAME = 'Exercise Packs API';

/** One importable catalog pack and this user's progress through it. */
export interface ExercisePack {
  id: string;
  label: string;
  description: string;
  total: number;
  alreadyImported: number;
}

/** The result of importing one batch of a pack. */
export interface ExercisePackImportBatch {
  packId: string;
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  failures: { name: string; reason: string }[];
  processed: number;
  /** Where the next batch starts, or null once the pack is finished. */
  nextOffset: number | null;
  done: boolean;
}

export const fetchExercisePacks = async (): Promise<ExercisePack[]> => {
  return apiFetch<ExercisePack[]>({
    endpoint: '/api/exercises/packs',
    serviceName: SERVICE_NAME,
    operation: 'fetch exercise packs',
  });
};

/**
 * A batch is up to ten exercises imported one after another, each of which
 * downloads a pair of photos from an upstream host. That routinely outlasts the
 * default API timeout, and a timeout here aborts the client's walk while the
 * server keeps going — so this request gets its own, much longer, budget.
 */
const PACK_IMPORT_TIMEOUT_MS = 180_000;

/**
 * Imports one batch. A whole pack is a few hundred image downloads, so the
 * caller walks it batch by batch rather than holding one long request open.
 */
export const importExercisePackBatch = async (
  packId: string,
  offset: number,
  limit: number,
): Promise<ExercisePackImportBatch> => {
  return apiFetch<ExercisePackImportBatch>({
    endpoint: `/api/exercises/packs/${packId}/import`,
    method: 'POST',
    body: { offset, limit },
    timeoutMs: PACK_IMPORT_TIMEOUT_MS,
    serviceName: SERVICE_NAME,
    operation: 'import exercise pack batch',
  });
};
