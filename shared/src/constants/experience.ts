/**
 * The training-experience vocabulary, shared by `exercises.level` and
 * `coach_profiles.experience_level`.
 *
 * These are free-exercise-db's difficulty tokens, and the profile deliberately
 * reuses them rather than inventing its own ("novice", "advanced"): the
 * workout generator's level term is an exact string comparison between the
 * profile's value and the candidate row's, so a second vocabulary would not be
 * a synonym set — it would be a silent no-match. Stored and compared
 * lowercase; display copy owns capitalization and translation.
 */
export const EXPERIENCE_LEVELS = [
  "beginner",
  "intermediate",
  "expert",
] as const;

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];
