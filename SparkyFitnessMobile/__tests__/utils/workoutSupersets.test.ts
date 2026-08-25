import type { ExerciseEntryResponse } from '@workspace/shared';
import type { WorkoutDraftExercise } from '../../src/types/drafts';
import {
  DEFAULT_REST_SEC,
  SUPERSET_PALETTE_VARS,
  buildExerciseReorderItems,
  buildSupersetColorMap,
  canReorderDraftExercises,
  getDraftSupersetRuns,
  getPlannedSupersetRuns,
  getSupersetRuns,
  moveDraftExerciseItem,
  moveSessionExerciseItem,
  normalizeDraftSupersetGroups,
  normalizePlannedSupersetGroups,
  normalizeSessionSupersetGroups,
  supersetDraftExercises,
  supersetPlannedExercises,
  supersetSessionExercises,
  ungroupDraftExercise,
  ungroupPlannedExercise,
  ungroupSessionExercise,
  type PlannedExercise,
} from '../../src/utils/workoutSupersets';
import {
  __resetAppPreferencesStoreForTests,
  useAppPreferencesStore,
} from '../../src/stores/appPreferencesStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

// --- Fixtures -------------------------------------------------------------
//
// The three shapes differ only in the four field names the module is
// parameterized over, so each builder takes the same (id, group, rest) triple.
// Everything else is filler chosen to satisfy the type, not to be asserted.

const sessionSet = (
  setNumber: number,
  restTime: number | null,
): ExerciseEntryResponse['sets'][number] => ({
  id: setNumber,
  set_number: setNumber,
  set_type: 'Working Set',
  reps: 10,
  weight: 60,
  duration: null,
  rest_time: restTime,
  notes: null,
  rpe: null,
  completed_at: null,
  is_pr: false,
});

const sessionEntry = (
  id: string,
  supersetGroup: number | null,
  restTime: number | null = 60,
  setCount = 2,
): ExerciseEntryResponse => ({
  id,
  exercise_id: `catalog-${id}`,
  duration_minutes: 10,
  calories_burned: 50,
  entry_date: '2026-03-20',
  notes: null,
  distance: null,
  avg_heart_rate: null,
  source: null,
  sets: Array.from({ length: setCount }, (_, index) => sessionSet(index + 1, restTime)),
  exercise_snapshot: null,
  activity_details: [],
  superset_group: supersetGroup,
});

const draftExercise = (
  clientId: string,
  supersetGroup: number | null,
  restTime: number | null = 60,
  setCount = 2,
): WorkoutDraftExercise => ({
  clientId,
  exerciseId: `catalog-${clientId}`,
  exerciseName: `Exercise ${clientId}`,
  exerciseCategory: 'Strength',
  images: [],
  sets: Array.from({ length: setCount }, (_, index) => ({
    clientId: `${clientId}-set-${index + 1}`,
    restTime,
    weight: '60',
    reps: '10',
    distance: '',
  })),
  supersetGroup,
});

const plannedExercise = (
  exerciseId: string,
  supersetGroup: number | null,
  restSeconds: number | null = 60,
  setCount = 2,
): PlannedExercise => ({
  exercise_id: exerciseId,
  exercise_name: `Exercise ${exerciseId}`,
  modality: 'weight_reps',
  primary_muscles: [],
  secondary_muscles: [],
  equipment: [],
  images: [],
  sort_order: 0,
  // The card's "2:00 rest" chip. Deliberately seeded from the same number the
  // sets carry, which is the invariant the harmonizer has to keep.
  rest_seconds: restSeconds ?? 0,
  rationale: '',
  sets: Array.from({ length: setCount }, (_, index) => ({
    set_number: index + 1,
    set_type: 'Working Set' as const,
    reps: 10,
    weight: 60,
    duration: null,
    distance: null,
    rest_time: restSeconds,
  })),
  superset_group: supersetGroup,
});

/** Group ids in list order — the compact form most assertions here want. */
const groupsOf = (
  exercises: { superset_group?: number | null }[],
): (number | null)[] => exercises.map(e => e.superset_group ?? null);

const draftGroupsOf = (exercises: WorkoutDraftExercise[]): (number | null)[] =>
  exercises.map(e => e.supersetGroup ?? null);

