import { describe, expect, it } from 'vitest';
import {
  COLD_START_LOAD_KG,
  GENERATION_TUNABLES,
  decideProgression,
  deriveExperienceLevel,
  estimateDurationMinutes,
  fitToDuration,
  isEquipmentAvailable,
  isExcludedByLimitations,
  isMobilityExercise,
  isPerformable,
  modalWorkingWeightKg,
  planWorkout,
  prescribeSets,
  rationaleFor,
  restSecondsFor,
  selectTargetMuscles,
  warmupSetsFor,
  withWarmups,
  workingSetCountFor,
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
  MUSCLE_SPLIT_MEMBERS,
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

function options(
  overrides: Partial<GenerationOptions> = {}
): GenerationOptions {
  return {
    targetDurationMinutes: 60,
    availableEquipment: null,
    availableApparatus: null,
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
    duration?: number | null;
  }[]
) {
  return {
    entryDate,
    sets: sets.map((set) => ({
      setType: set.setType ?? 'Working Set',
      reps: set.reps,
      weight: set.weight,
      duration: set.duration ?? null,
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

// --- client-requested muscles -----------------------------------------------

describe('selectTargetMuscles with requested muscles', () => {
  // Fatigued legs and a fully fresh upper body: every unguarded rule in the
  // function — the freshness floor, the cap, the balance swap — wants to
  // change this answer.
  const legDayYesterday = [
    fresh('chest', 1),
    fresh('lats', 1),
    fresh('shoulders', 1),
    fresh('biceps', 1),
    fresh('triceps', 1),
    fresh('quadriceps', 0.1),
    fresh('hamstrings', 0.1),
    fresh('glutes', 0.15),
  ];

  it('honours the request exactly, in the order asked for', () => {
    expect(
      selectTargetMuscles(legDayYesterday, ['hamstrings', 'quadriceps'])
    ).toEqual(['hamstrings', 'quadriceps']);
  });

  it('does not add a muscle for balance', () => {
    // The user asked for legs on sore legs. That is a decision, not a mistake,
    // and the picker already showed them the recovery percentage.
    const result = selectTargetMuscles(legDayYesterday, [
      'quadriceps',
      'hamstrings',
      'glutes',
    ]);

    expect(result).toEqual(['quadriceps', 'hamstrings', 'glutes']);
    expect(result.every(isLowerBodyMuscle)).toBe(true);
  });

  it('does not clamp a request to the automatic cap', () => {
    const upperBody = [...MUSCLE_SPLIT_MEMBERS['upper body']];
    const result = selectTargetMuscles(legDayYesterday, upperBody);

    expect(result).toEqual(upperBody);
    expect(result.length).toBeGreaterThan(GENERATION_TUNABLES.maxTargetMuscles);
  });

  it('ignores freshness entirely, including muscles it has no score for', () => {
    // `neck` is absent from this freshness vector. Ranking would drop it;
    // honouring the request keeps it.
    expect(selectTargetMuscles(legDayYesterday, ['neck'])).toEqual(['neck']);
  });

  it('treats an empty request as no request', () => {
    expect(selectTargetMuscles(legDayYesterday, [])).toEqual(
      selectTargetMuscles(legDayYesterday)
    );
  });

  it('falls back to ranking when nothing in the request is canonical', () => {
    // Not a silent empty workout: an unrecognized muscle cannot be matched by
    // `::jsonb ?|` anyway, so the useful answer is the one the engine would
    // have given on its own. The HTTP contract rejects these before here.
    expect(selectTargetMuscles(legDayYesterday, ['quads', 'legs'])).toEqual(
      selectTargetMuscles(legDayYesterday)
    );
  });

  it('canonicalizes and de-duplicates what it is given', () => {
    expect(
      selectTargetMuscles(legDayYesterday, [
        ' Quadriceps ',
        'quadriceps',
        'HAMSTRINGS',
        'not a muscle',
      ])
    ).toEqual(['quadriceps', 'hamstrings']);
  });

  it('stays deterministic across repeated calls', () => {
    const request = [...MUSCLE_SPLIT_MEMBERS['pull']];
    const first = selectTargetMuscles(legDayYesterday, request);
    const second = selectTargetMuscles(legDayYesterday, request);

    expect(first).toEqual(second);
    expect(first).toEqual(request);
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

  it('keeps opt-in gear out even with no gym profile', () => {
    // `other` is Atlas Stones, Car Deadlift and Battling Ropes, not an
    // "unclassified" bucket — the W7 live run offered an Atlas Stone Trainer to
    // an account that had simply never made a profile. Not having said where
    // you train is not a claim to own a strongman yard.
    expect(isEquipmentAvailable(['other'], null)).toBe(false);
    expect(isEquipmentAvailable(['other'], ['barbell'])).toBe(false);
    expect(isEquipmentAvailable(['other'], ['other'])).toBe(true);
    // Everything else still passes freely with no profile.
    expect(isEquipmentAvailable(['barbell', 'cable'], null)).toBe(true);
  });
});

describe('isPerformable', () => {
  it('rules out an exercise the profile cannot equip', () => {
    expect(
      isPerformable(
        candidate({ id: 'a', equipment: ['barbell'] }),
        ['dumbbell'],
        null
      )
    ).toBe(false);
  });

  it('rules out a pull-up for a home profile that says body only', () => {
    // `Chin-Up` is `body only` upstream, so the equipment test passes it and
    // the W7 gate duly put it in a dumbbells-and-bands session. The apparatus
    // override is what catches it.
    expect(isEquipmentAvailable(CHIN_UP.equipment, ['dumbbell', 'bands'])).toBe(
      true
    );
    expect(isPerformable(CHIN_UP, ['dumbbell', 'bands'], null)).toBe(false);
  });

  it('allows it where the profile implies a bar', () => {
    expect(isPerformable(CHIN_UP, ['dumbbell', 'cable', 'machine'], null)).toBe(
      true
    );
    expect(isPerformable(CHIN_UP, ['barbell'], null)).toBe(true);
    // And with no profile at all, like every other availability rule here.
    expect(isPerformable(CHIN_UP, null, null)).toBe(true);
  });

  it('lets logged history overrule the inference', () => {
    // Apparatus availability is a guess about the room; having done the
    // exercise ten times is evidence about it.
    expect(
      isPerformable(
        { ...CHIN_UP, timesPerformed: 10 },
        ['dumbbell', 'bands'],
        null
      )
    ).toBe(true);
  });

  it('does not let history overrule the profile itself', () => {
    // A barbell squat logged at the gym last month is still not doable in a
    // dumbbell-only garage today. The profile is a statement, not a guess.
    expect(
      isPerformable(
        candidate({ id: 'a', equipment: ['barbell'], timesPerformed: 50 }),
        ['dumbbell'],
        null
      )
    ).toBe(false);
  });

  it('admits an exercise its stated apparatus covers', () => {
    // A dumbbell garage with a stated pull-up bar gets Chin-Up, which the
    // inference would have denied it — that's what stating apparatus is FOR.
    expect(isPerformable(CHIN_UP, ['dumbbell', 'bands'], ['pull-up bar'])).toBe(
      true
    );
  });

  it('rules out an exercise a stated "none" denies, whatever the equipment implies', () => {
    // Planet Fitness in a sentence: machines and cables everywhere, and no
    // pull-up bar anywhere. The inference would say "bar"; the statement wins.
    expect(isPerformable(CHIN_UP, ['machine', 'cable', 'dumbbell'], [])).toBe(
      false
    );
    expect(
      isPerformable(CHIN_UP, ['machine', 'cable', 'dumbbell'], ['bench'])
    ).toBe(false);
  });

  it('does not let familiarity overrule stated apparatus', () => {
    // The familiarity escape covers a wrong GUESS about the room. A stated
    // apparatus list is not a guess: fifty logged pull-ups happened somewhere
    // else, and this profile says this room has no bar.
    expect(
      isPerformable(
        { ...CHIN_UP, timesPerformed: 50 },
        ['machine', 'cable'],
        []
      )
    ).toBe(false);
  });

  it('keeps stated apparatus away from the equipment test', () => {
    // Stating a bench does not conjure a barbell.
    expect(
      isPerformable(
        candidate({ id: 'a', equipment: ['barbell'] }),
        ['dumbbell'],
        ['bench', 'squat rack']
      )
    ).toBe(false);
  });

  it('does not read an inherited property as an apparatus requirement', () => {
    // `source_id` is a database value. An object-literal lookup would answer
    // `constructor` with a function, whose truthy `.length` reads as "needs one
    // apparatus" and quietly hides the row from every home profile.
    expect(
      isPerformable(
        { ...CHIN_UP, sourceId: 'constructor' },
        ['dumbbell', 'bands'],
        null
      )
    ).toBe(true);
    expect(
      isPerformable({ ...CHIN_UP, sourceId: 'toString' }, ['dumbbell'], null)
    ).toBe(true);
  });

  it('leaves rows from other sources alone', () => {
    // The overrides describe free-exercise-db's data. A user's own "Chin-Up"
    // is their own record of what they can do — even under a stated "none",
    // because no apparatus requirement is on record for it.
    expect(
      isPerformable(
        { ...CHIN_UP, source: 'manual', sourceId: null },
        ['dumbbell'],
        []
      )
    ).toBe(true);
  });
});

describe('isMobilityExercise', () => {
  it('reads the category, which is the only place the fact lives', () => {
    expect(isMobilityExercise({ category: 'stretching' })).toBe(true);
    expect(isMobilityExercise({ category: ' Stretching ' })).toBe(true);
    expect(isMobilityExercise({ category: 'strength' })).toBe(false);
    expect(isMobilityExercise({ category: null })).toBe(false);
  });

  it('does not count an isometric — a plank is a training set', () => {
    expect(isMobilityExercise({ category: 'isometrics' })).toBe(false);
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
/**
 * A real free-exercise-db row, and the one the W7 live gate programmed as
 * 3x10: `stretching` category, `body only`, hamstrings as the primary mover.
 */
const STRETCH = candidate({
  id: 's1',
  name: '90/90 Hamstring',
  category: 'stretching',
  source: 'free-exercise-db',
  sourceId: '90_90_Hamstring',
  primaryMuscles: ['hamstrings'],
  mechanic: 'isolation',
  equipment: ['body only'],
});
/** Same row family, and the reason `body only` cannot be taken at its word. */
const CHIN_UP = candidate({
  id: 'p1',
  name: 'Chin-Up',
  source: 'free-exercise-db',
  sourceId: 'Chin-Up',
  primaryMuscles: ['lats'],
  mechanic: 'compound',
  equipment: ['body only'],
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

  it('builds around the requested muscles instead of the freshest ones', () => {
    // Chest is the fresher muscle, so an unconstrained plan opens with it.
    // Asking for lats has to be enough to leave chest out entirely.
    const plan = planWorkout(
      freshness,
      pool,
      options({ targetMuscles: ['lats'] })
    );

    expect(plan.targetMuscles).toEqual(['lats']);
    expect(plan.exercises.map((e) => e.candidate.id)).toEqual(['l1', 'l2']);
  });

  it('ignores an empty request rather than planning nothing', () => {
    const plan = planWorkout(freshness, pool, options({ targetMuscles: [] }));

    expect(plan.targetMuscles).toEqual(['chest', 'lats']);
  });

  it('loses a slot to a real movement rather than a stretch', () => {
    // Even a familiar stretch: the penalty is sized to beat the familiarity
    // bonus, or a stretch the user has done before would outrank a press they
    // have not.
    const familiarStretch = {
      ...STRETCH,
      primaryMuscles: ['chest'],
      timesPerformed: 20,
    };
    const plan = planWorkout(
      [fresh('chest', 1)],
      [familiarStretch, CHEST_COMPOUND],
      options()
    );

    expect(plan.exercises[0]!.candidate.id).toBe('c1');
  });

  it('still programs a stretch when the muscle has nothing else', () => {
    // A soft penalty, not an exclusion. An empty slot is worse than a hold,
    // and the hold is at least programmed as one.
    const plan = planWorkout([fresh('hamstrings', 1)], [STRETCH], options());

    expect(plan.exercises.map((e) => e.candidate.id)).toEqual(['s1']);
  });

  it('drops an exercise whose apparatus the profile does not imply', () => {
    const plan = planWorkout(
      [fresh('lats', 1)],
      [CHIN_UP, LAT_ISOLATION],
      options({ availableEquipment: ['dumbbell', 'bands', 'body only'] })
    );

    expect(plan.exercises.map((e) => e.candidate.id)).toEqual([]);
    expect(
      planWorkout(
        [fresh('lats', 1)],
        [CHIN_UP, LAT_ISOLATION],
        options({ availableEquipment: ['cable'] })
      ).exercises.map((e) => e.candidate.id)
    ).toEqual(['p1', 'l2']);
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

  it('biases a stated beginner away from an unperformed expert movement', () => {
    // The expert row gets the LOWER id, so if the two scored equally the
    // tiebreak would pick it — the unleveled row winning is the penalty.
    const expert = candidate({
      id: 'c0-expert',
      primaryMuscles: ['chest'],
      mechanic: 'compound',
      level: 'expert',
    });
    const unleveled = candidate({
      id: 'c8-plain',
      primaryMuscles: ['chest'],
      mechanic: 'compound',
    });
    const plan = planWorkout(
      [fresh('chest', 1)],
      [expert, unleveled],
      options({ experienceLevel: 'beginner' })
    );

    expect(plan.exercises[0]!.candidate.id).toBe('c8-plain');
  });

  it('lets familiarity override the too-advanced penalty', () => {
    // A logged session is evidence the movement is within reach; the stated
    // level is only a prior. The familiar expert row must win on score — it
    // has the higher id, so a tie would go the other way.
    const familiarExpert = candidate({
      id: 'c9-expert',
      primaryMuscles: ['chest'],
      mechanic: 'compound',
      level: 'expert',
      timesPerformed: 12,
    });
    const matchedUnfamiliar = candidate({
      id: 'c0-beginner',
      primaryMuscles: ['chest'],
      mechanic: 'compound',
      level: 'beginner',
    });
    const plan = planWorkout(
      [fresh('chest', 1)],
      [familiarExpert, matchedUnfamiliar],
      options({ experienceLevel: 'beginner' })
    );

    expect(plan.exercises[0]!.candidate.id).toBe('c9-expert');
  });

  it('does not penalize a one-level gap, in either direction', () => {
    // Intermediate rows are most of the catalog; penalizing them would starve
    // a beginner's workout. Both pairs tie on score, so the lower id winning
    // is what proves no penalty term fired against the off-level row.
    const forBeginner = planWorkout(
      [fresh('chest', 1)],
      [
        candidate({
          id: 'a-intermediate',
          primaryMuscles: ['chest'],
          mechanic: 'compound',
          level: 'intermediate',
        }),
        candidate({
          id: 'b-plain',
          primaryMuscles: ['chest'],
          mechanic: 'compound',
        }),
      ],
      options({ experienceLevel: 'beginner' })
    );
    expect(forBeginner.exercises[0]!.candidate.id).toBe('a-intermediate');

    // And the full gap downward is free too: a beginner-rated row is merely
    // easy for an expert, not unsafe.
    const forExpert = planWorkout(
      [fresh('chest', 1)],
      [
        candidate({
          id: 'a-beginner',
          primaryMuscles: ['chest'],
          mechanic: 'compound',
          level: 'beginner',
        }),
        candidate({
          id: 'b-plain',
          primaryMuscles: ['chest'],
          mechanic: 'compound',
        }),
      ],
      options({ experienceLevel: 'expert' })
    );
    expect(forExpert.exercises[0]!.candidate.id).toBe('a-beginner');
  });

  it('keeps the best-scoring stretch below the worst-scoring real movement', () => {
    // The invariant behind mobilityPenalty's size, asserted as behaviour
    // rather than as arithmetic on the constants: a familiar, level-matched
    // stretch must still lose the slot to an unfamiliar movement rated two
    // levels above the user.
    const bestStretch = {
      ...STRETCH,
      primaryMuscles: ['chest'],
      level: 'beginner',
      timesPerformed: 20,
    };
    const worstReal = candidate({
      id: 'z-expert',
      primaryMuscles: ['chest'],
      mechanic: 'compound',
      level: 'expert',
    });
    const plan = planWorkout(
      [fresh('chest', 1)],
      [bestStretch, worstReal],
      options({ experienceLevel: 'beginner' })
    );

    expect(plan.exercises[0]!.candidate.id).toBe('z-expert');
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

  it('caps a stated beginner at the default set count, even for strength', () => {
    // Sets are the cheapest thing to add back next session and the most
    // expensive to have prescribed wrongly. Only the count moves: the rep
    // target and the progression rules stay exactly as the goal set them.
    const beginner = prescribeSets(
      candidate({ id: 'a' }),
      null,
      options({ goal: 'strength', experienceLevel: 'beginner' })
    );
    expect(beginner.sets).toHaveLength(GENERATION_TUNABLES.workingSetsDefault);
    expect(beginner.sets[0]!.reps).toBe(GENERATION_TUNABLES.repTargetStrength);

    expect(workingSetCountFor('strength', 'beginner')).toBe(
      GENERATION_TUNABLES.workingSetsDefault
    );
    expect(workingSetCountFor('hypertrophy', 'beginner')).toBe(
      GENERATION_TUNABLES.workingSetsDefault
    );
    // Anyone else — expert, unstated, or an unknown token — keeps the goal's
    // own count.
    expect(workingSetCountFor('strength', 'expert')).toBe(
      GENERATION_TUNABLES.workingSetsStrength
    );
    expect(workingSetCountFor('strength', null)).toBe(
      GENERATION_TUNABLES.workingSetsStrength
    );
    expect(workingSetCountFor('strength')).toBe(
      GENERATION_TUNABLES.workingSetsStrength
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

  describe('mobility', () => {
    it('programs a stretch as a hold, not three sets of ten', () => {
      // The whole point: `stretching` rows are stored `weight_reps` like
      // everything else, so reading modality alone gave "90/90 Hamstring" a
      // rep target and a rest timer built for a compound lift.
      const result = prescribeSets(STRETCH, null, options());

      expect(result.mobility).toBe(true);
      expect(result.modality).toBe('duration');
      expect(result.sets).toHaveLength(GENERATION_TUNABLES.mobilitySets);
      expect(result.sets).toEqual(
        Array.from({ length: GENERATION_TUNABLES.mobilitySets }, (_, i) => ({
          set_number: i + 1,
          set_type: 'Working Set',
          reps: null,
          weight: null,
          duration: GENERATION_TUNABLES.mobilityHoldSeconds,
          distance: null,
          rest_time: GENERATION_TUNABLES.restMobility,
        }))
      );
      expect(result.restSeconds).toBe(GENERATION_TUNABLES.restMobility);
    });

    it('never puts a load on one, even with loadable equipment recorded', () => {
      const result = prescribeSets(
        candidate({
          id: 'a',
          category: 'stretching',
          equipment: ['barbell'],
        }),
        null,
        options()
      );

      expect(result.workingWeightKg).toBeNull();
      expect(result.sets.every((s) => s.weight === null)).toBe(true);
      // And therefore no ramp: the warm-up gate reads the prescription's
      // modality, which is `duration` here whatever the catalog stored.
      expect(
        warmupSetsFor(result.workingWeightKg, ['barbell'], result.modality)
      ).toEqual([]);
    });

    it("honours the last session's hold", () => {
      const result = prescribeSets(
        STRETCH,
        history(
          session('2026-08-20', [{ reps: null, weight: null, duration: 45 }])
        ),
        options()
      );

      expect(result.sets.every((s) => s.duration === 45)).toBe(true);
    });

    it('holds rather than progressing — there is nothing to add to', () => {
      expect(prescribeSets(STRETCH, null, options()).progression).toBe('hold');
      expect(
        prescribeSets(
          STRETCH,
          history(session('2026-08-20', [{ reps: 10, weight: 20 }])),
          options()
        ).progression
      ).toBe('hold');
    });

    it('leaves an isometric alone — a plank is a training set, not mobility', () => {
      const plank = candidate({
        id: 'a',
        category: 'isometrics',
        modality: 'duration',
        equipment: ['body only'],
      });
      const result = prescribeSets(plank, null, options());

      expect(result.mobility).toBe(false);
      expect(result.sets).toHaveLength(GENERATION_TUNABLES.workingSetsDefault);
      expect(result.sets[0]!.duration).toBe(
        GENERATION_TUNABLES.defaultDurationSeconds
      );
    });

    it('reports the modality the sets were built as for everything else too', () => {
      expect(
        prescribeSets(candidate({ id: 'a' }), null, options()).modality
      ).toBe('weight_reps');
      expect(
        prescribeSets(
          candidate({ id: 'a', modality: 'duration_distance' }),
          null,
          options()
        ).modality
      ).toBe('duration_distance');
    });
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

  it('does not talk about load on a movement that has none', () => {
    // "first time — starting light" reads as a conservative weight, and a
    // stretch has no weight to be conservative about.
    expect(
      rationaleFor('hamstrings', prescribeSets(STRETCH, null, options()))
    ).toBe('fresh hamstrings · mobility hold');
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

describe('deriveExperienceLevel', () => {
  // Boundaries asserted against the tunables, not literals, so retuning the
  // thresholds does not orphan this test — what it pins is that the bounds
  // are inclusive and the vocabulary is the catalog's own.
  it('maps training-day counts to levels at the tunable thresholds', () => {
    const mid = GENERATION_TUNABLES.derivedIntermediateSessionDays;
    const expert = GENERATION_TUNABLES.derivedExpertSessionDays;

    expect(deriveExperienceLevel(0)).toBe('beginner');
    expect(deriveExperienceLevel(mid - 1)).toBe('beginner');
    expect(deriveExperienceLevel(mid)).toBe('intermediate');
    expect(deriveExperienceLevel(expert - 1)).toBe('intermediate');
    expect(deriveExperienceLevel(expert)).toBe('expert');
    expect(deriveExperienceLevel(expert * 3)).toBe('expert');
  });
});
