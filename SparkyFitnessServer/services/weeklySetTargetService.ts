import {
  MUSCLE_GROUPS,
  bucketEntriesByWeek,
  deriveDefaultWeeklySetTargets,
  recentWeekStarts,
  summarizeWeeklySetTargets,
  todayInZone,
  type MuscleGroup,
  type WeeklySetEntry,
  type WeeklySetTargetSummary,
  type WeeklySetTargetsResponse,
} from '@workspace/shared';
import workoutRecommendationRepository from '../models/workoutRecommendationRepository.js';
import coachProfileRepository from '../models/coachProfileRepository.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';

/** History weeks a caller may ask for, on top of the current week. */
export const MAX_HISTORY_WEEKS = 12;

/**
 * Reads the stored targets, falling back to a derived default.
 *
 * A stored map may be partial (the user set legs and nothing else) or hold a
 * group that no longer exists, so it is merged over the derived defaults per
 * group rather than used wholesale. `targetsAreCustom` reports whether the user
 * set *anything*, because the client labels a derived number differently from
 * one the user committed to.
 */
async function resolveTargets(userId: string): Promise<{
  targets: Record<MuscleGroup, number>;
  targetsAreCustom: boolean;
}> {
  const profile = await coachProfileRepository.getCoachProfile(userId);
  const stored = profile?.weekly_set_targets ?? {};
  const defaults = deriveDefaultWeeklySetTargets(
    profile?.training_days_per_week ?? null
  );
  const targets = { ...defaults };
  let targetsAreCustom = false;
  for (const group of MUSCLE_GROUPS) {
    const value = stored[group];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      targets[group] = Math.round(value);
      targetsAreCustom = true;
    }
  }
  return { targets, targetsAreCustom };
}

function toSummaryResponse(
  summary: WeeklySetTargetSummary
): WeeklySetTargetsResponse['current'] {
  return {
    week_start: summary.weekStart,
    week_end: summary.weekEnd,
    groups: summary.groups,
    overall_percent: summary.overallPercent,
  };
}

/**
 * The current week's progress plus `historyWeeks` earlier weeks.
 *
 * One query covers every week on screen: the entries come back for the whole
 * span and are bucketed by week here. Asking per week would multiply an
 * already-joined aggregate query by thirteen for a screen that renders in one
 * pass.
 *
 * Targets are the *current* ones for every week shown, including history. That
 * is a deliberate simplification — nothing records what a target was in March —
 * and it means a past week's ring answers "how would that week measure up to
 * what I am aiming for now", not "did I hit the target I held then".
 */
async function getWeeklySetTargets(
  userId: string,
  historyWeeks: number
): Promise<WeeklySetTargetsResponse> {
  const weeks = Math.min(Math.max(historyWeeks, 0), MAX_HISTORY_WEEKS) + 1;
  const timezone = await loadUserTimezone(userId);
  const today = todayInZone(timezone);
  const weekStarts = recentWeekStarts(today, weeks);
  const rangeStart = weekStarts[0]!;
  // Today, not Saturday. The screen reports sets already done, so an entry the
  // user dated later this week — logging ahead, or a session pencilled in for
  // Friday — must not fill the ring on Tuesday. Every history week ends in the
  // past, so a single `today` bound covers the whole span.
  const rangeEnd = today;

  const rows = await workoutRecommendationRepository.getWeeklySetCountInputs(
    userId,
    rangeStart,
    rangeEnd
  );
  const entries: WeeklySetEntry[] = rows.map((row) => ({
    entryDate: row.entryDate,
    primaryMuscles: row.primaryMuscles,
    secondaryMuscles: row.secondaryMuscles,
    workingSetCount: row.workingSetCount,
  }));
  const byWeek = bucketEntriesByWeek(entries);
  const { targets, targetsAreCustom } = await resolveTargets(userId);

  const summaries = weekStarts.map((weekStart) =>
    toSummaryResponse(
      summarizeWeeklySetTargets({
        weekStart,
        entries: byWeek.get(weekStart) ?? [],
        targets,
      })
    )
  );

  // recentWeekStarts returns oldest first and ends on the current week.
  const current = summaries[summaries.length - 1]!;
  return {
    current,
    history: summaries.slice(0, -1),
    targets_are_custom: targetsAreCustom,
  };
}

/**
 * Writes a partial target map, then returns the freshly recomputed screen so
 * the client never has to guess what the server made of the edit.
 *
 * The patch is merged over what is stored rather than replacing it: a client
 * sending only the group the user just changed must not silently clear the
 * others. The merge itself happens in SQL — see `mergeWeeklySetTargets` — so
 * two clients editing different groups at once cannot clobber each other.
 */
async function updateWeeklySetTargets(
  userId: string,
  patch: Partial<Record<MuscleGroup, number>>,
  historyWeeks: number
): Promise<WeeklySetTargetsResponse> {
  const changes: Record<string, number> = {};
  for (const group of MUSCLE_GROUPS) {
    const value = patch[group];
    if (typeof value === 'number') changes[group] = Math.round(value);
  }
  if (Object.keys(changes).length > 0) {
    await coachProfileRepository.mergeWeeklySetTargets(userId, changes);
  }
  return await getWeeklySetTargets(userId, historyWeeks);
}

export { getWeeklySetTargets, updateWeeklySetTargets };

export default {
  getWeeklySetTargets,
  updateWeeklySetTargets,
  MAX_HISTORY_WEEKS,
};
