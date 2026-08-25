import { useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import {
  loadWorkoutPlaybackDraftFromStorage,
  type WorkoutPlaybackDraft,
} from '@/utils/workoutPlayback';

export interface StartWorkoutPlaybackRequest {
  /** The day the workout is logged to, `YYYY-MM-DD`. */
  entryDate: string;
  /**
   * Built lazily, and only when playback is actually entered: a start the user
   * cancels at the prompt should not have paid for mapping a whole workout, and
   * a draft stamps `started_at` at the moment it is created.
   */
  createDraft: () => WorkoutPlaybackDraft;
  /** Ran after navigating. Best-effort side effects only — see `UpNextCard`. */
  onStarted?: () => void;
}

/**
 * Enter workout playback, without destroying a workout already in progress.
 *
 * Every caller hands `/workout-playback` a draft through route state, and
 * `WorkoutPlaybackPage` prefers that draft over the one in storage and then
 * overwrites storage with it. So starting *any* workout on a day that already
 * has an unfinished one silently discards the unfinished one — sets, timings
 * and all. This hook is the prompt that stands in front of that, shared by all
 * three entry points (the Up Next card and the two preset paths) so a fourth
 * cannot quietly reintroduce the hazard.
 *
 * Resuming deliberately navigates with **no** draft in route state: falling
 * back to the stored draft is exactly what resuming means, and passing one
 * would be the overwrite this exists to prevent.
 *
 * Returns the dialog element rather than taking a render prop — callers just
 * drop `guardDialog` somewhere in their tree and forget about it.
 */
export const useWorkoutPlaybackStart = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [pending, setPending] = useState<StartWorkoutPlaybackRequest | null>(
    null
  );

  const enterPlayback = useCallback(
    (
      request: StartWorkoutPlaybackRequest,
      draft: WorkoutPlaybackDraft | null
    ) => {
      navigate(`/workout-playback?date=${request.entryDate}`, {
        state: {
          returnTo: `${location.pathname}${location.search}`,
          ...(draft ? { draft } : {}),
        },
      });
      if (draft) {
        request.onStarted?.();
      }
    },
    [location.pathname, location.search, navigate]
  );

  const requestStart = useCallback(
    (request: StartWorkoutPlaybackRequest) => {
      if (loadWorkoutPlaybackDraftFromStorage(request.entryDate)) {
        setPending(request);
        return;
      }
      enterPlayback(request, request.createDraft());
    },
    [enterPlayback]
  );

  const guardDialog = (
    <ConfirmationDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
      title={t(
        'exercise.replaceInProgressTitle',
        'Workout already in progress'
      )}
      description={t(
        'exercise.replaceInProgressDescription',
        'You have an unfinished workout for this day. Starting this one replaces it, and anything you logged in the unfinished workout is lost.'
      )}
      variant="destructive"
      confirmLabel={t('exercise.replaceInProgressConfirm', 'Start new workout')}
      onConfirm={() => {
        const request = pending;
        setPending(null);
        if (request) {
          enterPlayback(request, request.createDraft());
        }
      }}
      secondaryActionLabel={t('exercise.resumeInProgress', 'Resume it')}
      onSecondaryAction={() => {
        const request = pending;
        setPending(null);
        if (request) {
          enterPlayback(request, null);
        }
      }}
    />
  );

  return { requestStart, guardDialog };
};