beforeEach(() => {
  __resetAppPreferencesStoreForTests();
});

// --- The rule every other behaviour is built on ---------------------------

describe('getSupersetRuns', () => {
  test('a run is 2+ ADJACENT exercises sharing a non-null group', () => {
    const runs = getSupersetRuns([
      { id: 'a', superset_group: null },
      { id: 'b', superset_group: 1 },
      { id: 'c', superset_group: 1 },
      { id: 'd', superset_group: null },
    ]);

    expect(runs).toEqual([{ groupId: 1, entryIds: ['b', 'c'] }]);
  });

  test('a lone member of a group is not a run', () => {
    expect(
      getSupersetRuns([
        { id: 'a', superset_group: 1 },
        { id: 'b', superset_group: null },
      ]),
    ).toEqual([]);
  });

  test('the same group id split apart is two singletons, not one run', () => {
    // Reachable through external edits. Adjacency is the app-wide truth for
    // grouping, so neither half counts — and nothing downstream displays them
    // as grouped, even though the stored values survive a round trip.
    expect(
      getSupersetRuns([
        { id: 'a', superset_group: 7 },
        { id: 'b', superset_group: null },
        { id: 'c', superset_group: 7 },
      ]),
    ).toEqual([]);
  });

  test('three adjacent members are one run, not two', () => {
    expect(
      getSupersetRuns([
        { id: 'a', superset_group: 2 },
        { id: 'b', superset_group: 2 },
        { id: 'c', superset_group: 2 },
      ]),
    ).toEqual([{ groupId: 2, entryIds: ['a', 'b', 'c'] }]);
  });

  test('adjacent runs with different ids stay separate', () => {
    expect(
      getSupersetRuns([
        { id: 'a', superset_group: 1 },
        { id: 'b', superset_group: 1 },
        { id: 'c', superset_group: 2 },
        { id: 'd', superset_group: 2 },
      ]),
    ).toEqual([
      { groupId: 1, entryIds: ['a', 'b'] },
      { groupId: 2, entryIds: ['c', 'd'] },
    ]);
  });

  test('an absent group field reads as ungrouped', () => {
    // Sessions persisted before the superset upgrade have no field at all,
    // which the response type cannot express as anything but optional.
    expect(getSupersetRuns([{ id: 'a' }, { id: 'b' }])).toEqual([]);
  });
});

describe('run derivation is keyed to each shape’s own id field', () => {
  test('drafts key on clientId', () => {
    expect(
      getDraftSupersetRuns([
        draftExercise('draft-a', 3),
        draftExercise('draft-b', 3),
      ]),
    ).toEqual([{ groupId: 3, entryIds: ['draft-a', 'draft-b'] }]);
  });

  test('planned exercises key on exercise_id', () => {
    expect(
      getPlannedSupersetRuns([
        plannedExercise('planned-a', 4),
        plannedExercise('planned-b', 4),
      ]),
    ).toEqual([{ groupId: 4, entryIds: ['planned-a', 'planned-b'] }]);
  });
});

// --- Grouping -------------------------------------------------------------

describe('grouping two exercises', () => {
  test('the picked exercise moves to sit immediately after the current one', () => {
    const result = supersetSessionExercises(
      [sessionEntry('a', null), sessionEntry('b', null), sessionEntry('c', null)],
      'a',
      'c',
    );

    expect(result.map(e => e.id)).toEqual(['a', 'c', 'b']);
    expect(groupsOf(result)).toEqual([1, 1, null]);
  });

  test('a new group id is max(existing)+1 counting STALE values', () => {
    // The stale 5 is not a run, but reusing it would silently fuse the new
    // pair into that singleton the moment a reorder made them adjacent.
    const result = supersetSessionExercises(
      [sessionEntry('stale', 5), sessionEntry('a', null), sessionEntry('b', null)],
      'a',
      'b',
    );

    expect(groupsOf(result)).toEqual([5, 6, 6]);
  });

  test('picking an exercise already in a run is refused, by identity', () => {
    const exercises = [
      sessionEntry('a', null),
      sessionEntry('b', 1),
      sessionEntry('c', 1),
    ];

    expect(supersetSessionExercises(exercises, 'a', 'b')).toBe(exercises);
  });

  test('picking itself, or an id that is not in the list, is refused', () => {
    const exercises = [sessionEntry('a', null), sessionEntry('b', null)];

    expect(supersetSessionExercises(exercises, 'a', 'a')).toBe(exercises);
    expect(supersetSessionExercises(exercises, 'a', 'ghost')).toBe(exercises);
    expect(supersetSessionExercises(exercises, 'ghost', 'b')).toBe(exercises);
  });

  test('an anchor already in a run extends it into a circuit', () => {
    const result = supersetSessionExercises(
      [
        sessionEntry('a', 1),
        sessionEntry('b', 1),
        sessionEntry('spacer', null),
        sessionEntry('c', null),
      ],
      'a',
      'c',
    );

    // Keeps the existing group id, and lands after the run's LAST member so
    // the block stays adjacent — not after the member whose menu was used.
    expect(result.map(e => e.id)).toEqual(['a', 'b', 'c', 'spacer']);
    expect(groupsOf(result)).toEqual([1, 1, 1, null]);
  });
});

