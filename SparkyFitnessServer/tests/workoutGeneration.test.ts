import { describe, expect, it } from 'vitest';
import {
  COLD_START_LOAD_KG,
  GENERATION_TUNABLES,
  decideProgression,
  estimateDurationMinutes,
  fitToDuration,
  isEquipmentAvailable,
  isExcludedByLimitations,
  modalWorkingWeightKg,
  planWorkout,
  prescribeSets,
  rationaleFor,
  restSecondsFor,
  selectTargetMuscles,
  warmupSetsFor,
  withWarmups,
  type CandidateExercise,
  type ExerciseHistoryInput,
  type FittableExercise,
  type GenerationOptions,
  type MuscleFreshness,
  type RecommendationSet,
  type RecommendedExercise,
  type Muscle,
  isLowerBodyMuscle,
  MUSCLES,
  MUSCLE_SIZE_RANK,
} from '@workspace/shared';

// --- fixtures ---------------------------------------------------------------

function fresh(
  muscle: string,
  freshness: number,
  lastTrained: string | null = null
): MuscleFreshness {
  return { muscle, freshness, fatigueSets: (1 - freshness) * 10, lastTrained };
}

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

function options(
  overrides: Partial<GenerationOptions> = {}
): GenerationOptions {
  return {
    targetDurationMinutes: 60,
    availableEquipment: null,
    limitations: [],
    goal: 'general',
    ...overrides,
  };
}

function session(
  entryDate: string,
  sets: {
    reps: number | null;
    weight: number | null;
    setType?: string | null;
  }[]
) {
  return {
    entryDate,
    sets: sets.map((set) => ({
      setType: set.setType ?? 'Working Set',
      reps: set.reps,
      weight: set.weight,
    })),
  };
}

function history(
  ...sessions: ReturnType<typeof session>[]
): ExerciseHistoryInput {
  return { lastSessions: sessions, bestSet: null };
}

// --- muscle targeting -------------------------------------------------------

describe('selectTargetMuscles', () => {
  it('takes the freshest muscles above the threshold, capped at the header size', () => {
    const result = selectTargetMuscles([
      fresh('chest', 1),
      fresh('lats', 0.95),
      fresh('quadriceps', 0.9),
      fresh('biceps', 0.85),
      fresh('triceps', 0.8),
      fresh('shoulders', 0.75),
      fresh('calves', 0.7),
    ]);

    expect(result).toHaveLength(GENERATION_TUNABLES.maxTargetMuscles);
    expect(result).toEqual([
      'chest',
      'lats',
      'quadriceps',
      'biceps',
      'triceps',
    ]);
  });

  it('excludes muscles below the freshness threshold', () => {
    const result = selectTargetMuscles([
      fresh('chest', 1),
      fresh('lats', 0.9),
      fresh('quadriceps', 0.49),
      fresh('triceps', 0.2),
    ]);

    expect(result).toEqual(['chest', 'lats']);
  });

  it('still produces a workout when everything is fatigued', () => {
    // Trained everything yesterday. Refusing to suggest anything is worse than
    // suggesting something light, so the two freshest come back regardless.
    const result = selectTargetMuscles([
      fresh('chest', 0.3),
      fresh('lats', 0.2),
      fresh('quadriceps', 0.1),
    ]);

    expect(result).toEqual(['chest', 'lats']);
  });

  it('breaks freshness ties deterministically, whatever order they arrive in', () => {
    const allFresh = ['triceps', 'chest', 'lats', 'biceps', 'calves'].map((m) =>
      fresh(m, 1)
    );

    expect(selectTargetMuscles(allFresh)).toEqual(
      selectTargetMuscles([...allFresh].reverse())
    );
  });

  it('breaks ties by muscle size, not by spelling', () => {
    // A brand-new user has every muscle at exactly 1.0, so the tiebreak alone
    // picks the workout. Ordering those by name is stable, reproducible, and
    // absurd: the canonical list is alphabetical, so the first workout came
    // back as abdominals/abductors/adductors/calves/glutes — five muscles
    // chosen for how they are spelled.
    const untrained = MUSCLES.map((muscle) => fresh(muscle, 1));
    const result = selectTargetMuscles(untrained);

    // Every pick is a large muscle, and the day spans both halves of the body.
    expect(
      result.every((muscle) => MUSCLE_SIZE_RANK[muscle as Muscle] === 0)
    ).toBe(true);
    expect(result.some(isLowerBodyMuscle)).toBe(true);
    expect(result.some((muscle) => !isLowerBodyMuscle(muscle))).toBe(true);
    for (const spelled of ['abdominals', 'abductors', 'adductors', 'calves']) {
      expect(result).not.toContain(spelled);
    }
  });

  it('still prefers a fresher small muscle over a fatigued large one', () => {
    // Size is only a tiebreak. It must not outrank the actual evidence.
    const result = selectTargetMuscles([
      fresh('biceps', 1),
      fresh('chest', 0.6),
    ]);

    expect(result[0]).toBe('biceps');
  });

  it('gives the last slot to the other half of the body when the picks are all upper', () => {
    // A heavy leg day leaves the whole upper body at 1.0, so an unguarded
    // ranking returns five upper-body muscles and never trains legs again.
    const result = selectTargetMuscles([
      fresh('chest', 1),
      fresh('lats', 1),
      fresh('shoulders', 0.95),
      fresh('biceps', 0.9),
      fresh('triceps', 0.85),
      fresh('quadriceps', 0.7),
    ]);

    expect(result).toContain('quadriceps');
    expect(result).toHaveLength(5);
    expect(result[result.length - 1]).toBe('quadriceps');
  });

  it('swaps in an upper-body muscle when the picks are all lower', () => {
    const result = selectTargetMuscles([
      fresh('quadriceps', 1),
      fresh('hamstrings', 1),
      fresh('glutes', 0.95),
      fresh('calves', 0.9),
      fresh('adductors', 0.85),
      fresh('chest', 0.8),
    ]);

    expect(result).toContain('chest');
    expect(result[result.length - 1]).toBe('chest');
  });

  it('does not swap when the other half is too fatigued to earn it', () => {
    const result = selectTargetMuscles([
      fresh('chest', 1),
      fresh('lats', 1),
      fresh('shoulders', 0.95),
      fresh('biceps', 0.9),
      fresh('triceps', 0.85),
      fresh('quadriceps', 0.55),
    ]);

    // 0.55 clears the targeting threshold but not the balance-swap bar, so the
    // workout stays upper rather than programming onto sore legs.
    expect(result).not.toContain('quadriceps');
  });

  it('leaves a mixed selection alone', () => {
    const result = selectTargetMuscles([
      fresh('chest', 1),
      fresh('quadriceps', 0.9),
    ]);

    expect(result).toEqual(['chest', 'quadriceps']);
  });

  it('returns nothing for an empty vector', () => {
    expect(selectTargetMuscles([])).toEqual([]);
  });
});

