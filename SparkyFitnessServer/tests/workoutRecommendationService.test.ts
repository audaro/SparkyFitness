import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'supertest'
import request from 'supertest';
import express from 'express';
import {
  estimateDurationMinutes,
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
    getStrengthSessionDayCount: vi.fn(),
    getCandidateExercises: vi.fn(),
    getCandidateExerciseById: vi.fn(),
    getWorkoutRecommendation: vi.fn(),
    upsertWorkoutRecommendation: vi.fn(),
    updateWorkoutRecommendationPayload: vi.fn(),
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
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = USER_ID;
    req.authenticatedUserId = USER_ID;
    next();
  },
}));

vi.mock('../middleware/checkPermissionMiddleware.js', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));

const USER_ID = '11111111-1111-4111-8111-111111111111';
const REC_ID = '22222222-2222-4222-8222-222222222222';
const BENCH_ID = '33333333-3333-4333-8333-333333333333';
const FLY_ID = '44444444-4444-4444-8444-444444444444';
const ROW_ID = '55555555-5555-4555-8555-555555555555';
const DIP_ID = '66666666-6666-4666-8666-666666666666';
const PULLDOWN_ID = '77777777-7777-4777-8777-777777777777';
const STRETCH_ID = '88888888-8888-4888-8888-888888888888';
const CHIN_UP_ID = '99999999-9999-4999-8999-999999999999';
const DUMBBELL_ROW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ATLAS_STONE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const app = express();
app.use(express.json());
app.use('/api/workout-recommendations', workoutRecommendationRoutes);
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.status || 500).json({ error: err.message });
});

const repo = workoutRecommendationRepository as any;
const coachRepo = coachProfileRepository as any;
const gymRepo = gymEquipmentProfileRepository as any;
const entries = exerciseEntryModel as any;
const exercises = exerciseService as any;
const fedb = freeExerciseDBService as any;

