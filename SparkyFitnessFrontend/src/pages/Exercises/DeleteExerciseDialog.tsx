import type React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type {
  Exercise as ExerciseInterface,
  ExerciseDeletionImpact,
  ExerciseDeleteMode,
} from '@/types/exercises';

interface DeleteExerciseDialogProps {
  exercise: ExerciseInterface | null;
  impact: ExerciseDeletionImpact | null;
  onConfirm: (mode: ExerciseDeleteMode) => void;
  onCancel: () => void;
}

/**
 * Mirrors DeleteFoodDialog so the two library domains behave identically.
 *
 * The exercise side previously used a generic single-button ConfirmationDialog,
 * which gave the user no say at all — the hook silently picked force-delete
 * whenever the exercise had diary entries, destroying exactly the history the
 * user wanted to keep.
 */
const DeleteExerciseDialog: React.FC<DeleteExerciseDialogProps> = ({
  exercise,
  impact,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();

  if (!exercise || !impact) return null;

  const summaryCounts = [
    {
      key: 'diaryEntries',
      count: impact.exerciseEntriesCount,
      label: t('exercise.databaseManager.diaryEntriesCount', {
        count: impact.exerciseEntriesCount,
        defaultValue: `${impact.exerciseEntriesCount} logged workouts`,
      }),
    },
    {
      key: 'workoutPresets',
      count: impact.workoutPresetsCount,
      label: t('exercise.databaseManager.workoutPresetsCount', {
        count: impact.workoutPresetsCount,
        defaultValue: `${impact.workoutPresetsCount} workout presets`,
      }),
    },
    {
      key: 'workoutPlans',
      count: impact.workoutPlansCount,
      label: t('exercise.databaseManager.workoutPlansCount', {
        count: impact.workoutPlansCount,
        defaultValue: `${impact.workoutPlansCount} workout plans`,
      }),
    },
  ].filter(({ count }) => count > 0);

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t('exercise.databaseManager.deleteExerciseConfirmTitle', {
              exerciseName: exercise.name,
              defaultValue: `Delete ${exercise.name}?`,
            })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {summaryCounts.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">
                {t(
                  'exercise.databaseManager.exerciseUsedIn',
                  'This exercise is used in:'
                )}
              </p>
              {summaryCounts.map(({ key, label }) => (
                <div
                  key={key}
                  className="rounded-lg border border-border px-3 py-2.5 text-sm bg-muted/20"
                >
                  {label}
                </div>
              ))}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t(
                'exercise.databaseManager.exerciseUnused',
                'This exercise is not used anywhere yet.'
              )}
            </p>
          )}

          {impact.isUsedByOthers && (
            <div className="p-3.5 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300 rounded-lg text-sm space-y-1">
              <p className="font-semibold">
                {t('exercise.databaseManager.warning', 'Warning!')}
              </p>
              <p className="text-yellow-700 dark:text-yellow-400">
                {t(
                  'exercise.databaseManager.exerciseUsedByOtherUsersWarning',
                  'This exercise is used by other users. You can only hide it. Hiding stops it appearing in search from now on, but does not affect their history, presets, or plans.'
                )}
              </p>
            </div>
          )}

          {!impact.isUsedByOthers && impact.exerciseEntriesCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {t(
                'exercise.databaseManager.deleteKeepsDiaryHint',
                'Deleting removes the exercise from your library, presets and plans. Your logged workouts keep their name, picture, sets and reps.'
              )}
            </p>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onCancel}>
            {t('exercise.databaseManager.cancel', 'Cancel')}
          </Button>
          {impact.totalReferences === 0 ? (
            <Button variant="destructive" onClick={() => onConfirm('delete')}>
              {t('exercise.databaseManager.delete', 'Delete')}
            </Button>
          ) : impact.isUsedByOthers ? (
            // Presets and plans cascade from the library row for every user, so
            // deleting would strip the exercise out of other people's data.
            // Hiding is the only option that leaves them alone.
            <Button onClick={() => onConfirm('hide')}>
              {t('exercise.databaseManager.hide', 'Hide')}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onConfirm('hide')}>
                {t('exercise.databaseManager.hide', 'Hide')}
              </Button>
              <Button variant="default" onClick={() => onConfirm('delete')}>
                {t('exercise.databaseManager.delete', 'Delete')}
              </Button>
              <Button
                variant="destructive"
                onClick={() => onConfirm('delete_with_history')}
              >
                {t(
                  'exercise.databaseManager.deleteWithHistory',
                  'Delete including history'
                )}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteExerciseDialog;
