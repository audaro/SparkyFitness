import { aggregateByDay } from '../../../src/services/shared/dataAggregation';
import { aggregateByDay as healthkitAggregateByDay } from '../../../src/services/healthkit/dataAggregation';
import { aggregateByDay as healthconnectAggregateByDay } from '../../../src/services/healthconnect/dataAggregation';

import type { TransformedRecord } from '../../../src/types/healthRecords';

jest.mock('../../../src/services/LogService', () => ({
  addLog: jest.fn(),
}));

describe('platform re-exports', () => {
  test('both platform dataAggregation modules re-export the shared aggregateByDay', () => {
    expect(healthkitAggregateByDay).toBe(aggregateByDay);
    expect(healthconnectAggregateByDay).toBe(aggregateByDay);
  });
});

describe('aggregateByDay', () => {
  test('returns empty array for empty input', () => {
    const result = aggregateByDay([], 'running_speed', 'm/s', 'min-max-avg');
    expect(result).toEqual([]);
  });

  test('min-max-avg with multiple records across 2 days returns 3 records per day', () => {
    const records: TransformedRecord[] = [
      { value: 2.5, type: 'running_speed', date: '2024-01-15', unit: 'm/s', source: 'HealthKit' },
      { value: 3.0, type: 'running_speed', date: '2024-01-15', unit: 'm/s', source: 'HealthKit' },
      { value: 4.0, type: 'running_speed', date: '2024-01-15', unit: 'm/s', source: 'HealthKit' },
      { value: 5.0, type: 'running_speed', date: '2024-01-16', unit: 'm/s', source: 'HealthKit' },
      { value: 6.0, type: 'running_speed', date: '2024-01-16', unit: 'm/s', source: 'HealthKit' },
    ];

    const result = aggregateByDay(records, 'running_speed', 'm/s', 'min-max-avg');

    expect(result).toHaveLength(6);

    // Day 1: min=2.5, max=4.0, avg=(2.5+3.0+4.0)/3=3.17
    expect(result[0]).toEqual({ value: 2.5, type: 'running_speed_min', date: '2024-01-15', unit: 'm/s', source: 'HealthKit' });
    expect(result[1]).toEqual({ value: 4.0, type: 'running_speed_max', date: '2024-01-15', unit: 'm/s', source: 'HealthKit' });
    expect(result[2]).toEqual({ value: 3.17, type: 'running_speed_avg', date: '2024-01-15', unit: 'm/s', source: 'HealthKit' });

    // Day 2: min=5.0, max=6.0, avg=(5.0+6.0)/2=5.5
    expect(result[3]).toEqual({ value: 5.0, type: 'running_speed_min', date: '2024-01-16', unit: 'm/s', source: 'HealthKit' });
    expect(result[4]).toEqual({ value: 6.0, type: 'running_speed_max', date: '2024-01-16', unit: 'm/s', source: 'HealthKit' });
    expect(result[5]).toEqual({ value: 5.5, type: 'running_speed_avg', date: '2024-01-16', unit: 'm/s', source: 'HealthKit' });
  });

  test('min-max-avg with single record on a day sets min/max/avg all equal', () => {
    const records: TransformedRecord[] = [
      { value: 3.5, type: 'running_speed', date: '2024-01-15', unit: 'm/s', source: 'HealthKit' },
    ];

    const result = aggregateByDay(records, 'running_speed', 'm/s', 'min-max-avg');

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ value: 3.5, type: 'running_speed_min', date: '2024-01-15', unit: 'm/s', source: 'HealthKit' });
    expect(result[1]).toEqual({ value: 3.5, type: 'running_speed_max', date: '2024-01-15', unit: 'm/s', source: 'HealthKit' });
    expect(result[2]).toEqual({ value: 3.5, type: 'running_speed_avg', date: '2024-01-15', unit: 'm/s', source: 'HealthKit' });
  });

  test('sum strategy returns 1 record per day with summed value', () => {
    const records: TransformedRecord[] = [
      { value: 100, type: 'step', date: '2024-01-15', unit: 'count', source: 'HealthKit' },
      { value: 200, type: 'step', date: '2024-01-15', unit: 'count', source: 'HealthKit' },
      { value: 300, type: 'step', date: '2024-01-16', unit: 'count', source: 'HealthKit' },
    ];

    const result = aggregateByDay(records, 'step', 'count', 'sum');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ value: 300, type: 'step', date: '2024-01-15', unit: 'count', source: 'HealthKit' });
    expect(result[1]).toEqual({ value: 300, type: 'step', date: '2024-01-16', unit: 'count', source: 'HealthKit' });
  });

  test('sum strategy combines same-day hydration drinks into one daily water total (ml)', () => {
    // Hydration is synced as type 'water', which the server upserts per (date, source),
    // overwriting on conflict. Summing per day before upload prevents same-day drinks
    // from overwriting each other.
    const records: TransformedRecord[] = [
      { value: 200, type: 'water', date: '2024-01-15', unit: 'ml', source: 'HealthKit' },
      { value: 300, type: 'water', date: '2024-01-15', unit: 'ml', source: 'HealthKit' },
      { value: 250, type: 'water', date: '2024-01-16', unit: 'ml', source: 'HealthKit' },
    ];

    const result = aggregateByDay(records, 'water', 'ml', 'sum');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ value: 500, type: 'water', date: '2024-01-15', unit: 'ml', source: 'HealthKit' });
    expect(result[1]).toEqual({ value: 250, type: 'water', date: '2024-01-16', unit: 'ml', source: 'HealthKit' });
  });

  test('last strategy returns 1 record per day with the newest value (first in newest-first order)', () => {
    // Records arrive newest-first from HealthKit/Health Connect queries
    const records: TransformedRecord[] = [
      { value: 72, type: 'weight', date: '2024-01-15', unit: 'kg', source: 'HealthKit' }, // newest
      { value: 71, type: 'weight', date: '2024-01-15', unit: 'kg', source: 'HealthKit' },
      { value: 70, type: 'weight', date: '2024-01-15', unit: 'kg', source: 'HealthKit' }, // oldest
    ];

    const result = aggregateByDay(records, 'weight', 'kg', 'last');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ value: 72, type: 'weight', date: '2024-01-15', unit: 'kg', source: 'HealthKit' });
  });
});

