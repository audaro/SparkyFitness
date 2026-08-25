import { useActiveUser } from '@/contexts/ActiveUserContext';

/**
 * Whether the coaching-context surfaces can be shown at all.
 *
 * `coach_profiles`, `gym_equipment_profiles` and `workout_recommendations` are
 * all owner-only at the RLS layer (`db/rls_policies.sql`, "Owner-only access
 * tables"): they match the *authenticated actor*, not the switched-to user, and
 * are deliberately not family-delegated. So while acting on behalf of someone
 * else a delegate would read an empty list and have every write rejected.
 *
 * Sections built on those tables hide themselves rather than render broken, and
 * their queries stay disabled so no request is made at all.
 */
export const useCoachingContextAvailable = (): boolean => {
  const { isActingOnBehalf } = useActiveUser();
  return !isActingOnBehalf;
};
