import { DailyHealthMetrics } from '@workspace/shared';

/**
 * Fields the Daily Wearable Health Summary card actually renders as a headline
 * value. A row carrying none of these is an empty shell for that provider.
 */
const DISPLAYABLE_FIELDS = [
  'body_battery_highest',
  'avg_stress_level',
  'resting_heart_rate',
  'vo2_max',
  'training_readiness_score',
  'acute_training_load',
  'weekly_training_load',
  // The Training Load tile also renders these two, and Polar can report
  // tolerance/ratio without strain — omitting them here would skip an otherwise
  // displayable row and hide the card.
  'chronic_training_load',
  'acwr_ratio',
] as const satisfies readonly (keyof DailyHealthMetrics)[];

/**
 * Pick the daily_health_metrics row the wearable card should render.
 *
 * The table holds one row per provider per day, and the API orders only by
 * entry_date, so for a multi-provider user the first row is arbitrary -- often
 * an empty shell from a provider that synced something else that day (e.g. a
 * Garmin row holding only lactate_threshold, or a HealthKit row holding only
 * total_calories). Taking index 0 hid the card outright in that case.
 *
 * Returns the first row with something worth showing, or undefined when no
 * provider reported any of these metrics for the day. The card is
 * single-provider by design -- it badges metrics.source_provider -- so this
 * selects one row rather than merging several, which would mislabel the badge.
 */
export const selectDisplayableHealthMetrics = (
  metrics: DailyHealthMetrics[] | undefined
): DailyHealthMetrics | undefined =>
  metrics?.find((row) => DISPLAYABLE_FIELDS.some((f) => row[f] != null));