describe('grouping harmonizes rest across the whole group', () => {
  test("every member's per-set rest becomes the anchor's first-set rest", () => {
    const result = supersetSessionExercises(
      [sessionEntry('a', null, 45), sessionEntry('b', null, 180)],
      'a',
      'b',
    );

    expect(result.flatMap(e => e.sets.map(s => s.rest_time))).toEqual([45, 45, 45, 45]);
  });

  test('the anchor is the run’s first member when extending, not the menu’s owner', () => {
    const result = supersetSessionExercises(
      [
        // Members of a run normally already agree on rest; they are forced
        // apart here because that is the only way to tell "the run's first
        // member" and "the exercise whose menu was used" apart.
        sessionEntry('a', 1, 30),
        sessionEntry('b', 1, 77),
        sessionEntry('c', null, 999),
      ],
      // Grouping was triggered from 'b', but 'a' opens the run.
      'b',
      'c',
    );

    expect(result.flatMap(e => e.sets.map(s => s.rest_time))).toEqual([30, 30, 30, 30, 30, 30]);
  });

  test('an anchor with no rest of its own falls back to the user preference', () => {
    useAppPreferencesStore.getState().setDefaultRestSec(123);

    const result = supersetSessionExercises(
      [sessionEntry('a', null, null), sessionEntry('b', null, 60)],
      'a',
      'b',
    );

    expect(result.flatMap(e => e.sets.map(s => s.rest_time))).toEqual([123, 123, 123, 123]);
  });

  test('the fallback is the shipped default when the user has not set one', () => {
    const result = supersetSessionExercises(
      [sessionEntry('a', null, null, 1), sessionEntry('b', null, 60, 1)],
      'a',
      'b',
    );

    expect(result.flatMap(e => e.sets.map(s => s.rest_time))).toEqual([
      DEFAULT_REST_SEC,
      DEFAULT_REST_SEC,
    ]);
  });

  test('planned exercises harmonize rest_seconds alongside every set', () => {
    // The row chip reads `rest_seconds` and the started entries read the sets.
    // Moving one without the other leaves the card advertising a rest the
    // workout will not take.
    const result = supersetPlannedExercises(
      [plannedExercise('a', null, 40), plannedExercise('b', null, 200)],
      'a',
      'b',
    );

    expect(result.map(e => e.rest_seconds)).toEqual([40, 40]);
    expect(result.flatMap(e => e.sets.map(s => s.rest_time))).toEqual([40, 40, 40, 40]);
  });

  test('drafts harmonize their own restTime field', () => {
    const result = supersetDraftExercises(
      [draftExercise('a', null, 25), draftExercise('b', null, 300)],
      'a',
      'b',
    );

    expect(result.flatMap(e => e.sets.map(s => s.restTime))).toEqual([25, 25, 25, 25]);
    expect(draftGroupsOf(result)).toEqual([1, 1]);
  });
});

// --- Ungrouping -----------------------------------------------------------

