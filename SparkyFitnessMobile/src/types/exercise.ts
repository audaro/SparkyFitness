import type { ExerciseModality } from '@workspace/shared';

export interface Exercise {
  id: string;
  name: string;
  category: string | null;
  /** Absent/null on pre-modality servers; resolve via `resolveSnapshotModality`. */
  modality?: ExerciseModality | null;
  equipment: string[];
  primary_muscles: string[];
  secondary_muscles: string[];
  calories_per_hour: number;
  source: string;
  images: string[];
  // Demonstration clips (server-relative paths or absolute URLs), same
  // resolution rules as `images`. Absent on rows from older servers.
  videos?: string[];
  tags: string[];
  force?: string | null;
  level?: string | null;
  mechanic?: string | null;
  instructions?: string[];
  description?: string | null;
  userId?: string | null;
  isCustom?: boolean;
  sharedWithPublic?: boolean;
}

export interface SuggestedExercisesResponse {
  recentExercises: Exercise[];
  topExercises: Exercise[];
}
