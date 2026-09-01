import type { UserGoals } from '@workspace/shared';

// The shared schema types goal_date as a Date because that is the column type,
// but pg hands DATE columns back as raw 'YYYY-MM-DD' strings here — see the
// type parser in db/poolManager.ts, which is deliberate so a calendar day is
// not shifted by the server's timezone. A type alias rather than an interface
// so it still satisfies the Record<string, unknown> the goal pipeline passes
// these rows through as.
export type Goals = Omit<UserGoals, 'goal_date'> & {
  goal_date: string | Date;
};