describe('timezone metadata propagation', () => {
  test('aggregateByDay propagates record_timezone from input records', () => {
    const records: TransformedRecord[] = [
      { value: 100, type: 'step', date: '2024-01-15', unit: 'count', source: 'HealthKit', record_timezone: 'Asia/Tokyo' },
      { value: 200, type: 'step', date: '2024-01-15', unit: 'count', source: 'HealthKit', record_timezone: 'Asia/Tokyo' },
    ];
    const result = aggregateByDay(records, 'step', 'count', 'sum');
    expect(result).toHaveLength(1);
    expect(result[0].record_timezone).toBe('Asia/Tokyo');
  });

  test('aggregateByDay propagates record_utc_offset_minutes from input records', () => {
    const records: TransformedRecord[] = [
      { value: 72, type: 'weight', date: '2024-01-15', unit: 'kg', source: 'Health Connect', record_utc_offset_minutes: 540 },
    ];
    const result = aggregateByDay(records, 'weight', 'kg', 'last');
    expect(result).toHaveLength(1);
    expect(result[0].record_utc_offset_minutes).toBe(540);
  });

  test('aggregateByDay omits timezone fields when not present on input', () => {
    const records: TransformedRecord[] = [
      { value: 100, type: 'step', date: '2024-01-15', unit: 'count', source: 'HealthKit' },
    ];
    const result = aggregateByDay(records, 'step', 'count', 'sum');
    expect(result).toHaveLength(1);
    expect(result[0].record_timezone).toBeUndefined();
    expect(result[0].record_utc_offset_minutes).toBeUndefined();
  });
});