// --- filtering --------------------------------------------------------------

describe('isEquipmentAvailable', () => {
  it('allows everything when no gym profile is active', () => {
    expect(isEquipmentAvailable(['barbell', 'cable'], null)).toBe(true);
  });

  it('requires every item, not merely one', () => {
    // The catalog's browse filter is an overlap test; reusing it here would
    // offer a barbell+cable movement to someone who owns only dumbbells.
    expect(isEquipmentAvailable(['dumbbell', 'barbell'], ['dumbbell'])).toBe(
      false
    );
    expect(isEquipmentAvailable(['dumbbell'], ['dumbbell', 'bands'])).toBe(
      true
    );
  });

  it('treats an exercise with no equipment as available anywhere', () => {
    // Most user-created exercises record no equipment. Dropping them would
    // hide the user's own catalog from their own workout.
    expect(isEquipmentAvailable([], ['dumbbell'])).toBe(true);
    expect(isEquipmentAvailable([''], ['dumbbell'])).toBe(true);
  });

  it('always allows body-only work', () => {
    expect(isEquipmentAvailable(['body only'], ['dumbbell'])).toBe(true);
  });

  it('matches case-insensitively, since the column is uncanonicalized free text', () => {
    expect(isEquipmentAvailable([' Dumbbell '], ['dumbbell'])).toBe(true);
  });

  it('filters everything equipment-dependent out of an empty active profile', () => {
    expect(isEquipmentAvailable(['barbell'], [])).toBe(false);
    expect(isEquipmentAvailable(['body only'], [])).toBe(true);
  });
});

describe('isExcludedByLimitations', () => {
  it('passes everything when no limitations are stated', () => {
    expect(isExcludedByLimitations(candidate({ id: 'a' }), [])).toBe(false);
  });

  it('excludes on a name match', () => {
    expect(
      isExcludedByLimitations(
        candidate({ id: 'a', name: 'Barbell Shoulder Press' }),
        ['shoulder']
      )
    ).toBe(true);
  });

  it('excludes on a muscle match, primary or secondary', () => {
    expect(
      isExcludedByLimitations(
        candidate({ id: 'a', name: 'Bench Press', primaryMuscles: ['chest'] }),
        ['chest']
      )
    ).toBe(true);
    expect(
      isExcludedByLimitations(
        candidate({ id: 'a', name: 'Row', secondaryMuscles: ['lower back'] }),
        ['lower back']
      )
    ).toBe(true);
  });

  it('ignores blank limitation entries', () => {
    expect(isExcludedByLimitations(candidate({ id: 'a' }), ['', '  '])).toBe(
      false
    );
  });
});

