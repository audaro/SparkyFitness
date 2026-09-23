import type { WorkoutPresetSet } from './workoutPresets';

export type WorkoutPlanScheduleType = 'weekly' | 'sequential';

export interface WorkoutPlanAssignment {
  id: string;
  template_id: string;
  day_of_week: number | null;
  session_index?: number | null;
  session_name?: string | null;
  sort_order: number | null;
  workout_preset_id?: string | null;
  workout_preset_name?: string | null;
  exercise_id?: string | null;
  exercise_name?: string | null;
  sets: WorkoutPresetSet[];
  created_at?: string;
  updated_at?: string;
  category?: string | null;
  modality?: string | null;
}

export interface WorkoutPlanTemplate {
  id: string;
  user_id: string;
  plan_name: string;
  description?: string | null;
  start_date: string;
  end_date?: string | null;
  is_active: boolean;
  schedule_type: WorkoutPlanScheduleType;
  entry_mode?: 'prompt' | 'prefill';
  created_at?: string;
  updated_at?: string;
  assignments?: WorkoutPlanAssignment[];
  next_assignment?: WorkoutPlanAssignment | null;
  next_assignments?: WorkoutPlanAssignment[];
  sequence_position?: {
    current: number;
    total: number;
    session_name?: string | null;
  } | null;
}
