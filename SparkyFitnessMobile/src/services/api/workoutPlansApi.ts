import { apiFetch } from './apiClient';
import type { WorkoutPlanTemplate } from '../../types/workoutPlans';

export const fetchActiveWorkoutPlans = async (
  date: string
): Promise<WorkoutPlanTemplate[]> => {
  const response = await apiFetch<
    WorkoutPlanTemplate[] | WorkoutPlanTemplate | null
  >({
    endpoint: `/api/workout-plan-templates/active/${date}`,
    serviceName: 'Workout Plans API',
    operation: 'fetch active workout plans',
  });
  if (!response) return [];
  return Array.isArray(response) ? response : [response];
};
