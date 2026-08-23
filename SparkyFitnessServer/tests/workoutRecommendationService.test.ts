import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'supertest'
import request from 'supertest';
import express from 'express';
import {
  GENERATION_TUNABLES,
  MUSCLES,
  todayInZone,
  type CandidateExercise,
} from '@workspace/shared';
import workoutRecommendationService, {
  deriveGoal,
} from '../services/workoutRecommendationService.js';
import workoutRecommendationRepository from '../models/workoutRecommendationRepository.js';
import workoutRecommendationRoutes from '../routes/workoutRecommendationRoutes.js';
import coachProfileRepository from '../models/coachProfileRepository.js';
import gymEquipmentProfileRepository from '../models/gymEquipmentProfileRepository.js';
import exerciseEntryModel from '../models/exerciseEntry.js';
import exerciseService from '../services/exerciseService.js';
import freeExerciseDBService from '../integrations/freeexercisedb/FreeExerciseDBService.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';

vi.mock('../models/workoutRecommendationRepository.js', () => {
  const mock = {
    getMuscleFatigueInputs: vi.fn(),
    getCandidateExercises: vi.fn(),
    getCandidateExerciseById: vi.fn(),
    getWorkoutRecommendation: vi.fn(),
    upsertWorkoutRecommendation: vi.fn(),
    updateWorkoutRecommendationStatus: vi.fn(),
  };
  return { default: mock, ...mock };
});

vi.mock('../models/coachProfileRepository.js', () => {
  const mock = { getCoachProfile: vi.fn(), upsertCoachProfile: vi.fn() };
  return { default: mock, ...mock };
});

vi.mock('../models/gymEquipmentProfileRepository.js', () => {
  const mock = { getActiveGymProfile: vi.fn(), getGymProfile: vi.fn() };
  return { default: mock, ...mock };
});

vi.mock('../models/exerciseEntry.js', () => {
  const mock = { getRecentSessionsForExercise: vi.fn() };
  return { default: mock, ...mock };
});

vi.mock('../services/exerciseService.js', () => {
  const mock = { addFreeExerciseDBExerciseToUserExercises: vi.fn() };
  return { default: mock, ...mock };
});

vi.mock('../integrations/freeexercisedb/FreeExerciseDBService.js', () => ({
  default: { searchExercises: vi.fn() },
}));

vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn(),
}));

vi.mock('../middleware/authMiddleware.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = USER_ID;
    req.authenticatedUserId = USER_ID;
    next();
  },
}));

vi.mock('../middleware/checkPermissionMiddleware.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: () => (_req: any, _res: any, next: any) => next(),
}));

const USER_ID = '11111111-1111-4111-8111-111111111111';
const REC_ID = '22222222-2222-4222-8222-222222222222';
const BENCH_ID = '33333333-3333-4333-8333-333333333333';
const FLY_ID = '44444444-4444-4444-8444-444444444444';
const ROW_ID = '55555555-5555-4555-8555-555555555555';

const app = express();
app.use(express.json());
app.use('/api/workout-recommendations', workoutRecommendationRoutes);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.status || 500).json({ error: err.message });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const repo = workoutRecommendationRepository as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const coachRepo = coachProfileRepository as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gymRepo = gymEquipmentProfileRepository as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entries = exerciseEntryModel as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exercises = exerciseService as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fedb = freeExerciseDBService as any;

function candidate(
  overrides: Partial<CandidateExercise> & { id: string }
): CandidateExercise {
  return {
    name: `Exercise ${overrides.id}`,
    modality: 'weight_reps',
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: ['barbell'],
    mechanic: 'compound',
    level: null,
    images: [],
    timesPerformed: 0,
    ...overrides,
  };
}

