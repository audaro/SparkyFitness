import { apiFetch } from './apiClient';
import { getAppLanguageCode } from '../../localization/i18n';
import { transformExerciseRow } from './exerciseApi';
import type { Exercise } from '../../types/exercise';
import type { PaginatedExternalExerciseSearchResult } from '../../types/externalExercises';

export async function searchExternalExercises(
  query: string,
  providerType: string,
  providerId: string,
  page = 1,
  pageSize = 20
): Promise<PaginatedExternalExerciseSearchResult> {
  // Resolved here rather than passed in so no call site can forget it: without
  // `language` the server falls back to English and localized queries return
  // nothing (searching "Beinpresse" against wger yields an empty list).
  const params = new URLSearchParams({
    query,
    providerType,
    providerId,
    page: String(page),
    pageSize: String(pageSize),
    language: getAppLanguageCode(),
  });

  return apiFetch<PaginatedExternalExerciseSearchResult>({
    endpoint: `/api/exercises/search-external?${params.toString()}`,
    serviceName: 'External Exercise Search',
    operation: 'search external exercises',
  });
}

// Must match the cases `importExercise` switches on below. Nutritionix is
// deliberately absent: mobile has no import path for it, so its search
// results can be previewed but not added.
const IMPORTABLE_EXERCISE_SOURCES = ['wger', 'free-exercise-db'] as const;

export function isImportableExerciseSource(source: string): boolean {
  return (IMPORTABLE_EXERCISE_SOURCES as readonly string[]).includes(source);
}

export async function importExercise(
  source: string,
  externalId: string
): Promise<Exercise> {
  // Server stores `images` as a JSON-stringified array; transformExerciseRow
  // parses it back so callers can index it as string[] (#1353 follow-up).
  switch (source) {
    case 'wger': {
      const row = await apiFetch<Record<string, unknown>>({
        endpoint: '/api/exercises/add-external',
        serviceName: 'External Exercise Search',
        operation: 'import wger exercise',
        method: 'POST',
        // Without `language` the server imports the English name even when the
        // result was found in another language (`language || 'en'` server-side).
        body: {
          wgerExerciseId: Number(externalId),
          language: getAppLanguageCode(),
        },
      });
      return transformExerciseRow(row);
    }

    case 'free-exercise-db': {
      const row = await apiFetch<Record<string, unknown>>({
        endpoint: '/api/freeexercisedb/add',
        serviceName: 'External Exercise Search',
        operation: 'import Free Exercise DB exercise',
        method: 'POST',
        body: { exerciseId: externalId },
      });
      return transformExerciseRow(row);
    }

    default:
      throw new Error(`Unsupported exercise source: ${source}`);
  }
}
