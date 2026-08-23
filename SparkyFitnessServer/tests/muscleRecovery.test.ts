import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeMuscleFreshness,
  MUSCLES,
  RECOVERY_TUNABLES,
  type MuscleFatigueInput,
  type MuscleFreshness,
} from '@workspace/shared';
import workoutRecommendationRepository from '../models/workoutRecommendationRepository.js';
import { getClient } from '../db/poolManager.js';

vi.mock('../db/poolManager', () => ({
  getClient: vi.fn(),
}));

const TODAY = '2026-08-23';

function entry(overrides: Partial<MuscleFatigueInput>): MuscleFatigueInput {
  return {
    entryDate: TODAY,
    primaryMuscles: [],
    secondaryMuscles: [],
    workingSetCount: 0,
    ...overrides,
  };
}

function byMuscle(results: MuscleFreshness[], muscle: string): MuscleFreshness {
  const found = results.find((result) => result.muscle === muscle);
  if (!found) throw new Error(`No result for ${muscle}`);
  return found;
}

describe('computeMuscleFreshness', () => {
  it('covers the whole canonical vocabulary, untrained muscles at 1.0', () => {
    const results = computeMuscleFreshness([], TODAY);

    expect(results).toHaveLength(MUSCLES.length);
    expect(results.map((r) => r.muscle)).toEqual([...MUSCLES]);
    for (const result of results) {
      expect(result.freshness).toBe(1);
      expect(result.fatigueSets).toBe(0);
      expect(result.lastTrained).toBeNull();
    }
  });

  it('drives freshness to 0 at exactly fullFatigueSets', () => {
    const results = computeMuscleFreshness(
      [
        entry({
          primaryMuscles: ['chest'],
          workingSetCount: RECOVERY_TUNABLES.fullFatigueSets,
        }),
      ],
      TODAY
    );

    const chest = byMuscle(results, 'chest');
    expect(chest.fatigueSets).toBe(RECOVERY_TUNABLES.fullFatigueSets);
    expect(chest.freshness).toBe(0);
    expect(chest.lastTrained).toBe(TODAY);
  });

  it('saturates rather than going negative past fullFatigueSets', () => {
    const results = computeMuscleFreshness(
      [
        entry({
          primaryMuscles: ['chest'],
          workingSetCount: RECOVERY_TUNABLES.fullFatigueSets * 5,
        }),
      ],
      TODAY
    );

    const chest = byMuscle(results, 'chest');
    expect(chest.freshness).toBe(0);
    // The raw accumulation is preserved even though freshness clamps — the
    // generator needs to tell "cooked" from "annihilated".
    expect(chest.fatigueSets).toBe(RECOVERY_TUNABLES.fullFatigueSets * 5);
  });

  it('halves fatigue at exactly one half-life', () => {
    const results = computeMuscleFreshness(
      [
        entry({
          entryDate: '2026-08-21', // TODAY - halfLifeDays
          primaryMuscles: ['lats'],
          workingSetCount: 8,
        }),
      ],
      TODAY
    );

    expect(RECOVERY_TUNABLES.halfLifeDays).toBe(2);
    expect(byMuscle(results, 'lats').fatigueSets).toBe(4);
  });

  it('halves again at each further half-life', () => {
    const results = computeMuscleFreshness(
      [
        entry({
          entryDate: '2026-08-19', // TODAY - 2 half-lives
          primaryMuscles: ['lats'],
          workingSetCount: 8,
        }),
      ],
      TODAY
    );

    expect(byMuscle(results, 'lats').fatigueSets).toBe(2);
  });

  it('counts a secondary muscle at secondaryWeight', () => {
    const results = computeMuscleFreshness(
      [
        entry({
          primaryMuscles: ['chest'],
          secondaryMuscles: ['triceps'],
          workingSetCount: 6,
        }),
      ],
      TODAY
    );

    expect(byMuscle(results, 'chest').fatigueSets).toBe(6);
    expect(byMuscle(results, 'triceps').fatigueSets).toBe(
      6 * RECOVERY_TUNABLES.secondaryWeight
    );
    expect(byMuscle(results, 'triceps').lastTrained).toBe(TODAY);
  });

  it('charges a muscle listed as both primary and secondary only once', () => {
    const results = computeMuscleFreshness(
      [
        entry({
          primaryMuscles: ['chest'],
          secondaryMuscles: ['chest', 'triceps'],
          workingSetCount: 4,
        }),
      ],
      TODAY
    );

    expect(byMuscle(results, 'chest').fatigueSets).toBe(4);
  });

  it('sums fatigue across entries', () => {
    const results = computeMuscleFreshness(
      [
        entry({ primaryMuscles: ['quadriceps'], workingSetCount: 3 }),
        entry({
          entryDate: '2026-08-21',
          primaryMuscles: ['quadriceps'],
          workingSetCount: 4,
        }),
      ],
      TODAY
    );

    // 3 fresh + 4 halved once.
    expect(byMuscle(results, 'quadriceps').fatigueSets).toBe(5);
    expect(byMuscle(results, 'quadriceps').lastTrained).toBe(TODAY);
  });

  it('decays across a month boundary by calendar days, not by month arithmetic', () => {
    const results = computeMuscleFreshness(
      [
        entry({
          entryDate: '2026-07-30',
          primaryMuscles: ['glutes'],
          workingSetCount: 8,
        }),
      ],
      '2026-08-01' // two calendar days later, one half-life
    );

    expect(byMuscle(results, 'glutes').fatigueSets).toBe(4);
  });

  it('decays across a leap day without drifting', () => {
    const results = computeMuscleFreshness(
      [
        entry({
          entryDate: '2028-02-28',
          primaryMuscles: ['calves'],
          workingSetCount: 8,
        }),
      ],
      '2028-03-01' // 2028 is a leap year: Feb 29 sits between these
    );

    expect(byMuscle(results, 'calves').fatigueSets).toBe(4);
  });

  it('marks a set-less entry as trained without adding fatigue', () => {
    const results = computeMuscleFreshness(
      [entry({ primaryMuscles: ['calves'], workingSetCount: 0 })],
      TODAY
    );

    const calves = byMuscle(results, 'calves');
    expect(calves.fatigueSets).toBe(0);
    expect(calves.freshness).toBe(1);
    // A run trained the calves; it just did not log sets, so it cannot say how
    // hard. The date is real information even when the volume is not.
    expect(calves.lastTrained).toBe(TODAY);
  });

  it('keeps the most recent training date, not the last one seen', () => {
    const results = computeMuscleFreshness(
      [
        entry({ entryDate: TODAY, primaryMuscles: ['biceps'] }),
        entry({ entryDate: '2026-08-10', primaryMuscles: ['biceps'] }),
      ],
      TODAY
    );

    expect(byMuscle(results, 'biceps').lastTrained).toBe(TODAY);
  });

  it('clamps a future-dated entry to today instead of amplifying it', () => {
    const results = computeMuscleFreshness(
      [
        entry({
          entryDate: '2026-08-30', // a week ahead of TODAY
          primaryMuscles: ['shoulders'],
          workingSetCount: 5,
        }),
      ],
      TODAY
    );

    // 0.5^(-7/2) would be 11.3x, zeroing out a muscle that was never trained.
    expect(byMuscle(results, 'shoulders').fatigueSets).toBe(5);
  });

  it('folds non-canonical casing and whitespace onto the canonical muscle', () => {
    const results = computeMuscleFreshness(
      [
        entry({
          primaryMuscles: ['  Lower Back '],
          workingSetCount: 5,
        }),
      ],
      TODAY
    );

    expect(byMuscle(results, 'lower back').fatigueSets).toBe(5);
  });

  it('ignores muscles outside the requested vocabulary', () => {
    const results = computeMuscleFreshness(
      [entry({ primaryMuscles: ['rotator cuff'], workingSetCount: 9 })],
      TODAY
    );

    expect(results.every((result) => result.freshness === 1)).toBe(true);
    expect(results.some((result) => result.muscle === 'rotator cuff')).toBe(
      false
    );
  });

  it('honours an explicit muscle list, de-duplicated and in order', () => {
    const results = computeMuscleFreshness([], TODAY, [
      'chest',
      'Chest',
      'lats',
    ]);

    expect(results.map((result) => result.muscle)).toEqual(['chest', 'lats']);
  });

  it('treats a malformed set count as zero volume rather than NaN', () => {
    const results = computeMuscleFreshness(
      [
        entry({
          primaryMuscles: ['traps'],
          workingSetCount: Number.NaN,
        }),
        entry({ primaryMuscles: ['traps'], workingSetCount: 2 }),
      ],
      TODAY
    );

    expect(byMuscle(results, 'traps').fatigueSets).toBe(2);
  });

  it('is deterministic: the same inputs give byte-identical output', () => {
    const inputs = [
      entry({
        entryDate: '2026-08-19',
        primaryMuscles: ['chest', 'shoulders'],
        secondaryMuscles: ['triceps'],
        workingSetCount: 7,
      }),
      entry({
        entryDate: '2026-08-22',
        primaryMuscles: ['lats'],
        secondaryMuscles: ['biceps', 'middle back'],
        workingSetCount: 5,
      }),
    ];

    expect(computeMuscleFreshness(inputs, TODAY)).toEqual(
      computeMuscleFreshness(inputs, TODAY)
    );
  });

  it('throws on an unplaceable entry date rather than scoring it as today', () => {
    // `exercise_entries.entry_date` is nullable, so this input is reachable if
    // a caller forgets to exclude it. Treating it as today would silently
    // charge a muscle for volume nobody could trace back to a session.
    expect(() =>
      computeMuscleFreshness(
        [
          entry({
            entryDate: 'not-a-date',
            primaryMuscles: ['chest'],
            workingSetCount: 5,
          }),
        ],
        TODAY
      )
    ).toThrow(/Invalid day string/);
  });
});

