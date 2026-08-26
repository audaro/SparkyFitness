import { apiCall } from '@/api/api';
import type {
  CoachProfileResponse,
  UpdateCoachProfileRequest,
} from '@workspace/shared';

export type CoachProfile = CoachProfileResponse;
export type CoachProfilePatch = UpdateCoachProfileRequest;

/**
 * The user's stated training constraints — goals, days per week, session
 * minutes, experience level, limitations. A user with no profile row gets
 * every field null rather than a 404, so callers never special-case "not
 * interviewed yet".
 *
 * Owner-only: `coach_profiles` RLS matches the authenticated caller, and the
 * route answers 403 to a delegate. Callers gate on
 * `useCoachingContextAvailable` so the request is never made in that context.
 */
export const getCoachProfile = async (): Promise<CoachProfile> => {
  return apiCall('/coach-profile', { method: 'GET' });
};

/**
 * Partial patch: only the fields present are written, and null clears a
 * stated scalar back to unstated — which is a real edit, distinct from
 * omitting the field. An empty patch is a 400, so never send one.
 */
export const updateCoachProfile = async (
  patch: CoachProfilePatch
): Promise<CoachProfile> => {
  return apiCall('/coach-profile', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
};
