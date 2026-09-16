import type { MuscleGainProjectionResponse } from '@workspace/shared';
import { apiFetch } from './apiClient';

export type MuscleGainProjection = MuscleGainProjectionResponse;

const SERVICE_NAME = 'Muscle Gain Projection API';

/**
 * Lean mass the server estimates over a horizon, from training and — when the
 * profile states one — from exogenous testosterone.
 *
 * The estimate is assembled server-side from the user's weigh-ins, their
 * stated experience and how reliably they have been hitting their weekly set
 * targets. The stated dose is deliberately absent from the response: the
 * payload only says whether one was part of the estimate, via
 * `inputs.enhancement_stated`.
 *
 * Owner-only, like the rest of the coach profile.
 */
export const fetchMuscleGainProjection = async (
  weeks: number,
): Promise<MuscleGainProjection> => {
  return apiFetch<MuscleGainProjection>({
    endpoint: `/api/coach-profile/projection?weeks=${weeks}`,
    serviceName: SERVICE_NAME,
    operation: 'fetch muscle gain projection',
  });
};
