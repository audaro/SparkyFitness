import axios from 'axios';
import NodeCache from 'node-cache';
import { log } from '../../config/logging.js';

// Community mirror of the ExerciseDB v1 catalog. Unlike free-exercise-db it
// tags equipment per machine ("leverage machine", "sled machine", "smith
// machine"), which is what lets its rows map onto the granular equipment-item
// vocabulary. Media is © Gym Visual (https://gymvisual.com/) — downloaded
// into the local uploads dir for the importing user only, never redistributed.
const GITHUB_RAW_BASE_URL =
  'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main';
const DATASET_PATH = 'data/exercises.json';

const datasetCache = new NodeCache({ stdTTL: 3600 });

// Shape of one mirror record. Only the fields this service's callers actually
// touch are typed; `muscle_group` is deliberately absent because it is noisy
// upstream — classification reads `target` and `secondary_muscles` instead.
export interface ExerciseDbMirrorRecord {
  id: string;
  name: string;
  equipment: string;
  target: string;
  secondary_muscles?: string[];
  /** Per-language instruction arrays; only `en` is imported. */
  instruction_steps?: Record<string, string[]>;
  /** Repo-relative still image path, e.g. "images/0009-PAgTVaK.jpg". */
  image?: string;
  /** Repo-relative animation path, e.g. "videos/0009-PAgTVaK.gif". */
  gif_url?: string;
  [key: string]: unknown;
}

class ExerciseDbMirrorService {
  /** The full mirror dataset, cached under a single fixed key for an hour. */
  async getAllExercises(): Promise<ExerciseDbMirrorRecord[]> {
    const cacheKey = 'all_exercises_dataset';
    const cached = datasetCache.get<ExerciseDbMirrorRecord[]>(cacheKey);
    if (cached) {
      return cached;
    }
    const datasetUrl = `${GITHUB_RAW_BASE_URL}/${DATASET_PATH}`;
    log(
      'debug',
      `[ExerciseDbMirrorService] Fetching dataset from: ${datasetUrl}`
    );
    const response = await axios.get<ExerciseDbMirrorRecord[]>(datasetUrl, {
      // Pack import can be waiting on this fetch; a hung connection must fail
      // instead of stalling the caller indefinitely.
      timeout: 15_000,
    });
    if (!Array.isArray(response.data)) {
      throw new Error(
        '[ExerciseDbMirrorService] Dataset response was not an array'
      );
    }
    datasetCache.set(cacheKey, response.data);
    return response.data;
  }

  /** Absolute raw URL for a record's repo-relative media path. */
  getMediaUrl(mediaPath: string): string {
    return `${GITHUB_RAW_BASE_URL}/${mediaPath}`;
  }
}

const exerciseDbMirrorService = new ExerciseDbMirrorService();
export default exerciseDbMirrorService;