function candidate(
  overrides: Partial<CandidateExercise> & { id: string }
): CandidateExercise {
  return {
    name: `Exercise ${overrides.id}`,
    modality: 'weight_reps',
    category: 'strength',
    source: 'manual',
    sourceId: null,
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
// Deliberately absent from the candidate list the planner reads, so they can
// only ever enter a workout by being replaced in.
const CHEST_DIP = candidate({
  id: DIP_ID,
  name: 'Chest Dip',
  primaryMuscles: ['chest'],
  mechanic: 'isolation',
  equipment: ['body only'],
});
const LAT_PULLDOWN = candidate({
  id: PULLDOWN_ID,
  name: 'Lat Pulldown',
  primaryMuscles: ['lats'],
  mechanic: 'compound',
  equipment: ['cable'],
});

// Three real free-exercise-db rows, each an instance of something the engine
// used to prescribe and cannot: a stretch programmed as 3x10, a `body only`
// row that needs a bar to hang from, and strongman gear admitted because the
// account had no gym profile to filter it.
const LAT_STRETCH = candidate({
  id: STRETCH_ID,
  name: 'Lat Stretch',
  category: 'stretching',
  source: 'free-exercise-db',
  sourceId: 'Lat_Stretch',
  primaryMuscles: ['lats'],
  mechanic: 'isolation',
  equipment: ['body only'],
});
const CHIN_UP = candidate({
  id: CHIN_UP_ID,
  name: 'Chin-Up',
  source: 'free-exercise-db',
  sourceId: 'Chin-Up',
  primaryMuscles: ['lats'],
  mechanic: 'compound',
  equipment: ['body only'],
});
const DUMBBELL_ROW = candidate({
  id: DUMBBELL_ROW_ID,
  name: 'Bent Over Two-Dumbbell Row',
  primaryMuscles: ['lats'],
  mechanic: 'compound',
  equipment: ['dumbbell'],
});
const ATLAS_STONE = candidate({
  id: ATLAS_STONE_ID,
  name: 'Atlas Stone Trainer',
  source: 'free-exercise-db',
  sourceId: 'Atlas_Stone_Trainer',
  primaryMuscles: ['lats'],
  mechanic: 'compound',
  equipment: ['other'],
});

/** Echo the payload back the way the real upsert would. */
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

/** The row `repo.getWorkoutRecommendation` is currently configured to return. */
let currentRow: any = null;

/**
 * Echo a payload rewrite back the way the real update would.
 *
 * `status` and `generated_at` are the point: unlike the upsert, an in-place
 * payload rewrite leaves them alone, so the response still carries whatever the
 * stored row had.
 */
function echoPayloadUpdate(
  _userId: string,
  payload: any,
  expectedPayload: unknown
) {
  // Models the compare-and-set: the real UPDATE carries `AND payload = $3`, so
  // it matches nothing once the stored payload has moved. Reference equality is
  // enough here because the service hands back the very object the mocked read
  // returned.
  if (expectedPayload !== currentRow?.payload) return Promise.resolve(null);
  return Promise.resolve({
    ...currentRow,
    payload,
    updated_at: new Date('2026-08-23T12:00:00Z'),
  });
}

/**
 * Generate a workout and make it the stored row, so a replace has something to
 * act on. Returns the payload that was persisted.
 */
async function storeGenerated(overrides: Record<string, any> = {}) {
  const generated =
    await workoutRecommendationService.generateRecommendation(USER_ID);
  currentRow = {
    id: REC_ID,
    user_id: USER_ID,
    gym_profile_id: null,
    target_duration_minutes: 60,
    payload: generated.payload,
    status: 'active',
    generated_at: new Date('2026-08-23T10:00:00Z'),
    created_at: new Date('2026-08-23T10:00:00Z'),
    updated_at: new Date('2026-08-23T10:00:00Z'),
    ...overrides,
  };
  repo.getWorkoutRecommendation.mockResolvedValue(currentRow);
  repo.upsertWorkoutRecommendation.mockClear();
  return generated.payload;
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
  currentRow = null;
  vi.mocked(loadUserTimezone).mockResolvedValue('UTC');
  repo.getMuscleFatigueInputs.mockResolvedValue(
    fatigueEverythingExcept('chest', 'lats')
  );
  repo.getStrengthSessionDayCount.mockResolvedValue(0);
  repo.getCandidateExercises.mockResolvedValue([BENCH, FLY, BARBELL_ROW]);
  repo.getCandidateExerciseById.mockResolvedValue(null);
  repo.getWorkoutRecommendation.mockResolvedValue(null);
  repo.upsertWorkoutRecommendation.mockImplementation(echoUpsert);
  repo.updateWorkoutRecommendationPayload.mockImplementation(echoPayloadUpdate);
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

  // The scoring itself is asserted in workoutGeneration.test.ts; this proves
  // the wire-through — the stored profile value reaching GenerationOptions —
  // because that seam sat inert (`experienceLevel: null`) for a release and
  // nothing but this test would notice it regressing.
  it('reads the experience level off the coach profile into selection', async () => {
    coachRepo.getCoachProfile.mockResolvedValue({
      goals: null,
      session_minutes: null,
      experience_level: 'beginner',
      limitations: [],
    });
    const beginnerBench = candidate({
      id: '77777777-7777-4777-8777-777777777777',
      name: 'Push-Up',
      level: 'beginner',
    });
    const unleveledBench = candidate({
      id: '11111111-aaaa-4aaa-8aaa-111111111111',
      name: 'Machine Press',
    });
    repo.getCandidateExercises.mockResolvedValue([
      unleveledBench,
      beginnerBench,
    ]);

    const result = await workoutRecommendationService.generateRecommendation(
      USER_ID,
      { targetMuscles: ['chest'] }
    );

    // Otherwise identical candidates: only the level-match bonus separates
    // them, so the beginner-rated row winning is the profile value arriving.
    expect(result.payload.exercises[0].exercise_id).toBe(beginnerBench.id);
  });

  it('does not derive a level when the profile states one', async () => {
    coachRepo.getCoachProfile.mockResolvedValue({
      goals: null,
      session_minutes: null,
      experience_level: 'expert',
      limitations: [],
    });

    await workoutRecommendationService.generateRecommendation(USER_ID);

    // Stated beats derived, and skipping the count is also the cheap path:
    // the query only runs for the users it can help.
    expect(repo.getStrengthSessionDayCount).not.toHaveBeenCalled();
  });

  it('derives a level from the training log when the profile is silent', async () => {
    // No profile row at all (the beforeEach default). One day short of the
    // intermediate threshold derives 'beginner', so the beginner-rated
    // candidate winning is the derived value reaching selection.
    repo.getStrengthSessionDayCount.mockResolvedValue(
      GENERATION_TUNABLES.derivedIntermediateSessionDays - 1
    );
    const beginnerBench = candidate({
      id: '77777777-7777-4777-8777-777777777777',
      name: 'Push-Up',
      level: 'beginner',
    });
    const unleveledBench = candidate({
      id: '11111111-aaaa-4aaa-8aaa-111111111111',
      name: 'Machine Press',
    });
    repo.getCandidateExercises.mockResolvedValue([
      unleveledBench,
      beginnerBench,
    ]);

    const result = await workoutRecommendationService.generateRecommendation(
      USER_ID,
      { targetMuscles: ['chest'] }
    );

    expect(repo.getStrengthSessionDayCount).toHaveBeenCalledTimes(1);
    expect(result.payload.exercises[0].exercise_id).toBe(beginnerBench.id);
  });

  it('narrows the catalog read to the muscles it actually chose', async () => {
    const result =
      await workoutRecommendationService.generateRecommendation(USER_ID);
    const [, muscles] = repo.getCandidateExercises.mock.calls[0];

    expect(muscles).toEqual(result.payload.muscle_groups);
  });

  it('builds around requested muscles instead of the freshest ones', async () => {
    // The fatigue fixture leaves chest and lats fresh, so an unasked-for
    // workout is a chest/lats day. Asking for lats has to narrow both the
    // catalog read and the workout itself.
    const result = await workoutRecommendationService.generateRecommendation(
      USER_ID,
      { targetMuscles: ['lats'] }
    );
    const [, muscles] = repo.getCandidateExercises.mock.calls[0];

    expect(muscles).toEqual(['lats']);
    expect(result.payload.muscle_groups).toEqual(['lats']);
    expect(result.payload.exercises.map((e) => e.exercise_id)).toEqual([
      ROW_ID,
    ]);
  });

  it('ignores an empty muscle request rather than planning nothing', async () => {
    const asked = await workoutRecommendationService.generateRecommendation(
      USER_ID,
      { targetMuscles: [] }
    );
    const unasked =
      await workoutRecommendationService.generateRecommendation(USER_ID);

    expect(asked.payload).toEqual(unasked.payload);
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

  it("caps prescriptions at the gym profile's stated load limits", async () => {
    gymRepo.getActiveGymProfile.mockResolvedValue({
      id: 'gym-1',
      equipment: ['barbell', 'cable'],
      load_limits: { barbell: { max_kg: 60 } },
    });
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
    // 80 → +2.5% wants 82.5; the gym's bar maxes at 60, and the rationale
    // says so instead of claiming a deload the lifter never earned.
    const working = bench!.sets.filter((s) => s.set_type === 'Working Set');
    expect(working.every((s) => s.weight === 60)).toBe(true);
    expect(bench!.rationale).toContain("at this gym's max load");
    // Warm-ups ramp off the capped weight, so they respect the cap too.
    const warmups = bench!.sets.filter((s) => s.set_type === 'Warmup');
    expect(warmups.every((s) => (s.weight ?? 0) < 60)).toBe(true);
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
      ).rejects.toThrow(/No exercises/);

      // At most one import per target muscle, and never more than the cap.
      expect(
        exercises.addFreeExerciseDBExerciseToUserExercises.mock.calls.length
      ).toBeLessThanOrEqual(10);
    });

    it('counts a muscle covered only by a stretch as unserved', async () => {
      // A catalog whose only lats row is a stretch can be handed a lats
      // *stretch* and nothing to train with. The planner will still program it
      // as a fallback, but only after this has had a chance to find a real
      // movement to beat it.
      repo.getCandidateExercises.mockResolvedValue([BENCH, LAT_STRETCH]);
      fedb.searchExercises.mockResolvedValue({
        exercises: [{ id: 'Pullup', name: 'Pullup', primaryMuscles: ['lats'] }],
        totalCount: 1,
      });

      await workoutRecommendationService.generateRecommendation(USER_ID);

      expect(
        exercises.addFreeExerciseDBExerciseToUserExercises
      ).toHaveBeenCalledWith(USER_ID, 'Pullup');
    });

    it('imports a real movement over an upstream stretch', async () => {
      // Importing another stretch to cover a stretch-only muscle leaves the
      // slot exactly as unserved as it started.
      repo.getCandidateExercises.mockResolvedValue([BENCH]);
      fedb.searchExercises.mockResolvedValue({
        exercises: [
          {
            id: 'Lat_Stretch',
            name: 'Lat Stretch',
            primaryMuscles: ['lats'],
            category: 'stretching',
          },
          {
            id: 'Pullup',
            name: 'Pullup',
            primaryMuscles: ['lats'],
            category: 'strength',
          },
        ],
        totalCount: 2,
      });

      await workoutRecommendationService.generateRecommendation(USER_ID);

      expect(
        exercises.addFreeExerciseDBExerciseToUserExercises
      ).toHaveBeenCalledWith(USER_ID, 'Pullup');
    });

    it('takes a stretch when upstream moves the muscle no other way', async () => {
      repo.getCandidateExercises.mockResolvedValue([BENCH]);
      fedb.searchExercises.mockResolvedValue({
        exercises: [
          {
            id: 'Lat_Stretch',
            name: 'Lat Stretch',
            primaryMuscles: ['lats'],
            category: 'stretching',
          },
        ],
        totalCount: 1,
      });

      await workoutRecommendationService.generateRecommendation(USER_ID);

      expect(
        exercises.addFreeExerciseDBExerciseToUserExercises
      ).toHaveBeenCalledWith(USER_ID, 'Lat_Stretch');
    });

    it('does not spend a round trip on gear the planner would then reject', async () => {
      // `Chin-Up` is `body only` upstream, so nothing before this filter knows
      // the home profile cannot do it — and importing it costs a fetch plus
      // image downloads for a row the very next plan discards.
      gymRepo.getActiveGymProfile.mockResolvedValue({
        id: 'gym-1',
        equipment: ['dumbbell', 'bands'],
      });
      repo.getCandidateExercises.mockResolvedValue([]);
      fedb.searchExercises.mockImplementation(
        (_q: unknown, _eq: unknown, muscles: string[]) =>
          Promise.resolve({
            exercises: [
              {
                id: 'Chin-Up',
                name: 'Chin-Up',
                primaryMuscles: muscles,
                equipment: 'body only',
              },
              {
                id: 'Atlas_Stone_Trainer',
                name: 'Atlas Stone Trainer',
                primaryMuscles: muscles,
                equipment: 'other',
              },
            ],
            totalCount: 2,
          })
      );

      await expect(
        workoutRecommendationService.generateRecommendation(USER_ID)
      ).rejects.toThrow(/No exercises/);
      expect(
        exercises.addFreeExerciseDBExerciseToUserExercises
      ).not.toHaveBeenCalled();
    });
  });

  describe('what it refuses to prescribe', () => {
    it('programs a stretch as a hold, and says so in the payload', async () => {
      repo.getCandidateExercises.mockResolvedValue([BENCH, LAT_STRETCH]);

      const result =
        await workoutRecommendationService.generateRecommendation(USER_ID);
      const stretch = result.payload.exercises.find(
        (exercise) => exercise.exercise_id === LAT_STRETCH.id
      );

      expect(stretch).toBeDefined();
      // The catalog stores this row `weight_reps`; publishing that would put
      // duration sets under a weight-and-reps editor.
      expect(stretch!.modality).toBe('duration');
      expect(stretch!.sets).toHaveLength(GENERATION_TUNABLES.mobilitySets);
      expect(
        stretch!.sets.every(
          (set) =>
            set.reps === null &&
            set.weight === null &&
            set.duration === GENERATION_TUNABLES.mobilityHoldSeconds
        )
      ).toBe(true);
      expect(stretch!.rationale).toBe('fresh lats · mobility hold');
    });

    it('keeps opt-in gear out of a session with no gym profile', async () => {
      // The W7 live run prescribed an Atlas Stone Trainer to an account that
      // had simply never made a profile.
      repo.getCandidateExercises.mockResolvedValue([BENCH, ATLAS_STONE]);

      const result =
        await workoutRecommendationService.generateRecommendation(USER_ID);

      expect(
        result.payload.exercises.map((exercise) => exercise.exercise_id)
      ).not.toContain(ATLAS_STONE.id);
    });

    it('keeps a pull-up out of a dumbbells-and-bands session', async () => {
      gymRepo.getActiveGymProfile.mockResolvedValue({
        id: 'gym-1',
        equipment: ['dumbbell', 'bands'],
      });
      repo.getCandidateExercises.mockResolvedValue([DUMBBELL_ROW, CHIN_UP]);

      const result =
        await workoutRecommendationService.generateRecommendation(USER_ID);

      expect(
        result.payload.exercises.map((exercise) => exercise.exercise_id)
      ).toEqual([DUMBBELL_ROW.id]);
    });

    it('admits a pull-up when the profile states a pull-up bar', async () => {
      // Same room as above, but the user has told us there is a bar in it.
      // Stating apparatus is precisely what un-guesses the inference.
      gymRepo.getActiveGymProfile.mockResolvedValue({
        id: 'gym-1',
        equipment: ['dumbbell', 'bands'],
        apparatus: ['pull-up bar'],
      });
      repo.getCandidateExercises.mockResolvedValue([DUMBBELL_ROW, CHIN_UP]);

      const result =
        await workoutRecommendationService.generateRecommendation(USER_ID);

      expect(
        result.payload.exercises.map((exercise) => exercise.exercise_id)
      ).toContain(CHIN_UP.id);
    });

    it('keeps a pull-up out of a gym that stated it has no bar, even a familiar one', async () => {
      // Planet Fitness: machines and cables everywhere (which the inference
      // reads as "bar"), apparatus stated as none. The statement wins over
      // both the inference and the familiarity escape — the fifty logged
      // pull-ups happened somewhere with a bar; this profile says here isn't.
      gymRepo.getActiveGymProfile.mockResolvedValue({
        id: 'gym-1',
        equipment: ['machine', 'cable', 'dumbbell'],
        apparatus: [],
      });
      repo.getCandidateExercises.mockResolvedValue([
        { ...DUMBBELL_ROW, timesPerformed: 10 },
        { ...CHIN_UP, timesPerformed: 50 },
      ]);

      const result =
        await workoutRecommendationService.generateRecommendation(USER_ID);

      expect(
        result.payload.exercises.map((exercise) => exercise.exercise_id)
      ).toEqual([DUMBBELL_ROW.id]);
    });

    it('threads stated equipment items into the gate', async () => {
      // An item-stated row exactly as the route stores it: coarse columns
      // derived from the items. Fixed bars derive coarse `barbell`, so only
      // the item gate knows this room has no Olympic bar — a smith row
      // passes, a free-bar row does not, and familiarity does not argue.
      gymRepo.getActiveGymProfile.mockResolvedValue({
        id: 'gym-1',
        equipment: ['barbell', 'machine'],
        apparatus: [],
        equipment_items: ['fixed-barbells', 'smith-machine'],
      });
      const SMITH_ROW = candidate({
        id: BENCH_ID,
        name: 'Smith Machine Bent Over Row',
        source: 'free-exercise-db',
        sourceId: 'Smith_Machine_Bent_Over_Row',
        primaryMuscles: ['lats'],
        mechanic: 'compound',
        equipment: ['machine'],
      });
      const BARBELL_ROW = candidate({
        id: FLY_ID,
        name: 'Bent Over Barbell Row',
        source: 'free-exercise-db',
        sourceId: 'Bent_Over_Barbell_Row',
        primaryMuscles: ['lats'],
        mechanic: 'compound',
        equipment: ['barbell'],
        timesPerformed: 50,
      });
      repo.getCandidateExercises.mockResolvedValue([SMITH_ROW, BARBELL_ROW]);

      const result =
        await workoutRecommendationService.generateRecommendation(USER_ID);

      expect(
        result.payload.exercises.map((exercise) => exercise.exercise_id)
      ).toEqual([SMITH_ROW.id]);
    });
  });

  it('refuses to persist an empty workout', async () => {
    repo.getCandidateExercises.mockResolvedValue([]);

    await expect(
      workoutRecommendationService.generateRecommendation(USER_ID)
    ).rejects.toThrow(/No exercises/);
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

  it('holds upstream suggestions to the same performability bar as local ones', async () => {
    // Upstream's own equipment filter is a case-sensitive substring match and
    // knows nothing about apparatus, so a home profile asking for a lat
    // replacement was offered Chin-Up.
    gymRepo.getActiveGymProfile.mockResolvedValue({
      id: 'gym-1',
      equipment: ['dumbbell', 'bands'],
    });
    repo.getCandidateExercises.mockResolvedValue([source]);
    fedb.searchExercises.mockResolvedValue({
      exercises: [
        {
          id: 'Chin-Up',
          name: 'Chin-Up',
          primaryMuscles: ['chest'],
          equipment: 'body only',
        },
        {
          id: 'Atlas_Stone_Trainer',
          name: 'Atlas Stone Trainer',
          primaryMuscles: ['chest'],
          equipment: 'other',
        },
        {
          id: 'Push-Ups',
          name: 'Push-Ups',
          primaryMuscles: ['chest'],
          equipment: 'body only',
        },
      ],
      totalCount: 3,
    });

    const result = await workoutRecommendationService.getAlternatives(
      USER_ID,
      BENCH_ID,
      10
    );

    expect(
      result
        .filter((item) => item.source === 'external')
        .map((item) => item.exercise_id)
    ).toEqual(['Push-Ups']);
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

describe('replaceRecommendationExercise', () => {
  /** Where the named exercise sits in the stored workout. */
  function indexOf(payload: any, exerciseId: string): number {
    const index = payload.exercises.findIndex(
      (exercise: any) => exercise.exercise_id === exerciseId
    );
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
  }

  it('returns null when the user has never generated a workout', async () => {
    repo.getWorkoutRecommendation.mockResolvedValue(null);
    await expect(
      workoutRecommendationService.replaceRecommendationExercise(
        USER_ID,
        BENCH_ID,
        DIP_ID
      )
    ).resolves.toBeNull();
    expect(repo.updateWorkoutRecommendationPayload).not.toHaveBeenCalled();
  });

  it('swaps the exercise in place, keeping its position', async () => {
    const before = await storeGenerated();
    const at = indexOf(before, BENCH_ID);
    repo.getCandidateExerciseById.mockResolvedValue(CHEST_DIP);

    const result =
      await workoutRecommendationService.replaceRecommendationExercise(
        USER_ID,
        BENCH_ID,
        DIP_ID
      );

    expect(result?.payload.exercises).toHaveLength(before.exercises.length);
    expect(result?.payload.exercises[at].exercise_id).toBe(DIP_ID);
    expect(result?.payload.exercises[at].exercise_name).toBe('Chest Dip');
    expect(result?.payload.exercises[at].sort_order).toBe(
      before.exercises[at].sort_order
    );
    // Every other row is untouched — this is a substitution, not a regenerate.
    expect(
      result?.payload.exercises
        .filter((_, index) => index !== at)
        .map((exercise) => exercise.exercise_id)
    ).toEqual(
      before.exercises
        .filter((_, index) => index !== at)
        .map((exercise) => exercise.exercise_id)
    );
  });

  it('derives the level for a replace the same way generate did', async () => {
    await storeGenerated();
    repo.getStrengthSessionDayCount.mockClear();
    repo.getCandidateExerciseById.mockResolvedValue(CHEST_DIP);

    await workoutRecommendationService.replaceRecommendationExercise(
      USER_ID,
      BENCH_ID,
      DIP_ID
    );

    // The workout was built under a derived level (no stated one in these
    // fixtures). A null level at replace time is not neutral — only beginners
    // are capped to three working sets — so the incoming exercise has to be
    // programmed under the same derivation or it arrives with a set count
    // its neighbours never got.
    expect(repo.getStrengthSessionDayCount).toHaveBeenCalledTimes(1);
  });

  it('does not run the derivation when a level is stated, on replace either', async () => {
    await storeGenerated();
    coachRepo.getCoachProfile.mockResolvedValue({
      goals: null,
      session_minutes: 45,
      limitations: [],
      experience_level: 'intermediate',
    });
    repo.getStrengthSessionDayCount.mockClear();
    repo.getCandidateExerciseById.mockResolvedValue(CHEST_DIP);

    await workoutRecommendationService.replaceRecommendationExercise(
      USER_ID,
      BENCH_ID,
      DIP_ID
    );

    expect(repo.getStrengthSessionDayCount).not.toHaveBeenCalled();
  });

  it('prescribes the replacement for its own slot, not the outgoing one’s', async () => {
    await storeGenerated();
    repo.getCandidateExerciseById.mockResolvedValue(CHEST_DIP);

    const result =
      await workoutRecommendationService.replaceRecommendationExercise(
        USER_ID,
        BENCH_ID,
        DIP_ID
      );
    const swapped = result?.payload.exercises.find(
      (exercise) => exercise.exercise_id === DIP_ID
    );

    // Bench is a compound; the dip is an isolation, and its rest says so.
    // Carrying the outgoing exercise's programming forward is the whole failure
    // mode this endpoint exists to avoid.
    expect(swapped?.rest_seconds).toBe(GENERATION_TUNABLES.restIsolation);
    // Bounded at the user's today, like generate: a plan session prescribed
    // for later this week is not last session.
    expect(entries.getRecentSessionsForExercise).toHaveBeenCalledWith(
      USER_ID,
      DIP_ID,
      null,
      2,
      null,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
    );
  });

  it('rebuilds the duration estimate around the new programming', async () => {
    const before = await storeGenerated();
    repo.getCandidateExerciseById.mockResolvedValue(CHEST_DIP);

    const result =
      await workoutRecommendationService.replaceRecommendationExercise(
        USER_ID,
        BENCH_ID,
        DIP_ID
      );

    expect(result?.payload.estimated_duration_minutes).toBe(
      estimateDurationMinutes(result?.payload.exercises ?? [])
    );
    // Guard against the assertion above passing on a stale value copied through.
    expect(estimateDurationMinutes(before.exercises)).toBe(
      before.estimated_duration_minutes
    );
  });

  it('keeps the slot’s muscle when the replacement also trains it', async () => {
    await storeGenerated();
    repo.getCandidateExerciseById.mockResolvedValue(CHEST_DIP);

    const result =
      await workoutRecommendationService.replaceRecommendationExercise(
        USER_ID,
        BENCH_ID,
        DIP_ID
      );

    expect(
      result?.payload.exercises.find(
        (exercise) => exercise.exercise_id === DIP_ID
      )?.rationale
    ).toContain('chest');
  });

  it('explains a replacement against its own muscle when the slot’s no longer applies', async () => {
    await storeGenerated();
    repo.getCandidateExerciseById.mockResolvedValue(LAT_PULLDOWN);

    const result =
      await workoutRecommendationService.replaceRecommendationExercise(
        USER_ID,
        BENCH_ID,
        PULLDOWN_ID
      );
    const swapped = result?.payload.exercises.find(
      (exercise) => exercise.exercise_id === PULLDOWN_ID
    );

    expect(swapped?.rationale).toContain('lats');
    expect(swapped?.rationale).not.toContain('chest');
  });

  it('leaves the header muscles alone — one substitution is not a replan', async () => {
    const before = await storeGenerated();
    repo.getCandidateExerciseById.mockResolvedValue(LAT_PULLDOWN);

    const result =
      await workoutRecommendationService.replaceRecommendationExercise(
        USER_ID,
        BENCH_ID,
        PULLDOWN_ID
      );

    expect(result?.payload.muscle_groups).toEqual(before.muscle_groups);
  });

  it('rewrites the payload in place rather than regenerating the row', async () => {
    await storeGenerated({ status: 'started' });
    repo.getCandidateExerciseById.mockResolvedValue(CHEST_DIP);

    const result =
      await workoutRecommendationService.replaceRecommendationExercise(
        USER_ID,
        BENCH_ID,
        DIP_ID
      );

    expect(repo.upsertWorkoutRecommendation).not.toHaveBeenCalled();
    expect(repo.updateWorkoutRecommendationPayload).toHaveBeenCalledTimes(1);
    // The upsert would have reset both of these; swapping a movement does not
    // make the suggestion newly generated, nor un-start a workout in progress.
    expect(result?.status).toBe('started');
    expect(result?.generated_at).toBe(
      new Date('2026-08-23T10:00:00Z').toISOString()
    );
  });

  it('refuses an exercise that is not in the workout', async () => {
    await storeGenerated();
    repo.getCandidateExerciseById.mockResolvedValue(CHEST_DIP);

    await expect(
      workoutRecommendationService.replaceRecommendationExercise(
        USER_ID,
        PULLDOWN_ID,
        DIP_ID
      )
    ).rejects.toThrow(/not in your current workout/);
    expect(repo.updateWorkoutRecommendationPayload).not.toHaveBeenCalled();
  });

  it('refuses to put the same movement in the workout twice', async () => {
    const before = await storeGenerated();
    const other = before.exercises.find(
      (exercise) => exercise.exercise_id !== BENCH_ID
    );
    repo.getCandidateExerciseById.mockResolvedValue(FLY);

    await expect(
      workoutRecommendationService.replaceRecommendationExercise(
        USER_ID,
        BENCH_ID,
        other?.exercise_id ?? FLY_ID
      )
    ).rejects.toThrow(/already in this workout/);
  });

  it('refuses an exercise the user does not have in their catalog', async () => {
    await storeGenerated();
    repo.getCandidateExerciseById.mockResolvedValue(null);

    await expect(
      workoutRecommendationService.replaceRecommendationExercise(
        USER_ID,
        BENCH_ID,
        DIP_ID
      )
    ).rejects.toThrow(/not in your catalog/);
  });

  it('does not veto a replacement the active gym profile could not have suggested', async () => {
    // The workout was built under a barbell-only profile; the user searched past
    // the suggestions and picked a cable machine anyway. That is a decision, not
    // a candidate to filter.
    const profile = { id: REC_ID, name: 'Home', equipment: ['barbell'] };
    gymRepo.getGymProfile.mockResolvedValue(profile);
    await storeGenerated({ gym_profile_id: REC_ID });
    repo.getCandidateExerciseById.mockResolvedValue(LAT_PULLDOWN);

    const result =
      await workoutRecommendationService.replaceRecommendationExercise(
        USER_ID,
        BENCH_ID,
        PULLDOWN_ID
      );

    expect(
      result?.payload.exercises.map((exercise) => exercise.exercise_id)
    ).toContain(PULLDOWN_ID);
    expect(gymRepo.getGymProfile).toHaveBeenCalledWith(USER_ID, REC_ID);
  });

  it('guards the write on the payload it read', async () => {
    const stored = await storeGenerated();
    repo.getCandidateExerciseById.mockResolvedValue(CHEST_DIP);

    await workoutRecommendationService.replaceRecommendationExercise(
      USER_ID,
      BENCH_ID,
      DIP_ID
    );

    expect(repo.updateWorkoutRecommendationPayload).toHaveBeenCalledWith(
      USER_ID,
      expect.anything(),
      stored
    );
  });

  it('refuses rather than clobbering a workout regenerated underneath it', async () => {
    await storeGenerated();
    repo.getCandidateExerciseById.mockResolvedValue(CHEST_DIP);
    // What a concurrent regenerate looks like from here: the guarded write
    // matches no row. Writing anyway would restore the workout it replaced,
    // minus one exercise.
    repo.updateWorkoutRecommendationPayload.mockResolvedValue(null);

    await expect(
      workoutRecommendationService.replaceRecommendationExercise(
        USER_ID,
        BENCH_ID,
        DIP_ID
      )
    ).rejects.toThrow(/changed while/);
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

  it('passes requested muscles through to the planner', async () => {
    const res = await request(app)
      .post('/api/workout-recommendations/generate')
      .send({ target_muscles: ['lats'] });

    expect(res.status).toBe(200);
    expect(res.body.payload.muscle_groups).toEqual(['lats']);
  });

  // A mis-cased muscle is invisible to `::jsonb ?|`, so accepting it would
  // return a workout built around whatever else was in the list rather than an
  // error. The 400 is the only place this can be caught honestly.
  it('rejects a muscle outside the canonical vocabulary', async () => {
    const res = await request(app)
      .post('/api/workout-recommendations/generate')
      .send({ target_muscles: ['Quadriceps'] });

    expect(res.status).toBe(400);
    expect(repo.upsertWorkoutRecommendation).not.toHaveBeenCalled();
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

  it('replaces an exercise on POST', async () => {
    await storeGenerated();
    repo.getCandidateExerciseById.mockResolvedValue(CHEST_DIP);

    const res = await request(app)
      .post('/api/workout-recommendations/replace')
      .send({ exercise_id_out: BENCH_ID, exercise_id_in: DIP_ID });

    expect(res.status).toBe(200);
    expect(
      res.body.payload.exercises.map((exercise: any) => exercise.exercise_id)
    ).toContain(DIP_ID);
  });

  it('404s a replace before anything has been generated', async () => {
    repo.getWorkoutRecommendation.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/workout-recommendations/replace')
      .send({ exercise_id_out: BENCH_ID, exercise_id_in: DIP_ID });

    expect(res.status).toBe(404);
  });

  it('answers 422, not 500, when the swap cannot be made', async () => {
    await storeGenerated();
    repo.getCandidateExerciseById.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/workout-recommendations/replace')
      .send({ exercise_id_out: BENCH_ID, exercise_id_in: DIP_ID });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/not in your catalog/);
  });

  it('rejects a replace body with a non-uuid id', async () => {
    const res = await request(app)
      .post('/api/workout-recommendations/replace')
      .send({ exercise_id_out: 'nope', exercise_id_in: DIP_ID });

    expect(res.status).toBe(400);
    expect(repo.updateWorkoutRecommendationPayload).not.toHaveBeenCalled();
  });

  it('rejects an unknown key in the replace body rather than ignoring it', async () => {
    const res = await request(app)
      .post('/api/workout-recommendations/replace')
      .send({
        exercise_id_out: BENCH_ID,
        exercise_id_in: DIP_ID,
        swap: true,
      });

    expect(res.status).toBe(400);
  });
});
