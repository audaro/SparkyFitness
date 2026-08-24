import { apiFetch } from './apiClient';

const SERVICE_NAME = 'Weekly Set Targets API';

/** Training groups a set can count toward. Mirrors the shared MUSCLE_GROUPS. */
export type MuscleGroup = 'push' | 'pull' | 'legs' | 'core';

export interface WeeklySetGroupProgress {
  group: MuscleGroup;
  /** Fractional: a muscle trained as a secondary mover is half a set. */
  completed: number;
  target: number;
  remaining: number;
  /** 0..1, clamped. */
  percent: number;
}

export interface WeeklySetTargetSummary {
  week_start: string;
  week_end: string;
  groups: WeeklySetGroupProgress[];
  overall_percent: number;
}

export interface WeeklySetTargetsResponse {
  current: WeeklySetTargetSummary;
  /** Earlier weeks, oldest first, excluding the current week. */
  history: WeeklySetTargetSummary[];
  /** False when the server derived the targets from training days per week. */
  targets_are_custom: boolean;
}

export const fetchWeeklySetTargets = async (
  historyWeeks: number,
): Promise<WeeklySetTargetsResponse> => {
  return apiFetch<WeeklySetTargetsResponse>({
    endpoint: `/api/weekly-set-targets?history_weeks=${historyWeeks}`,
    serviceName: SERVICE_NAME,
    operation: 'fetch weekly set targets',
  });
};

/**
 * Saves a partial target map. Groups left out keep whatever they had, so the
 * caller sends only what the user actually changed.
 */
export const updateWeeklySetTargets = async (
  targets: Partial<Record<MuscleGroup, number>>,
  historyWeeks: number,
): Promise<WeeklySetTargetsResponse> => {
  return apiFetch<WeeklySetTargetsResponse>({
    endpoint: `/api/weekly-set-targets?history_weeks=${historyWeeks}`,
    method: 'PUT',
    body: { targets },
    serviceName: SERVICE_NAME,
    operation: 'update weekly set targets',
  });
};
