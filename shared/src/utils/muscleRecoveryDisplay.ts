/**
 * Display layer over the recovery engine (`./muscleRecovery.ts`).
 *
 * The wire carries `freshness` as **0.0–1.0**; every surface renders it as a
 * whole percentage. Both conversions live here so the mobile recovery strip,
 * the mobile muscle grid, the web recovery card and anything after them cannot
 * disagree about what "84%" means or about where "fresh" stops.
 *
 * In `shared/` rather than in one client because the bands are a shared reading
 * of the same wire value: a threshold that drifted between platforms would call
 * the same muscle fresh on the phone and fatigued on the web.
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