describe('workoutRecommendationRepository.getMuscleFatigueInputs', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockClient: any;

  beforeEach(() => {
    mockClient = { query: vi.fn(), release: vi.fn() };
    // @ts-expect-error mock typing
    getClient.mockResolvedValue(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const queryText = (): string => mockClient.query.mock.calls[0][0];

  it('scopes to the user and window, and releases the client', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });

    const result = await workoutRecommendationRepository.getMuscleFatigueInputs(
      'user-1',
      '2026-08-09',
      '2026-08-23'
    );

    expect(result).toEqual([]);
    expect(mockClient.query).toHaveBeenCalledWith(expect.any(String), [
      'user-1',
      '2026-08-09',
      '2026-08-23',
    ]);
    expect(queryText()).toContain('ee.user_id = $1');
    expect(queryText()).toContain('ee.entry_date >= $2::date');
    // Upper bound at today: without it a plan session prescribed for a future
    // day counts against today's freshness at full weight (the scorer clamps
    // future ages to zero, it does not exclude them).
    expect(queryText()).toContain('ee.entry_date <= $3::date');
    // The column is nullable and the scoring function throws on a date it
    // cannot place, so this guard is what keeps one bad row from taking the
    // whole endpoint down. The window bound happens to exclude NULLs too;
    // this does not depend on that staying true.
    expect(queryText()).toContain('ee.entry_date IS NOT NULL');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('excludes warm-up sets with the server-wide predicate, byte-identical', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });

    await workoutRecommendationRepository.getMuscleFatigueInputs(
      'user-1',
      '2026-08-09',
      '2026-08-23'
    );

    // Copied verbatim from models/exerciseEntry.ts:1380. If this assertion
    // fails, the two warm-up definitions have drifted and volume is being
    // counted differently in two places.
    expect(queryText()).toContain(
      "ees.set_type IS NULL\n                   OR regexp_replace(LOWER(ees.set_type), '[^a-z0-9]', '', 'g') NOT LIKE 'warmup%'"
    );
    expect(queryText()).toContain('COUNT(ees.id) FILTER');
  });

  it('counts plan-linked sets only once they are stamped performed', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });

    await workoutRecommendationRepository.getMuscleFatigueInputs(
      'user-1',
      '2026-08-09',
      '2026-08-23'
    );

    // Same "performed" rule as models/exerciseEntry.ts:1523 — plan-generated
    // entries insert their prescribed sets up front, and a prescription is
    // not fatigue.
    expect(queryText()).toContain(
      'ee.workout_plan_assignment_id IS NULL\n                   OR ees.completed_at IS NOT NULL'
    );
  });

  it('reads the entry snapshot columns, never joining the exercises catalog', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });

    await workoutRecommendationRepository.getMuscleFatigueInputs(
      'user-1',
      '2026-08-09',
      '2026-08-23'
    );

    expect(queryText()).toContain('ee.primary_muscles');
    expect(queryText()).toContain('ee.secondary_muscles');
    // The snapshot is the record of what was trained; it outlives edits and
    // deletes of the underlying exercise.
    expect(queryText()).not.toContain('JOIN exercises');
  });

  it('keeps set-less entries via the LEFT JOIN and orders deterministically', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });

    await workoutRecommendationRepository.getMuscleFatigueInputs(
      'user-1',
      '2026-08-09',
      '2026-08-23'
    );

    expect(queryText()).toContain('LEFT JOIN exercise_entry_sets');
    // Float summation is order-dependent; an unordered GROUP BY could make a
    // reproducible endpoint differ in its last bits between calls.
    expect(queryText()).toContain('ORDER BY ee.entry_date, ee.id');
  });

  it('parses the JSON-text muscle columns and normalizes the elements', async () => {
    mockClient.query.mockResolvedValue({
      rows: [
        {
          entry_date: '2026-08-22',
          primary_muscles: '["Chest", " triceps "]',
          secondary_muscles: '["shoulders"]',
          working_set_count: '4',
        },
      ],
    });

    const result = await workoutRecommendationRepository.getMuscleFatigueInputs(
      'user-1',
      '2026-08-09',
      '2026-08-23'
    );

    expect(result).toEqual([
      {
        entryDate: '2026-08-22',
        primaryMuscles: ['chest', 'triceps'],
        secondaryMuscles: ['shoulders'],
        // COUNT is bigint, which node-postgres returns as a string.
        workingSetCount: 4,
      },
    ]);
  });

  it('accepts an already-parsed array, as a jsonb column would return', async () => {
    mockClient.query.mockResolvedValue({
      rows: [
        {
          entry_date: '2026-08-22',
          primary_muscles: ['Chest'],
          secondary_muscles: ['triceps'],
          working_set_count: 2,
        },
      ],
    });

    const result = await workoutRecommendationRepository.getMuscleFatigueInputs(
      'user-1',
      '2026-08-09',
      '2026-08-23'
    );

    // The columns are TEXT today. If they are ever migrated to jsonb, this
    // path is what stops every muscle list from quietly becoming empty.
    expect(result[0]).toEqual({
      entryDate: '2026-08-22',
      primaryMuscles: ['chest'],
      secondaryMuscles: ['triceps'],
      workingSetCount: 2,
    });
  });

  it('survives null, malformed and non-array muscle columns', async () => {
    mockClient.query.mockResolvedValue({
      rows: [
        {
          entry_date: '2026-08-22',
          primary_muscles: null,
          secondary_muscles: 'chest,triceps', // legacy comma text, not JSON
          working_set_count: '3',
        },
        {
          entry_date: '2026-08-21',
          primary_muscles: '"chest"', // valid JSON, wrong shape
          secondary_muscles: '[1, null, "lats", ""]',
          working_set_count: null,
        },
      ],
    });

    const result = await workoutRecommendationRepository.getMuscleFatigueInputs(
      'user-1',
      '2026-08-09',
      '2026-08-23'
    );

    expect(result).toEqual([
      {
        entryDate: '2026-08-22',
        primaryMuscles: [],
        secondaryMuscles: [],
        workingSetCount: 3,
      },
      {
        entryDate: '2026-08-21',
        primaryMuscles: [],
        secondaryMuscles: ['lats'],
        workingSetCount: 0,
      },
    ]);
  });

  it('releases the client when the query throws', async () => {
    mockClient.query.mockRejectedValue(new Error('boom'));

    await expect(
      workoutRecommendationRepository.getMuscleFatigueInputs(
        'user-1',
        '2026-08-09',
        '2026-08-23'
      )
    ).rejects.toThrow('boom');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
