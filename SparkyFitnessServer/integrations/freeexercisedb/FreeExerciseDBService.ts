import axios from 'axios';
import NodeCache from 'node-cache';
import { log } from '../../config/logging.js';
import { filterAndSortByTerms } from '@workspace/shared';

const GITHUB_RAW_BASE_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main';
const EXERCISES_PATH = 'exercises'; // No leading slash for API
// Initialize cache for GitHub API responses (e.g., 1 hour TTL)
const githubCache = new NodeCache({ stdTTL: 3600 });

// Shape of one upstream free-exercise-db record (dist/exercises.json entry).
// Only the fields this service and its callers actually touch are typed.
export interface FreeExerciseDbExercise {
  id: string;
  name: string;
  images?: string[];
  equipment?: string | string[] | null;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  [key: string]: unknown;
}
class FreeExerciseDBService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exerciseList: any;
  constructor() {
    this.exerciseList = []; // To store a list of available exercise IDs/names
  }
  /**
   * Fetches a single exercise by its ID (filename without .json).
   * @param {string} exerciseId - The ID of the exercise (e.g., "Air_Bike").
   * @returns {Promise<object|null>} The exercise data or null if not found.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getExerciseById(exerciseId: any) {
    const cacheKey = `exercise_${exerciseId}`;
    let exercise = githubCache.get(cacheKey);
    if (exercise) {
      console.log(
        `[FreeExerciseDBService] Cache hit for exercise: ${exerciseId}`
      );
      return exercise;
    }
    try {
      const url = `${GITHUB_RAW_BASE_URL}/${EXERCISES_PATH}/${exerciseId}.json`;
      console.log(`[FreeExerciseDBService] Fetching exercise from: ${url}`);
      const response = await axios.get(url);
      exercise = response.data;
      log(
        'debug',
        `[FreeExerciseDBService] Fetched exercise ${exerciseId}:`,
        exercise
      );
      githubCache.set(cacheKey, exercise);
      return exercise;
    } catch (error) {
      log(
        'error',
        `[FreeExerciseDBService] Error fetching exercise ${exerciseId}:`,
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        error.message
      );
      return null;
    }
  }
  /**
   * The full upstream dataset, cached under a single fixed key. Every search
   * previously fetched the multi-megabyte exercises.json again because the
   * per-query result cache keys never overlap between queries.
   */
  async getAllExercises(): Promise<FreeExerciseDbExercise[]> {
    const cacheKey = 'all_exercises_dataset';
    const cached = githubCache.get<FreeExerciseDbExercise[]>(cacheKey);
    if (cached) {
      return cached;
    }
    const exercisesJsonUrl =
      'https://api.github.com/repos/yuhonas/free-exercise-db/contents/dist/exercises.json';
    log(
      'debug',
      `[FreeExerciseDBService] Fetching exercises from: ${exercisesJsonUrl}`
    );
    const response = await axios.get<FreeExerciseDbExercise[]>(
      exercisesJsonUrl,
      {
        headers: { Accept: 'application/vnd.github.raw+json' },
        // Exercise creation can be waiting on this fetch; a hung GitHub
        // connection must fail instead of stalling the caller indefinitely.
        timeout: 10_000,
      }
    );
    githubCache.set(cacheKey, response.data);
    return response.data;
  }

  async searchExercises(
    query: string | null | undefined,
    equipmentFilter: string[] = [],
    muscleGroupFilter: string[] = [],
    limit = 50,
    offset = 0
  ) {
    const cacheKey = `search_exercises_${query}_${equipmentFilter.join(',')}_${muscleGroupFilter.join(',')}_${limit}_${offset}`;
    const cachedResults = githubCache.get(cacheKey);
    if (cachedResults) {
      console.log(
        `[FreeExerciseDBService] Cache hit for search query: ${query}, equipment: ${equipmentFilter}, muscles: ${muscleGroupFilter}, limit: ${limit}, offset: ${offset}`
      );
      return cachedResults;
    }
    try {
      const allExercises = await this.getAllExercises();

      // 1. Filter by equipment and muscle group first
      const preFiltered = allExercises.filter((exercise) => {
        const matchesEquipment =
          equipmentFilter.length === 0 ||
          equipmentFilter.some(
            (filter) => exercise.equipment?.includes(filter) ?? false
          );
        const matchesMuscleGroup =
          muscleGroupFilter.length === 0 ||
          muscleGroupFilter.some(
            (filter) => exercise.primaryMuscles?.includes(filter) ?? false
          ) ||
          muscleGroupFilter.some(
            (filter) => exercise.secondaryMuscles?.includes(filter) ?? false
          );
        return matchesEquipment && matchesMuscleGroup;
      });

      // 2. Filter and sort by search query using the shared utility
      const filteredExercises = filterAndSortByTerms(
        preFiltered,
        (ex) => ex.name,
        query || ''
      );

      const totalCount = filteredExercises.length;
      const paginatedExercises = filteredExercises.slice(
        offset,
        offset + limit
      );
      const result = { exercises: paginatedExercises, totalCount };
      githubCache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error(
        `[FreeExerciseDBService] Error searching exercises for query "${query}" with limit ${limit}:`,
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        error.message
      );
      return { exercises: [], totalCount: 0 };
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getExerciseImageUrl(imagePath: any) {
    // The imagePath from the exercise JSON is relative to the exercise file,
    // e.g., "3_4_Sit-Up/0.jpg".
    // The full raw URL should be GITHUB_RAW_BASE_URL/images/ExerciseName/image.jpg
    const imageUrl = `${GITHUB_RAW_BASE_URL}/${EXERCISES_PATH}/${imagePath}`;
    log(
      'debug',
      `[FreeExerciseDBService] Constructed image URL: ${imageUrl} from imagePath: ${imagePath}`
    );
    return imageUrl;
  }
}
const freeExerciseDBService = new FreeExerciseDBService();
export default freeExerciseDBService;
