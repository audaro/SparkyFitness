import { apiCall } from '@/api/api';
import type { MuscleGainProjectionResponse } from '@workspace/shared';

export type MuscleGainProjection = MuscleGainProjectionResponse;

/**
 * Lean mass the server estimates over a horizon, from training and — when the
 * profile states one — from exogenous testosterone.
 *
 * Assembled server-side from the user's weigh-ins, their stated experience and
 * how reliably they have been hitting their weekly set targets. The stated
 * dose is deliberately absent from the response: the payload says only whether
 * one was part of the estimate, through `inputs.enhancement_stated`.
 *
 * Owner-only, like the rest of the coach profile. Gate the caller on
 * `useCoachingContextAvailable` so a delegate never collects a 403.
 */
export const getMuscleGainProjection = async (
  weeks: number
): Promise<MuscleGainProjection> => {
  return apiCall('/coach-profile/projection', {
    method: 'GET',
    params: { weeks },
  });
};
