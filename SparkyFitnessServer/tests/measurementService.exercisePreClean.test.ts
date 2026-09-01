import { beforeEach, describe, expect, it, vi } from 'vitest';
import measurementService from '../services/measurementService.js';
import exerciseEntryDb from '../models/exerciseEntry.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn(),
}));
vi.mock('../models/measurementRepository');
vi.mock('../models/userRepository');
vi.mock('../models/exercise');
vi.mock('../models/exerciseEntry');
vi.mock('../models/sleepRepository');
vi.mock('../models/waterContainerRepository');
vi.mock('../models/activityDetailsRepository');
vi.mock('../models/foodRepository');

// The exercise pre-clean is delete-then-insert by (source, day range). That
// only makes a re-sync idempotent when the client re-sends whole days; the
// mobile HealthKit sync sends what changed since its last run and keys every
// workout on the HealthKit uuid, so the range delete removed the morning's
// workout whenever the afternoon's arrived alone. Records that carry a
// source_id upsert in place and must skip the range delete.
describe('processHealthData exercise pre-clean', () => {
  const userId = 'user-123';
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadUserTimezone).mockResolvedValue('UTC');
  });

  const workout = (overrides: Record<string, unknown>) => ({
    type: 'Workout',
    date: '2026-08-28',
    timestamp: '2026-08-28T17:30:00Z',
    source: 'HealthKit',
    workoutType: 'Running',
    duration: 1800,
    ...overrides,
  });

  it('skips the range delete when every record of a source carries a source_id', async () => {
    await measurementService.processHealthData(
      [
        workout({ source_id: 'hk-uuid-1' }),
        workout({ source_id: 'hk-uuid-2', timestamp: '2026-08-28T19:00:00Z' }),
      ],
      userId,
      userId
    );

    expect(
      exerciseEntryDb.deleteExerciseEntriesByEntrySourceAndDate
    ).not.toHaveBeenCalled();
  });

  it('still range-deletes for a source whose records are not keyed', async () => {
    await measurementService.processHealthData(
      [workout({}), workout({ source_id: 'hk-uuid-2' })],
      userId,
      userId
    );

    expect(
      exerciseEntryDb.deleteExerciseEntriesByEntrySourceAndDate
    ).toHaveBeenCalledWith(userId, '2026-08-28', '2026-08-28', 'HealthKit');
  });

  it('decides per source', async () => {
    await measurementService.processHealthData(
      [
        workout({ source_id: 'hk-uuid-1' }),
        workout({ source: 'Health Connect' }),
      ],
      userId,
      userId
    );

    expect(
      exerciseEntryDb.deleteExerciseEntriesByEntrySourceAndDate
    ).toHaveBeenCalledTimes(1);
    expect(
      exerciseEntryDb.deleteExerciseEntriesByEntrySourceAndDate
    ).toHaveBeenCalledWith(
      userId,
      '2026-08-28',
      '2026-08-28',
      'Health Connect'
    );
  });
});