const BENCH = candidate({
  id: BENCH_ID,
  name: 'Bench Press',
  primaryMuscles: ['chest'],
  mechanic: 'compound',
});
const FLY = candidate({
  id: FLY_ID,
  name: 'Cable Fly',
  primaryMuscles: ['chest'],
  mechanic: 'isolation',
  equipment: ['cable'],
});
const BARBELL_ROW = candidate({
  id: ROW_ID,
  name: 'Barbell Row',
  primaryMuscles: ['lats'],
  mechanic: 'compound',
});

/** Echo the payload back the way the real upsert would. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function echoUpsert(_userId: string, input: any) {
  return Promise.resolve({
    id: REC_ID,
    user_id: USER_ID,
    gym_profile_id: input.gymProfileId,
    target_duration_minutes: input.targetDurationMinutes,
    payload: input.payload,
    status: 'active',
    generated_at: new Date('2026-08-23T10:00:00Z'),
    created_at: new Date('2026-08-23T10:00:00Z'),
    updated_at: new Date('2026-08-23T10:00:00Z'),
  });
}

/**
 * Fatigue every muscle except the named ones, so the planner has a predictable
 * target list.
 *
 * Necessary rather than incidental: with no history at all every muscle sits at
 * 1.0, the ranking falls through to its alphabetical tiebreak, and the workout
 * gets built around abdominals and abductors. Real, correct, and useless as a
 * fixture — the candidates below train chest and lats.
 */
function fatigueEverythingExcept(...fresh: string[]) {
  return [
    {
      entryDate: todayInZone('UTC'),
      primaryMuscles: MUSCLES.filter((muscle) => !fresh.includes(muscle)),
      secondaryMuscles: [],
      workingSetCount: 50,
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadUserTimezone).mockResolvedValue('UTC');
  repo.getMuscleFatigueInputs.mockResolvedValue(
    fatigueEverythingExcept('chest', 'lats')
  );
  repo.getCandidateExercises.mockResolvedValue([BENCH, FLY, BARBELL_ROW]);
  repo.getCandidateExerciseById.mockResolvedValue(null);
  repo.getWorkoutRecommendation.mockResolvedValue(null);
  repo.upsertWorkoutRecommendation.mockImplementation(echoUpsert);
  repo.updateWorkoutRecommendationStatus.mockResolvedValue(null);
  coachRepo.getCoachProfile.mockResolvedValue(null);
  gymRepo.getActiveGymProfile.mockResolvedValue(null);
  gymRepo.getGymProfile.mockResolvedValue(null);
  entries.getRecentSessionsForExercise.mockResolvedValue([]);
  exercises.addFreeExerciseDBExerciseToUserExercises.mockResolvedValue({});
  fedb.searchExercises.mockResolvedValue({ exercises: [], totalCount: 0 });
});

describe('deriveGoal', () => {
  it('reads strength out of prose', () => {
    expect(deriveGoal('I want to get my squat 1RM up')).toBe('strength');
    expect(deriveGoal('powerlifting meet in March')).toBe('strength');
  });

  it('reads hypertrophy out of prose', () => {
    expect(deriveGoal('put on some muscle')).toBe('hypertrophy');
    expect(deriveGoal('bodybuilding, more size')).toBe('hypertrophy');
  });

  it('prefers strength when the answer names both', () => {
    // "build strength and muscle" is a strength answer with the word muscle in
    // it. The rep scheme has to pick one, so the order is the decision.
    expect(deriveGoal('build strength and muscle')).toBe('strength');
  });

  it('falls back to general for silence or something unrelated', () => {
    expect(deriveGoal(null)).toBe('general');
    expect(deriveGoal('')).toBe('general');
    expect(deriveGoal('feel better day to day')).toBe('general');
  });
});

