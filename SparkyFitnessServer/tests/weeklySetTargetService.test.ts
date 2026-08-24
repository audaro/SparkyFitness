import { vi, beforeEach, describe, expect, it } from 'vitest';
import coachProfileRepository from '../models/coachProfileRepository.js';
import workoutRecommendationRepository from '../models/workoutRecommendationRepository.js';
import weeklySetTargetService from '../services/weeklySetTargetService.js';

vi.mock('../models/coachProfileRepository.js', () => ({
  default: {
    getCoachProfile: vi.fn(),
    mergeWeeklySetTargets: vi.fn(),
    upsertCoachProfile: vi.fn(),
  },
}));
vi.mock('../models/workoutRecommendationRepository.js', () => ({
  default: {
    getWeeklySetCountInputs: vi.fn(),
  },
}));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn().mockResolvedValue('UTC'),
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocked(coachProfileRepository.getCoachProfile).mockResolvedValue({
    training_days_per_week: 4,
    weekly_set_targets: {},
  });
  mocked(coachProfileRepository.mergeWeeklySetTargets).mockResolvedValue({});
  mocked(
    workoutRecommendationRepository.getWeeklySetCountInputs
  ).mockResolvedValue([]);
});

describe('updateWeeklySetTargets', () => {
  // The merge has to happen in SQL. A read-modify-write in JavaScript loses an
  // edit whenever two clients overlap: the phone saving push and the browser
  // saving legs both read the same map, and the second writer puts back a copy
  // that never saw the first change.
  it('hands only the changed groups to the atomic merge', async () => {
    await weeklySetTargetService.updateWeeklySetTargets(
      'user-1',
      { legs: 20 },
      0
    );
    expect(coachProfileRepository.mergeWeeklySetTargets).toHaveBeenCalledWith(
      'user-1',
      { legs: 20 }
    );
    expect(coachProfileRepository.upsertCoachProfile).not.toHaveBeenCalled();
  });

  it('rounds fractional targets before storing them', async () => {
    await weeklySetTargetService.updateWeeklySetTargets(
      'user-1',
      { push: 12.6 },
      0
    );
    expect(coachProfileRepository.mergeWeeklySetTargets).toHaveBeenCalledWith(
      'user-1',
      { push: 13 }
    );
  });

  it('writes nothing when the patch names no group', async () => {
    await weeklySetTargetService.updateWeeklySetTargets('user-1', {}, 0);
    expect(coachProfileRepository.mergeWeeklySetTargets).not.toHaveBeenCalled();
  });

  it('returns the recomputed screen rather than the patch', async () => {
    const result = await weeklySetTargetService.updateWeeklySetTargets(
      'user-1',
      { legs: 20 },
      2
    );
    expect(result.current.groups).toHaveLength(4);
    expect(result.history).toHaveLength(2);
  });
});

describe('getWeeklySetTargets', () => {
  it('never queries past today, so a future-dated entry cannot fill the ring', async () => {
    await weeklySetTargetService.getWeeklySetTargets('user-1', 3);
    const call = mocked(workoutRecommendationRepository.getWeeklySetCountInputs)
      .mock.calls[0];
    const [, rangeStart, rangeEnd] = call as [string, string, string];
    const today = new Date().toISOString().slice(0, 10);
    expect(rangeEnd).toBe(today);
    expect(rangeStart <= rangeEnd).toBe(true);
  });

  it('reports derived targets as non-custom until the user sets one', async () => {
    const result = await weeklySetTargetService.getWeeklySetTargets(
      'user-1',
      0
    );
    expect(result.targets_are_custom).toBe(false);
  });

  it('reports stored targets as custom', async () => {
    mocked(coachProfileRepository.getCoachProfile).mockResolvedValue({
      training_days_per_week: 4,
      weekly_set_targets: { legs: 20 },
    });
    const result = await weeklySetTargetService.getWeeklySetTargets(
      'user-1',
      0
    );
    expect(result.targets_are_custom).toBe(true);
    expect(
      result.current.groups.find((group) => group.group === 'legs')?.target
    ).toBe(20);
  });
});