describe('ungrouping one member', () => {
  test('a middle member moves out to just after the run', () => {
    const result = ungroupSessionExercise(
      [
        sessionEntry('a', 1),
        sessionEntry('b', 1),
        sessionEntry('c', 1),
        sessionEntry('tail', null),
      ],
      'b',
    );

    // The remaining members must stay adjacent, or they stop being a run.
    expect(result.map(e => e.id)).toEqual(['a', 'c', 'b', 'tail']);
    expect(groupsOf(result)).toEqual([1, 1, null, null]);
  });

  test('an end member is cleared in place', () => {
    const result = ungroupSessionExercise(
      [sessionEntry('a', 1), sessionEntry('b', 1), sessionEntry('c', 1)],
      'c',
    );

    expect(result.map(e => e.id)).toEqual(['a', 'b', 'c']);
    expect(groupsOf(result)).toEqual([1, 1, null]);
  });

  test('an exercise that is not in a run is refused, by identity', () => {
    const exercises = [sessionEntry('a', null), sessionEntry('b', null)];

    expect(ungroupSessionExercise(exercises, 'a')).toBe(exercises);
  });

  test('the session wrapper leaves the 1-member remainder for its caller', () => {
    // Store session edits all funnel through buildSessionEditState, whose
    // normalize pass dissolves it. Doing it here too would be harmless but
    // would hide which layer actually owns the invariant.
    const result = ungroupSessionExercise(
      [sessionEntry('a', 1), sessionEntry('b', 1)],
      'b',
    );

    expect(groupsOf(result)).toEqual([1, null]);
  });

  test('the planned and draft wrappers dissolve the remainder inline', () => {
    // Up Next and the form reducers have no shared edit tail to do it.
    expect(
      groupsOf(ungroupPlannedExercise([plannedExercise('a', 1), plannedExercise('b', 1)], 'b')),
    ).toEqual([null, null]);

    expect(
      draftGroupsOf(ungroupDraftExercise([draftExercise('a', 1), draftExercise('b', 1)], 'b')),
    ).toEqual([null, null]);
  });

  test('ungrouping does not restore the rest each member had before grouping', () => {
    // Harmonization is deliberately lossy — rest is a property of the round.
    const grouped = supersetSessionExercises(
      [sessionEntry('a', null, 45), sessionEntry('b', null, 180)],
      'a',
      'b',
    );
    const result = ungroupSessionExercise(grouped, 'b');

    expect(result.flatMap(e => e.sets.map(s => s.rest_time))).toEqual([45, 45, 45, 45]);
  });
});

// --- Normalization --------------------------------------------------------

describe('normalizing stale group values', () => {
  test('a group value on an exercise that is not in a run is cleared', () => {
    expect(
      groupsOf(
        normalizeSessionSupersetGroups([
          sessionEntry('a', 7),
          sessionEntry('b', null),
          sessionEntry('c', 7),
        ]),
      ),
    ).toEqual([null, null, null]);
  });

  test('real runs are left alone, and the array comes back by identity', () => {
    const exercises = [sessionEntry('a', 1), sessionEntry('b', 1), sessionEntry('c', null)];

    // Identity matters: this runs on every session edit, and a fresh array
    // every time would defeat the memo checks downstream of it.
    expect(normalizeSessionSupersetGroups(exercises)).toBe(exercises);
  });

  test('the planned and draft shapes normalize the same way', () => {
    expect(
      groupsOf(normalizePlannedSupersetGroups([plannedExercise('a', 9), plannedExercise('b', null)])),
    ).toEqual([null, null]);

    expect(
      draftGroupsOf(normalizeDraftSupersetGroups([draftExercise('a', 9), draftExercise('b', null)])),
    ).toEqual([null, null]);
  });
});

// --- Reorder items --------------------------------------------------------

describe('buildExerciseReorderItems', () => {
  test('a run collapses into ONE draggable item holding its members', () => {
    expect(
      buildExerciseReorderItems([
        { id: 'a', superset_group: null },
        { id: 'b', superset_group: 1 },
        { id: 'c', superset_group: 1 },
      ]),
    ).toEqual([
      { key: 'a', entryIds: ['a'], groupId: null },
      { key: 'b', entryIds: ['b', 'c'], groupId: 1 },
    ]);
  });

  test('a stale same-value singleton surfaces as a solo item', () => {
    expect(
      buildExerciseReorderItems([
        { id: 'a', superset_group: 7 },
        { id: 'b', superset_group: null },
        { id: 'c', superset_group: 7 },
      ]),
    ).toEqual([
      { key: 'a', entryIds: ['a'], groupId: null },
      { key: 'b', entryIds: ['b'], groupId: null },
      { key: 'c', entryIds: ['c'], groupId: null },
    ]);
  });
});

