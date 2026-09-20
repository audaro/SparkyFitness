import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  compareProgressPhotos,
  fetchAlignedPair,
  fetchVisionAvailability,
} from '../services/api/progressPhotoComparisonsApi';
import {
  alignedPairQueryKey,
  progressPhotoComparisonQueryKey,
  visionAvailabilityQueryKey,
} from './queryKeys';

/** How long a data URI stays worth holding. */
const ALIGNED_STALE_MS = 30 * 60 * 1000;

/**
 * Is progress-photo comparison available on this server at all?
 *
 * The sidecar is optional, so this is the difference between hiding the
 * feature and offering a button that always fails. Cached for the session:
 * whether a container exists is not something that changes while someone
 * scrolls a gallery.
 */
export function useVisionAvailability(enabled = true) {
  const query = useQuery({
    queryKey: visionAvailabilityQueryKey,
    queryFn: fetchVisionAvailability,
    enabled,
    staleTime: Infinity,
    retry: false,
  });

  return {
    /** True only when the sidecar is both installed and answering. */
    isAvailable: query.data?.configured === true && query.data.ok === true,
    /** Installed but not answering — worth saying, unlike "not installed". */
    isDown: query.data?.configured === true && query.data.ok === false,
    isLoading: query.isLoading,
  };
}

export interface AlignedPhotoPair {
  before: string;
  after: string;
  /** Width / height of the shared frame, for sizing the slider. */
  aspectRatio: number;
}

/**
 * The two photos of a pair, warped into one frame and ready to draw.
 *
 * Two requests, deliberately in that order and deliberately separate: the
 * comparison is small, cached server-side and worth keeping, while the aligned
 * frames are hundreds of kilobytes that only a screen actually drawing them
 * should ever pull. Nothing here runs until `enabled` — a gallery must not
 * spend a sidecar round trip on a pair nobody asked to see.
 */
export function useAlignedPhotoPair(
  beforePhotoId: string | null,
  afterPhotoId: string | null,
  enabled: boolean
) {
  const canCompare = Boolean(beforePhotoId && afterPhotoId && enabled);

  const comparison = useQuery({
    queryKey: progressPhotoComparisonQueryKey(
      beforePhotoId ?? '',
      afterPhotoId ?? ''
    ),
    queryFn: () => compareProgressPhotos(beforePhotoId!, afterPhotoId!),
    enabled: canCompare,
    // A pair the model could not read, or two photos of different angles, is a
    // durable answer about these two files. Retrying spends a pose inference
    // to be told the same thing.
    retry: false,
  });

  const comparisonId = comparison.data?.id ?? null;

  const aligned = useQuery({
    queryKey: alignedPairQueryKey(comparisonId ?? ''),
    queryFn: () => fetchAlignedPair(comparisonId!),
    enabled: canCompare && comparisonId !== null,
    staleTime: ALIGNED_STALE_MS,
    retry: false,
  });

  const pair = useMemo<AlignedPhotoPair | null>(() => {
    const data = aligned.data;
    if (!data) return null;
    const [width, height] = data.frame;
    return {
      before: `data:image/jpeg;base64,${data.before_jpeg}`,
      after: `data:image/jpeg;base64,${data.after_jpeg}`,
      // Both frames are the before photo's size by construction, so one ratio
      // describes the pair. Sizing the two layers independently would scale
      // them differently and draw a change that is not there.
      aspectRatio: height > 0 ? width / height : 3 / 4,
    };
  }, [aligned.data]);

  return {
    pair,
    comparison: comparison.data ?? null,
    isLoading: canCompare && (comparison.isPending || aligned.isPending),
    /** The first failure of the two, so a caller can say which step failed. */
    error: comparison.error ?? aligned.error ?? null,
  };
}
