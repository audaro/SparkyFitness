import { getClient } from '../db/poolManager.js';
import exerciseRepository from '../models/exerciseRepository.js';
import exerciseDb from '../models/exercise.js';
import exerciseEntryDb, {
  type RecentSessionRow,
} from '../models/exerciseEntry.js';
import activityDetailsRepository from '../models/activityDetailsRepository.js';
import exercisePresetEntryRepository from '../models/exercisePresetEntryRepository.js';
import preferenceRepository from '../models/preferenceRepository.js';
import workoutPresetRepository from '../models/workoutPresetRepository.js';
import { v4 as uuidv4 } from 'uuid';
import { log } from '../config/logging.js';
import wgerService from '../integrations/wger/wgerService.js';
import nutritionixService from '../integrations/nutritionix/nutritionixService.js';
import { downloadImage } from '../utils/imageDownloader.js';
import calorieCalculationService from './CalorieCalculationService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveExerciseIdToUuid } from '../utils/uuidUtils.js';
import { normalizeToStringArray } from '../utils/exerciseJsonFields.js';
import type { FreeExerciseDbExercise } from '../integrations/freeexercisedb/FreeExerciseDBService.js';
import type { ExerciseDbMirrorRecord } from '../integrations/exercisedb/ExerciseDbMirrorService.js';
import { cleanExerciseDbExerciseName } from '../integrations/exercisedb/exerciseDbNames.js';
import {
  EXERCISE_CATALOG_PACKS,
  getExerciseCatalogPack,
  type ExerciseCatalogPack,
} from '../constants/exerciseCatalogPacks.js';
import {
  EXERCISEDB_SOURCE,
  EXERCISEDB_EQUIPMENT_TO_COARSE,
  EXERCISEDB_TARGET_TO_MUSCLE,
  EXERCISEDB_SECONDARY_TO_MUSCLE,
  deriveExerciseModality,
  canEditGroupedWorkout,
  setsDistanceKm,
  setsDurationMinutes,
  toNumber,
  parseCsv,
  DEFAULT_CSV_FORMAT,
} from '@workspace/shared';
import {
  getGroupedExerciseSessionById,
  getGroupedExerciseSessionByIdWithClient,
} from './exerciseEntryHistoryService.js';
import {
  forceMap,
  mechanicMap,
  createReverseMap,
  muscleNameMap,
  equipmentNameMap,
} from '../integrations/wger/wgerNameMapping.js';
import { ExternalProviderType } from 'types/externalProvider.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
async function getExercisesWithPagination(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  searchTerm: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  categoryFilter: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ownershipFilter: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  equipmentFilter: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  muscleGroupFilter: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentPage: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  itemsPerPage: any
) {
  try {
    const limit = parseInt(itemsPerPage, 10) || 10;
    const offset = ((parseInt(currentPage, 10) || 1) - 1) * limit;
    const [exercises, totalCount] = await Promise.all([
      exerciseDb.getExercisesWithPagination(
        targetUserId,
        searchTerm,
        categoryFilter,
        ownershipFilter,
        equipmentFilter,
        muscleGroupFilter,
        limit,
        offset
      ),
      exerciseDb.countExercises(
        targetUserId,
        searchTerm,
        categoryFilter,
        ownershipFilter,
        equipmentFilter,
        muscleGroupFilter
      ),
    ]);
    const taggedExercises = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exercises.map(async (exercise: any) => {
        const tags = [];
        const isOwner = exercise.user_id === authenticatedUserId;
        if (isOwner) {
          tags.push('private');
        }
        if (exercise.shared_with_public) {
          tags.push('public');
        }
        if (!isOwner && !exercise.shared_with_public) {
          // If not owned and not public, it must be visible due to family access
          tags.push('family');
        }
        return { ...exercise, tags };
      })
    );
    return { exercises: taggedExercises, totalCount };
  } catch (error) {
    log(
      'error',
      `Error fetching exercises with pagination for user ${authenticatedUserId} and target ${targetUserId}:`,
      error
    );
    throw error;
  }
}
async function searchExercises(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  name: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  equipmentFilter: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  muscleGroupFilter: any,
  /**
   * Active gym profile's equipment, when the caller opted in. Keeps only
   * exercises fully covered by it — not the same question as
   * `equipmentFilter`. An empty array is meaningful and is passed through.
   */
  availableEquipment?: string[] | null
) {
  try {
    const exercises = await exerciseDb.searchExercises(
      name,
      targetUserId,
      equipmentFilter,
      muscleGroupFilter,
      availableEquipment
    );
    const taggedExercises = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exercises.map(async (exercise: any) => {
        const tags = [];
        const isOwner = exercise.user_id === authenticatedUserId;
        if (isOwner) {
          tags.push('private');
        }
        if (exercise.shared_with_public) {
          tags.push('public');
        }
        if (!isOwner && !exercise.shared_with_public) {
          tags.push('family');
        }
        return { ...exercise, tags };
      })
    );
    return taggedExercises;
  } catch (error) {
    log(
      'error',
      `Error searching exercises for user ${authenticatedUserId} with name "${name}":`,
      error
    );
    throw error;
  }
}
async function searchExercisesPaginated(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  name: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  equipmentFilter: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  muscleGroupFilter: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  limit: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  offset: any
) {
  try {
    const { exercises, totalCount } = await exerciseDb.searchExercisesPaginated(
      name,
      targetUserId,
      equipmentFilter,
      muscleGroupFilter,
      limit,
      offset
    );
    const taggedExercises = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exercises.map(async (exercise: any) => {
        const tags = [];
        const isOwner = exercise.user_id === authenticatedUserId;
        if (isOwner) {
          tags.push('private');
        }
        if (exercise.shared_with_public) {
          tags.push('public');
        }
        if (!isOwner && !exercise.shared_with_public) {
          tags.push('family');
        }
        return { ...exercise, tags };
      })
    );
    return { exercises: taggedExercises, totalCount };
  } catch (error) {
    log(
      'error',
      `Error searching exercises (paginated) for user ${authenticatedUserId} with name "${name}":`,
      error
    );
    throw error;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSetStatsRow(row: any) {
  return {
    entryDate: row.entry_date,
    weight: row.weight,
    reps: row.reps,
    setNumber: row.set_number,
  };
}
// The DB holds cross-source set_type variants ('Warm-up', 'Warm-up Set', ...);
// mirror the fuzzy SQL warmup match so clients can compare against 'warmup'.
function normalizeSetType(setType: string | null): string | null {
  if (setType === null) {
    return null;
  }
  return setType
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .startsWith('warmup')
    ? 'warmup'
    : setType;
}
function mapRecentSessionRow(row: RecentSessionRow) {
  return {
    entryDate: row.entry_date,
    sets: (row.sets ?? []).map((s) => ({
      setNumber: s.set_number,
      setType: normalizeSetType(s.set_type),
      weight: s.weight,
      reps: s.reps,
      duration: s.duration,
      distance: s.distance,
    })),
  };
}
async function getExerciseStats(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exerciseId: any,
  excludePresetEntryId: string | null = null,
  presetId: number | null = null
) {
  const [bestRow, lastRow, recentRows] = await Promise.all([
    // Best/last stay exercise-global by design: a heavier lift is a PR
    // regardless of which preset it was performed under.
    exerciseEntryDb.getBestSetForExercise(
      userId,
      exerciseId,
      excludePresetEntryId
    ),
    exerciseEntryDb.getLastSetForExercise(
      userId,
      exerciseId,
      excludePresetEntryId
    ),
    // Recent sessions feed the live "Previous" placeholders; scoping to the
    // preset that started the workout (when supplied) means those placeholders
    // reflect this preset's own history instead of a different preset's.
    exerciseEntryDb.getRecentSessionsForExercise(
      userId,
      exerciseId,
      excludePresetEntryId,
      undefined,
      presetId
    ),
  ]);
  return {
    bestSet: bestRow ? mapSetStatsRow(bestRow) : null,
    lastSet: lastRow ? mapSetStatsRow(lastRow) : null,
    recentSessions: recentRows.map(mapRecentSessionRow),
  };
}
async function getAvailableEquipment() {
  try {
    const equipment = await exerciseDb.getDistinctEquipment();
    return equipment;
  } catch (error) {
    log('error', 'Error fetching available equipment:', error);
    throw error;
  }
}
async function getAvailableMuscleGroups() {
  try {
    const muscleGroups = await exerciseDb.getDistinctMuscleGroups();
    return muscleGroups;
  } catch (error) {
    log('error', 'Error fetching available muscle groups:', error);
    throw error;
  }
}
// The source values hand-created exercises arrive with: 'custom' from the
// mobile/web form, 'manual' from the chat tools. Importer sources
// (free-exercise-db, wger) and auto-created activity types (Health Data)
// bring their own media story and stay out of stock-image matching.
const STOCK_IMAGE_SOURCES = new Set(['custom', 'manual']);
const STOCK_IMAGE_LOOKUP_TIMEOUT_MS = 15_000;

function normalizeExerciseNameForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Stock photos for a hand-created exercise: the free-exercise-db image set
 * whose exercise name is an exact (normalized) match for the given name.
 * The wrong exercise's photos are worse than none, so anything short of a
 * unique exact match returns null and the exercise stays bare.
 */
async function findStockImagesForExerciseName(
  name: string
): Promise<string[] | null> {
  const { default: freeExerciseDBService } =
    await import('../integrations/freeexercisedb/FreeExerciseDBService.js');
  // Scan the full dataset rather than searchExercises: its term matching
  // keeps interior punctuation (a "bench-press" query never matches "Bench
  // Press") and its result cap would make the uniqueness check local to one
  // page instead of global.
  const catalog = await freeExerciseDBService.getAllExercises();
  const wanted = normalizeExerciseNameForMatch(name);
  const matches = catalog.filter(
    (candidate) =>
      normalizeExerciseNameForMatch(String(candidate.name ?? '')) === wanted &&
      Array.isArray(candidate.images) &&
      candidate.images.length > 0
  );
  if (matches.length !== 1) {
    return null;
  }
  const images = await downloadFreeExerciseDbImages(
    matches[0].images as string[]
  );
  return images.length > 0 ? images : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createExercise(authenticatedUserId: any, exerciseData: any) {
  try {
    // Ensure the exercise is created for the authenticated user
    exerciseData.user_id = authenticatedUserId;
    // A hand-created exercise with no photos borrows the free-exercise-db
    // set when its name unambiguously matches one catalog entry. Never
    // blocks creation: an upstream fetch failure just creates it bare.
    const hasImages = Array.isArray(exerciseData.images)
      ? exerciseData.images.length > 0
      : Boolean(exerciseData.images);
    if (
      !hasImages &&
      STOCK_IMAGE_SOURCES.has(String(exerciseData.source ?? '')) &&
      typeof exerciseData.name === 'string' &&
      exerciseData.name.trim()
    ) {
      try {
        // Race a cap so a stalled upstream fetch or image download can only
        // delay creation, never hang it — past the cap the exercise is
        // simply created bare. The losing lookup is deliberately not
        // aborted: it holds no DB handle and writes nothing to the DB, and
        // at worst it finishes warming the dataset cache and leaves the
        // photo pair in the shared free-exercise-db uploads directory,
        // where the next request for that exercise's images reuses it.
        const stockImages = await Promise.race([
          findStockImagesForExerciseName(exerciseData.name),
          new Promise<null>((resolve) => {
            const timer = setTimeout(
              () => resolve(null),
              STOCK_IMAGE_LOOKUP_TIMEOUT_MS
            );
            timer.unref?.();
          }),
        ]);
        if (stockImages) {
          exerciseData.images = stockImages;
        }
      } catch (stockImageError) {
        log(
          'debug',
          `Stock image lookup failed for exercise "${exerciseData.name}":`,
          stockImageError
        );
      }
    }
    // exerciseDb.createExercise (models/exercise.ts) is the single
    // persistence chokepoint for JSON-encoding equipment/muscles/
    // instructions/images — encoding images here too would double-encode it
    // into a JSON string containing a JSON string.
    const newExercise = await exerciseDb.createExercise(exerciseData);
    return newExercise;
  } catch (error) {
    log(
      'error',
      `Error creating exercise for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}

async function prepareExerciseEntryForCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entryData: any
) {
  const resolvedExerciseId = await resolveExerciseIdToUuid(
    entryData.exercise_id,
    authenticatedUserId
  );
  const exercise = await exerciseDb.getExerciseById(
    resolvedExerciseId,
    authenticatedUserId
  );
  if (!exercise) {
    throw new Error('Exercise not found for snapshot.');
  }
  const durationMinutes =
    typeof entryData.duration_minutes === 'number'
      ? entryData.duration_minutes
      : setsDurationMinutes(entryData.sets);
  let calculatedCaloriesBurned = entryData.calories_burned;
  if (
    calculatedCaloriesBurned === undefined ||
    calculatedCaloriesBurned === null
  ) {
    const caloriesPerHour =
      await calorieCalculationService.estimateCaloriesBurnedPerHour(
        exercise,
        authenticatedUserId,
        entryData.sets
      );
    calculatedCaloriesBurned = (caloriesPerHour / 60) * durationMinutes;
  }
  return {
    ...entryData,
    user_id: authenticatedUserId,
    exercise_id: resolvedExerciseId,
    exercise_name: exercise.name,
    calories_per_hour: exercise.calories_per_hour,
    calories_burned: calculatedCaloriesBurned ?? 0,
    duration_minutes: durationMinutes ?? 0,
    workout_plan_assignment_id: entryData.workout_plan_assignment_id || null,
    image_url: entryData.image_url || null,
    // Explicit client value wins; otherwise derive the total from per-set
    // distances (null when no set carries one).
    distance: entryData.distance ?? setsDistanceKm(entryData.sets),
    avg_heart_rate: entryData.avg_heart_rate ?? null,
  };
}
async function createExerciseEntry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actingUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entryData: any,
  options: { skipDuplicateCheck?: boolean } = {}
) {
  try {
    const snapshotEntryData = await prepareExerciseEntryForCreate(
      authenticatedUserId,
      entryData
    );
    // Use exerciseEntry module to create the entry (handles sets and snapshot inserts)
    const newEntry = await exerciseEntryDb.createExerciseEntry(
      authenticatedUserId,
      snapshotEntryData,
      actingUserId,
      'Manual',
      null,
      options
    );
    // If activity_details are provided, create them
    if (entryData.activity_details && entryData.activity_details.length > 0) {
      for (const detail of entryData.activity_details) {
        await activityDetailsRepository.createActivityDetail(
          authenticatedUserId,
          {
            exercise_entry_id: newEntry.id,
            provider_name: detail.provider_name || 'Manual', // Default to Manual if not provided
            detail_type: detail.detail_type,
            detail_data: detail.detail_data,
            created_by_user_id: actingUserId,
            updated_by_user_id: actingUserId,
          }
        );
      }
    }
    return newEntry;
  } catch (error) {
    log(
      'error',
      `Error creating exercise entry for user ${authenticatedUserId} by ${actingUserId}:`,
      error
    );
    throw error;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getExerciseEntryById(authenticatedUserId: any, id: any) {
  try {
    const entryOwnerId = await exerciseEntryDb.getExerciseEntryOwnerId(
      id,
      authenticatedUserId
    );
    if (!entryOwnerId) {
      throw new Error('Exercise entry not found.');
    }
    const entry = await exerciseEntryDb.getExerciseEntryById(
      id,
      authenticatedUserId
    );
    // Fetch activity details
    const activityDetails =
      await activityDetailsRepository.getActivityDetailsByEntryOrPresetId(
        authenticatedUserId,
        id
      );
    return { ...entry, activity_details: activityDetails };
  } catch (error) {
    log(
      'error',
      `Error fetching exercise entry ${id} by user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
async function updateExerciseEntry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actingUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  id: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateData: any
) {
  try {
    const existingEntry = await exerciseEntryDb.getExerciseEntryById(
      id,
      authenticatedUserId
    );
    if (!existingEntry) {
      throw new Error('Exercise entry not found.');
    }
    // If a new image is being uploaded or the image is being cleared, delete the old one
    if (
      (updateData.image_url || updateData.image_url === null) &&
      existingEntry.image_url
    ) {
      const relativePath = existingEntry.image_url.startsWith('/')
        ? existingEntry.image_url.substring(1)
        : existingEntry.image_url;
      const oldImagePath = path.join(__dirname, '..', relativePath);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
        log('info', `Deleted old exercise entry image: ${oldImagePath}`);
      }
    }
    // If calories_burned is not provided, calculate it using the calorieCalculationService
    if (
      updateData.exercise_id &&
      updateData.duration_minutes !== null &&
      updateData.duration_minutes !== undefined &&
      updateData.calories_burned === undefined
    ) {
      const exercise = await exerciseDb.getExerciseById(
        updateData.exercise_id,
        authenticatedUserId
      );
      if (exercise) {
        const caloriesPerHour =
          await calorieCalculationService.estimateCaloriesBurnedPerHour(
            exercise,
            authenticatedUserId,
            updateData.sets
          );
        updateData.calories_burned =
          (caloriesPerHour / 60) * updateData.duration_minutes;
      } else {
        log(
          'warn',
          `Exercise ${updateData.exercise_id} not found. Cannot auto-calculate calories_burned.`
        );
        updateData.calories_burned = 0;
      }
    } else if (updateData.calories_burned === undefined) {
      // If calories_burned is not in updateData, use existing value or 0
      updateData.calories_burned = existingEntry.calories_burned || 0;
    }
    const updatedEntry = await exerciseEntryDb.updateExerciseEntry(
      id,
      authenticatedUserId,
      actingUserId,
      {
        ...updateData,
        exercise_id: updateData.exercise_id ?? existingEntry.exercise_id,
        duration_minutes:
          updateData.duration_minutes ?? existingEntry.duration_minutes ?? 0,
        calories_burned:
          updateData.calories_burned ?? existingEntry.calories_burned ?? 0,
        entry_date: updateData.entry_date ?? existingEntry.entry_date,
        notes: updateData.notes ?? existingEntry.notes,
        workout_plan_assignment_id:
          updateData.workout_plan_assignment_id ??
          existingEntry.workout_plan_assignment_id,
        image_url:
          updateData.image_url === undefined
            ? existingEntry.image_url
            : updateData.image_url,
        // Explicit value (including null-to-clear) wins; omitted derives the
        // total from per-set distances, else preserves the existing value.
        distance:
          updateData.distance !== undefined
            ? updateData.distance
            : (setsDistanceKm(updateData.sets) ?? existingEntry.distance),
        avg_heart_rate:
          updateData.avg_heart_rate ?? existingEntry.avg_heart_rate,
        steps: updateData.steps ?? existingEntry.steps,
        sort_order: updateData.sort_order ?? existingEntry.sort_order,
        exercise_name: updateData.exercise_name ?? existingEntry.exercise_name,
        // Preserve when omitted; explicit null clears (leaving a superset).
        superset_group:
          updateData.superset_group === undefined
            ? (existingEntry.superset_group ?? null)
            : updateData.superset_group,
        // Preserve when omitted; explicit null clears the time of day.
        entry_time:
          updateData.entry_time === undefined
            ? (existingEntry.entry_time ?? null)
            : updateData.entry_time,
      }
    );
    if (!updatedEntry) {
      throw new Error('Exercise entry not found or not authorized to update.');
    }
    // Handle activity details updates
    if (updateData.activity_details !== undefined) {
      const existingActivityDetails =
        await activityDetailsRepository.getActivityDetailsByEntryOrPresetId(
          authenticatedUserId,
          id
        );
      const incomingActivityDetails = updateData.activity_details || [];
      const RAW_PROVIDER_TYPES = [
        'full_activity_data',
        'full_workout_data',
        'fit_file_data',
      ];

      // Identify details to delete
      for (const existingDetail of existingActivityDetails) {
        const found = incomingActivityDetails.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (incomingDetail: any) => incomingDetail.id === existingDetail.id
        );
        if (!found) {
          // Do not delete raw provider dump rows during standard entry edit
          if (RAW_PROVIDER_TYPES.includes(existingDetail.detail_type)) {
            continue;
          }
          await activityDetailsRepository.deleteActivityDetail(
            authenticatedUserId,
            existingDetail.id
          );
        }
      }

      // Identify details to create or update
      for (const incomingDetail of incomingActivityDetails) {
        if (incomingDetail.id) {
          const isMaskedOrNull =
            incomingDetail.detail_data === null ||
            incomingDetail.detail_data === undefined ||
            incomingDetail.detail_data === 'null' ||
            RAW_PROVIDER_TYPES.includes(incomingDetail.detail_type);

          if (isMaskedOrNull) {
            const existing = existingActivityDetails.find(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (e: any) => e.id === incomingDetail.id
            );
            if (
              existing &&
              existing.detail_data !== null &&
              existing.detail_data !== undefined &&
              existing.detail_data !== 'null'
            ) {
              incomingDetail.detail_data = existing.detail_data;
            }
          }

          // Preserve existing raw detail_data if incoming value is still null/masked
          if (
            incomingDetail.detail_data !== null &&
            incomingDetail.detail_data !== 'null'
          ) {
            await activityDetailsRepository.updateActivityDetail(
              authenticatedUserId,
              incomingDetail.id,
              {
                ...incomingDetail,
                updated_by_user_id: actingUserId,
              }
            );
          }
        } else {
          // Create new detail
          await activityDetailsRepository.createActivityDetail(
            authenticatedUserId,
            {
              ...incomingDetail,
              exercise_entry_id: id,
              created_by_user_id: actingUserId,
              updated_by_user_id: actingUserId,
            }
          );
        }
      }
    }
    return updatedEntry;
  } catch (error) {
    log(
      'error',
      `Error updating exercise entry ${id} by ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deleteExerciseEntry(authenticatedUserId: any, id: any) {
  try {
    const entryOwnerId = await exerciseEntryDb.getExerciseEntryOwnerId(
      id,
      authenticatedUserId
    );
    if (!entryOwnerId) {
      throw new Error('Exercise entry not found.');
    }
    const entry = await exerciseEntryDb.getExerciseEntryById(id, entryOwnerId);
    if (!entry) {
      throw new Error('Exercise entry not found.'); // Should not happen if entryOwnerId was found
    }
    // If an image is associated with the entry, delete it from the filesystem
    if (entry.image_url) {
      const imagePath = path.join(__dirname, '..', entry.image_url);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
        log('info', `Deleted exercise entry image: ${imagePath}`);
      }
    }
    const success = await exerciseEntryDb.deleteExerciseEntry(id, entryOwnerId);
    if (!success) {
      throw new Error('Exercise entry not found or not authorized to delete.');
    }
    return { message: 'Exercise entry deleted successfully.' };
  } catch (error) {
    log(
      'error',
      `Error deleting exercise entry ${id} by ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getExerciseById(authenticatedUserId: any, id: any) {
  try {
    const exerciseOwnerId = await exerciseDb.getExerciseOwnerId(
      id,
      authenticatedUserId
    );
    if (!exerciseOwnerId) {
      const publicExercise = await exerciseDb.getExerciseById(
        id,
        authenticatedUserId
      );
      if (publicExercise && !publicExercise.is_custom) {
        return publicExercise;
      }
      throw new Error('Exercise not found.');
    }
    const exercise = await exerciseDb.getExerciseById(id, authenticatedUserId);
    return exercise;
  } catch (error) {
    log(
      'error',
      `Error fetching exercise ${id} by user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}

async function updateExercise(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  id: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateData: any
) {
  try {
    const exerciseOwnerId = await exerciseDb.getExerciseOwnerId(
      id,
      authenticatedUserId
    );
    if (!exerciseOwnerId) {
      throw new Error('Exercise not found.');
    }
    // exerciseDb.updateExercise (models/exercise.ts) is the single
    // persistence chokepoint for JSON-encoding equipment/muscles/
    // instructions/images — encoding images here too would double-encode it
    // into a JSON string containing a JSON string.
    const updatedExercise = await exerciseDb.updateExercise(
      id,
      authenticatedUserId,
      updateData
    );
    if (!updatedExercise) {
      throw new Error('Exercise not found or not authorized to update.');
    }
    return updatedExercise;
  } catch (error) {
    log(
      'error',
      `Error updating exercise ${id} by ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
async function deleteExercise(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exerciseId: any,
  forceDelete = false
) {
  log(
    'info',
    `deleteExercise: Attempting to delete exercise ${exerciseId} by user ${authenticatedUserId}. Force delete: ${forceDelete}`
  );
  try {
    const exerciseOwnerId = await exerciseDb.getExerciseOwnerId(
      exerciseId,
      authenticatedUserId
    );
    if (!exerciseOwnerId) {
      log(
        'warn',
        `deleteExercise: Exercise ${exerciseId} not found for user ${authenticatedUserId}.`
      );
      throw new Error('Exercise not found.');
    }
    const deletionImpact = await exerciseDb.getExerciseDeletionImpact(
      exerciseId,
      authenticatedUserId
    );
    log(
      'info',
      `deleteExercise: Deletion impact for exercise ${exerciseId}: ${JSON.stringify(deletionImpact)}`
    );
    const {
      exerciseEntriesCount,
      workoutPlansCount,
      workoutPresetsCount,
      otherUserReferences,
    } = deletionImpact;
    const totalReferences =
      exerciseEntriesCount + workoutPlansCount + workoutPresetsCount;
    // Scenario 1: No references at all
    if (totalReferences === 0) {
      log(
        'info',
        `deleteExercise: Exercise ${exerciseId} has no references. Performing hard delete.`
      );
      const success = await exerciseDb.deleteExerciseAndDependencies(
        exerciseId,
        authenticatedUserId
      );
      if (!success) {
        throw new Error('Exercise not found or not authorized to delete.');
      }
      return { message: 'Exercise deleted permanently.', status: 'deleted' };
    }
    // Scenario 2: References only by the current user
    if (otherUserReferences === 0) {
      if (forceDelete) {
        log(
          'info',
          `deleteExercise: Exercise ${exerciseId} has references only by current user. Force deleting.`
        );
        const success = await exerciseDb.deleteExerciseAndDependencies(
          exerciseId,
          authenticatedUserId
        );
        if (!success) {
          throw new Error('Exercise not found or not authorized to delete.');
        }
        return {
          message: 'Exercise and all its references deleted permanently.',
          status: 'force_deleted',
        };
      } else {
        // Hide the exercise (mark as quick/hidden) so it won't appear in searches but existing references remain
        log(
          'info',
          `deleteExercise: Exercise ${exerciseId} has references only by current user. Hiding as quick exercise.`
        );
        await exerciseDb.updateExercise(exerciseId, exerciseOwnerId, {
          is_quick_exercise: true,
        });
        return {
          message:
            'Exercise hidden (marked as quick exercise). Existing references remain.',
          status: 'hidden',
        };
      }
    }
    // Scenario 3: References by other users
    if (otherUserReferences > 0) {
      // If other users reference this exercise, hide it (mark as quick exercise) so it's removed from searches
      log(
        'info',
        `deleteExercise: Exercise ${exerciseId} has references by other users. Hiding as quick exercise.`
      );
      await exerciseDb.updateExercise(exerciseId, exerciseOwnerId, {
        is_quick_exercise: true,
      });
      return {
        message:
          'Exercise hidden (marked as quick exercise). Existing references remain.',
        status: 'hidden',
      };
    }
    // Fallback for any unhandled cases (should not be reached)
    log(
      'warn',
      `deleteExercise: Unhandled deletion scenario for exercise ${exerciseId}.`
    );
    throw new Error('Could not delete exercise due to an unknown issue.');
  } catch (error) {
    log(
      'error',
      `Error deleting exercise ${exerciseId} by user ${authenticatedUserId} in exerciseService:`,
      error
    );
    throw error;
  }
}
async function getExerciseEntriesByDate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selectedDate: any
) {
  try {
    if (!targetUserId) {
      log(
        'error',
        'getExerciseEntriesByDate: targetUserId is undefined. Returning empty array.'
      );
      return [];
    }
    // Use the exerciseEntryDb directly to avoid circular dependency where exerciseRepository
    // may not have fully exported its properties yet at runtime.
    const entries = await exerciseEntryDb.getExerciseEntriesByDate(
      targetUserId,
      selectedDate
    );
    if (!entries || entries.length === 0) {
      return [];
    }
    // exerciseEntryDb.getExerciseEntriesByDate already attaches `activity_details` per
    // entry/preset via a single batched query, with raw provider sync dumps
    // (full_activity_data/full_workout_data) stripped of their payload. Previously this
    // function re-fetched activity details per entry (N+1 queries) and, worse, used
    // getActivityDetailsByEntryOrPresetId — which does NOT strip the raw dump — so it
    // silently re-inflated every diary response with the full Garmin JSON blob this
    // fix removes. Do not re-fetch here.
    return entries;
  } catch (error) {
    log(
      'error',
      `Error fetching exercise entries for user ${targetUserId} on ${selectedDate} by ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getOrCreateActiveCaloriesExercise(userId: any) {
  try {
    const exerciseId =
      await exerciseDb.getOrCreateActiveCaloriesExercise(userId);
    return exerciseId;
  } catch (error) {
    log(
      'error',
      `Error getting or creating active calories exercise for user ${userId}:`,
      error
    );
    throw error;
  }
}
async function upsertExerciseEntryData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exerciseId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  caloriesBurned: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  date: any
) {
  try {
    // @ts-expect-error TS(2554): Expected 5 arguments, but got 4.
    const entry = await exerciseEntryDb.upsertExerciseEntryData(
      userId,
      exerciseId,
      caloriesBurned,
      date
    );
    return entry;
  } catch (error) {
    log(
      'error',
      `Error upserting exercise entry data for user ${userId}, exercise ${exerciseId}:`,
      error
    );
    throw error;
  }
}

interface FreeExerciseDBResult {
  totalCount: number;
  exercises: {
    id: string;
    name: string;
    category: string;
    description: string;
    force: string | null;
    level: string | null;
    mechanic: string | null;
    equipment: string | string[];
    primaryMuscles: string | string[];
    secondaryMuscles: string | string[];
    instructions: string | string[];
    images: string[];
  }[];
}

/**
 * wger descriptions are HTML (often a <ol>/<li> list). Normalize to the same
 * plain-text step array free-exercise-db exercises use.
 */
function wgerDescriptionToInstructions(rawDescription: string): string[] {
  return rawDescription
    .replace(/<li>/g, '\n- ')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function searchExternalExercises(
  _authenticatedUserId: string,
  query: string,
  providerId: string,
  providerType: ExternalProviderType,
  equipmentFilter: string[],
  muscleGroupFilter: string[],
  language: string,
  page = 1,
  pageSize = 20
) {
  const { default: freeExerciseDBService } =
    await import('../integrations/freeexercisedb/FreeExerciseDBService.js');

  log(
    'info',
    `[exerciseService] searchExternalExercises called with: query='${query}', providerType='${providerType}', equipmentFilter='${equipmentFilter}', muscleGroupFilter='${muscleGroupFilter}', page=${page}, pageSize=${pageSize}`
  );

  const emptyResponse = {
    items: [],
    pagination: { page, pageSize, totalCount: 0, hasMore: false },
  };

  try {
    let items: unknown[] = [];
    let totalCount = 0;
    const offset = (page - 1) * pageSize;

    const hasFilters =
      equipmentFilter.length > 0 || muscleGroupFilter.length > 0;
    const hasQuery = query.trim().length > 0;

    if (!hasQuery && hasFilters && providerType === 'nutritionix') {
      log(
        'warn',
        `External search for provider ${providerType} received filters but no search query. Returning empty results.`
      );
      return emptyResponse;
    }

    if (providerType === 'wger') {
      const muscleIdMap = await wgerService.getWgerMuscleIdMap();
      const equipmentIdMap = await wgerService.getWgerEquipmentIdMap();

      const muscleIds = muscleGroupFilter.flatMap(
        (name) => muscleIdMap[name] ?? []
      );
      const equipmentIds = equipmentFilter.flatMap(
        (name) => equipmentIdMap[name] ?? []
      );

      const wgerResult = await wgerService.searchWgerExercises(
        query,
        muscleIds,
        equipmentIds,
        language ?? 'en',
        pageSize,
        offset
      );

      totalCount = wgerResult.totalCount;
      const reverseMuscleMap = createReverseMap(muscleNameMap);
      const reverseEquipmentMap = createReverseMap(equipmentNameMap);
      items = wgerResult.exercises.map((exercise) => {
        // `exercise.instructions` is the raw wger HTML description; normalize
        // it the same way the import path does so previews match imports.
        const instructions = wgerDescriptionToInstructions(
          exercise.instructions
        );
        return {
          id: exercise.id.toString(),
          name: exercise.name,
          category: exercise.category?.name ?? 'Uncategorized',
          modality: deriveExerciseModality(exercise.category?.name),
          calories_per_hour: 0,
          source: 'wger',
          description: instructions[0] ?? exercise.name,
          force: exercise.force,
          mechanic: exercise.mechanic,
          equipment: exercise.equipment.map(
            (e) =>
              reverseEquipmentMap[
                e.name.toLowerCase() as keyof typeof reverseEquipmentMap
              ] ?? e.name
          ),
          primary_muscles: exercise.muscles.map(
            (m) =>
              reverseMuscleMap[
                m.name.toLowerCase() as keyof typeof reverseMuscleMap
              ] ?? m.name
          ),
          secondary_muscles: exercise.muscles_secondary.map(
            (m) =>
              reverseMuscleMap[
                m.name.toLowerCase() as keyof typeof reverseMuscleMap
              ] ?? m.name
          ),
          instructions,
          images: exercise.images,
        };
      });
    } else if (providerType === 'nutritionix') {
      const nutritionixSearchResults =
        await nutritionixService.searchNutritionixExercises(query, providerId);
      totalCount = nutritionixSearchResults.length;
      items = nutritionixSearchResults.slice(offset, offset + pageSize);
    } else if (providerType === 'free-exercise-db') {
      const freeExerciseDBResult = (await freeExerciseDBService.searchExercises(
        query,
        equipmentFilter as never[],
        muscleGroupFilter as never[],
        pageSize,
        offset
      )) as FreeExerciseDBResult;
      totalCount = freeExerciseDBResult.totalCount;
      items = freeExerciseDBResult.exercises.map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        category: exercise.category,
        modality: deriveExerciseModality(exercise.category),
        calories_per_hour: 0,
        description: exercise.description,
        source: 'free-exercise-db',
        force: exercise.force,
        level: exercise.level,
        mechanic: exercise.mechanic,
        equipment: normalizeToStringArray(exercise.equipment),
        primary_muscles: normalizeToStringArray(exercise.primaryMuscles),
        secondary_muscles: normalizeToStringArray(exercise.secondaryMuscles),
        instructions: normalizeToStringArray(exercise.instructions),
        images: exercise.images.map((img: string) =>
          freeExerciseDBService.getExerciseImageUrl(img)
        ),
      }));
    } else {
      throw new Error(
        `Unsupported external exercise provider: ${providerType}`
      );
    }

    return {
      items,
      pagination: {
        page,
        pageSize,
        totalCount,
        hasMore: page * pageSize < totalCount,
      },
    };
  } catch (error) {
    log(
      'error',
      `Error searching external exercises with query "${query}" from provider "${providerType}":`,
      error
    );
    throw error;
  }
}

async function addExternalExerciseToUserExercises(
  authenticatedUserId: string,
  wgerExerciseId: string | number,
  language: string = 'en'
) {
  try {
    // Import is idempotent: re-adding an already-imported exercise returns the
    // user's existing copy instead of violating the (user_id, source, source_id)
    // unique index.
    const existingExercise = await exerciseDb.getExerciseBySourceAndSourceId(
      'wger',
      String(wgerExerciseId),
      authenticatedUserId
    );
    if (existingExercise) {
      return existingExercise;
    }
    const wgerExerciseDetails =
      await wgerService.getWgerExerciseDetails(wgerExerciseId);
    if (!wgerExerciseDetails) {
      throw new Error('Wger exercise not found.');
    }

    log(
      'info',
      `Raw wger exercise data for exercise ID ${wgerExerciseId}: ${JSON.stringify(wgerExerciseDetails, null, 2)}`
    );

    let caloriesPerHour = 0;

    // met and level are not in the wger /exerciseinfo schema, so we always fall back
    caloriesPerHour =
      await calorieCalculationService.estimateCaloriesBurnedPerHour(
        wgerExerciseDetails,
        authenticatedUserId,
        [{ reps: 10, weight: 0 }]
      );

    const { exerciseName, description: rawDescription } =
      wgerService.extractWgerText(wgerExerciseDetails.translations, language);

    const reverseMuscleMap = createReverseMap(muscleNameMap);
    const reverseEquipmentMap = createReverseMap(equipmentNameMap);

    const mappedForce = wgerExerciseDetails.force?.name
      ? (forceMap[
          wgerExerciseDetails.force.name.toLowerCase() as keyof typeof forceMap
        ] ?? null)
      : null;

    const mappedMechanic = wgerExerciseDetails.mechanic?.name
      ? (mechanicMap[
          wgerExerciseDetails.mechanic.name.toLowerCase() as keyof typeof mechanicMap
        ] ?? null)
      : null;

    const instructions = wgerDescriptionToInstructions(rawDescription);

    const exerciseData = {
      name: exerciseName,
      category: wgerExerciseDetails.category?.name ?? 'general',
      calories_per_hour: caloriesPerHour,
      description: instructions[0] ?? exerciseName,
      user_id: authenticatedUserId,
      is_custom: true,
      shared_with_public: false,
      // createExercise persists source_id (not source_external_id); the unique
      // index and the dedup lookup above both key on it. Store the id the
      // lookup queries by (the caller's id), not the fetched detail's id —
      // if the two ever diverge, dedup would miss and the insert would hit
      // the unique index.
      source_id: String(wgerExerciseId),
      source: 'wger',
      level: 'intermediate',
      force: mappedForce,
      mechanic: mappedMechanic,
      equipment: wgerExerciseDetails.equipment.map(
        (e) =>
          reverseEquipmentMap[
            e.name.toLowerCase() as keyof typeof reverseEquipmentMap
          ] ?? e.name
      ),
      primary_muscles: wgerExerciseDetails.muscles.map(
        (m) =>
          reverseMuscleMap[
            m.name.toLowerCase() as keyof typeof reverseMuscleMap
          ] ?? m.name
      ),
      secondary_muscles: wgerExerciseDetails.muscles_secondary.map(
        (m) =>
          reverseMuscleMap[
            m.name.toLowerCase() as keyof typeof reverseMuscleMap
          ] ?? m.name
      ),
      instructions,
      images: [] as string[],
    };

    if (wgerExerciseDetails.images.length > 0) {
      const exerciseFolderName = exerciseName.replace(/[^a-zA-Z0-9]/g, '_');
      const localImagePaths = await Promise.all(
        wgerExerciseDetails.images.map(async (img) => {
          try {
            if (img.image) {
              const fullPath = (await downloadImage(
                img.image,
                exerciseFolderName
              )) as string;
              return fullPath.replace('/uploads/exercises/', '');
            }
          } catch (imgError) {
            log(
              'error',
              `Failed to download image ${img.image} for exercise ${exerciseName}:`,
              imgError
            );
          }
          return null;
        })
      );
      exerciseData.images = localImagePaths.filter(
        (p): p is string => p !== null
      );
    }

    log(
      'info',
      `Mapped exercise data before insert: ${JSON.stringify(exerciseData, null, 2)}`
    );
    return await exerciseDb.createExercise(exerciseData);
  } catch (error) {
    log(
      'error',
      `Error adding external exercise ${wgerExerciseId} for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
async function addNutritionixExerciseToUserExercises(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nutritionixExerciseData: any
) {
  try {
    const newExerciseId = uuidv4(); // Generate a new UUID for the local exercise
    const exerciseData = {
      id: newExerciseId,
      name: nutritionixExerciseData.name,
      category: nutritionixExerciseData.category || 'External',
      calories_per_hour: nutritionixExerciseData.calories_per_hour,
      description: nutritionixExerciseData.description,
      user_id: authenticatedUserId,
      is_custom: true, // Mark as custom as it's imported by the user
      shared_with_public: false, // Imported exercises are private by default
      source_external_id: nutritionixExerciseData.external_id.toString(), // Store original Nutritionix ID
      source: 'nutritionix',
    };
    const newExercise = await exerciseDb.createExercise(exerciseData);
    return newExercise;
  } catch (error) {
    log(
      'error',
      `Error adding Nutritionix exercise for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
/**
 * Downloads a free-exercise-db image set into /uploads/exercises and returns
 * the stored relative paths. Persists the path downloadImage actually wrote,
 * not the upstream one: resolveImageFileName appends a URL hash
 * (`0.jpg` -> `0_ab12cd34.jpg`), so storing the upstream `Name/0.jpg` pointed
 * every thumbnail at a file that does not exist. The `/uploads/exercises/`
 * prefix is stripped to match the relative shape the wger importer stores.
 */
async function downloadFreeExerciseDbImages(
  imagePaths: string[]
): Promise<string[]> {
  const { default: freeExerciseDBService } =
    await import('../integrations/freeexercisedb/FreeExerciseDBService.js');
  const localImagePaths = await Promise.all(
    imagePaths.map(async (imagePath: string) => {
      const imageUrl = freeExerciseDBService.getExerciseImageUrl(imagePath);
      // Sanitized before it reaches downloadImage, which path.join()s the
      // value into the uploads dir without checking it: an upstream entry
      // whose first segment is `..` would otherwise escape
      // /uploads/exercises. The charset keeps `_` and `-` (unlike the wger
      // and CSV callers' [^a-zA-Z0-9]) so a real id such as `3_4_Sit-Up`
      // survives byte-for-byte — the /uploads/exercises/:exerciseId route
      // re-downloads a missing file by looking the id up upstream, and a
      // rewritten directory name would break that recovery.
      const exerciseIdFromPath = imagePath
        .split('/')[0]
        .replace(/[^a-zA-Z0-9_-]/g, '_');
      try {
        const fullPath = await downloadImage(imageUrl, exerciseIdFromPath);
        return (fullPath as string).replace('/uploads/exercises/', '');
      } catch (imgError) {
        log(
          'error',
          `Failed to download free-exercise-db image ${imageUrl}:`,
          imgError
        );
        return null;
      }
    })
  );
  return localImagePaths.filter((p): p is string => p !== null);
}

async function addFreeExerciseDBExerciseToUserExercises(
  authenticatedUserId: string,
  freeExerciseDBId: string
) {
  const { default: freeExerciseDBService } =
    await import('../integrations/freeexercisedb/FreeExerciseDBService.js');
  try {
    // Import is idempotent: re-adding an already-imported exercise returns the
    // user's existing copy instead of violating the (user_id, source, source_id)
    // unique index.
    const existingExercise = await exerciseDb.getExerciseBySourceAndSourceId(
      'free-exercise-db',
      freeExerciseDBId,
      authenticatedUserId
    );
    if (existingExercise) {
      return existingExercise;
    }
    const exerciseDetails =
      await freeExerciseDBService.getExerciseById(freeExerciseDBId);
    if (!exerciseDetails) {
      throw new Error('Free-Exercise-DB exercise not found.');
    }
    return await createExerciseFromFreeExerciseDbRecord(
      authenticatedUserId,
      exerciseDetails as FreeExerciseDbExercise,
      freeExerciseDBId
    );
  } catch (error) {
    log(
      'error',
      `Error adding Free-Exercise-DB exercise ${freeExerciseDBId} for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}

/**
 * Maps one free-exercise-db record onto the local Exercise model and persists
 * it, downloading its photos on the way. Takes the record rather than an id so
 * catalog-pack import can feed it entries from the already-cached dataset
 * instead of refetching each exercise's JSON individually.
 */
async function createExerciseFromFreeExerciseDbRecord(
  authenticatedUserId: string,
  exerciseDetails: FreeExerciseDbExercise,
  freeExerciseDBId: string
) {
  const localImagePaths = await downloadFreeExerciseDbImages(
    exerciseDetails.images ?? []
  );
  const instructions = normalizeToStringArray(exerciseDetails.instructions);
  const exerciseData = {
    id: uuidv4(), // Generate a new UUID for the local exercise
    source: 'free-exercise-db',
    // Store the id the dedup lookup queries by (the caller's id) so the two
    // can never diverge and miss dedup on re-import.
    source_id: String(freeExerciseDBId),
    name: exerciseDetails.name,
    force: exerciseDetails.force,
    level: exerciseDetails.level,
    mechanic: exerciseDetails.mechanic,
    equipment: normalizeToStringArray(exerciseDetails.equipment),
    primary_muscles: normalizeToStringArray(exerciseDetails.primaryMuscles),
    secondary_muscles: normalizeToStringArray(exerciseDetails.secondaryMuscles),
    instructions,
    category: exerciseDetails.category,
    images: localImagePaths, // Local upload paths — createExercise handles JSON.stringify
    calories_per_hour:
      // @ts-expect-error TS(2554): Expected 3 arguments, but got 2.
      await calorieCalculationService.estimateCaloriesBurnedPerHour(
        exerciseDetails,
        authenticatedUserId
      ), // Calculate calories
    // Same normalized array the instructions field uses, not the raw
    // (possibly bare-string) value — indexing a bare string here would
    // silently take its first character instead of the first instruction.
    description: instructions[0] ?? exerciseDetails.name,
    user_id: authenticatedUserId,
    is_custom: true, // Imported exercises are custom to the user
    shared_with_public: false, // Imported exercises are private by default
  };
  return await exerciseDb.createExercise(exerciseData);
}

/**
 * Downloads a mirror record's still photo and animated demonstration into the
 * local uploads dir, mirroring how free-exercise-db photos are localized. The
 * media is © Gym Visual (via the ExerciseDB mirror); it is stored only in the
 * importing user's own library. A failed download is logged and skipped, not
 * fatal.
 */
async function downloadExerciseDbImages(
  record: ExerciseDbMirrorRecord
): Promise<string[]> {
  const { default: exerciseDbMirrorService } =
    await import('../integrations/exercisedb/ExerciseDbMirrorService.js');
  const mediaPaths = [record.image, record.gif_url].filter(
    (mediaPath): mediaPath is string =>
      typeof mediaPath === 'string' && mediaPath.length > 0
  );
  // Sanitized before it reaches downloadImage, which path.join()s the value
  // into the uploads dir without checking it. The `exercisedb_` prefix keeps
  // these directories out of the unauthenticated /uploads/exercises recovery
  // route's namespace, which treats a bare directory name as a
  // free-exercise-db id and would try to re-download a missing file from the
  // wrong upstream.
  const entityDir = `exercisedb_${String(record.id).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const localPaths = await Promise.all(
    mediaPaths.map(async (mediaPath) => {
      const mediaUrl = exerciseDbMirrorService.getMediaUrl(mediaPath);
      try {
        const fullPath = await downloadImage(mediaUrl, entityDir);
        return (fullPath as string).replace('/uploads/exercises/', '');
      } catch (imgError) {
        log(
          'error',
          `Failed to download exercisedb media ${mediaUrl}:`,
          imgError
        );
        return null;
      }
    })
  );
  return localPaths.filter((p): p is string => p !== null);
}

/**
 * Maps one ExerciseDB-mirror record onto the local Exercise model and
 * persists it, downloading its photo and animation on the way. Unlike the
 * free-exercise-db mapper this one translates vocabulary: the mirror's
 * granular equipment tag collapses to the coarse enum (the granular half
 * lives in the shared per-source item-requirements map, keyed by source_id),
 * and its target/secondary muscles map onto the canonical MUSCLES names. An
 * unmapped tag or muscle is a thrown error, never a guess — the pack importer
 * records it as a named failure, so an upstream vocabulary addition surfaces
 * instead of importing a row the engine cannot classify.
 */
async function createExerciseFromExerciseDbRecord(
  authenticatedUserId: string,
  record: ExerciseDbMirrorRecord
) {
  const equipmentTag = String(record.equipment ?? '').toLowerCase();
  const coarseEquipment = EXERCISEDB_EQUIPMENT_TO_COARSE[equipmentTag];
  if (coarseEquipment === undefined) {
    throw new Error(`Unmapped exercisedb equipment tag "${record.equipment}".`);
  }
  const target = String(record.target ?? '').toLowerCase();
  const primaryMuscle = EXERCISEDB_TARGET_TO_MUSCLE[target];
  if (primaryMuscle === undefined) {
    throw new Error(`Unmapped exercisedb target "${record.target}".`);
  }
  if (primaryMuscle === null) {
    // The cardio-target rows; pack membership excludes them, so reaching
    // here means a caller fed a row the vocabulary deliberately skips.
    throw new Error(
      `Exercisedb target "${record.target}" is not importable as strength work.`
    );
  }
  const secondaryMuscles: string[] = [];
  for (const raw of record.secondary_muscles ?? []) {
    const mapped = EXERCISEDB_SECONDARY_TO_MUSCLE[String(raw).toLowerCase()];
    if (mapped === undefined) {
      throw new Error(`Unmapped exercisedb secondary muscle "${raw}".`);
    }
    if (mapped === null || mapped === primaryMuscle) {
      continue;
    }
    if (!secondaryMuscles.includes(mapped)) {
      secondaryMuscles.push(mapped);
    }
  }
  const instructions = normalizeToStringArray(record.instruction_steps?.en);
  const localImagePaths = await downloadExerciseDbImages(record);
  const displayName = cleanExerciseDbExerciseName(record.name);
  const exerciseData = {
    id: uuidv4(),
    source: EXERCISEDB_SOURCE,
    source_id: String(record.id),
    name: displayName,
    force: null,
    level: null,
    mechanic: null,
    equipment: coarseEquipment === null ? [] : [coarseEquipment],
    primary_muscles: [primaryMuscle],
    secondary_muscles: secondaryMuscles,
    instructions,
    // The mirror's own `category` is a body region ("upper legs"), not a
    // modality. Every importable row is resistance work, so the local
    // modality-bearing category is strength.
    category: 'strength',
    images: localImagePaths,
    calories_per_hour:
      await calorieCalculationService.estimateCaloriesBurnedPerHour(
        { category: 'strength' },
        authenticatedUserId,
        undefined
      ),
    description: instructions[0] ?? displayName,
    user_id: authenticatedUserId,
    is_custom: true,
    shared_with_public: false,
  };
  return await exerciseDb.createExercise(exerciseData);
}

/** One exercise's outcome inside a catalog-pack import batch. */
interface CatalogPackImportBatch {
  packId: string;
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  failures: { name: string; reason: string }[];
  processed: number;
  nextOffset: number | null;
  done: boolean;
}

/** A pack member paired with the catalog it came from, so import can route it. */
type CatalogPackMember =
  | { source: 'free-exercise-db'; record: FreeExerciseDbExercise }
  | { source: 'exercisedb'; record: ExerciseDbMirrorRecord };

/**
 * Catalog entries belonging to a pack, ordered by name. The order has to be
 * stable across calls: the client walks the pack with offset/limit batches, so
 * a shifting order would skip or repeat exercises mid-import.
 *
 * Order is stable for a given dataset, but the dataset itself is cached for an
 * hour — an upstream release landing mid-walk could insert a member ahead of
 * the cursor and push one past it. That costs a missed exercise, not a wrong
 * one: the pack list reports how many members are still missing, and importing
 * again picks them up because import skips what is already present.
 */
async function exerciseCatalogPackMembers(
  pack: ExerciseCatalogPack
): Promise<CatalogPackMember[]> {
  const wanted = new Set(pack.equipment);
  if (pack.source === 'exercisedb') {
    const { default: exerciseDbMirrorService } =
      await import('../integrations/exercisedb/ExerciseDbMirrorService.js');
    const catalog = await exerciseDbMirrorService.getAllExercises();
    return (
      catalog
        .filter(
          (entry) =>
            entry?.id &&
            entry?.name &&
            wanted.has(String(entry.equipment).toLowerCase()) &&
            // The cardio-machine rows the muscle vocabulary deliberately skips
            // are not importable strength work and leave the pack here; an
            // *unknown* target stays in so import fails loudly on it instead of
            // silently shrinking the pack.
            EXERCISEDB_TARGET_TO_MUSCLE[String(entry.target).toLowerCase()] !==
              null
        )
        // Cleaned here as well as in the mapper (the function is idempotent) so
        // sorting, progress listing and name dedup all see the stored name.
        // Upstream duplicate names and pov re-films clean to identical names on
        // purpose; the importer's name dedup keeps one copy.
        .map((record) => ({
          source: 'exercisedb' as const,
          record: { ...record, name: cleanExerciseDbExerciseName(record.name) },
        }))
        .sort((a, b) => a.record.name.localeCompare(b.record.name))
    );
  }
  const { default: freeExerciseDBService } =
    await import('../integrations/freeexercisedb/FreeExerciseDBService.js');
  const catalog = await freeExerciseDBService.getAllExercises();
  return catalog
    .filter(
      (entry) =>
        entry?.id &&
        entry?.name &&
        normalizeToStringArray(entry.equipment).some((value) =>
          wanted.has(String(value).toLowerCase())
        )
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((record) => ({ source: 'free-exercise-db' as const, record }));
}

/**
 * The importable catalog packs with this user's progress through each.
 */
async function listExerciseCatalogPacks(authenticatedUserId: string) {
  const existingNames = await userExerciseNameIndex(authenticatedUserId);
  const importedIdsBySource = new Map<string, Set<string>>();
  const packs = [];
  for (const pack of EXERCISE_CATALOG_PACKS) {
    let importedIds = importedIdsBySource.get(pack.source);
    if (!importedIds) {
      importedIds = new Set<string>(
        await exerciseDb.getImportedSourceIds(pack.source, authenticatedUserId)
      );
      importedIdsBySource.set(pack.source, importedIds);
    }
    const members = await exerciseCatalogPackMembers(pack);
    packs.push({
      id: pack.id,
      label: pack.label,
      description: pack.description,
      total: members.length,
      alreadyImported: members.filter((member) =>
        alreadyInLibrary(member.record, importedIds, existingNames)
      ).length,
    });
  }
  return packs;
}

/** Normalized names of everything already in the user's exercise library. */
async function userExerciseNameIndex(
  authenticatedUserId: string
): Promise<Set<string>> {
  const names = await exerciseDb.getAllExerciseNames(authenticatedUserId);
  return new Set(
    names.map((name: string) => normalizeExerciseNameForMatch(String(name)))
  );
}

/**
 * Whether the user already holds this catalog entry — either as a previous
 * import of the same upstream id, or under the same name from any source. The
 * name test matters most: an exercise the user created by hand may already
 * carry logged sets, so importing a second copy of it would split that
 * history across two near-identical library rows.
 */
function alreadyInLibrary(
  member: { id: string; name: string },
  importedIds: Set<string>,
  existingNames: Set<string>
): boolean {
  return (
    importedIds.has(String(member.id)) ||
    existingNames.has(normalizeExerciseNameForMatch(String(member.name)))
  );
}

/**
 * Imports one batch of a catalog pack. Batched rather than one long request
 * because a full pack is a few hundred image downloads — far past any mobile
 * client's request timeout. The caller walks `nextOffset` until `done`.
 *
 * A failing exercise is counted and named, never fatal: one bad upstream
 * record must not abandon the rest of the pack, and the caller needs to see
 * what did not make it rather than a silently short library.
 */
async function importExerciseCatalogPack(
  authenticatedUserId: string,
  packId: string,
  offset: number,
  limit: number
): Promise<CatalogPackImportBatch> {
  const pack = getExerciseCatalogPack(packId);
  if (!pack) {
    const error = new Error(`Unknown exercise pack "${packId}".`);
    // statusCode, not status: middleware/errorHandler.ts reads `err.statusCode`
    // and anything else falls through to a 500.
    // @ts-expect-error TS(2339): Property 'statusCode' does not exist on type 'Error'.
    error.statusCode = 400;
    throw error;
  }
  const members = await exerciseCatalogPackMembers(pack);
  const batch = members.slice(offset, offset + limit);
  // Read once per batch rather than per exercise, with names this batch
  // creates added as it goes. This is a snapshot, so an exercise created by
  // hand *during* the batch could still collide; that needs a unique index to
  // close properly, and a self-hosted user racing their own import is not
  // worth a migration.
  const existingNames = await userExerciseNameIndex(authenticatedUserId);

  let imported = 0;
  let skipped = 0;
  const failures: { name: string; reason: string }[] = [];

  for (const member of batch) {
    const record = member.record;
    const sourceId = String(record.id);
    try {
      const existing = await exerciseDb.getExerciseBySourceAndSourceId(
        member.source,
        sourceId,
        authenticatedUserId
      );
      const normalizedName = normalizeExerciseNameForMatch(
        String(record.name ?? '')
      );
      if (existing || existingNames.has(normalizedName)) {
        skipped++;
        continue;
      }
      if (member.source === 'exercisedb') {
        await createExerciseFromExerciseDbRecord(
          authenticatedUserId,
          member.record
        );
      } else {
        await createExerciseFromFreeExerciseDbRecord(
          authenticatedUserId,
          member.record,
          sourceId
        );
      }
      // Only after the insert lands: claiming the name up front would make a
      // failed create block a later retry of the same name in this batch.
      existingNames.add(normalizedName);
      imported++;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ name: String(record.name ?? sourceId), reason });
      log(
        'error',
        `Catalog pack "${packId}": failed to import ${sourceId} for user ${authenticatedUserId}:`,
        error
      );
    }
  }

  const processed = offset + batch.length;
  const done = processed >= members.length || batch.length === 0;
  return {
    packId,
    total: members.length,
    imported,
    skipped,
    failed: failures.length,
    failures,
    processed,
    nextOffset: done ? null : processed,
    done,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSuggestedExercises(authenticatedUserId: any, limit: any) {
  try {
    const preferences =
      await preferenceRepository.getUserPreferences(authenticatedUserId);
    const displayLimit = preferences?.item_display_limit || limit;
    const recentExercises = await exerciseDb.getRecentExercises(
      authenticatedUserId,
      displayLimit
    );
    const topExercises = await exerciseDb.getTopExercises(
      authenticatedUserId,
      displayLimit
    );
    return { recentExercises, topExercises };
  } catch (error) {
    log(
      'error',
      `Error fetching suggested exercises for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getRecentExercises(authenticatedUserId: any, limit: any) {
  try {
    const preferences =
      await preferenceRepository.getUserPreferences(authenticatedUserId);
    const displayLimit = preferences?.item_display_limit || limit;
    const recentExercises = await exerciseDb.getRecentExercises(
      authenticatedUserId,
      displayLimit
    );
    const taggedExercises = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recentExercises.map(async (exercise: any) => {
        const tags = [];
        const isOwner = exercise.user_id === authenticatedUserId;
        if (isOwner) {
          tags.push('private');
        }
        if (exercise.shared_with_public) {
          tags.push('public');
        }
        if (!isOwner && !exercise.shared_with_public) {
          tags.push('family');
        }
        return { ...exercise, tags };
      })
    );
    return taggedExercises;
  } catch (error) {
    log(
      'error',
      `Error fetching recent exercises for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getTopExercises(authenticatedUserId: any, limit: any) {
  try {
    const preferences =
      await preferenceRepository.getUserPreferences(authenticatedUserId);
    const displayLimit = preferences?.item_display_limit || limit;
    const topExercises = await exerciseDb.getTopExercises(
      authenticatedUserId,
      displayLimit
    );
    const taggedExercises = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      topExercises.map(async (exercise: any) => {
        const tags = [];
        const isOwner = exercise.user_id === authenticatedUserId;
        if (isOwner) {
          tags.push('private');
        }
        if (exercise.shared_with_public) {
          tags.push('public');
        }
        if (!isOwner && !exercise.shared_with_public) {
          tags.push('family');
        }
        return { ...exercise, tags };
      })
    );
    return taggedExercises;
  } catch (error) {
    log(
      'error',
      `Error fetching top exercises for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
async function getExerciseProgressData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exerciseId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  startDate: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  endDate: any
) {
  try {
    // getExerciseProgressData is implemented in the exerciseEntry module
    const progressData = await exerciseEntryDb.getExerciseProgressData(
      authenticatedUserId,
      exerciseId,
      startDate,
      endDate
    );
    return progressData;
  } catch (error) {
    log(
      'error',
      `Error fetching exercise progress data for user ${authenticatedUserId}, exercise ${exerciseId}:`,
      error
    );
    throw error;
  }
}

async function getExerciseHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exerciseId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  limit: any
) {
  try {
    const resolvedExerciseId = await resolveExerciseIdToUuid(
      exerciseId,
      authenticatedUserId
    );
    // getExerciseHistory is implemented in the exerciseEntry module
    const history = await exerciseEntryDb.getExerciseHistory(
      authenticatedUserId,
      resolvedExerciseId,
      limit
    );
    return history;
  } catch (error) {
    log(
      'error',
      `Error fetching exercise history for user ${authenticatedUserId}, exercise ${exerciseId}:`,
      error
    );
    throw error;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importExercisesFromCSV(authenticatedUserId: any, filePath: any) {
  let createdCount = 0;
  let updatedCount = 0;
  let failedCount = 0;
  const failedRows = [];
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    // parseCsv (shared, not a raw papa.parse call) so delimiter detection
    // failures and parse issues are logged and included in warnings/failedRows
    // naming the actual problem, instead of a blanket "CSV parsing failed".
    const {
      rows: data,
      resolvedDecimal,
      warnings,
      fatal,
    } = parseCsv(fileContent, DEFAULT_CSV_FORMAT, {
      numericColumns: ['calories_per_hour'],
    });
    if (fatal) {
      log('error', 'CSV parsing error:', fatal);
      throw new Error(fatal.message);
    }
    const warningRowIndices = new Set<number>();
    if (warnings.length > 0) {
      log('warn', 'CSV parsing warnings:', warnings);
      for (const w of warnings) {
        if (w.row !== undefined) {
          warningRowIndices.add(w.row);
        }
        failedRows.push({
          row: w.row !== undefined ? { row: w.row } : {},
          reason: w.message,
        });
        failedCount++;
      }
    }
    for (let i = 0; i < data.length; i++) {
      if (warningRowIndices.has(i)) continue;
      const row = data[i];
      try {
        const exerciseName = row.name ? row.name.trim() : null;
        if (!exerciseName) {
          failedCount++;
          failedRows.push({ row, reason: 'Exercise name is required.' });
          continue;
        }
        const primaryMuscles = row.primary_muscles
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            row.primary_muscles.split(',').map((m: any) => m.trim())
          : [];
        if (primaryMuscles.length === 0) {
          failedCount++;
          failedRows.push({ row, reason: 'Primary muscles are required.' });
          continue;
        }
        const sourceId = exerciseName.toLowerCase().replace(/\s/g, '_');
        const exerciseData = {
          name: exerciseName,
          description: row.description || null,
          instructions: row.instructions
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              row.instructions.split(',').map((i: any) => i.trim())
            : [],
          category: row.category || null,
          force: row.force || null,
          level: row.level || null,
          mechanic: row.mechanic || null,
          equipment: row.equipment
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              row.equipment.split(',').map((e: any) => e.trim())
            : [],
          primary_muscles: primaryMuscles,
          secondary_muscles: row.secondary_muscles
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              row.secondary_muscles.split(',').map((m: any) => m.trim())
            : [],
          // toNumber (not parseFloat) so a locale-comma decimal like "300,5"
          // parses to 300.5 instead of parseFloat's silent truncation at the
          // comma — the same #1960 bug already fixed client-side.
          calories_per_hour: row.calories_per_hour
            ? (toNumber(row.calories_per_hour, resolvedDecimal) ?? null)
            : null,
          user_id: authenticatedUserId,
          is_custom: true,
          shared_with_public: row.shared_with_public === 'true',
          source: 'CSV',
          source_id: sourceId,
        };
        // Handle images: download and store local paths
        if (row.images) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const imageUrls = row.images.split(',').map((url: any) => url.trim());
          const localImagePaths = [];
          const exerciseFolderName = exerciseName.replace(/[^a-zA-Z0-9]/g, '_');
          for (const imageUrl of imageUrls) {
            try {
              const localPath = await downloadImage(
                imageUrl,
                exerciseFolderName
              );
              localImagePaths.push(localPath);
            } catch (imgError) {
              log(
                'error',
                `Failed to download image ${imageUrl} for exercise ${exerciseName}:`,
                imgError
              );
              // Continue without this image, but log the error
            }
          }
          // @ts-expect-error TS(2339): Property 'images' does not exist on type '{ name: ... Remove this comment to see the full error message
          exerciseData.images = localImagePaths;
        } else {
          // @ts-expect-error TS(2339): Property 'images' does not exist on type '{ name: ... Remove this comment to see the full error message
          exerciseData.images = [];
        }
        const existingExercise = await exerciseDb.searchExercises(
          exerciseName,
          authenticatedUserId,
          [],
          []
        );
        if (existingExercise && existingExercise.length > 0) {
          // Assuming the first match is the one to update
          await exerciseDb.updateExercise(
            existingExercise[0].id,
            authenticatedUserId,
            exerciseData
          );
          updatedCount++;
        } else {
          await exerciseDb.createExercise(exerciseData);
          createdCount++;
        }
      } catch (rowError) {
        failedCount++;
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        failedRows.push({ row, reason: rowError.message });
        log(
          'error',
          `Error processing CSV row for user ${authenticatedUserId}:`,
          rowError
        );
      }
    }
  } catch (error) {
    log(
      'error',
      `Error importing exercises from CSV for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  } finally {
    // Clean up the uploaded file
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
  return {
    message: 'CSV import complete.',
    created: createdCount,
    updated: updatedCount,
    failed: failedCount,
    failedRows: failedRows,
  };
}

async function getExerciseDeletionImpact(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exerciseId: any
) {
  log(
    'info',
    `getExerciseDeletionImpact: Checking deletion impact for exercise ${exerciseId} by user ${authenticatedUserId}`
  );
  try {
    const exerciseOwnerId = await exerciseDb.getExerciseOwnerId(
      exerciseId,
      authenticatedUserId
    );
    if (!exerciseOwnerId) {
      log(
        'warn',
        `getExerciseDeletionImpact: Exercise ${exerciseId} not found for user ${authenticatedUserId}.`
      );
      throw new Error('Exercise not found.');
    }
    // No need to check permission here, as exerciseRepository.getExerciseDeletionImpact handles it
    return await exerciseDb.getExerciseDeletionImpact(
      exerciseId,
      authenticatedUserId
    );
  } catch (error) {
    log(
      'error',
      `Error getting exercise deletion impact for exercise ${exerciseId} by user ${authenticatedUserId} in exerciseService:`,
      error
    );
    throw error;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createServiceError(status: any, message: any) {
  const error = new Error(message);
  // @ts-expect-error TS(2339): Property 'status' does not exist on type 'Error'.
  error.status = status;
  return error;
}
function deriveDurationMinutes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exerciseData: any,
  { preserveLegacyPresetDurationFallback = false } = {}
) {
  if (typeof exerciseData.duration_minutes === 'number') {
    return exerciseData.duration_minutes;
  }
  return setsDurationMinutes(
    exerciseData.sets,
    preserveLegacyPresetDurationFallback ? { fallbackMinutes: 30 } : undefined
  );
}

async function createGroupedExerciseEntriesWithClient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actingUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  presetEntryId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entryDate: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exercises: any,
  options = {}
) {
  const {
    // @ts-expect-error TS(2339): Property 'entrySource' does not exist on type '{}'... Remove this comment to see the full error message
    entrySource = 'manual',
    // @ts-expect-error TS(2339): Property 'workoutPlanAssignmentId' does not exist ... Remove this comment to see the full error message
    workoutPlanAssignmentId = null,
    // @ts-expect-error TS(2339): Property 'preserveLegacyPresetDurationFallback' do... Remove this comment to see the full error message
    preserveLegacyPresetDurationFallback = false,
  } = options;
  const createdEntries = [];
  for (const exercise of exercises || []) {
    const durationMinutes = deriveDurationMinutes(exercise, {
      preserveLegacyPresetDurationFallback,
    });

    const preparedEntry = await prepareExerciseEntryForCreate(userId, {
      // A client-minted entry uuid (create-in-reconcile for a mid-workout add)
      // is inserted as-is so the entry keeps its identity across saves. Only a
      // string id is forwarded: preset exercise definitions carry a numeric
      // `id`, and the delete-and-recreate path sends none — neither must reach
      // the uuid `exercise_entries.id` column.
      ...(typeof exercise.id === 'string' ? { id: exercise.id } : {}),
      exercise_id: exercise.exercise_id,
      entry_date: entryDate,
      notes: exercise.notes ?? null,
      sets: exercise.sets || [],
      duration_minutes: durationMinutes,
      // A client-provided value is a manual override; omitting it lets
      // prepareExerciseEntryForCreate recompute from duration and sets.
      ...(typeof exercise.calories_burned === 'number'
        ? { calories_burned: exercise.calories_burned }
        : {}),
      sort_order: exercise.sort_order ?? 0,
      superset_group: exercise.superset_group ?? null,
      workout_plan_assignment_id: workoutPlanAssignmentId,
      distance: exercise.distance,
      avg_heart_rate: exercise.avg_heart_rate,
      entry_time: exercise.entry_time ?? null,
    });
    const { entry: createdEntry } =
      await exerciseEntryDb._createExerciseEntryWithClient(
        client,
        userId,
        preparedEntry,
        actingUserId,
        entrySource,
        presetEntryId
      );
    createdEntries.push(createdEntry);
  }
  return createdEntries;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getGroupedWorkoutSessionById(userId: any, presetEntryId: any) {
  return getGroupedExerciseSessionById(userId, presetEntryId);
}

async function createGroupedWorkoutSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actingUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessionData: any
) {
  const client = await getClient(userId);
  try {
    await client.query('BEGIN');
    const {
      workout_preset_id,
      entry_date,
      name,
      description,
      notes,
      source = 'manual',
      exercises,
      workoutPlanAssignmentId = null,
    } = sessionData;
    let presetEntry;
    let exerciseDefinitions;
    let childEntrySource = source;
    let preserveLegacyPresetDurationFallback = false;
    if (workout_preset_id !== undefined && workout_preset_id !== null) {
      const workoutPreset = await workoutPresetRepository.getWorkoutPresetById(
        workout_preset_id,
        userId
      );
      if (!workoutPreset) {
        throw createServiceError(404, 'Workout preset not found.');
      }
      presetEntry =
        await exercisePresetEntryRepository.createExercisePresetEntryWithClient(
          client,
          userId,
          {
            workout_preset_id,
            name: name || workoutPreset.name,
            description:
              description !== undefined
                ? description
                : workoutPreset.description,
            entry_date,
            notes,
            source,
          },
          actingUserId
        );
      if (exercises !== undefined) {
        // Client supplied its own exercise/set structure (e.g. a live
        // workout's Hevy-style placeholders) — use it verbatim. The entry is
        // still tagged to the preset (for recentSessions stats scoping), but
        // keeps its own source and stays nested-edit-able like any other
        // client-authored session, unlike a pure workout_preset_id start
        // (source 'Workout Preset', not in EDITABLE_SOURCES).
        exerciseDefinitions = exercises;
      } else {
        exerciseDefinitions = workoutPreset.exercises || [];
        childEntrySource = 'Workout Preset';
        preserveLegacyPresetDurationFallback = true;
      }
    } else {
      presetEntry =
        await exercisePresetEntryRepository.createExercisePresetEntryWithClient(
          client,
          userId,
          {
            workout_preset_id: null,
            name,
            description: description ?? null,
            entry_date,
            notes: notes ?? null,
            source,
          },
          actingUserId
        );
      exerciseDefinitions = exercises || [];
    }
    await createGroupedExerciseEntriesWithClient(
      client,
      userId,
      actingUserId,
      presetEntry.id,
      entry_date,
      exerciseDefinitions,
      {
        entrySource: childEntrySource,
        workoutPlanAssignmentId,
        preserveLegacyPresetDurationFallback,
      }
    );
    const groupedSession = await getGroupedExerciseSessionByIdWithClient(
      client,
      userId,
      presetEntry.id
    );
    await client.query('COMMIT');
    return groupedSession;
  } catch (error) {
    await client.query('ROLLBACK');
    log('error', 'Error creating grouped workout session:', error);
    throw error;
  } finally {
    client.release();
  }
}
async function updateGroupedWorkoutSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actingUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  presetEntryId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateData: any
) {
  const client = await getClient(userId);
  try {
    await client.query('BEGIN');
    const existingSession = await getGroupedExerciseSessionByIdWithClient(
      client,
      userId,
      presetEntryId
    );
    if (!existingSession) {
      throw createServiceError(404, 'Exercise preset entry not found.');
    }
    await exercisePresetEntryRepository.updateExercisePresetEntryWithClient(
      client,
      presetEntryId,
      userId,
      {
        name: updateData.name,
        description: updateData.description,
        notes: updateData.notes,
        entry_date: updateData.entry_date,
      }
    );
    const targetEntryDate = updateData.entry_date || existingSession.entry_date;
    if (updateData.exercises !== undefined) {
      if (!canEditGroupedWorkout(existingSession.source)) {
        throw createServiceError(
          409,
          'Nested exercise editing is only supported for manual, sparky, or workout plan sessions.'
        );
      }

      const incomingExercises = updateData.exercises;
      const withId = incomingExercises.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => e.id !== undefined && e.id !== null
      ).length;

      if (withId !== 0 && withId !== incomingExercises.length) {
        throw createServiceError(
          400,
          'exercises[].id must be provided for all entries or none.'
        );
      }

      const useReconcile =
        withId === incomingExercises.length && incomingExercises.length > 0;

      // Capture the workout plan assignment before any child rows are deleted:
      // the assignment id lives on exercise_entries, so once delete-and-recreate
      // removes them there is nothing left to recover it from. Returns null for
      // sessions that never came from a workout plan.
      const workoutPlanAssignmentId =
        await exerciseEntryDb.getWorkoutPlanAssignmentIdByPresetEntryIdWithClient(
          client,
          userId,
          presetEntryId
        );

      if (!useReconcile) {
        await exerciseEntryDb.deleteExerciseEntriesByPresetEntryIdWithClient(
          client,
          userId,
          presetEntryId
        );

        await createGroupedExerciseEntriesWithClient(
          client,
          userId,
          actingUserId,
          presetEntryId,
          targetEntryDate,
          incomingExercises,
          {
            entrySource: existingSession.source,
            workoutPlanAssignmentId,
          }
        );
      } else {
        const existingExercises = existingSession.exercises || [];
        const existingById = new Map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          existingExercises.map((e: any) => [e.id, e])
        );

        const incomingIdSet = new Set(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          incomingExercises.map((e: any) => e.id)
        );
        const toDelete = existingExercises.filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (e: any) => !incomingIdSet.has(e.id)
        );
        for (const e of toDelete) {
          await exerciseEntryDb._deleteExerciseEntryWithClient(
            client,
            userId,
            e.id
          );
        }

        for (const ex of incomingExercises) {
          // An incoming id the session doesn't already have is a client-added
          // exercise: a new app mints a uuid on add and sends it through the
          // reconcile path. Create the entry under this preset entry with that
          // client uuid, then skip the update/reconcile-sets path below — the
          // create already inserts its sets, so falling through would
          // double-insert them.
          if (!existingById.has(ex.id)) {
            await createGroupedExerciseEntriesWithClient(
              client,
              userId,
              actingUserId,
              presetEntryId,
              targetEntryDate,
              [ex],
              {
                entrySource: existingSession.source,
                workoutPlanAssignmentId,
              }
            );
            continue;
          }

          // Reuse prepareExerciseEntryForCreate so calories_burned is
          // recomputed from the new duration/sets the same way the legacy
          // delete-and-recreate path does — otherwise the helper would
          // preserve the stale value.
          const preparedEntry = await prepareExerciseEntryForCreate(userId, {
            exercise_id: ex.exercise_id,
            entry_date: targetEntryDate,
            notes: ex.notes ?? null,
            sets: ex.sets || [],
            duration_minutes: deriveDurationMinutes(ex),
            ...(typeof ex.calories_burned === 'number'
              ? { calories_burned: ex.calories_burned }
              : {}),
            sort_order: ex.sort_order ?? 0,
            superset_group: ex.superset_group ?? null,
            distance: ex.distance,
            avg_heart_rate: ex.avg_heart_rate,
          });

          await exerciseEntryDb._updateExerciseEntryWithClient(
            client,
            ex.id,
            userId,
            {
              exercise_id: preparedEntry.exercise_id,
              notes: preparedEntry.notes,
              sort_order: preparedEntry.sort_order ?? 0,
              superset_group: preparedEntry.superset_group ?? null,
              // The grouped request has no entry-level distance, so
              // preparedEntry.distance is the set-derived total; preserve the
              // existing value when no set carries a distance.
              distance:
                preparedEntry.distance ??
                existingById.get(ex.id)?.distance ??
                null,
              avg_heart_rate: preparedEntry.avg_heart_rate,
              duration_minutes: preparedEntry.duration_minutes,
              calories_burned: preparedEntry.calories_burned,
              entry_date: targetEntryDate,
              entry_time: ex.entry_time ?? null,
            },
            actingUserId,
            existingById.get(ex.id)?.source ?? existingSession.source
          );

          await exerciseEntryDb._reconcileExerciseEntrySetsWithClient(
            client,
            ex.id,
            ex.sets || []
          );
        }
      }
    } else if (
      updateData.entry_date !== undefined &&
      updateData.entry_date !== existingSession.entry_date
    ) {
      await exerciseEntryDb.updateExerciseEntriesDateByPresetEntryIdWithClient(
        client,
        userId,
        presetEntryId,
        updateData.entry_date,
        actingUserId
      );
    }
    const groupedSession = await getGroupedExerciseSessionByIdWithClient(
      client,
      userId,
      presetEntryId
    );
    await client.query('COMMIT');
    return groupedSession;
  } catch (error) {
    await client.query('ROLLBACK');
    log('error', 'Error updating grouped workout session:', error);
    throw error;
  } finally {
    client.release();
  }
}
async function logWorkoutPresetGrouped(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actingUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workoutPresetId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entryDate: any,
  options = {}
) {
  return createGroupedWorkoutSession(userId, actingUserId, {
    workout_preset_id: workoutPresetId,
    entry_date: entryDate,
    ...options,
  });
}
async function getActivityDetailsByExerciseEntryIdAndProvider(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entryId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providerName: any
) {
  try {
    let activityDetails = [];
    // First, try to find an exercise entry with the given ID
    const exerciseEntry = await exerciseEntryDb.getExerciseEntryById(
      entryId,
      authenticatedUserId
    );
    let targetId = entryId; // Default to the provided entryId
    if (exerciseEntry) {
      // If it's an exercise entry and linked to a preset, use the preset ID
      if (exerciseEntry.exercise_preset_entry_id) {
        targetId = exerciseEntry.exercise_preset_entry_id;
        activityDetails =
          await activityDetailsRepository.getActivityDetailsByEntryOrPresetId(
            authenticatedUserId,
            null,
            targetId
          );
      } else {
        // If it's an exercise entry but not linked to a preset, use its own ID
        activityDetails =
          await activityDetailsRepository.getActivityDetailsByEntryOrPresetId(
            authenticatedUserId,
            targetId,
            null
          );
      }
    } else {
      // If not an exercise entry, try to find an exercise preset entry with the given ID
      const presetEntry =
        await exercisePresetEntryRepository.getExercisePresetEntryById(
          entryId,
          authenticatedUserId
        );
      if (presetEntry) {
        targetId = entryId; // The provided ID is already a preset entry ID
        activityDetails =
          await activityDetailsRepository.getActivityDetailsByEntryOrPresetId(
            authenticatedUserId,
            null,
            targetId
          );
      }
    }
    // Find the full_activity_data and full_workout_data for the given provider
    const activityData = activityDetails.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (detail: any) =>
        detail.provider_name === providerName &&
        detail.detail_type === 'full_activity_data'
    );
    const workoutData = activityDetails.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (detail: any) =>
        detail.provider_name === providerName &&
        detail.detail_type === 'full_workout_data'
    );
    // Return a composite object containing both, if they exist
    if (activityData || workoutData) {
      return {
        activity: activityData ? activityData.detail_data : null,
        workout: workoutData ? workoutData.detail_data : null,
      };
    }
    return null;
  } catch (error) {
    log(
      'error',
      `Error fetching activity details for entry ${entryId} from provider ${providerName} by user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getExercisesNeedingReview(authenticatedUserId: any) {
  try {
    const exercisesNeedingReview =
      await exerciseRepository.getExercisesNeedingReview(authenticatedUserId);
    return exercisesNeedingReview;
  } catch (error) {
    log(
      'error',
      `Error getting exercises needing review for user ${authenticatedUserId}:`,
      error
    );
    throw error;
  }
}

async function updateExerciseEntriesSnapshot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exerciseId: any
) {
  try {
    // Fetch the latest exercise details
    const exercise = await exerciseDb.getExerciseById(
      exerciseId,
      authenticatedUserId
    );
    if (!exercise) {
      throw new Error('Exercise not found.');
    }
    // Construct the new snapshot data
    const newSnapshotData = {
      exercise_name: exercise.name,
      calories_per_hour: exercise.calories_per_hour,
      modality: exercise.modality,
    };
    // Update all relevant exercise entries for the authenticated user
    await exerciseRepository.updateExerciseEntriesSnapshot(
      authenticatedUserId,
      exerciseId,
      newSnapshotData
    );
    // Clear any ignored updates for this exercise for this user
    await exerciseRepository.clearUserIgnoredUpdate(
      authenticatedUserId,
      exerciseId
    );
    return { message: 'Exercise entries updated successfully.' };
  } catch (error) {
    log(
      'error',
      `Error updating exercise entries snapshot for user ${authenticatedUserId}, exercise ${exerciseId}:`,
      error
    );
    throw error;
  }
}

async function importExercisesFromJson(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exercisesArray: any
) {
  let createdCount = 0;
  let updatedCount = 0;
  let failedCount = 0;
  const failedRows = [];
  const duplicates = [];
  for (const exerciseData of exercisesArray) {
    try {
      const exerciseName = exerciseData.name ? exerciseData.name.trim() : null;
      if (!exerciseName) {
        failedCount++;
        failedRows.push({
          row: exerciseData,
          reason: 'Exercise name is required.',
        });
        continue;
      }
      const primaryMuscles = exerciseData.primary_muscles
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          exerciseData.primary_muscles.split(',').map((m: any) => m.trim())
        : [];
      if (primaryMuscles.length === 0) {
        failedCount++;
        failedRows.push({
          row: exerciseData,
          reason: 'Primary muscles are required.',
        });
        continue;
      }
      const sourceId = exerciseName.toLowerCase().replace(/\s/g, '_');
      const newExerciseData = {
        name: exerciseName,
        description: exerciseData.description || null,
        instructions: exerciseData.instructions
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            exerciseData.instructions.split(',').map((i: any) => i.trim())
          : [],
        category: exerciseData.category || null,
        force: exerciseData.force || null,
        level: exerciseData.level || null,
        mechanic: exerciseData.mechanic || null,
        equipment: exerciseData.equipment
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            exerciseData.equipment.split(',').map((e: any) => e.trim())
          : [],
        primary_muscles: primaryMuscles,
        secondary_muscles: exerciseData.secondary_muscles
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            exerciseData.secondary_muscles.split(',').map((m: any) => m.trim())
          : [],
        // toNumber (not parseFloat) so a locale-comma decimal parses
        // correctly instead of silently truncating — same fix as the CSV
        // import path above.
        calories_per_hour:
          exerciseData.calories_per_hour !== undefined &&
          exerciseData.calories_per_hour !== null &&
          exerciseData.calories_per_hour !== ''
            ? (toNumber(String(exerciseData.calories_per_hour)) ?? null)
            : null,
        user_id: authenticatedUserId,
        is_custom: exerciseData.is_custom === true,
        shared_with_public: exerciseData.shared_with_public === true,
        source: 'CSV_Import', // Indicate that it came from a CSV import via the UI
        source_id: sourceId,
      };
      // Handle images: download and store local paths
      if (exerciseData.images) {
        const imageUrls = exerciseData.images
          .split(',')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((url: any) => url.trim());
        const localImagePaths = [];
        const exerciseFolderName = exerciseName.replace(/[^a-zA-Z0-9]/g, '_');
        for (const imageUrl of imageUrls) {
          try {
            const localPath = await downloadImage(imageUrl, exerciseFolderName);
            localImagePaths.push(localPath);
          } catch (imgError) {
            log(
              'error',
              `Failed to download image ${imageUrl} for exercise ${exerciseName}:`,
              imgError
            );
            // Continue without this image, but log the error
          }
        }
        // @ts-expect-error TS(2339): Property 'images' does not exist on type '{ name: ... Remove this comment to see the full error message
        newExerciseData.images = localImagePaths;
      } else {
        // @ts-expect-error TS(2339): Property 'images' does not exist on type '{ name: ... Remove this comment to see the full error message
        newExerciseData.images = [];
      }
      const existingExercise = await exerciseDb.searchExercises(
        exerciseName,
        authenticatedUserId,
        [],
        []
      );
      if (existingExercise && existingExercise.length > 0) {
        // Check for exact duplicate before updating
        const isDuplicate = existingExercise.some(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (ex: any) => ex.name.toLowerCase() === exerciseName.toLowerCase()
        );
        if (isDuplicate) {
          duplicates.push({
            name: exerciseName,
            reason: 'Exercise with this name already exists.',
          });
          failedCount++;
          failedRows.push({
            row: exerciseData,
            reason: 'Duplicate exercise name.',
          });
          continue;
        }
        // Assuming the first match is the one to update
        await exerciseDb.updateExercise(
          existingExercise[0].id,
          authenticatedUserId,
          newExerciseData
        );
        updatedCount++;
      } else {
        await exerciseDb.createExercise(newExerciseData);
        createdCount++;
      }
    } catch (rowError) {
      failedCount++;
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      failedRows.push({ row: exerciseData, reason: rowError.message });
      log(
        'error',
        `Error processing exercise data for user ${authenticatedUserId}:`,
        rowError
      );
    }
  }
  if (duplicates.length > 0) {
    const error = new Error('Duplicate exercises found.');
    // @ts-expect-error TS(2339): Property 'status' does not exist on type 'Error'.
    error.status = 409; // Conflict
    // @ts-expect-error TS(2339): Property 'data' does not exist on type 'Error'.
    error.data = { duplicates };
    throw error;
  }
  return {
    message: 'Exercise import complete.',
    created: createdCount,
    updated: updatedCount,
    failed: failedCount,
    failedRows: failedRows,
  };
}
export { getExerciseById };
export { getOrCreateActiveCaloriesExercise };
export { upsertExerciseEntryData };
export { getExercisesWithPagination };
export { searchExercises };
export { searchExercisesPaginated };
export { getExerciseStats };
export { getAvailableEquipment };
export { getAvailableMuscleGroups };
export { createExercise };
export { createExerciseEntry };
export { getExerciseEntryById };
export { updateExerciseEntry };
export { deleteExerciseEntry };
export { updateExercise };
export { deleteExercise };
export { getExerciseEntriesByDate };
export { addFreeExerciseDBExerciseToUserExercises };
export { getSuggestedExercises };
export { searchExternalExercises };
export { addExternalExerciseToUserExercises };
export { addNutritionixExerciseToUserExercises };
export { getExerciseDeletionImpact };
export { getExerciseProgressData };
export { getExerciseHistory };
export { getRecentExercises };
export { getTopExercises };
export { importExercisesFromCSV };
export { importExercisesFromJson };
export { getExercisesNeedingReview };
export { updateExerciseEntriesSnapshot };
export { getActivityDetailsByExerciseEntryIdAndProvider };
export { logWorkoutPresetGrouped };
export { createGroupedWorkoutSession };
export { updateGroupedWorkoutSession };
export { getGroupedWorkoutSessionById };
export default {
  getExerciseById,
  findStockImagesForExerciseName,
  getOrCreateActiveCaloriesExercise,
  upsertExerciseEntryData,
  getExercisesWithPagination,
  searchExercises,
  searchExercisesPaginated,
  getExerciseStats,
  getAvailableEquipment,
  getAvailableMuscleGroups,
  createExercise,
  createExerciseEntry,
  getExerciseEntryById,
  updateExerciseEntry,
  deleteExerciseEntry,
  updateExercise,
  deleteExercise,
  getExerciseEntriesByDate,
  addFreeExerciseDBExerciseToUserExercises,
  listExerciseCatalogPacks,
  importExerciseCatalogPack,
  getSuggestedExercises,
  searchExternalExercises,
  addExternalExerciseToUserExercises,
  addNutritionixExerciseToUserExercises,
  getExerciseDeletionImpact,
  getExerciseProgressData,
  getExerciseHistory,
  getRecentExercises,
  getTopExercises,
  importExercisesFromCSV,
  importExercisesFromJson,
  getExercisesNeedingReview,
  updateExerciseEntriesSnapshot,
  getActivityDetailsByExerciseEntryIdAndProvider,
  logWorkoutPresetGrouped,
  createGroupedWorkoutSession,
  updateGroupedWorkoutSession,
  getGroupedWorkoutSessionById,
};
