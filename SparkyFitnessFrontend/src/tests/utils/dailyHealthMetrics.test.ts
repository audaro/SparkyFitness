import { DailyHealthMetrics } from '@workspace/shared';
import { selectDisplayableHealthMetrics } from '@/utils/dailyHealthMetrics';

// daily_health_metrics holds one row per provider per day and the API orders
// only by entry_date, so the first row for a date is arbitrary. Taking index 0
// hid the Daily Wearable Health Summary card behind an empty shell row for any
// user with more than one provider connected (issue #2471 follow-up).
const row = (overrides: Partial<DailyHealthMetrics>): DailyHealthMetrics =>
  ({
    source_provider: 'garmin',
    body_battery_highest: null,
    avg_stress_level: null,
    resting_heart_rate: null,
    vo2_max: null,
    training_readiness_score: null,
    acute_training_load: null,
    weekly_training_load: null,
    ...overrides,
  }) as DailyHealthMetrics;

describe('selectDisplayableHealthMetrics', () => {
  it('skips empty provider rows and returns the one with data', () => {
    const selected = selectDisplayableHealthMetrics([
      row({ source_provider: 'healthkit' }),
      row({ source_provider: 'polar', resting_heart_rate: 54 }),
      row({ source_provider: 'garmin' }),
    ]);

    expect(selected?.source_provider).toBe('polar');
    expect(selected?.resting_heart_rate).toBe(54);
  });

  it('selects provider row when acute_training_load is present', () => {
    const selected = selectDisplayableHealthMetrics([
      row({ source_provider: 'polar', acute_training_load: 45.2 }),
    ]);

    expect(selected?.source_provider).toBe('polar');
    expect(selected?.acute_training_load).toBe(45.2);
  });

  it('returns undefined when no provider reported a displayable metric', () => {
    expect(
      selectDisplayableHealthMetrics([
        row({ source_provider: 'healthkit' }),
        row({ source_provider: 'garmin' }),
      ])
    ).toBeUndefined();
  });

  it('treats zero as a real reading, not missing data', () => {
    const selected = selectDisplayableHealthMetrics([
      row({ source_provider: 'garmin', body_battery_highest: 0 }),
    ]);

    expect(selected?.source_provider).toBe('garmin');
  });

  it('handles an undefined or empty list', () => {
    expect(selectDisplayableHealthMetrics(undefined)).toBeUndefined();
    expect(selectDisplayableHealthMetrics([])).toBeUndefined();
  });

  it('ignores fields the card does not display as headline values', () => {
    expect(
      selectDisplayableHealthMetrics([
        row({
          source_provider: 'polar',
          total_steps: 8154,
        } as Partial<DailyHealthMetrics>),
      ])
    ).toBeUndefined();
  });
});
