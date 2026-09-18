import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  ExerciseSetRestSheetRef,
  ExerciseSetRestUpdate,
} from '../components/ExerciseSetRestSheet';
import { useActiveWorkoutStore } from '../stores/activeWorkoutStore';
import { getSupersetRuns } from '../utils/workoutSession';

/**
 * Drives `ExerciseSetRestSheet` against the live workout.
 *
 * Shared by the active-workout screen and the per-exercise sheet rather than
 * copied, because the apply half is the non-obvious part: superset rest is
 * per-round and shared across members, so a changed round has to be written to
 * every member's set with that `set_number`, not just the one the user edited.
 * A second copy of that rule would drift the moment one surface learned about
 * a new grouping.
 *
 * The caller renders the sheet itself — `<ExerciseSetRestSheet ref={ref}
 * onApply={apply} />` — so it keeps control of where the modal sits.
 */
export function useActiveWorkoutRestSheet() {
  const { t } = useTranslation();
  const ref = useRef<ExerciseSetRestSheetRef>(null);

  const present = useCallback(
    (entryId: string) => {
      const store = useActiveWorkoutStore.getState();
      const exercise = store.session?.exercises.find((e) => e.id === entryId);
      if (!exercise || !store.session) return;

      const isSupersetMember = getSupersetRuns(store.session.exercises).some(
        (run) => run.entryIds.includes(entryId)
      );

      ref.current?.present(
        exercise.exercise_snapshot?.name ??
          t('workout.exercise', { defaultValue: 'Exercise' }),
        exercise.sets.map((set) => ({
          setId: String(set.id),
          setNumber: set.set_number,
          restSec: set.rest_time,
        })),
        isSupersetMember
      );
    },
    [t]
  );

  const apply = useCallback((updates: ExerciseSetRestUpdate[]) => {
    const store = useActiveWorkoutStore.getState();
    if (!store.session) return;

    // Which exercise these belong to is discovered from the first set id
    // rather than passed in: the sheet edits one exercise at a time, and
    // reading it back from the store means the write targets what is live now
    // and not what was live when the sheet opened.
    const firstUpdate = updates[0];
    if (!firstUpdate) return;
    const exercise = store.session.exercises.find((e) =>
      e.sets.some((s) => String(s.id) === firstUpdate.setId)
    );
    if (!exercise) return;

    const run = getSupersetRuns(store.session.exercises).find((r) =>
      r.entryIds.includes(exercise.id)
    );

    if (run) {
      // Superset rest is per-round and shared across members: apply each
      // changed round (matched by set_number) to every member's matching set,
      // so editing one round doesn't overwrite the others.
      const memberExercises = store.session.exercises.filter((e) =>
        run.entryIds.includes(e.id)
      );
      for (const update of updates) {
        const changedSet = exercise.sets.find(
          (s) => String(s.id) === update.setId
        );
        if (!changedSet) continue;
        for (const member of memberExercises) {
          const roundSet = member.sets.find(
            (s) => s.set_number === changedSet.set_number
          );
          if (roundSet)
            store.updateSetField(String(roundSet.id), {
              rest_time: update.seconds,
            });
        }
      }
    } else {
      for (const update of updates) {
        store.updateSetField(update.setId, { rest_time: update.seconds });
      }
    }
  }, []);

  return { ref, present, apply };
}
