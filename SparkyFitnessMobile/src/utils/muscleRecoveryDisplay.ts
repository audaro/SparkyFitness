/**
 * Display layer over the recovery engine (`shared/src/utils/muscleRecovery.ts`).
 *
 * The wire carries `freshness` as **0.0–1.0**; every surface renders it as a
 * whole percentage. Both conversions live here so the recovery strip, the
 * muscle grid and anything after them cannot disagree about what "84%" means.
 */

/** Freshness bands, coarse on purpose — this is a glanceable signal, not a gauge. */
export type FreshnessTone = 'fresh' | 'moderate' | 'fatigued';

/**
 * `freshness` (0.0–1.0) as a whole percentage.
 *
 * Clamped because the value is rendered as a bar width: a response outside the
 * schema's range would otherwise draw a bar past the end of its track.
 */
export function freshnessPercent(freshness: number): number {
  if (!Number.isFinite(freshness)) return 0;
  return Math.round(Math.min(1, Math.max(0, freshness)) * 100);
}

/**
 * Which band a freshness score falls in.
 *
 * Takes the 0.0–1.0 score, not the percentage, so there is exactly one place
 * the scale is interpreted.
 */
export function freshnessTone(freshness: number): FreshnessTone {
  if (freshness >= 0.66) return 'fresh';
  if (freshness >= 0.33) return 'moderate';
  return 'fatigued';
}
