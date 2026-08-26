import type {
  CoachProfileResponse,
  UpdateCoachProfileRequest,
} from '@workspace/shared';
import { apiFetch } from './apiClient';

// Payload shapes are the shared request schemas the server validates against;
// these aliases keep the mobile-local names the screens are written against.
export type CoachProfile = CoachProfileResponse;
export type CoachProfilePatch = UpdateCoachProfileRequest;

const SERVICE_NAME = 'Coach Profile API';

/**
 * The user's stated training constraints — goals, days per week, session
 * minutes, experience level, limitations. A user with no profile row gets
 * every field null rather than a 404, so callers never special-case "not
 * interviewed yet".
 *
 * Owner-only: `coach_profiles` RLS matches the authenticated caller, and the
 * route answers 403 when acting on behalf of someone else.
 */
export const fetchCoachProfile = async (): Promise<CoachProfile> => {
  return apiFetch<CoachProfile>({
    endpoint: '/api/coach-profile',
    serviceName: SERVICE_NAME,
    operation: 'fetch coach profile',
  });
};

/**
 * Partial patch: only the fields present are written, and null clears a
 * stated scalar back to unstated — which is a real edit, distinct from
 * omitting the field. An empty patch is a 400, so never send one.
 */
export const updateCoachProfile = async (
  patch: CoachProfilePatch,
): Promise<CoachProfile> => {
  return apiFetch<CoachProfile>({
    endpoint: '/api/coach-profile',
    method: 'PATCH',
    body: patch,
    serviceName: SERVICE_NAME,
    operation: 'update coach profile',
  });
};
