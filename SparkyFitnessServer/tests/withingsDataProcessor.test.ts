import { vi, beforeEach, describe, expect, it } from 'vitest';
import exerciseRepository from '../models/exercise.js';
import exerciseEntryRepository from '../models/exerciseEntry.js';
import measurementRepository from '../models/measurementRepository.js';
import { log } from '../config/logging.js';
import {
  processWithingsMeasures,
  processWithingsWorkouts,
} from '../integrations/withings/withingsDataProcessor.js';

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../models/measurementRepository.js', () => ({
  default: { upsertCheckInMeasurements: vi.fn() },
}));
vi.mock('../models/exercise.js', () => ({
  default: {
    getExerciseBySourceAndSourceId: vi.fn(),
    searchExercises: vi.fn(),
    createExercise: vi.fn(),
  },
}));
vi.mock('../models/exerciseEntry.js', () => ({
  default: {
    deleteExerciseEntriesByEntrySourceAndDate: vi.fn(),
    createExerciseEntry: vi.fn(),
  },
}));
vi.mock('../models/sleepRepository.js', () => ({ default: {} }));
vi.mock('../models/activityDetailsRepository.js', () => ({
  default: { createActivityDetail: vi.fn() },
}));

const UID = 'user-1';
const CID = 'user-1';

describe('processWithingsWorkouts duration units', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(
      exerciseRepository.getExerciseBySourceAndSourceId
    ).mockResolvedValue({ id: 'exercise-1', name: 'Run' });
    vi.mocked(exerciseEntryRepository.createExerciseEntry).mockResolvedValue({
      id: 'entry-1',
    });
  });

  it('stores entry duration in minutes and set duration in integer seconds (issue #1903)', async () => {
    const startdate = 1750000000;
    await processWithingsWorkouts(UID, CID, [
      {
        startdate,
        enddate: startdate + 1800,
        category: 2,
        data: {
          calories: 300,
          distance: 5000,
          steps: 4000,
          intensity: 50,
          hr_average: 140,
        },
      },
    ] as Parameters<typeof processWithingsWorkouts>[2]);

    expect(exerciseEntryRepository.createExerciseEntry).toHaveBeenCalledWith(
      UID,
      expect.objectContaining({
        duration_minutes: 30,
        sets: [expect.objectContaining({ duration: 1800 })],
      }),
      CID,
      'Withings'
    );
  });
});

describe('processWithingsMeasures malformed payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(
      measurementRepository.upsertCheckInMeasurements
    ).mockResolvedValue(undefined);
  });

  // Withings does not guarantee `measures` on every group. Before the guard,
  // a single malformed group threw a TypeError out of the loop and aborted the
  // whole sync, discarding every later group in the same batch.
  it('skips a group with no measures and still processes the rest', async () => {
    const timestamp = 1750000000;
    await expect(
      processWithingsMeasures(UID, CID, [
        { category: 1, date: timestamp },
        { category: 1, date: timestamp, measures: null },
        {
          category: 1,
          date: timestamp,
          measures: [{ type: 1, value: 805, unit: -1 }],
        },
      ] as Parameters<typeof processWithingsMeasures>[2])
    ).resolves.not.toThrow();

    // The one well-formed group still landed.
    expect(
      measurementRepository.upsertCheckInMeasurements
    ).toHaveBeenCalledTimes(1);
    expect(
      measurementRepository.upsertCheckInMeasurements
    ).toHaveBeenCalledWith(
      UID,
      CID,
      expect.any(String),
      expect.objectContaining({ weight: 80.5 })
    );
    expect(vi.mocked(log)).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('Missing or malformed measures')
    );
  });
});