describe('canReorderDraftExercises', () => {
  test('two exercises fused into one superset are not reorderable', () => {
    expect(canReorderDraftExercises([draftExercise('a', 1), draftExercise('b', 1)])).toBe(false);
  });

  test('two independent exercises are', () => {
    expect(canReorderDraftExercises([draftExercise('a', null), draftExercise('b', null)])).toBe(
      true,
    );
  });

  test('a single exercise is not', () => {
    expect(canReorderDraftExercises([draftExercise('a', null)])).toBe(false);
    expect(canReorderDraftExercises([])).toBe(false);
  });
});

// --- Moving ---------------------------------------------------------------

describe('moving an exercise item', () => {
  test('indices are ITEM indices, and a run drags as one block', () => {
    const result = moveSessionExerciseItem(
      [sessionEntry('a', 1), sessionEntry('b', 1), sessionEntry('c', null), sessionEntry('d', null)],
      // Item 0 is the whole (a, b) run; there are three items, not four.
      0,
      2,
    );

    expect(result.map(e => e.id)).toEqual(['c', 'd', 'a', 'b']);
  });

  test('a no-op or out-of-range move returns the input by identity', () => {
    const exercises = [sessionEntry('a', null), sessionEntry('b', null)];

    expect(moveSessionExerciseItem(exercises, 1, 1)).toBe(exercises);
    expect(moveSessionExerciseItem(exercises, -1, 0)).toBe(exercises);
    expect(moveSessionExerciseItem(exercises, 0, 2)).toBe(exercises);
    expect(moveSessionExerciseItem(exercises, 5, 0)).toBe(exercises);
  });

  test('a move that lands two stale singletons adjacent does not fuse them', () => {
    // Without the pre-move clearing pass, the next normalize would read these
    // two 7s as a run the user never built.
    const result = moveSessionExerciseItem(
      [sessionEntry('a', 7), sessionEntry('spacer', null), sessionEntry('c', 7)],
      1,
      2,
    );

    expect(result.map(e => e.id)).toEqual(['a', 'c', 'spacer']);
    expect(groupsOf(result)).toEqual([null, null, null]);
    expect(getSupersetRuns(result)).toEqual([]);
  });

  test('drafts move by clientId', () => {
    const result = moveDraftExerciseItem(
      [draftExercise('a', null), draftExercise('b', null), draftExercise('c', null)],
      2,
      0,
    );

    expect(result.map(e => e.clientId)).toEqual(['c', 'a', 'b']);
  });
});

// --- Colours --------------------------------------------------------------

describe('buildSupersetColorMap', () => {
  test('colours are assigned by run position, so visible groups never collide', () => {
    const map = buildSupersetColorMap(
      [
        { groupId: 41, entryIds: ['a', 'b'] },
        { groupId: 3, entryIds: ['c', 'd'] },
      ],
      ['red', 'blue'],
    );

    // By index, not by hashing the group id — 41 and 3 would be free to
    // collide under a hash.
    expect([...map]).toEqual([
      ['a', 'red'],
      ['b', 'red'],
      ['c', 'blue'],
      ['d', 'blue'],
    ]);
  });

  test('more runs than colours wraps around the palette', () => {
    const map = buildSupersetColorMap(
      [
        { groupId: 1, entryIds: ['a'] },
        { groupId: 2, entryIds: ['b'] },
        { groupId: 3, entryIds: ['c'] },
      ],
      ['red', 'blue'],
    );

    expect(map.get('c')).toBe('red');
  });

  test('an empty palette yields no colours rather than dividing by zero', () => {
    expect(buildSupersetColorMap([{ groupId: 1, entryIds: ['a'] }], []).size).toBe(0);
  });

  test('the shipped palette has no duplicate vars', () => {
    expect(new Set(SUPERSET_PALETTE_VARS).size).toBe(SUPERSET_PALETTE_VARS.length);
  });
});
