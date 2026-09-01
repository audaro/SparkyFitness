import exerciseRepository from '../models/exerciseRepository.js';
// Helper function to validate UUID
const isValidUuid = (uuid: string) => {
  const uuidRegex =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  return uuidRegex.test(uuid);
};
// Helper function to resolve exercise ID to a UUID
async function resolveExerciseIdToUuid(exerciseId: string, userId: string) {
  if (isValidUuid(exerciseId)) {
    return exerciseId;
  }
  // If not a UUID, assume it's an ID from a source like FreeExerciseDB.
  // Each user may have their own per-user copy of that source exercise, so
  // callers pass userId to select the row owned by the current user.
  const exercise = await exerciseRepository.getExerciseBySourceAndSourceId(
    'free-exercise-db',
    exerciseId,
    userId
  );
  if (exercise) {
    return exercise.id;
  }
  throw new Error(
    `Exercise with ID ${exerciseId} not found or is not a valid UUID.`
  );
}
export { isValidUuid };
export { resolveExerciseIdToUuid };
export default {
  isValidUuid,
  resolveExerciseIdToUuid,
};
