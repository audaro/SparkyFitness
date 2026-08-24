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
    serviceName: SERVICE_NAME,
    operation: 'import exercise pack batch',
  });
};
