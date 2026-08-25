import { apiCall } from '@/api/api';
import type {
  MuscleGroupValue,
  UpdateWeeklySetTargetsRequest,
  WeeklySetTargetsResponse,
} from '@workspace/shared';

export type WeeklySetTargets = WeeklySetTargetsResponse;
export type MuscleGroup = MuscleGroupValue;
export type WeeklySetTargetsMap = UpdateWeeklySetTargetsRequest['targets'];

/**
 * This week's working sets per training group against the user's targets, plus
 * however many earlier weeks were asked for.
 *
 * Owner-only: targets live in `coach_profiles`, and the route answers 403 to a
 * delegate rather than reporting derived defaults as though the owner had never
 * set one. Callers gate on `useCoachingContextAvailable` so the request is never
 * made in that context.
 */
export const getWeeklySetTargets = async (
  historyWeeks: number
): Promise<WeeklySetTargets> => {
  return apiCall('/weekly-set-targets', {
    method: 'GET',
    params: { history_weeks: historyWeeks },
  });
};

/**
 * Saves targets and returns the recomputed week.
 *
 * Send only the groups that actually changed. The server merges a partial map,
 * so resending all four would overwrite an edit made elsewhere between load and
 * save — and would flip `targets_are_custom` for groups the user never touched,
 * claiming a derived default as a choice they made.
 */
export const updateWeeklySetTargets = async (
  targets: WeeklySetTargetsMap,
  historyWeeks: number
): Promise<WeeklySetTargets> => {
  return apiCall('/weekly-set-targets', {
    method: 'PUT',
    params: { history_weeks: historyWeeks },
    body: JSON.stringify({ targets }),
  });
};
