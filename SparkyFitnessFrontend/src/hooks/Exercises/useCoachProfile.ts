import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getCoachProfile,
  updateCoachProfile,
  type CoachProfile,
  type CoachProfilePatch,
} from '@/api/Exercises/coachProfile';
import {
  coachProfileKeys,
  muscleGainProjectionKeys,
  weeklySetTargetKeys,
  workoutRecommendationKeys,
} from '@/api/keys/exercises';

// Pages may not import from `@/api` (enforced by no-restricted-imports), so the
// domain types reach them through this hook module.
export type {
  CoachProfile,
  CoachProfilePatch,
} from '@/api/Exercises/coachProfile';

/**
 * The coach profile the workout engine reads. Owner-only — pass
 * `useCoachingContextAvailable()` as `enabled` so a delegate context makes no
 * request instead of collecting a 403.
 */
export const useCoachProfile = (enabled: boolean = true) => {
  const { t } = useTranslation();

  return useQuery<CoachProfile>({
    queryKey: coachProfileKeys.current(),
    queryFn: getCoachProfile,
    enabled,
    meta: {
      errorMessage: t(
        'coachProfile.loadError',
        'Failed to load your training profile.'
      ),
    },
  });
};

/**
 * Saves a partial patch and replaces the cached profile with what the server
 * stored — the response is authoritative, so there is nothing to refetch.
 * A profile edit changes what the *next* generation reads; the stored
 * workout deliberately does not move until the user regenerates.
 */
export const useUpdateCoachProfileMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (patch: CoachProfilePatch) => updateCoachProfile(patch),
    onSuccess: (profile) => {
      queryClient.setQueryData(coachProfileKeys.current(), profile);
    },
    meta: {
      successMessage: t('coachProfile.saveSuccess', 'Training profile saved.'),
      errorMessage: t(
        'coachProfile.saveError',
        'Failed to save your training profile.'
      ),
    },
  });
};

/**
 * Saves the whole training plan as one patch and stamps it answered.
 *
 * `plan_completed_at` is the only thing that says the questionnaire has been
 * answered — a profile with some fields filled in is not a completed plan, and
 * nothing infers completion from the fields themselves — so the stamp belongs
 * to the save rather than to whichever form happened to call it.
 *
 * The plan changes what the weekly targets derive and what the next generate
 * reads, and it is an input to the projection, so all three are invalidated.
 * The stored workout deliberately stays put until regenerated; what has to
 * move is the card's claim about which plan produced it.
 */
export const useSaveTrainingPlanMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (patch: CoachProfilePatch) =>
      updateCoachProfile({
        ...patch,
        plan_completed_at: new Date().toISOString(),
      }),
    onSuccess: (profile) => {
      queryClient.setQueryData(coachProfileKeys.current(), profile);
      void queryClient.invalidateQueries({ queryKey: weeklySetTargetKeys.all });
      void queryClient.invalidateQueries({
        queryKey: workoutRecommendationKeys.all,
      });
      void queryClient.invalidateQueries({
        queryKey: muscleGainProjectionKeys.all,
      });
    },
    meta: {
      successMessage: t('trainingPlan.saved', 'Training plan saved.'),
      errorMessage: t(
        'trainingPlan.saveError',
        'Failed to save your training plan.'
      ),
    },
  });
};
