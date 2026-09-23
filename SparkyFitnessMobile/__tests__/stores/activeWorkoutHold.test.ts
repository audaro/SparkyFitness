import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PresetSessionResponse } from '@workspace/shared';
import {
  __resetActiveWorkoutStoreForTests,
  useActiveWorkoutStore,
} from '../../src/stores/activeWorkoutStore';
import {
  cancelScheduledNotification,
  fireRestCompleteCue,
  scheduleHoldNotification,
} from '../../src/services/notifications';
import {
  fireSelectionHaptic,
  fireSuccessHaptic,
} from '../../src/services/haptics';

jest.mock('../../src/services/notifications', () => ({
  scheduleRestNotification: jest.fn(async () => 'notif-rest'),
  scheduleHoldNotification: jest.fn(async () => 'notif-hold'),
  cancelScheduledNotification: jest.fn(async () => undefined),
  fireRestCompleteCue: jest.fn(),
  COMPLETE_SET_ACTION: 'complete-set',
  addNotificationResponseListener: jest.fn(() => ({ remove: jest.fn() })),
  dismissDeliveredNotification: jest.fn(async () => undefined),
}));

jest.mock('../../src/services/LogService', () => ({
  addLog: jest.fn(async () => undefined),
}));

jest.mock('../../src/services/haptics', () => ({
  fireSuccessHaptic: jest.fn(),
  fireSelectionHaptic: jest.fn(),
}));

const mockScheduleHold = scheduleHoldNotification as jest.MockedFunction<
  typeof scheduleHoldNotification
>;
const mockCancel = cancelScheduledNotification as jest.MockedFunction<
  typeof cancelScheduledNotification
>;
const mockSelectionHaptic = fireSelectionHaptic as jest.MockedFunction<
  typeof fireSelectionHaptic
>;
const mockSuccessHaptic = fireSuccessHaptic as jest.MockedFunction<
  typeof fireSuccessHaptic
>;
const mockCompleteCue = fireRestCompleteCue as jest.MockedFunction<
  typeof fireRestCompleteCue
>;

const FIXED_NOW = 1_700_000_000_000;
const STORAGE_KEY = '@SparkyFitness/active-workout';

/**
 * Plank (duration, 45s target, 30s rest) then Bench (reps). The two modalities
 * sit in one session so "a hold only starts on the set that can be held" is
 * asserted against a real neighbour rather than a second fixture.
 */
function makeSession(
  overrides?: Partial<PresetSessionResponse>
): PresetSessionResponse {
  return {
    type: 'preset',
    id: 'session-1',
    entry_date: '2026-03-20',
    workout_preset_id: null,
    name: 'Core Day',
    description: null,
    notes: null,
    source: 'sparky',
    total_duration_minutes: 30,
    activity_details: [],
    exercises: [
      {
        id: 'ex-uuid-1',
        exercise_id: 'ex-1',
        duration_minutes: 10,
        calories_burned: 50,
        entry_date: '2026-03-20',
        notes: null,
        distance: null,
        avg_heart_rate: null,
        source: null,
        exercise_snapshot: {
          id: 'ex-1',
          name: 'Plank',
          category: 'Strength',
          modality: 'duration',
          calories_per_hour: 200,
          source: 'system',
          images: [],
        } as any,
        activity_details: [],
        sets: [
          {
            id: 101,
            set_number: 1,
            set_type: 'working',
            reps: null,
            weight: null,
            duration: 45,
            rest_time: 30,
            notes: null,
            rpe: null,
            completed_at: null,
          },
          {
            id: 102,
            set_number: 2,
            set_type: 'working',
            reps: null,
            weight: null,
            duration: 45,
            rest_time: 30,
            notes: null,
            rpe: null,
            completed_at: null,
          },
        ],
      } as any,
      {
        id: 'ex-uuid-2',
        exercise_id: 'ex-2',
        duration_minutes: 20,
        calories_burned: 150,
        entry_date: '2026-03-20',
        notes: null,
        distance: null,
        avg_heart_rate: null,
        source: null,
        exercise_snapshot: {
          id: 'ex-2',
          name: 'Bench Press',
          category: 'Strength',
          modality: 'reps_weight',
          calories_per_hour: 400,
          source: 'system',
          images: [],
        } as any,
        activity_details: [],
        sets: [
          {
            id: 201,
            set_number: 1,
            set_type: 'working',
            reps: 10,
            weight: 60,
            duration: null,
            rest_time: 60,
            notes: null,
            rpe: null,
            completed_at: null,
          },
        ],
      } as any,
    ],
    ...overrides,
  };
}

/** The persisted `duration` of a set, read back off the live session. */
function durationOf(setId: string): number | null | undefined {
  const session = useActiveWorkoutStore.getState().session;
  for (const ex of session?.exercises ?? []) {
    const hit = ex.sets.find((s) => String(s.id) === setId);
    if (hit) return hit.duration;
  }
  return undefined;
}

