import { apiCall } from '@/api/api';
import {
  DailyHealthMetrics,
  ExerciseEntryLaps,
  ExerciseEntryGpsPoints,
  ExerciseEntryHrZones,
  HealthMetric,
  HealthMetricSamples,
} from '@workspace/shared';

export const fetchHealthMetricSamples = async (
  metric: HealthMetric,
  startDate: string,
  endDate?: string,
  userId?: string
): Promise<HealthMetricSamples[]> => {
  const params = new URLSearchParams({
    metric,
    startDate,
    endDate: endDate || startDate,
  });
  if (userId) params.append('userId', userId);
  const response = await apiCall<{ data: HealthMetricSamples[] }>(
    `/generic-health/samples?${params.toString()}`,
    {
      method: 'GET',
    }
  );
  return response?.data || [];
};

export const fetchDailyHealthMetrics = async (
  startDate: string,
  endDate?: string,
  userId?: string
): Promise<DailyHealthMetrics[]> => {
  const params = new URLSearchParams({
    startDate,
    endDate: endDate || startDate,
  });
  if (userId) params.append('userId', userId);
  const response = await apiCall<{ data: DailyHealthMetrics[] }>(
    `/generic-health/metrics?${params.toString()}`,
    {
      method: 'GET',
    }
  );
  return response?.data || [];
};

export const fetchWorkoutLaps = async (
  exerciseEntryId: string
): Promise<ExerciseEntryLaps[]> => {
  const response = await apiCall<{ data: ExerciseEntryLaps[] }>(
    `/generic-health/workout-laps/${exerciseEntryId}`,
    { method: 'GET' }
  );
  return response?.data || [];
};

/**
 * Returns one row for the whole workout (its `points` array holds every
 * trackpoint), or null if the workout has no GPS data — not a list of rows.
 */
export const fetchWorkoutGpsPoints = async (
  exerciseEntryId: string
): Promise<ExerciseEntryGpsPoints | null> => {
  const response = await apiCall<{ data: ExerciseEntryGpsPoints | null }>(
    `/generic-health/workout-gps/${exerciseEntryId}`,
    { method: 'GET' }
  );
  return response?.data ?? null;
};

export const fetchWorkoutHrZones = async (
  exerciseEntryId: string
): Promise<ExerciseEntryHrZones[]> => {
  const response = await apiCall<{ data: ExerciseEntryHrZones[] }>(
    `/generic-health/workout-hr-zones/${exerciseEntryId}`,
    { method: 'GET' }
  );
  return response?.data || [];
};