// --- planning ---------------------------------------------------------------

const CHEST_COMPOUND = candidate({
  id: 'c1',
  name: 'Bench Press',
  primaryMuscles: ['chest'],
  mechanic: 'compound',
});
const CHEST_ISOLATION = candidate({
  id: 'c2',
  name: 'Cable Fly',
  primaryMuscles: ['chest'],
  mechanic: 'isolation',
  equipment: ['cable'],
});
const LAT_COMPOUND = candidate({
  id: 'l1',
  name: 'Barbell Row',
  primaryMuscles: ['lats'],
  mechanic: 'compound',
});
const LAT_ISOLATION = candidate({
  id: 'l2',
  name: 'Straight-Arm Pulldown',
  primaryMuscles: ['lats'],
  mechanic: 'isolation',
  equipment: ['cable'],
});

describe('planWorkout', () => {
  const freshness = [fresh('chest', 1), fresh('lats', 0.9)];
  const pool = [CHEST_COMPOUND, CHEST_ISOLATION, LAT_COMPOUND, LAT_ISOLATION];

  it('slots one compound and one isolation per target muscle', () => {
    const plan = planWorkout(freshness, pool, options());

    expect(plan.targetMuscles).toEqual(['chest', 'lats']);
    expect(plan.exercises.map((e) => e.candidate.id)).toHaveLength(4);
    expect(
      plan.exercises
        .filter((e) => e.slot === 'compound')
        .map((e) => e.candidate.id)
    ).toEqual(['c1', 'l1']);
  });

  it('puts compounds before isolation', () => {
    const plan = planWorkout(freshness, pool, options());
    const slots = plan.exercises.map((e) => e.slot);

    expect(slots).toEqual(['compound', 'compound', 'isolation', 'isolation']);
  });

  it('prefers a movement the user has performed before', () => {
    const known = candidate({
      id: 'c9',
      primaryMuscles: ['chest'],
      mechanic: 'compound',
      timesPerformed: 12,
    });
    const plan = planWorkout(
      [fresh('chest', 1), fresh('lats', 0.9)],
      [CHEST_COMPOUND, known, LAT_COMPOUND],
      options()
    );

    expect(
      plan.exercises.find((e) => e.targetMuscle === 'chest')?.candidate.id
    ).toBe('c9');
  });

  it('prefers a candidate matching the stated experience level', () => {
    const matched = candidate({
      id: 'c9',
      primaryMuscles: ['chest'],
      mechanic: 'compound',
      level: 'beginner',
    });
    const plan = planWorkout(
      [fresh('chest', 1), fresh('lats', 0.9)],
      [CHEST_COMPOUND, matched, LAT_COMPOUND],
      options({ experienceLevel: 'beginner' })
    );

    expect(
      plan.exercises.find((e) => e.targetMuscle === 'chest')?.candidate.id
    ).toBe('c9');
  });

  it('never uses the same exercise twice, even when it is the only option for two muscles', () => {
    // A soft score penalty would let this through, and the result is not a
    // slightly worse workout — it is the same card rendered twice.
    const shared = candidate({
      id: 'shared',
      primaryMuscles: ['chest', 'shoulders'],
      mechanic: 'compound',
    });
    const plan = planWorkout(
      [fresh('chest', 1), fresh('shoulders', 0.9)],
      [shared],
      options()
    );

    const ids = plan.exercises.map((e) => e.candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filters candidates the gym profile cannot support', () => {
    const plan = planWorkout(
      freshness,
      pool,
      options({ availableEquipment: ['barbell'] })
    );

    // The cable movements are gone; the barbell ones survive.
    expect(plan.exercises.map((e) => e.candidate.id).sort()).toEqual([
      'c1',
      'l1',
    ]);
  });

  it('filters candidates a limitation rules out', () => {
    const plan = planWorkout(
      freshness,
      pool,
      options({ limitations: ['lats'] })
    );

    expect(plan.exercises.every((e) => e.targetMuscle !== 'lats')).toBe(true);
  });

  it('falls back to an isolation movement when a muscle has no compound', () => {
    // A machine-only gym may genuinely have no compound for a muscle. An empty
    // slot is worse than an isolation one.
    const plan = planWorkout(
      [fresh('chest', 1), fresh('lats', 0.9)],
      [CHEST_ISOLATION, LAT_COMPOUND],
      options()
    );

    expect(
      plan.exercises.find((e) => e.targetMuscle === 'chest')?.candidate.id
    ).toBe('c2');
  });

  it('penalises the outgoing workout on swap without hard-excluding it', () => {
    const otherChestCompound = candidate({
      id: 'c8',
      name: 'Incline Press',
      primaryMuscles: ['chest'],
      mechanic: 'compound',
    });

    // Another chest compound exists, so the swapped-away one loses its slot...
    const swapped = planWorkout(
      [fresh('chest', 1), fresh('lats', 0.9)],
      [CHEST_COMPOUND, otherChestCompound, LAT_COMPOUND],
      options({ excludeIds: ['c1'] })
    );
    expect(
      swapped.exercises.find((e) => e.slot === 'compound')?.candidate.id
    ).toBe('c8');

    // ...but when it is the only one, a penalised exercise still beats an empty
    // slot. Swap prefers a different movement; it cannot promise one.
    const soleOption = planWorkout(
      [fresh('chest', 1), fresh('lats', 0.9)],
      [CHEST_COMPOUND, LAT_COMPOUND],
      options({ excludeIds: ['c1'] })
    );
    expect(soleOption.exercises.map((e) => e.candidate.id).sort()).toEqual([
      'c1',
      'l1',
    ]);
  });

  it('keeps the swap penalty inside its slot — a swap still returns a compound', () => {
    // The penalty ranks within the compound pool and the isolation pool
    // separately. Letting it cross would mean swapping away the bench press
    // and being handed a cable fly as the day's main chest movement.
    const plan = planWorkout(
      [fresh('chest', 1), fresh('lats', 0.9)],
      pool,
      options({ excludeIds: ['c1'] })
    );

    expect(plan.exercises.find((e) => e.targetMuscle === 'chest')?.slot).toBe(
      'compound'
    );
  });

  it('surfaces unused isolation picks as alternates for the duration fitter', () => {
    const extra = candidate({
      id: 'c3',
      primaryMuscles: ['chest'],
      mechanic: 'isolation',
    });
    const plan = planWorkout(freshness, [...pool, extra], options());

    expect(plan.alternates.map((a) => a.candidate.id)).toContain('c3');
    expect(
      plan.alternates.every(
        (a) => !plan.exercises.some((e) => e.candidate.id === a.candidate.id)
      )
    ).toBe(true);
  });

  it('is deterministic regardless of candidate input order', () => {
    const forwards = planWorkout(freshness, pool, options());
    const backwards = planWorkout(freshness, [...pool].reverse(), options());

    expect(forwards).toEqual(backwards);
  });

  it('produces nothing rather than throwing on an empty catalog', () => {
    const plan = planWorkout(freshness, [], options());

    expect(plan.exercises).toEqual([]);
    expect(plan.targetMuscles).toEqual(['chest', 'lats']);
  });
});

// --- prescription -----------------------------------------------------------

describe('prescribeSets', () => {
  it('cold-starts an unseen barbell lift at an empty bar', () => {
    const result = prescribeSets(candidate({ id: 'a' }), null, options());

    expect(result.progression).toBe('cold-start');
    expect(result.workingWeightKg).toBe(COLD_START_LOAD_KG.barbell);
    expect(result.sets).toHaveLength(GENERATION_TUNABLES.workingSetsDefault);
    expect(result.sets.every((s) => s.weight === 20 && s.reps === 10)).toBe(
      true
    );
  });

  it('cold-starts with no load at all when the equipment suggests none', () => {
    const result = prescribeSets(
      candidate({ id: 'a', equipment: ['body only'] }),
      null,
      options()
    );

    // Better a reps-only prescription than an invented number.
    expect(result.workingWeightKg).toBeNull();
    expect(result.sets.every((s) => s.weight === null)).toBe(true);
  });

  it('programs four sets of five for strength and three of ten otherwise', () => {
    const strength = prescribeSets(
      candidate({ id: 'a' }),
      null,
      options({ goal: 'strength' })
    );
    const hypertrophy = prescribeSets(
      candidate({ id: 'a' }),
      null,
      options({ goal: 'hypertrophy' })
    );

    expect(strength.sets).toHaveLength(GENERATION_TUNABLES.workingSetsStrength);
    expect(strength.sets[0]!.reps).toBe(GENERATION_TUNABLES.repTargetStrength);
    expect(hypertrophy.sets).toHaveLength(
      GENERATION_TUNABLES.workingSetsDefault
    );
    expect(hypertrophy.sets[0]!.reps).toBe(
      GENERATION_TUNABLES.repTargetHypertrophy
    );
  });

  it('adds 2.5% on an upper-body lift after a clean session', () => {
    const result = prescribeSets(
      candidate({ id: 'a', primaryMuscles: ['chest'] }),
      history(
        session('2026-08-20', [
          { reps: 10, weight: 80 },
          { reps: 10, weight: 80 },
          { reps: 11, weight: 80 },
        ])
      ),
      options()
    );

    expect(result.progression).toBe('increase');
    // 80 × 1.025 = 82, snapped up to the nearest loadable 2.5 kg barbell step.
    expect(result.workingWeightKg).toBe(82.5);
  });

  it('adds 5% on a lower-body lift, where 2.5% is less than a plate', () => {
    const result = prescribeSets(
      candidate({ id: 'a', primaryMuscles: ['quadriceps'] }),
      history(
        session('2026-08-20', [
          { reps: 10, weight: 100 },
          { reps: 10, weight: 100 },
        ])
      ),
      options()
    );

    expect(result.progression).toBe('increase');
    expect(result.workingWeightKg).toBe(105);
  });

  it('holds when even one working set missed the target', () => {
    const result = prescribeSets(
      candidate({ id: 'a' }),
      history(
        session('2026-08-20', [
          { reps: 10, weight: 80 },
          { reps: 9, weight: 80 },
        ])
      ),
      options()
    );

    expect(result.progression).toBe('hold');
    expect(result.workingWeightKg).toBe(80);
  });

  it('holds after a single bad session rather than chasing noise downward', () => {
    const result = prescribeSets(
      candidate({ id: 'a' }),
      history(
        session('2026-08-20', [{ reps: 5, weight: 80 }]),
        session('2026-08-17', [{ reps: 10, weight: 80 }])
      ),
      options()
    );

    expect(result.progression).toBe('hold');
  });

  it('deloads 5% after two short sessions running', () => {
    const result = prescribeSets(
      candidate({ id: 'a' }),
      history(
        session('2026-08-20', [{ reps: 5, weight: 80 }]),
        session('2026-08-17', [{ reps: 6, weight: 80 }])
      ),
      options()
    );

    expect(result.progression).toBe('decrease');
    // 80 × 0.95 = 76, snapped to the barbell's 2.5 kg step.
    expect(result.workingWeightKg).toBe(75);
  });

  it('ignores warm-up sets when reading the last session', () => {
    const result = prescribeSets(
      candidate({ id: 'a' }),
      history(
        session('2026-08-20', [
          { reps: 8, weight: 40, setType: 'Warm-up' },
          { reps: 10, weight: 80 },
          { reps: 10, weight: 80 },
        ])
      ),
      options()
    );

    // The 40 kg ramp is neither the baseline nor a missed target.
    expect(result.progression).toBe('increase');
    expect(result.workingWeightKg).toBe(82.5);
  });

  it('cold-starts when the last session logged no usable weight', () => {
    const result = prescribeSets(
      candidate({ id: 'a' }),
      history(session('2026-08-20', [{ reps: 10, weight: null }])),
      options()
    );

    expect(result.workingWeightKg).toBe(COLD_START_LOAD_KG.barbell);
  });

  it('leaves the weight blank for equipment that has no kilogram', () => {
    // A band has no plate to pick and no honest cold-start load. The catalog
    // still calls it weight_reps, because the modality comes from the category,
    // so the prescription has to say "no number" rather than invent one — the
    // first live band exercise the engine ever slotted was a skull crusher and
    // any weight it printed would have been fiction.
    for (const equipment of ['bands', 'body only', 'exercise ball']) {
      const result = prescribeSets(
        candidate({ id: 'a', equipment: [equipment] }),
        null,
        options()
      );

      expect(result.workingWeightKg).toBeNull();
      expect(result.sets.every((set) => set.weight === null)).toBe(true);
      // Still a usable prescription: the reps and the rest are real.
      expect(result.sets.length).toBeGreaterThan(0);
      expect(result.sets.every((set) => (set.reps ?? 0) > 0)).toBe(true);
    }
  });

  it('quantizes to a load that exists on the gym floor', () => {
    const result = prescribeSets(
      candidate({ id: 'a', equipment: ['barbell'] }),
      history(session('2026-08-20', [{ reps: 10, weight: 61.3 }])),
      options()
    );

    // Not 62.83. A barbell moves in 2.5 kg steps and nothing else is loadable.
    expect((result.workingWeightKg! * 10) % 25).toBe(0);
  });

  it('leaves weight null for a reps-only movement', () => {
    const result = prescribeSets(
      candidate({ id: 'a', modality: 'reps_only', equipment: ['body only'] }),
      null,
      options()
    );

    expect(result.sets.every((s) => s.weight === null && s.reps === 10)).toBe(
      true
    );
  });

  it('programs a hold as duration sets, not reps', () => {
    const result = prescribeSets(
      candidate({ id: 'a', modality: 'duration', equipment: ['body only'] }),
      null,
      options()
    );

    expect(result.sets).toHaveLength(GENERATION_TUNABLES.workingSetsDefault);
    expect(
      result.sets.every(
        (s) =>
          s.reps === null &&
          s.weight === null &&
          s.duration === GENERATION_TUNABLES.defaultDurationSeconds
      )
    ).toBe(true);
  });

  it('carries a hold duration forward from history', () => {
    const result = prescribeSets(
      candidate({ id: 'a', modality: 'duration' }),
      {
        lastSessions: [
          {
            entryDate: '2026-08-20',
            sets: [
              {
                setType: 'Working Set',
                reps: null,
                weight: null,
                duration: 90,
              },
            ],
          },
        ],
        bestSet: null,
      },
      options()
    );

    expect(result.sets[0]!.duration).toBe(90);
  });

  it('programs cardio as one block with a distance, not a set scheme', () => {
    const result = prescribeSets(
      candidate({ id: 'a', modality: 'duration_distance' }),
      {
        lastSessions: [
          {
            entryDate: '2026-08-20',
            sets: [
              {
                setType: 'Working Set',
                reps: null,
                weight: null,
                duration: 1800,
                distance: 5,
              },
            ],
          },
        ],
        bestSet: null,
      },
      options()
    );

    expect(result.sets).toHaveLength(1);
    expect(result.sets[0]!.duration).toBe(1800);
    expect(result.sets[0]!.distance).toBe(5);
  });

  it('falls back to a default cardio block with no history', () => {
    const result = prescribeSets(
      candidate({ id: 'a', modality: 'duration_distance' }),
      null,
      options()
    );

    expect(result.sets[0]!.duration).toBe(
      GENERATION_TUNABLES.defaultCardioSeconds
    );
    expect(result.sets[0]!.distance).toBeNull();
  });

  it('is deterministic', () => {
    const input = history(session('2026-08-20', [{ reps: 10, weight: 80 }]));
    expect(prescribeSets(candidate({ id: 'a' }), input, options())).toEqual(
      prescribeSets(candidate({ id: 'a' }), input, options())
    );
  });
});

describe('modalWorkingWeightKg', () => {
  it('takes the most common load, not the heaviest', () => {
    // A top set with two back-offs: the max overstates what the session was.
    expect(
      modalWorkingWeightKg(
        session('2026-08-20', [
          { reps: 5, weight: 100 },
          { reps: 8, weight: 80 },
          { reps: 8, weight: 80 },
        ])
      )
    ).toBe(80);
  });

  it('breaks a tie toward the heavier load', () => {
    expect(
      modalWorkingWeightKg(
        session('2026-08-20', [
          { reps: 5, weight: 100 },
          { reps: 5, weight: 100 },
          { reps: 8, weight: 80 },
          { reps: 8, weight: 80 },
        ])
      )
    ).toBe(100);
  });

  it('returns null when nothing was loaded', () => {
    expect(
      modalWorkingWeightKg(session('2026-08-20', [{ reps: 10, weight: null }]))
    ).toBeNull();
  });
});

describe('decideProgression', () => {
  it('reports a cold start when there is no history at all', () => {
    expect(decideProgression({ lastSessions: [], bestSet: null }, 10)).toBe(
      'cold-start'
    );
  });

  it('holds when the last session logged no reps', () => {
    expect(
      decideProgression(
        history(session('2026-08-20', [{ reps: null, weight: 80 }])),
        10
      )
    ).toBe('hold');
  });
});

describe('restSecondsFor', () => {
  it('gives a strength compound three minutes and a general one two', () => {
    expect(restSecondsFor('compound', 'weight_reps', 'strength')).toBe(180);
    expect(restSecondsFor('compound', 'weight_reps', 'general')).toBe(120);
  });

  it('gives isolation ninety seconds and cardio one minute', () => {
    expect(restSecondsFor('isolation', 'weight_reps', 'strength')).toBe(90);
    expect(restSecondsFor('compound', 'duration_distance', 'strength')).toBe(
      60
    );
  });
});

describe('rationaleFor', () => {
  it('states the actual step it applied', () => {
    const increase = prescribeSets(
      candidate({ id: 'a', primaryMuscles: ['quadriceps'] }),
      history(session('2026-08-20', [{ reps: 10, weight: 100 }])),
      options()
    );

    expect(rationaleFor('quadriceps', increase)).toBe(
      'fresh quadriceps · +5% from last session'
    );
  });

  it('names a first session as one', () => {
    expect(
      rationaleFor(
        'chest',
        prescribeSets(candidate({ id: 'a' }), null, options())
      )
    ).toBe('fresh chest · first time — starting light');
  });
});

// --- warm-ups ---------------------------------------------------------------

describe('warmupSetsFor', () => {
  it('adds nothing below the ramp threshold — the bar is the warm-up', () => {
    expect(warmupSetsFor(29.9, ['barbell'])).toEqual([]);
    expect(warmupSetsFor(null, ['barbell'])).toEqual([]);
  });

  it('adds a single ramp set from the threshold up', () => {
    const result = warmupSetsFor(30, ['barbell']);

    expect(result).toHaveLength(1);
    expect(result[0]!.set_type).toBe('Warmup');
    expect(result[0]!.reps).toBe(GENERATION_TUNABLES.warmupSingleReps);
    // 60% of 30 = 18, loadable on a barbell.
    expect(result[0]!.weight).toBe(17.5);
  });

  it('still adds one ramp set just below the two-step threshold', () => {
    expect(warmupSetsFor(59.9, ['barbell'])).toHaveLength(1);
  });

  it('adds two ramp sets at and above the two-step threshold', () => {
    const result = warmupSetsFor(60, ['barbell']);

    expect(result).toHaveLength(2);
    expect(result.map((s) => s.weight)).toEqual([27.5, 42.5]);
    expect(result.map((s) => s.reps)).toEqual([
      GENERATION_TUNABLES.warmupFirstReps,
      GENERATION_TUNABLES.warmupSecondReps,
    ]);
    expect(result.every((s) => s.rest_time === 60)).toBe(true);
  });

  it('never ramps a non-weight modality', () => {
    expect(warmupSetsFor(100, ['barbell'], 'duration')).toEqual([]);
    expect(warmupSetsFor(100, ['barbell'], 'duration_distance')).toEqual([]);
  });
});

describe('withWarmups', () => {
  it('puts warm-ups first and renumbers the whole list', () => {
    const working: RecommendationSet[] = [
      {
        set_number: 1,
        set_type: 'Working Set',
        reps: 10,
        weight: 80,
        duration: null,
        distance: null,
        rest_time: 120,
      },
      {
        set_number: 2,
        set_type: 'Working Set',
        reps: 10,
        weight: 80,
        duration: null,
        distance: null,
        rest_time: 120,
      },
    ];
    const result = withWarmups(working, warmupSetsFor(80, ['barbell']));

    expect(result.map((s) => s.set_number)).toEqual([1, 2, 3, 4]);
    expect(result.map((s) => s.set_type)).toEqual([
      'Warmup',
      'Warmup',
      'Working Set',
      'Working Set',
    ]);
  });
});

// --- duration ---------------------------------------------------------------

function recommended(
  overrides: Partial<RecommendedExercise> & { exercise_id: string }
): RecommendedExercise {
  return {
    exercise_name: 'Exercise',
    modality: 'weight_reps',
    primary_muscles: ['chest'],
    secondary_muscles: [],
    equipment: ['barbell'],
    images: [],
    sort_order: 0,
    rest_seconds: 120,
    rationale: '',
    sets: [
      {
        set_number: 1,
        set_type: 'Working Set',
        reps: 10,
        weight: 80,
        duration: null,
        distance: null,
        rest_time: 120,
      },
    ],
    ...overrides,
  };
}

function fittable(
  exercise: RecommendedExercise,
  slot: 'compound' | 'isolation',
  targetMuscle: string
): FittableExercise {
  return { exercise, slot, targetMuscle };
}

function withSets(
  exercise: RecommendedExercise,
  count: number
): RecommendedExercise {
  return {
    ...exercise,
    sets: Array.from({ length: count }, (_, i) => ({
      ...exercise.sets[0]!,
      set_number: i + 1,
    })),
  };
}

describe('estimateDurationMinutes', () => {
  it('charges work, rest and a per-exercise setup overhead', () => {
    const result = estimateDurationMinutes([recommended({ exercise_id: 'a' })]);

    // 90s setup + (10 reps × 4s) + 120s rest = 250s -> 5 minutes.
    expect(result).toBe(5);
  });

  it('uses a set duration in place of reps when the set has one', () => {
    const plank = recommended({
      exercise_id: 'a',
      sets: [
        {
          set_number: 1,
          set_type: 'Working Set',
          reps: null,
          weight: null,
          duration: 60,
          distance: null,
          rest_time: 60,
        },
      ],
    });

    // 90 + 60 + 60 = 210s -> 4 minutes.
    expect(estimateDurationMinutes([plank])).toBe(4);
  });

  it('is zero for an empty workout', () => {
    expect(estimateDurationMinutes([])).toBe(0);
  });
});

describe('fitToDuration', () => {
  const chestCompound = fittable(
    withSets(recommended({ exercise_id: 'c1' }), 3),
    'compound',
    'chest'
  );
  const chestIsolation = fittable(
    withSets(recommended({ exercise_id: 'c2' }), 3),
    'isolation',
    'chest'
  );
  const latCompound = fittable(
    withSets(recommended({ exercise_id: 'l1' }), 3),
    'compound',
    'lats'
  );
  const latIsolation = fittable(
    withSets(recommended({ exercise_id: 'l2' }), 3),
    'isolation',
    'lats'
  );

  it('leaves a workout that already fits alone', () => {
    const items = [chestCompound, latCompound];
    const result = fitToDuration(items, 60, [], ['chest', 'lats']);

    expect(result.map((e) => e.exercise_id)).toEqual(['c1', 'l1']);
  });

  it('drops isolation work first, from the least fresh muscle', () => {
    const result = fitToDuration(
      [chestCompound, chestIsolation, latCompound, latIsolation],
      30,
      [],
      ['chest', 'lats']
    );
    const ids = result.map((e) => e.exercise_id);

    // lats is the second target, so its isolation goes before chest's — and
    // only as much comes off as the budget needs.
    expect(ids).toEqual(['c1', 'c2', 'l1']);
  });

  it('will not strand a target muscle by dropping its only exercise', () => {
    // chest has an isolation-only slot here. Removing it to save time would
    // hand back a "chest and back" workout with no chest in it, which is not a
    // shorter version of the workout — it is a different one.
    const result = fitToDuration(
      [chestIsolation, latCompound, latIsolation],
      1,
      [],
      ['chest', 'lats']
    );

    expect(result.map((e) => e.exercise_id)).toContain('c2');
  });

  it('never drops a compound, even when it cannot reach the budget', () => {
    const result = fitToDuration(
      [chestCompound, latCompound],
      1,
      [],
      ['chest', 'lats']
    );

    expect(result.map((e) => e.exercise_id).sort()).toEqual(['c1', 'l1']);
  });

  it('trims fourth sets once there is no isolation work left to drop', () => {
    const strength = fittable(
      withSets(recommended({ exercise_id: 's1' }), 4),
      'compound',
      'chest'
    );
    const result = fitToDuration([strength], 9, [], ['chest']);

    expect(result[0]!.sets).toHaveLength(
      GENERATION_TUNABLES.workingSetsDefault
    );
    expect(result[0]!.sets.map((s) => s.set_number)).toEqual([1, 2, 3]);
  });

  it('adds a pre-programmed alternate when the workout comes in well short', () => {
    const result = fitToDuration(
      [chestCompound],
      60,
      [chestIsolation, latIsolation],
      ['chest', 'lats']
    );

    expect(result.length).toBeGreaterThan(1);
    expect(result.map((e) => e.exercise_id)).toContain('c2');
  });

  it('does not add an alternate that would overrun the budget', () => {
    const result = fitToDuration(
      [chestCompound],
      20,
      [chestIsolation],
      ['chest']
    );

    expect(estimateDurationMinutes(result)).toBeLessThanOrEqual(20);
  });

  it('never adds an exercise the workout already has', () => {
    const result = fitToDuration(
      [chestCompound, chestIsolation],
      120,
      [chestIsolation],
      ['chest']
    );
    const ids = result.map((e) => e.exercise_id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('renumbers sort_order across the final list', () => {
    const result = fitToDuration(
      [chestCompound, latCompound],
      60,
      [],
      ['chest', 'lats']
    );

    expect(result.map((e) => e.sort_order)).toEqual([0, 1]);
  });

  it('is deterministic', () => {
    const items = [chestCompound, chestIsolation, latCompound, latIsolation];
    expect(fitToDuration(items, 30, [], ['chest', 'lats'])).toEqual(
      fitToDuration(items, 30, [], ['chest', 'lats'])
    );
  });
});