describe('activeWorkoutStore — hold timer', () => {
  beforeEach(async () => {
    __resetActiveWorkoutStoreForTests();
    mockScheduleHold.mockClear();
    mockCancel.mockClear();
    mockSelectionHaptic.mockClear();
    mockSuccessHaptic.mockClear();
    mockCompleteCue.mockClear();
    mockScheduleHold.mockImplementation(async () => 'notif-hold');
    jest.useFakeTimers();
    jest.setSystemTime(new Date(FIXED_NOW));
    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('startHold preconditions', () => {
    it('starts on a duration set with a target, anchored to a wall-clock deadline', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');

      const { hold } = useActiveWorkoutStore.getState();
      expect(hold.state).toBe('holding');
      expect(hold.setId).toBe('101');
      expect(hold.targetSec).toBe(45);
      expect(hold.endsAt).toBe(FIXED_NOW + 45_000);
      expect(hold.pausedRemainingMs).toBeNull();
      expect(mockSelectionHaptic).toHaveBeenCalledTimes(1);
      expect(mockScheduleHold).toHaveBeenCalledWith('Plank', 45);
    });

    it('refuses a reps-modality set', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('201');
      expect(useActiveWorkoutStore.getState().hold.state).toBe('idle');
      expect(mockScheduleHold).not.toHaveBeenCalled();
    });

    it('holds the planned seconds when the set itself has none yet', () => {
      // A generated plank arrives with empty sets and the prescription in the
      // live-start plan — the row shows "60" grayed-in, and the hold must
      // count that down rather than offer nothing.
      const session = makeSession();
      (session.exercises[0] as any).sets[0].duration = null;
      (session.exercises[0] as any).sets[1].duration = null;
      useActiveWorkoutStore.getState().startWorkout(session, {
        plannedSetValues: [
          [
            { weight: null, reps: null, duration: 60 },
            { weight: null, reps: null, duration: 60 },
          ],
          [{ weight: 60, reps: 10 }],
        ],
        sourceRecommendationId: 'rec-1',
      });
      useActiveWorkoutStore.getState().startHold('101');

      const { hold } = useActiveWorkoutStore.getState();
      expect(hold.state).toBe('holding');
      expect(hold.targetSec).toBe(60);
      expect(mockScheduleHold).toHaveBeenCalledWith('Plank', 60);

      jest.advanceTimersByTime(60_000);
      expect(useActiveWorkoutStore.getState().hold.state).toBe('idle');
      expect(durationOf('101')).toBe(60);
      expect(
        useActiveWorkoutStore.getState().completedSetIds['101']
      ).toBeDefined();
    });

    it('refuses a duration set with no target', () => {
      const session = makeSession();
      (session.exercises[0] as any).sets[0].duration = null;
      useActiveWorkoutStore.getState().startWorkout(session);
      useActiveWorkoutStore.getState().startHold('101');
      expect(useActiveWorkoutStore.getState().hold.state).toBe('idle');
    });

    it('refuses while a rest is running', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      // Logging set 101 starts the 30s rest before 102.
      useActiveWorkoutStore.getState().completeSet('101');
      expect(useActiveWorkoutStore.getState().rest.state).toBe('resting');

      useActiveWorkoutStore.getState().startHold('102');
      expect(useActiveWorkoutStore.getState().hold.state).toBe('idle');
    });

    it('refuses a second hold while one is already running', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');
      const first = useActiveWorkoutStore.getState().hold;

      // Re-starting the SAME set: refused by the already-holding guard rather
      // than by the cursor guard, which a different set id would trip first.
      useActiveWorkoutStore.getState().startHold('101');
      expect(useActiveWorkoutStore.getState().hold).toBe(first);
      expect(mockScheduleHold).toHaveBeenCalledTimes(1);
    });

    it('refuses a set that is not the cursor', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      expect(useActiveWorkoutStore.getState().activeSetId).toBe('101');

      // 102 is a perfectly holdable plank set — it just is not the one the
      // user is on, and a hold off the cursor would be cleared by any
      // unrelated session edit.
      useActiveWorkoutStore.getState().startHold('102');
      expect(useActiveWorkoutStore.getState().hold.state).toBe('idle');
    });

    it('refuses an already-completed set', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().completeSet('101');
      useActiveWorkoutStore.getState().dismissRest();

      useActiveWorkoutStore.getState().startHold('101');
      expect(useActiveWorkoutStore.getState().hold.state).toBe('idle');
    });
  });

  describe('completion', () => {
    it('logs the planned duration and starts the next rest when it runs out', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');

      jest.advanceTimersByTime(45_000);

      const state = useActiveWorkoutStore.getState();
      expect(state.hold.state).toBe('idle');
      expect(state.completedSetIds['101']).toBe(FIXED_NOW + 45_000);
      expect(durationOf('101')).toBe(45);
      // completeSet owns the handoff: cursor advanced and rest started.
      expect(state.activeSetId).toBe('102');
      expect(state.rest.state).toBe('resting');
      expect(state.rest.durationSec).toBe(30);
    });

    it('cues the end of a hold that ran out, the way a finished rest does', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');

      jest.advanceTimersByTime(45_000);

      // The plank ends with the phone out of sight, so the haptic and chime
      // are the whole notice — the scheduled ping only covers the background.
      expect(mockCompleteCue).toHaveBeenCalledTimes(1);
    });

    it('does not cue a hold the user stopped early', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');

      jest.advanceTimersByTime(30_000);
      useActiveWorkoutStore.getState().stopHoldAndLog();

      // They are looking at the button they just pressed; completeSet's own
      // haptic is the acknowledgement, and a second cue would read as an event
      // rather than a confirmation.
      expect(mockCompleteCue).not.toHaveBeenCalled();
      expect(mockSelectionHaptic).toHaveBeenCalled();
    });

    it('stopping early logs the seconds actually held', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');

      jest.advanceTimersByTime(30_000);
      useActiveWorkoutStore.getState().stopHoldAndLog();

      expect(durationOf('101')).toBe(30);
      expect(useActiveWorkoutStore.getState().hold.state).toBe('idle');
      expect(useActiveWorkoutStore.getState().completedSetIds['101']).not.toBe(
        undefined
      );
    });

    it('a hold extended and held to the end logs the longer time', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');

      jest.advanceTimersByTime(40_000);
      useActiveWorkoutStore.getState().adjustHold(15);
      jest.advanceTimersByTime(20_000);

      expect(durationOf('101')).toBe(60);
    });

    it('floors the logged duration at one second', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');
      useActiveWorkoutStore.getState().stopHoldAndLog();
      expect(durationOf('101')).toBe(1);
    });

    it('dismissing abandons the hold without logging', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');
      jest.advanceTimersByTime(10_000);
      useActiveWorkoutStore.getState().dismissHold();

      const state = useActiveWorkoutStore.getState();
      expect(state.hold.state).toBe('idle');
      expect(state.completedSetIds['101']).toBeUndefined();
      expect(state.activeSetId).toBe('101');
      expect(durationOf('101')).toBe(45);
    });
  });

  describe('pause, resume and adjust', () => {
    it('pause freezes the remaining time and cancels the ping', async () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');
      await Promise.resolve();

      jest.advanceTimersByTime(15_000);
      useActiveWorkoutStore.getState().pauseHold();

      const { hold } = useActiveWorkoutStore.getState();
      expect(hold.state).toBe('paused');
      expect(hold.pausedRemainingMs).toBe(30_000);
      expect(hold.endsAt).toBeNull();
      expect(mockCancel).toHaveBeenCalledWith('notif-hold');
    });

    it('a paused hold does not expire while time passes', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');
      useActiveWorkoutStore.getState().pauseHold();

      jest.advanceTimersByTime(120_000);

      expect(useActiveWorkoutStore.getState().hold.state).toBe('paused');
      expect(useActiveWorkoutStore.getState().completedSetIds['101']).toBe(
        undefined
      );
    });

    it('resume re-anchors the deadline to the remaining time', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');
      jest.advanceTimersByTime(15_000);
      useActiveWorkoutStore.getState().pauseHold();
      jest.advanceTimersByTime(60_000);
      useActiveWorkoutStore.getState().resumeHold();

      const { hold } = useActiveWorkoutStore.getState();
      expect(hold.state).toBe('holding');
      expect(hold.endsAt).toBe(FIXED_NOW + 15_000 + 60_000 + 30_000);
      expect(hold.pausedRemainingMs).toBeNull();
    });

    it('adjust moves the deadline and the target together, so progress stays in range', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');
      jest.advanceTimersByTime(15_000);

      useActiveWorkoutStore.getState().adjustHold(15);
      const { hold } = useActiveWorkoutStore.getState();
      expect(hold.targetSec).toBe(60);
      expect(hold.endsAt).toBe(FIXED_NOW + 15_000 + 45_000);
      // remaining (45s) never exceeds the target (60s)
      expect(hold.endsAt! - (FIXED_NOW + 15_000)).toBeLessThanOrEqual(
        hold.targetSec * 1000
      );
    });

    it('adjust floors the remaining time at 1s instead of logging the set', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');

      useActiveWorkoutStore.getState().adjustHold(-120);

      const state = useActiveWorkoutStore.getState();
      expect(state.hold.state).toBe('holding');
      expect(state.hold.endsAt).toBe(FIXED_NOW + 1_000);
      expect(state.completedSetIds['101']).toBeUndefined();
    });

    it('adjust works while paused', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');
      useActiveWorkoutStore.getState().pauseHold();

      useActiveWorkoutStore.getState().adjustHold(15);

      const { hold } = useActiveWorkoutStore.getState();
      expect(hold.pausedRemainingMs).toBe(60_000);
      expect(hold.targetSec).toBe(60);
    });
  });

  describe('mutual exclusion with rest', () => {
    it('completeActiveSetIfReady refuses to log mid-hold', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');

      const handled = useActiveWorkoutStore
        .getState()
        .completeActiveSetIfReady();

      expect(handled).toBe(false);
      expect(useActiveWorkoutStore.getState().completedSetIds['101']).toBe(
        undefined
      );
      expect(useActiveWorkoutStore.getState().hold.state).toBe('holding');
    });

    it('a hold never runs alongside a rest', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');
      jest.advanceTimersByTime(45_000);

      const state = useActiveWorkoutStore.getState();
      expect(state.rest.state).toBe('resting');
      expect(state.hold.state).toBe('idle');
    });

    it('logging a different row mid-hold clears the hold', async () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');
      // Let the guarded schedule land, so there is an id to cancel.
      await Promise.resolve();
      mockCancel.mockClear();

      useActiveWorkoutStore.getState().completeSet('201');

      expect(useActiveWorkoutStore.getState().hold.state).toBe('idle');
      expect(mockCancel).toHaveBeenCalledWith('notif-hold');
      // The plank itself is untouched — only the timer was abandoned.
      expect(useActiveWorkoutStore.getState().completedSetIds['101']).toBe(
        undefined
      );
    });

    it('clearWorkout mid-hold cancels the scheduled ping', async () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');
      await Promise.resolve();
      mockCancel.mockClear();

      useActiveWorkoutStore.getState().clearWorkout();

      expect(useActiveWorkoutStore.getState().hold.state).toBe('idle');
      expect(mockCancel).toHaveBeenCalledWith('notif-hold');
    });

    it('a stale schedule resolution never attaches to a newer hold', async () => {
      let resolveSchedule: (id: string) => void = () => {};
      mockScheduleHold.mockImplementationOnce(
        () =>
          new Promise<string>((res) => {
            resolveSchedule = res;
          })
      );
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');
      useActiveWorkoutStore.getState().dismissHold();

      resolveSchedule('notif-late');
      await Promise.resolve();
      await Promise.resolve();

      expect(
        useActiveWorkoutStore.getState().hold.scheduledNotificationId
      ).toBe(null);
      expect(mockCancel).toHaveBeenCalledWith('notif-late');
    });
  });

  describe('persistence', () => {
    it('partialize carries the hold', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      useActiveWorkoutStore.getState().startHold('101');
      const persisted = useActiveWorkoutStore.persist.getOptions().partialize!(
        useActiveWorkoutStore.getState()
      ) as { hold: { state: string; setId: string | null } };
      expect(persisted.hold.state).toBe('holding');
      expect(persisted.hold.setId).toBe('101');
    });

    it('a v5 payload with no hold key rehydrates to idle', async () => {
      const persisted = {
        state: {
          sessionId: 'session-1',
          steps: [],
          completedSetIds: {},
          activeSetId: '101',
          rest: {
            state: 'ready',
            durationSec: 0,
            endsAt: null,
            pausedRemainingMs: null,
            scheduledNotificationId: null,
            instanceToken: 0,
          },
        },
        version: 5,
      };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
      await useActiveWorkoutStore.persist.rehydrate();

      const { hold } = useActiveWorkoutStore.getState();
      expect(hold.state).toBe('idle');
      expect(hold.setId).toBeNull();
      expect(hold.endsAt).toBeNull();
    });

    it('a hold whose deadline passed while the JS timer was suspended logs on re-arm', () => {
      useActiveWorkoutStore.getState().startWorkout(makeSession());
      // Stand in for a hold restored (or resumed) with a deadline already in
      // the past: the subscribe re-arms the timer at 0ms and it settles.
      useActiveWorkoutStore.setState({
        hold: {
          state: 'holding',
          setId: '101',
          targetSec: 45,
          endsAt: FIXED_NOW - 5_000,
          pausedRemainingMs: null,
          scheduledNotificationId: null,
          instanceToken: 99,
        },
      });

      jest.advanceTimersByTime(0);

      const state = useActiveWorkoutStore.getState();
      expect(state.hold.state).toBe('idle');
      expect(state.completedSetIds['101']).toBe(FIXED_NOW);
      expect(durationOf('101')).toBe(45);
      expect(state.rest.state).toBe('resting');
    });
  });
});