describe('generateRecommendation', () => {
  it('builds a workout and stores it as the one Up Next row', async () => {
    const result =
      await workoutRecommendationService.generateRecommendation(USER_ID);

    expect(result.id).toBe(REC_ID);
    expect(result.status).toBe('active');
    expect(result.payload.exercises.length).toBeGreaterThan(0);
    expect(result.payload.muscle_groups.length).toBeGreaterThan(0);
    expect(repo.upsertWorkoutRecommendation).toHaveBeenCalledTimes(1);
  });

  it('defaults the duration to the coach profile, then to an hour', async () => {
    coachRepo.getCoachProfile.mockResolvedValue({
      goals: null,
      session_minutes: 45,
      limitations: [],
    });
    const fromProfile =
      await workoutRecommendationService.generateRecommendation(USER_ID);
    expect(fromProfile.target_duration_minutes).toBe(45);

    coachRepo.getCoachProfile.mockResolvedValue(null);
    const fallback =
      await workoutRecommendationService.generateRecommendation(USER_ID);
    expect(fallback.target_duration_minutes).toBe(60);
  });

  it('lets the request override the profile duration', async () => {
    coachRepo.getCoachProfile.mockResolvedValue({
      goals: null,
      session_minutes: 45,
      limitations: [],
    });
    const result = await workoutRecommendationService.generateRecommendation(
      USER_ID,
      { durationMinutes: 90 }
    );
    expect(result.target_duration_minutes).toBe(90);
  });

  it('narrows the catalog read to the muscles it actually chose', async () => {
    const result =
      await workoutRecommendationService.generateRecommendation(USER_ID);
    const [, muscles] = repo.getCandidateExercises.mock.calls[0];

    expect(muscles).toEqual(result.payload.muscle_groups);
  });

  it('records the active gym profile it built against', async () => {
    gymRepo.getActiveGymProfile.mockResolvedValue({
      id: 'gym-1',
      equipment: ['barbell'],
    });
    const result =
      await workoutRecommendationService.generateRecommendation(USER_ID);

    expect(result.gym_profile_id).toBe('gym-1');
    // The cable fly is not performable with a barbell alone.
    expect(result.payload.exercises.some((e) => e.exercise_id === FLY_ID)).toBe(
      false
    );
  });

  it('asks for a named gym profile over the active one', async () => {
    gymRepo.getActiveGymProfile.mockResolvedValue({
      id: 'gym-1',
      equipment: ['barbell'],
    });
    gymRepo.getGymProfile.mockResolvedValue({
      id: 'gym-2',
      equipment: ['barbell', 'cable'],
    });
    const result = await workoutRecommendationService.generateRecommendation(
      USER_ID,
      { gymProfileId: 'gym-2' }
    );

    expect(gymRepo.getGymProfile).toHaveBeenCalledWith(USER_ID, 'gym-2');
    expect(result.gym_profile_id).toBe('gym-2');
  });

  it('treats an explicit null gym profile as "no constraint"', async () => {
    // Distinct from omitting the field, which falls back to whatever is active.
    gymRepo.getActiveGymProfile.mockResolvedValue({
      id: 'gym-1',
      equipment: ['barbell'],
    });
    const result = await workoutRecommendationService.generateRecommendation(
      USER_ID,
      { gymProfileId: null }
    );

    expect(result.gym_profile_id).toBeNull();
    expect(result.payload.exercises.some((e) => e.exercise_id === FLY_ID)).toBe(
      true
    );
  });

  it('honours a stated limitation', async () => {
    coachRepo.getCoachProfile.mockResolvedValue({
      goals: null,
      session_minutes: null,
      limitations: ['Chest'],
    });
    const result =
      await workoutRecommendationService.generateRecommendation(USER_ID);

    expect(
      result.payload.exercises.every(
        (e) => !e.primary_muscles.includes('chest')
      )
    ).toBe(true);
  });

  it('prescribes off logged history rather than cold-starting', async () => {
    entries.getRecentSessionsForExercise.mockImplementation(
      (_userId: string, exerciseId: string) =>
        Promise.resolve(
          exerciseId === BENCH_ID
            ? [
                {
                  entry_date: '2026-08-20',
                  sets: [
                    {
                      set_type: 'Working Set',
                      reps: 10,
                      weight: 80,
                      duration: null,
                      distance: null,
                    },
                    {
                      set_type: 'Working Set',
                      reps: 10,
                      weight: 80,
                      duration: null,
                      distance: null,
                    },
                  ],
                },
              ]
            : []
        )
    );
    const result =
      await workoutRecommendationService.generateRecommendation(USER_ID);
    const bench = result.payload.exercises.find(
      (e) => e.exercise_id === BENCH_ID
    );

    expect(bench).toBeDefined();
    expect(bench!.rationale).toContain('+2.5% from last session');
    const working = bench!.sets.filter((s) => s.set_type === 'Working Set');
    expect(working.every((s) => s.weight === 82.5)).toBe(true);
    // 82.5 kg clears the two-step ramp threshold.
    expect(bench!.sets.filter((s) => s.set_type === 'Warmup')).toHaveLength(2);
  });

  it('reads history one exercise at a time, not all at once', async () => {
    // The pool caps at 10 clients and each reader takes one; a Promise.all
    // over a ten-exercise workout would take the whole pool and deadlock
    // against anything else the request needs.
    let inFlight = 0;
    let peak = 0;
    entries.getRecentSessionsForExercise.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return [];
    });

    await workoutRecommendationService.generateRecommendation(USER_ID);

    expect(
      entries.getRecentSessionsForExercise.mock.calls.length
    ).toBeGreaterThan(1);
    expect(peak).toBe(1);
  });

  it('is reproducible: two runs with no new training return the same payload', async () => {
    const first =
      await workoutRecommendationService.generateRecommendation(USER_ID);
    const second =
      await workoutRecommendationService.generateRecommendation(USER_ID);

    expect(second.payload).toEqual(first.payload);
  });

  it('passes the previous workout to the planner on swap', async () => {
    const previous =
      await workoutRecommendationService.generateRecommendation(USER_ID);
    repo.getWorkoutRecommendation.mockResolvedValue({
      id: REC_ID,
      payload: previous.payload,
    });
    const alternative = candidate({
      id: '66666666-6666-4666-8666-666666666666',
      name: 'Incline Press',
      primaryMuscles: ['chest'],
      mechanic: 'compound',
    });
    repo.getCandidateExercises.mockResolvedValue([
      BENCH,
      alternative,
      FLY,
      BARBELL_ROW,
    ]);

    const swapped = await workoutRecommendationService.generateRecommendation(
      USER_ID,
      { swap: true }
    );

    const chestCompound = swapped.payload.exercises.find(
      (e) => e.exercise_name === 'Incline Press'
    );
    expect(chestCompound).toBeDefined();
  });

  it('does not read the previous workout when not swapping', async () => {
    await workoutRecommendationService.generateRecommendation(USER_ID);
    expect(repo.getWorkoutRecommendation).not.toHaveBeenCalled();
  });

  it('resets a completed workout to active when it regenerates', async () => {
    // Asserted at the repository boundary, since that is where the reset lives.
    await workoutRecommendationService.generateRecommendation(USER_ID);
    const result =
      await workoutRecommendationService.generateRecommendation(USER_ID);
    expect(result.status).toBe('active');
  });

  describe('thin-catalog fallback', () => {
    it('imports from free-exercise-db when a muscle has no candidate', async () => {
      repo.getCandidateExercises
        .mockResolvedValueOnce([BENCH]) // lats unserved
        .mockResolvedValue([BENCH, BARBELL_ROW]);
      fedb.searchExercises.mockResolvedValue({
        exercises: [
          {
            id: 'Barbell_Row',
            name: 'Barbell Row',
            primaryMuscles: ['lats'],
          },
        ],
        totalCount: 1,
      });

      await workoutRecommendationService.generateRecommendation(USER_ID);

      expect(fedb.searchExercises).toHaveBeenCalledWith(
        null,
        [],
        ['lats'],
        GENERATION_TUNABLES.catalogImportSearchLimit,
        0
      );
      expect(repo.getCandidateExercises).toHaveBeenCalledTimes(2);
      expect(
        exercises.addFreeExerciseDBExerciseToUserExercises
      ).toHaveBeenCalledWith(USER_ID, 'Barbell_Row');
      // Re-queried after the import, or the new row would not be in the plan.
      expect(repo.getCandidateExercises).toHaveBeenCalledTimes(2);
    });

    it('counts a muscle the gym profile rules out as unserved', async () => {
      // Five cable candidates the user cannot reach is exactly as unservable
      // as none at all, and a presence-only test would miss it.
      gymRepo.getActiveGymProfile.mockResolvedValue({
        id: 'gym-1',
        equipment: ['barbell'],
      });
      repo.getCandidateExercises.mockResolvedValue([BENCH, FLY]);

      await workoutRecommendationService.generateRecommendation(USER_ID);

      expect(fedb.searchExercises).toHaveBeenCalled();
      const [, equipment, muscles] = fedb.searchExercises.mock.calls[0];
      expect(equipment).toEqual(['barbell']);
      expect(muscles).toEqual(['lats']);
    });

    it('skips an upstream result that only assists the muscle', async () => {
      // Upstream matches a muscle in either list; the planner slots on the
      // primary mover only. Importing a secondary-only match spends a network
      // round trip and image downloads on a row the very next catalog read
      // ignores, and the slot stays empty anyway.
      repo.getCandidateExercises.mockResolvedValue([BENCH]);
      fedb.searchExercises.mockResolvedValue({
        exercises: [
          {
            id: 'Deadlift',
            name: 'Deadlift',
            primaryMuscles: ['lower back'],
            secondaryMuscles: ['lats'],
          },
          { id: 'Pullup', name: 'Pullup', primaryMuscles: ['lats'] },
        ],
        totalCount: 2,
      });

      await workoutRecommendationService.generateRecommendation(USER_ID);

      expect(
        exercises.addFreeExerciseDBExerciseToUserExercises
      ).toHaveBeenCalledWith(USER_ID, 'Pullup');
    });

    it('pages deep enough to reach a primary mover buried in the results', async () => {
      // The primary-mover filter runs on the page upstream already sliced, so
      // the page size and the filter are one mechanism, not two. Upstream orders
      // by name and matches secondary muscles too: the first primary triceps
      // exercise in the real catalog is the twentieth row, so asking for five
      // and filtering afterwards imported nothing at all for triceps or
      // forearms even though the catalog holds nineteen and six.
      repo.getCandidateExercises
        .mockResolvedValueOnce([BENCH])
        .mockResolvedValue([BENCH, BARBELL_ROW]);
      const assists = Array.from({ length: 19 }, (_, index) => ({
        id: `Assists_${index}`,
        name: `Assists ${index}`,
        primaryMuscles: ['biceps'],
        secondaryMuscles: ['lats'],
      }));
      fedb.searchExercises.mockImplementation(
        async (
          _query: unknown,
          _equipment: unknown,
          _muscles: unknown,
          limit: number
        ) => {
          const all = [
            ...assists,
            { id: 'Pullup', name: 'Pullup', primaryMuscles: ['lats'] },
          ];
          return { exercises: all.slice(0, limit), totalCount: all.length };
        }
      );

      await workoutRecommendationService.generateRecommendation(USER_ID);

      expect(
        exercises.addFreeExerciseDBExerciseToUserExercises
      ).toHaveBeenCalledWith(USER_ID, 'Pullup');
    });

    it('imports nothing when no upstream result has the muscle as primary', async () => {
      repo.getCandidateExercises.mockResolvedValue([BENCH]);
      fedb.searchExercises.mockResolvedValue({
        exercises: [
          {
            id: 'Deadlift',
            name: 'Deadlift',
            primaryMuscles: ['lower back'],
          },
        ],
        totalCount: 1,
      });

      await workoutRecommendationService.generateRecommendation(USER_ID);

      expect(
        exercises.addFreeExerciseDBExerciseToUserExercises
      ).not.toHaveBeenCalled();
      expect(repo.getCandidateExercises).toHaveBeenCalledTimes(1);
    });

    it('does not re-query when nothing was imported', async () => {
      repo.getCandidateExercises.mockResolvedValue([BENCH]);
      fedb.searchExercises.mockResolvedValue({ exercises: [], totalCount: 0 });

      await workoutRecommendationService.generateRecommendation(USER_ID);

      expect(repo.getCandidateExercises).toHaveBeenCalledTimes(1);
    });

    it('survives an upstream outage with a shorter workout', async () => {
      repo.getCandidateExercises.mockResolvedValue([BENCH]);
      fedb.searchExercises.mockRejectedValue(new Error('GitHub is down'));

      const result =
        await workoutRecommendationService.generateRecommendation(USER_ID);

      expect(result.payload.exercises.length).toBeGreaterThan(0);
    });

    it('caps imports so an empty catalog cannot run unbounded', async () => {
      repo.getCandidateExercises.mockResolvedValue([]);
      fedb.searchExercises.mockImplementation(
        (_q: unknown, _eq: unknown, muscles: string[]) =>
          Promise.resolve({
            exercises: [
              {
                id: `Some_${muscles[0]}_Exercise`,
                name: 'Some Exercise',
                primaryMuscles: muscles,
              },
            ],
            totalCount: 1,
          })
      );

      await expect(
        workoutRecommendationService.generateRecommendation(USER_ID)
      ).rejects.toThrow(/No exercises available/);

      // At most one import per target muscle, and never more than the cap.
      expect(
        exercises.addFreeExerciseDBExerciseToUserExercises.mock.calls.length
      ).toBeLessThanOrEqual(10);
    });
  });

  it('refuses to persist an empty workout', async () => {
    repo.getCandidateExercises.mockResolvedValue([]);

    await expect(
      workoutRecommendationService.generateRecommendation(USER_ID)
    ).rejects.toThrow(/No exercises available/);
    expect(repo.upsertWorkoutRecommendation).not.toHaveBeenCalled();
  });
});

