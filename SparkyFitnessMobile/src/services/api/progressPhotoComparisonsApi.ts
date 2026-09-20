import { apiFetch } from './apiClient';
import type { AlignedPair, ComparisonResponse } from '@workspace/shared';

const SERVICE = 'Progress Photo Comparisons API';

/** Whether this server has the vision sidecar at all, and whether it is up. */
export interface VisionAvailability {
  configured: boolean;
  ok: boolean;
  engine: string | null;
}

/**
 * The comparison feature is optional server-side, so every screen that offers
 * it asks this first rather than discovering the absence as a failed compare.
 */
export const fetchVisionAvailability = async (): Promise<VisionAvailability> =>
  apiFetch<VisionAvailability>({
    endpoint: '/api/progress-photo-comparisons/status',
    serviceName: SERVICE,
    operation: 'check vision availability',
  });

/**
 * Compare two photos, or return the pair already compared.
 *
 * Idempotent server-side: the same pair answers from its stored row, so this
 * is safe to call whenever a screen needs a comparison id and cheap whenever
 * it has been called before.
 */
export const compareProgressPhotos = async (
  beforePhotoId: string,
  afterPhotoId: string
): Promise<ComparisonResponse> =>
  apiFetch<ComparisonResponse>({
    endpoint: '/api/progress-photo-comparisons',
    method: 'POST',
    body: { before_photo_id: beforePhotoId, after_photo_id: afterPhotoId },
    serviceName: SERVICE,
    operation: 'compare progress photos',
  });

/**
 * Both frames of a comparison, warped into one geometry.
 *
 * The bytes ride in the JSON rather than behind two image URLs because the
 * server produces both frames from a single pass over the pair. That makes
 * this a heavy response — hundreds of kilobytes — so it belongs behind an
 * explicit request to view the pair, never on a list render.
 */
export const fetchAlignedPair = async (
  comparisonId: string
): Promise<AlignedPair> =>
  apiFetch<AlignedPair>({
    endpoint: `/api/progress-photo-comparisons/${encodeURIComponent(comparisonId)}/aligned`,
    serviceName: SERVICE,
    operation: 'fetch aligned pair',
  });