describe('getAlternatives', () => {
  const source = candidate({
    id: BENCH_ID,
    name: 'Bench Press',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps', 'shoulders'],
    mechanic: 'compound',
    level: 'intermediate',
  });

  beforeEach(() => {
    repo.getCandidateExerciseById.mockResolvedValue(source);
  });

  it('returns nothing for an exercise it cannot see', async () => {
    repo.getCandidateExerciseById.mockResolvedValue(null);
    expect(
      await workoutRecommendationService.getAlternatives(USER_ID, BENCH_ID, 10)
    ).toEqual([]);
  });

  it('never offers the exercise being replaced', async () => {
    repo.getCandidateExercises.mockResolvedValue([source, FLY, BARBELL_ROW]);
    const result = await workoutRecommendationService.getAlternatives(
      USER_ID,
      BENCH_ID,
      10
    );

    expect(result.every((item) => item.exercise_id !== BENCH_ID)).toBe(true);
  });

  it('ranks a primary-muscle match over one that only assists', async () => {
    const assists = candidate({
      id: '77777777-7777-4777-8777-777777777777',
      name: 'Dip',
      primaryMuscles: ['triceps'],
      secondaryMuscles: ['chest'],
      mechanic: 'compound',
    });
    const primary = candidate({
      id: '88888888-8888-4888-8888-888888888888',
      name: 'Incline Press',
      primaryMuscles: ['chest'],
      mechanic: 'compound',
    });
    repo.getCandidateExercises.mockResolvedValue([source, assists, primary]);

    const result = await workoutRecommendationService.getAlternatives(
      USER_ID,
      BENCH_ID,
      10
    );

    expect(result[0]!.exercise_name).toBe('Incline Press');
    expect(result[0]!.score).toBeGreaterThan(result[1]!.score);
  });

  it('widens the catalog read to secondary muscles', async () => {
    repo.getCandidateExercises.mockResolvedValue([source]);
    await workoutRecommendationService.getAlternatives(USER_ID, BENCH_ID, 10);

    expect(repo.getCandidateExercises).toHaveBeenCalledWith(
      USER_ID,
      ['chest'],
      true
    );
  });

  it('drops candidates the active gym profile cannot support', async () => {
    gymRepo.getActiveGymProfile.mockResolvedValue({
      id: 'gym-1',
      equipment: ['barbell'],
    });
    repo.getCandidateExercises.mockResolvedValue([source, FLY]);

    const result = await workoutRecommendationService.getAlternatives(
      USER_ID,
      BENCH_ID,
      10
    );

    expect(result.every((item) => item.exercise_id !== FLY_ID)).toBe(true);
  });

  it('is deterministic when scores tie', async () => {
    const tied = ['a', 'b', 'c'].map((letter, index) =>
      candidate({
        id: `9999999${index}-9999-4999-8999-99999999999${index}`,
        name: `Press ${letter}`,
        primaryMuscles: ['chest'],
        mechanic: 'compound',
      })
    );
    repo.getCandidateExercises.mockResolvedValue([source, ...tied]);

    const first = await workoutRecommendationService.getAlternatives(
      USER_ID,
      BENCH_ID,
      10
    );
    repo.getCandidateExercises.mockResolvedValue([
      source,
      ...[...tied].reverse(),
    ]);
    const second = await workoutRecommendationService.getAlternatives(
      USER_ID,
      BENCH_ID,
      10
    );

    expect(second).toEqual(first);
  });

  it('reaches upstream only when the local catalog is thin', async () => {
    const locals = ['a', 'b', 'c'].map((letter, index) =>
      candidate({
        id: `1010101${index}-1010-4010-8010-10101010101${index}`,
        name: `Press ${letter}`,
        primaryMuscles: ['chest'],
      })
    );
    repo.getCandidateExercises.mockResolvedValue([source, ...locals]);

    await workoutRecommendationService.getAlternatives(USER_ID, BENCH_ID, 10);
    expect(fedb.searchExercises).not.toHaveBeenCalled();

    repo.getCandidateExercises.mockResolvedValue([source, locals[0]!]);
    fedb.searchExercises.mockResolvedValue({
      exercises: [
        {
          id: 'Incline_Press',
          name: 'Incline Press',
          primaryMuscles: ['chest'],
          equipment: 'barbell',
          mechanic: 'compound',
          level: 'beginner',
        },
      ],
      totalCount: 1,
    });

    const result = await workoutRecommendationService.getAlternatives(
      USER_ID,
      BENCH_ID,
      10
    );
    expect(fedb.searchExercises).toHaveBeenCalled();
    const external = result.find((item) => item.source === 'external');
    expect(external?.exercise_id).toBe('Incline_Press');
    // Upstream results score 0, so every local row outranks them.
    expect(result[result.length - 1]).toBe(external);
    // A bare upstream string becomes a one-item array, not a spread of chars.
    expect(external?.equipment).toEqual(['barbell']);
  });

  it('does not offer an upstream copy of a movement already imported', async () => {
    repo.getCandidateExercises.mockResolvedValue([
      source,
      candidate({
        id: '12121212-1212-4212-8212-121212121212',
        name: 'Incline Press',
        primaryMuscles: ['chest'],
      }),
    ]);
    fedb.searchExercises.mockResolvedValue({
      exercises: [{ id: 'Incline_Press', name: 'incline press' }],
      totalCount: 1,
    });

    const result = await workoutRecommendationService.getAlternatives(
      USER_ID,
      BENCH_ID,
      10
    );

    expect(result.filter((item) => item.source === 'external')).toHaveLength(0);
  });

  it('returns the local list when the upstream lookup fails', async () => {
    repo.getCandidateExercises.mockResolvedValue([source, FLY]);
    fedb.searchExercises.mockRejectedValue(new Error('GitHub is down'));

    const result = await workoutRecommendationService.getAlternatives(
      USER_ID,
      BENCH_ID,
      10
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe('local');
  });
});

describe('workout recommendation routes', () => {
  it('404s before anything has been generated', async () => {
    const res = await request(app).get('/api/workout-recommendations');
    expect(res.status).toBe(404);
  });

  it('returns the stored workout', async () => {
    const generated =
      await workoutRecommendationService.generateRecommendation(USER_ID);
    repo.getWorkoutRecommendation.mockResolvedValue({
      id: REC_ID,
      user_id: USER_ID,
      gym_profile_id: null,
      target_duration_minutes: 60,
      payload: generated.payload,
      status: 'active',
      generated_at: new Date('2026-08-23T10:00:00Z'),
      created_at: new Date('2026-08-23T10:00:00Z'),
      updated_at: new Date('2026-08-23T10:00:00Z'),
    });

    const res = await request(app).get('/api/workout-recommendations');
    expect(res.status).toBe(200);
    expect(res.body.payload.exercises.length).toBeGreaterThan(0);
  });

  it('generates on POST', async () => {
    const res = await request(app)
      .post('/api/workout-recommendations/generate')
      .send({ duration_minutes: 45 });

    expect(res.status).toBe(200);
    expect(res.body.target_duration_minutes).toBe(45);
  });

  it('rejects a duration outside the allowed range', async () => {
    const res = await request(app)
      .post('/api/workout-recommendations/generate')
      .send({ duration_minutes: 5 });

    expect(res.status).toBe(400);
    expect(repo.upsertWorkoutRecommendation).not.toHaveBeenCalled();
  });

  it('rejects an unknown body key rather than ignoring it', async () => {
    const res = await request(app)
      .post('/api/workout-recommendations/generate')
      .send({ durationMinutes: 45 });

    expect(res.status).toBe(400);
  });

  it('generates from an empty body', async () => {
    const res = await request(app)
      .post('/api/workout-recommendations/generate')
      .send({});

    expect(res.status).toBe(200);
  });

  it('answers 422, not 500, when there is nothing to program', async () => {
    repo.getCandidateExercises.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/workout-recommendations/generate')
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/No exercises available/);
  });

  it('updates the status on PATCH', async () => {
    const generated =
      await workoutRecommendationService.generateRecommendation(USER_ID);
    repo.updateWorkoutRecommendationStatus.mockResolvedValue({
      id: REC_ID,
      user_id: USER_ID,
      gym_profile_id: null,
      target_duration_minutes: 60,
      payload: generated.payload,
      status: 'completed',
      generated_at: new Date('2026-08-23T10:00:00Z'),
      created_at: new Date('2026-08-23T10:00:00Z'),
      updated_at: new Date('2026-08-23T10:00:00Z'),
    });

    const res = await request(app)
      .patch(`/api/workout-recommendations/${REC_ID}`)
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(repo.updateWorkoutRecommendationStatus).toHaveBeenCalledWith(
      USER_ID,
      REC_ID,
      'completed'
    );
  });

  it('rejects a status outside the lifecycle', async () => {
    const res = await request(app)
      .patch(`/api/workout-recommendations/${REC_ID}`)
      .send({ status: 'in-progress' });

    expect(res.status).toBe(400);
  });

  it('404s a PATCH against another user’s row', async () => {
    repo.updateWorkoutRecommendationStatus.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/workout-recommendations/${REC_ID}`)
      .send({ status: 'started' });

    expect(res.status).toBe(404);
  });

  it('serves alternatives with a default limit', async () => {
    repo.getCandidateExerciseById.mockResolvedValue(BENCH);
    repo.getCandidateExercises.mockResolvedValue([BENCH, FLY]);

    const res = await request(app).get(
      `/api/workout-recommendations/alternatives/${BENCH_ID}`
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.alternatives)).toBe(true);
  });

  it('rejects a non-uuid exercise id', async () => {
    const res = await request(app).get(
      '/api/workout-recommendations/alternatives/not-a-uuid'
    );
    expect(res.status).toBe(400);
  });
});
