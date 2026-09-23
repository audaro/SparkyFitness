import measurementRepository from '../../models/measurementRepository.js';
import { log } from '../../config/logging.js';
import exerciseRepository from '../../models/exercise.js';
import exerciseEntryRepository from '../../models/exerciseEntry.js';
import sleepRepository from '../../models/sleepRepository.js';
import activityDetailsRepository from '../../models/activityDetailsRepository.js';
import * as genericHealthRepository from '../../models/genericHealthRepository.js';
import {
  utcOffsetMinutesFromIsoString,
  localDateTimeToUtc,
  addDays,
  instantToDay,
} from '@workspace/shared';
import {
  upsertSamplesByDay,
  FlatHealthSample,
} from '../../services/healthMetricSampleWriter.js';
import { loadUserTimezone } from '../../utils/timezoneLoader.js';

/**
 * Provider tag for Polar rows in daily_health_metrics. Lowercase to match the
 * other providers' source_provider values (the column is free text).
 */
const POLAR_HEALTH_PROVIDER = 'polar';

/**
 * A Polar daily-activity record as the AccessLink list API returns it. Polar
 * mixes hyphenated and underscored keys across endpoints, so both spellings are
 * declared and read through `getVal`.
 */
export interface PolarActivityRecord {
  date?: string;
  'start-time'?: string;
  start_time?: string;
  'end-time'?: string;
  end_time?: string;
  steps?: number | string;
  'active-steps'?: number | string;
  active_steps?: number | string;
  calories?: number | string;
  'active-calories'?: number | string;
  active_calories?: number | string;
  'distance-from-steps'?: number | string;
  distance_from_steps?: number | string;
}

/**
 * Coerce a Polar numeric field to a finite number, or null when it is absent or
 * unparseable. Distinct from a falsy check: a legitimate 0 (no steps that day)
 * must survive, which `if (steps)` would drop.
 */
const toFiniteNumber = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Helper to get a value from a Polar object regardless of hyphen or underscore usage.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getVal = (obj: any, key: any) => {
  if (!obj || !key) return undefined;
  if (obj[key] !== undefined) return obj[key];
  // Try alternative naming conventions (underscore vs hyphen)
  const underscored = key.replace(/-/g, '_');
  if (obj[underscored] !== undefined) return obj[underscored];
  const hyphenated = key.replace(/_/g, '-');
  if (obj[hyphenated] !== undefined) return obj[hyphenated];
  return undefined;
};
/**
 * Helper to safely parse a Polar timestamp into a UTC ISO string.
 * This is the standard way to store timestamps in SparkyFitness.
 */

/**
 * True when the leading YYYY-MM-DD of a timestamp is a real calendar date.
 *
 * `new Date()` silently normalises impossible dates -- "2026-02-30" becomes
 * 2026-03-02 -- which is finite and would otherwise be persisted two days off.
 * Round-tripping the components catches that before anything is stored.
 */
const hasRealCalendarDate = (timeStr: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(timeStr);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
};

const parsePolarToUTC = (timeStr: unknown): string | null => {
  // Total by construction: the processing phase of syncPolarData runs the
  // processors without a per-processor try/catch, so a single malformed
  // timestamp from one endpoint used to abort the whole sync. A non-string
  // threw on `.match`, and an unparseable string threw on `.toISOString()`.
  if (typeof timeStr !== 'string' || timeStr === '') return null;
  if (!hasRealCalendarDate(timeStr)) return null;

  const toIso = (value: string): string | null => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  };

  // Date-only strings are explicitly UTC midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(timeStr)) {
    return toIso(`${timeStr}T00:00:00Z`);
  }
  // Naive timestamps carry no offset; Polar documents these as UTC.
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:|:\d{2}|:\d{2}\.\d{1,6})$/.test(timeStr)
  ) {
    return toIso(`${timeStr}Z`);
  }
  // Anything else already carries an offset or is a full ISO string.
  return toIso(timeStr);
};
/**
 * Resolve a hypnogram wall-clock key ("HH:MM", recording zone) to a UTC instant.
 *
 * The key is placed on the calendar day of `anchorMs` (the bedtime) as seen in
 * the recording zone; when that lands before the anchor (minute granularity,
 * the first key equals the sleep-start minute while bedtime carries seconds)
 * the stage belongs to the next day. Nothing here consults the process zone.
 */
export const hypnogramStageStartMs = (
  hhmm: string,
  anchorMs: number,
  utcOffsetMinutes: number
): number => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const offsetMs = utcOffsetMinutes * 60_000;
  const shifted = new Date(anchorMs + offsetMs);
  const dayStartUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  );
  let stageMs = dayStartUtc + (hours * 60 + minutes) * 60_000 - offsetMs;
  const anchorMinuteMs = anchorMs - (anchorMs % 60_000);
  if (stageMs < anchorMinuteMs) stageMs += 24 * 60 * 60_000;
  return stageMs;
};

/**
 * Maps Polar exercise types/names to SparkyFitness exercise entries.
 */

async function processPolarExercises(
  userId: string,
  createdByUserId: string,
  exercises = []
) {
  // Normalize input: could be a direct array or a response object containing 'exercises'
  const exerciseList = Array.isArray(exercises)
    ? exercises
    : // @ts-expect-error TS(2339): Property 'exercises' does not exist on type 'never... Remove this comment to see the full error message
      exercises.exercises || [];
  if (!exerciseList || exerciseList.length === 0) {
    log('info', `No Polar exercise data to process for user ${userId}.`);
    return;
  }
  // First, delete existing Polar exercise entries for the dates covered to avoid duplicates
  const processedDates = new Set();
  for (const exercise of exerciseList) {
    const startTime = getVal(exercise, 'start-time');
    if (!startTime) continue;
    const entryDate = startTime.split('T')[0]; // Literal Calendar Date
    if (!processedDates.has(entryDate)) {
      await exerciseEntryRepository.deleteExerciseEntriesByEntrySourceAndDate(
        userId,
        entryDate,
        entryDate,
        'Polar'
      );
      processedDates.add(entryDate);
    }
  }
  for (const exercise of exerciseList) {
    try {
      const exerciseId = getVal(exercise, 'id');
      const startTime = getVal(exercise, 'start-time');
      const duration = getVal(exercise, 'duration');
      const calories = getVal(exercise, 'calories') ?? 0;
      const distance = getVal(exercise, 'distance') ?? 0; // In meters
      const sport = getVal(exercise, 'sport');
      const detailedSportInfo = getVal(exercise, 'detailed-sport-info');
      if (!startTime) {
        log(
          'warn',
          `[polarDataProcessor] Skipping exercise with no start-time: ${JSON.stringify(exercise)}`
        );
        continue;
      }
      const exerciseName = detailedSportInfo || sport || 'Polar Workout';
      const exerciseSourceId = `polar-workout-${exerciseId}`;
      let exerciseDef = await exerciseRepository.getExerciseBySourceAndSourceId(
        'Polar',
        exerciseSourceId,
        userId
      );
      if (!exerciseDef) {
        // Search by name if source not found
        // @ts-expect-error TS(2554): Expected 4 arguments, but got 2.
        const searchResults = await exerciseRepository.searchExercises(
          exerciseName,
          userId
        );
        if (searchResults && searchResults.length > 0) {
          exerciseDef = searchResults[0];
        }
      }
      const durationSeconds = duration
        ? Math.round(iso8601ToSeconds(duration))
        : 0;
      if (!exerciseDef) {
        const newExerciseData = {
          user_id: userId,
          name: exerciseName,
          category: 'Cardio',
          calories_per_hour:
            calories && durationSeconds > 0
              ? Math.round(calories / (durationSeconds / 3600))
              : 300,
          description: `Automatically created from Polar Flow: ${sport}.`,
          is_custom: true,
          shared_with_public: false,
          source: 'Polar',
          source_id: exerciseSourceId,
        };
        exerciseDef = await exerciseRepository.createExercise(newExerciseData);
      }
      const entryDate = startTime.split('T')[0];
      const durationMinutes = Math.round(durationSeconds / 60);
      const heartRateObj =
        getVal(exercise, 'heart-rate') || getVal(exercise, 'heart_rate');
      const avgHeartRate = heartRateObj
        ? Math.round(getVal(heartRateObj, 'average') ?? 0)
        : null;
      const distanceKm =
        distance > 0 ? parseFloat((distance / 1000).toFixed(2)) : null;

      const exerciseEntryData = {
        exercise_id: exerciseDef.id,
        duration_minutes: durationMinutes,
        calories_burned: calories,
        entry_date: entryDate,
        notes: `Logged from Polar Flow: ${sport}. ID: ${exerciseId}.${distance > 0 ? ` Distance: ${(distance / 1000).toFixed(2)}km.` : ''}`,
        distance: distanceKm,
        avg_heart_rate: avgHeartRate,
        source_id: exerciseId ? exerciseId.toString() : null,
        sets: [
          {
            set_number: 1,
            set_type: 'Working Set',
            reps: 1,
            weight: 0,
            duration: durationSeconds,
            rest_time: 0,
            notes: '',
          },
        ],
      };
      const newEntry = await exerciseEntryRepository.createExerciseEntry(
        userId,
        exerciseEntryData,
        createdByUserId,
        'Polar'
      );
      if (newEntry && newEntry.id) {
        await activityDetailsRepository.createActivityDetail(userId, {
          exercise_entry_id: newEntry.id,
          provider_name: 'Polar',
          detail_type: 'full_activity_data',
          detail_data: exercise,
          created_by_user_id: createdByUserId,
        });
      }
      log(
        'info',
        `Logged Polar exercise entry for user ${userId}: ${exerciseDef.name} on ${entryDate}.`
      );
    } catch (error) {
      const exerciseId = getVal(exercise, 'id');
      log(
        'error',
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        `Error processing Polar exercise ${exerciseId} for user ${userId}: ${error.message}`
      );
    }
  }
}
/**
 * Processes Polar physical info (e.g., weight, height, RHR, VO2 Max).
 */
async function processPolarPhysicalInfo(
  userId: string,
  createdByUserId: string,
  physicalInfo = []
) {
  // Normalize input
  const infoList = Array.isArray(physicalInfo)
    ? physicalInfo
    : physicalInfo['physical-informations'] || [];
  if (!infoList || infoList.length === 0) return;
  for (const info of infoList) {
    const created = getVal(info, 'created');
    if (!created) continue;
    const entryDate = created.split('T')[0];
    const measurementsToUpsert = {};
    const weight = getVal(info, 'weight');
    const height = getVal(info, 'height');
    // @ts-expect-error TS(2339): Property 'weight' does not exist on type '{}'.
    if (weight) measurementsToUpsert.weight = weight;
    // @ts-expect-error TS(2339): Property 'height' does not exist on type '{}'.
    if (height) measurementsToUpsert.height = height;
    if (Object.keys(measurementsToUpsert).length > 0) {
      await measurementRepository.upsertCheckInMeasurements(
        userId,
        createdByUserId,
        entryDate,
        measurementsToUpsert
      );
      log(
        'info',
        `Upserted Polar check-in measurements for user ${userId} on ${entryDate}.`
      );
    }
    // VO2 max also feeds the provider-scoped daily summary. The upsert COALESCEs
    // per column on (user_id, entry_date, source_provider), so this partial write
    // merges with the activity and nightly-recharge writes for the same day.
    const vo2Max = toFiniteNumber(getVal(info, 'vo2-max'));
    if (vo2Max !== null) {
      await genericHealthRepository.upsertDailyHealthMetrics(
        userId,
        createdByUserId,
        {
          user_id: userId,
          entry_date: entryDate,
          source_provider: POLAR_HEALTH_PROVIDER,
          vo2_max: vo2Max,
        }
      );
    }

    // Process other physiological metrics as custom measurements
    const physiologicalMetrics = [
      {
        name: 'Resting Heart Rate',
        value: getVal(info, 'resting-heart-rate'),
        unit: 'bpm',
        frequency: 'Daily',
      },
      {
        name: 'Maximum Heart Rate',
        value: getVal(info, 'maximum-heart-rate'),
        unit: 'bpm',
        frequency: 'Daily',
      },
      {
        name: 'VO2 Max',
        value: getVal(info, 'vo2-max'),
        unit: 'ml/kg/min',
        frequency: 'Daily',
      },
      {
        name: 'Aerobic Threshold',
        value: getVal(info, 'aerobic-threshold'),
        unit: 'bpm',
        frequency: 'Daily',
      },
      {
        name: 'Anaerobic Threshold',
        value: getVal(info, 'anaerobic-threshold'),
        unit: 'bpm',
        frequency: 'Daily',
      },
    ];
    for (const metric of physiologicalMetrics) {
      if (metric.value) {
        await upsertCustomMeasurementLogic(userId, createdByUserId, {
          categoryName: metric.name,
          value: metric.value,
          unit: metric.unit,
          entryDate: entryDate,
          entryTimestamp: parsePolarToUTC(created),
          frequency: metric.frequency,
        });
      }
    }
  }
}
/**
 * Resolve the calendar day a Polar daily-activity record belongs to.
 *
 * The `/users/activities` list returns `start_time`/`end_time` and no `date`
 * field; only the simple per-day summaries carry `date`. Both the service-level
 * dedup and this processor need the same answer, so the resolution lives here.
 * Returns null when neither field is present.
 */
export const resolvePolarActivityDate = (
  activity: PolarActivityRecord
): string | null => {
  const entryDate = getVal(activity, 'date');
  if (typeof entryDate === 'string' && entryDate) return entryDate;
  const startTime = getVal(activity, 'start-time');
  if (typeof startTime === 'string' && startTime)
    return startTime.split('T')[0];
  return null;
};

/**
 * Read the step count off a Polar daily-activity record, or null when absent.
 * Shared with the service-level dedup so both agree on which field wins.
 */
export const resolvePolarActivitySteps = (
  activity: PolarActivityRecord
): number | null =>
  toFiniteNumber(getVal(activity, 'steps') ?? getVal(activity, 'active-steps'));

/**
 * Processes Polar daily activity data.
 */

async function processPolarActivity(
  userId: string,
  createdByUserId: string,
  activities = []
) {
  // Normalize input
  const activityList = Array.isArray(activities)
    ? activities
    : // @ts-expect-error TS(2339): Property 'activities' does not exist on type 'neve... Remove this comment to see the full error message
      activities.activities || [];
  if (!activityList || activityList.length === 0) return;
  for (const activity of activityList) {
    const entryDate = resolvePolarActivityDate(activity);
    const startTime = getVal(activity, 'start-time');
    if (!entryDate) {
      log(
        'warn',
        `[polarDataProcessor] Skipping activity with no date or start_time: ${JSON.stringify(activity)}`
      );
      continue;
    }
    const calories = toFiniteNumber(getVal(activity, 'calories'));
    const activeCalories = toFiniteNumber(getVal(activity, 'active-calories'));
    const steps = resolvePolarActivitySteps(activity);
    // Polar reports distance in metres, already derived from the step count.
    const distanceMeters = toFiniteNumber(
      getVal(activity, 'distance-from-steps')
    );

    // Steps belong in check_in_measurements, which is what Reports -> Daily
    // Steps, the Daily Step Log and the Diary energy goal all read. upsertStepData
    // is max-wins per day, so the partial first/last day of Polar's 28-day window
    // never shrinks a total an earlier sync already recorded (issue #2471).
    if (steps !== null) {
      await measurementRepository.upsertStepData(
        userId,
        createdByUserId,
        steps,
        entryDate
      );
    }

    // Ordering key for the total_calories gate below. Polar's end_time is the
    // end of the window the record summarises, so it advances as the current day
    // accumulates and is stable once the day closes -- a provider-side snapshot
    // revision time. Local processing time cannot be used here: syncPolarData
    // has no per-user serialization and both the hourly cron and the manual
    // route can run concurrently, so a slow older response can land after a
    // newer one and would carry the later stamp, overwriting fresher calories.
    // start_time is the last resort and is fixed for the day, so a record
    // missing end_time simply stops advancing rather than regressing.
    const snapshotAt = parsePolarToUTC(
      getVal(activity, 'end-time') || startTime || entryDate
    );
    if (
      steps !== null ||
      distanceMeters !== null ||
      activeCalories !== null ||
      calories !== null
    ) {
      await genericHealthRepository.upsertDailyHealthMetrics(
        userId,
        createdByUserId,
        {
          user_id: userId,
          entry_date: entryDate,
          source_provider: POLAR_HEALTH_PROVIDER,
          total_steps: steps,
          total_distance_meters: distanceMeters,
          active_calories: activeCalories,
          total_calories: calories,
          // The upsert only advances total_calories when a strictly newer
          // stamp comes with it, so the two must always travel together.
          total_calories_captured_at:
            calories !== null && snapshotAt !== null
              ? new Date(snapshotAt)
              : null,
        }
      );
    }

    // Calories stay as custom measurements: check_in_measurements has no column
    // for them, and existing users already chart these categories. Steps are
    // deliberately absent here now that they have a first-class home.
    const metrics = [
      {
        name: 'Active Calories',
        value: activeCalories,
        unit: 'kcal',
        frequency: 'Daily',
      },
      {
        name: 'Daily Calories',
        value: calories,
        unit: 'kcal',
        frequency: 'Daily',
      },
    ];
    for (const metric of metrics) {
      if (metric.value !== null) {
        await upsertCustomMeasurementLogic(userId, createdByUserId, {
          categoryName: metric.name,
          value: metric.value,
          unit: metric.unit,
          entryDate: entryDate,
          entryTimestamp: parsePolarToUTC(startTime || entryDate),
          frequency: metric.frequency,
        });
      }
    }
  }
}
/**
 * Helper to upsert custom measurements.
 */
async function upsertCustomMeasurementLogic(
  userId: string,
  createdByUserId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  customMeasurement: any
) {
  const { categoryName, value, entryDate, entryTimestamp, frequency } =
    customMeasurement;
  const categories = await measurementRepository.getCustomCategories(userId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const category = categories.find((cat: any) => cat.name === categoryName);
  let categoryId;
  if (!category) {
    const newCategoryData = {
      user_id: userId,
      name: categoryName,
      frequency: frequency || 'Daily',
      measurement_type: 'health',
      data_type: typeof value === 'number' ? 'numeric' : 'text',
      created_by_user_id: createdByUserId,
    };
    const newCategory =
      await measurementRepository.createCustomCategory(newCategoryData);
    categoryId = newCategory.id;
  } else {
    categoryId = category.id;
  }
  await measurementRepository.upsertCustomMeasurement(
    userId,
    createdByUserId,
    categoryId,
    value,
    entryDate,
    null, // entryHour
    entryTimestamp,
    null, // notes
    frequency || 'Daily',
    'Polar' // source
  );
}
/**
 * Processes Polar sleep data.
 */

async function processPolarSleep(
  userId: string,
  createdByUserId: string,
  sleepData = []
) {
  // Normalize input
  const sleepNights = Array.isArray(sleepData)
    ? sleepData
    : // @ts-expect-error TS(2339): Property 'nights' does not exist on type 'never'.
      sleepData.nights || [];
  if (!sleepNights || sleepNights.length === 0) {
    log('info', `No Polar sleep data to process for user ${userId}.`);
    return;
  }
  for (const night of sleepNights) {
    try {
      const entryDate = getVal(night, 'date');
      const startTime =
        getVal(night, 'sleep-start-time') || getVal(night, 'start-time');
      const endTime =
        getVal(night, 'sleep-end-time') || getVal(night, 'end-time');
      if (!entryDate || !startTime || !endTime) {
        log(
          'warn',
          `[polarDataProcessor] Skipping sleep entry due to missing required fields for user ${userId}.`
        );
        continue;
      }
      // Summary stats - Polar uses seconds for these
      const lightSleepSec =
        getVal(night, 'light-sleep') ??
        (getVal(night, 'light-non-rem-sleep-duration') ?? 0) +
          (getVal(night, 'lighter-non-rem-sleep-duration') ?? 0);
      const deepSleepSec =
        getVal(night, 'deep-sleep') ??
        getVal(night, 'deep-non-rem-sleep-duration') ??
        0;
      const remSleepSec =
        getVal(night, 'rem-sleep') ?? getVal(night, 'rem-sleep-duration') ?? 0;
      const awakeSec =
        getVal(night, 'wake-duration') ??
        getVal(night, 'total-interruption-duration') ??
        0;
      const totalDurationSec =
        lightSleepSec + deepSleepSec + remSleepSec + awakeSec;
      // The raw sleep-start-time string carries the recording zone as a
      // ±HH:MM suffix that parsePolarToUTC normalizes away; naive or
      // date-only strings yield null and stamp nothing.
      const recordUtcOffsetMinutes = utcOffsetMinutesFromIsoString(startTime);
      const sleepEntryData = {
        entry_date: entryDate,
        bedtime: parsePolarToUTC(startTime),
        wake_time: parsePolarToUTC(endTime),
        ...(recordUtcOffsetMinutes !== null
          ? { record_utc_offset_minutes: recordUtcOffsetMinutes }
          : {}),
        duration_in_seconds: totalDurationSec,
        time_asleep_in_seconds: lightSleepSec + deepSleepSec + remSleepSec,
        sleep_score: getVal(night, 'sleep-score'),
        source: 'Polar',
        deep_sleep_seconds: deepSleepSec,
        light_sleep_seconds: lightSleepSec,
        rem_sleep_seconds: remSleepSec,
        awake_sleep_seconds: awakeSec,
      };
      const entry = await sleepRepository.upsertSleepEntry(
        userId,
        createdByUserId,
        sleepEntryData
      );
      // Process hypnogram (stages)
      const hypnogram = getVal(night, 'hypnogram');
      if (hypnogram && entry) {
        // Polar hypnogram can be Map or Array of Objects
        const stagesArray = Array.isArray(hypnogram)
          ? hypnogram
          : Object.entries(hypnogram).map(([time, value]) => ({ time, value }));
        // Hypnogram keys are wall-clock HH:MM in the recording zone (the
        // ±HH:MM suffix of sleep-start-time). Resolve each key against the
        // bedtime in that zone (a key that reads earlier than bedtime belongs
        // to the next day) and order the stages by the resolved instant: a
        // string sort put the post-midnight stages before the evening ones,
        // and reading the anchor with getHours()/setHours() tied the result to
        // the process time zone. Both stretched "awake" far past the night
        // (issue #2431). The last stage ends at the recorded wake time, and no
        // stage runs past it.
        const bedtimeMs = new Date(parsePolarToUTC(startTime) ?? NaN).getTime();
        const wakeMs = endTime
          ? new Date(parsePolarToUTC(endTime) ?? NaN).getTime()
          : Number.NaN;
        const offsetMinutes = recordUtcOffsetMinutes ?? 0;
        const sortedStages = stagesArray
          .map((stage) => ({
            value: stage.value,
            startMs: hypnogramStageStartMs(
              stage.time,
              bedtimeMs,
              offsetMinutes
            ),
          }))
          .sort((a, b) => a.startMs - b.startMs);
        for (let i = 0; i < sortedStages.length; i++) {
          const current = sortedStages[i];
          const stageCode = current.value;
          let stageType = 'light';
          if (stageCode === 0) stageType = 'awake';
          else if (stageCode === 1) stageType = 'rem';
          else if (stageCode === 4) stageType = 'deep';
          else if (stageCode === 6) stageType = 'awake'; // 6 is short interruption
          // Note: Stage 5 (Unknown) falls through to "light" sleep per review suggestion
          // Keys carry minute precision while bedtime carries seconds, so the
          // first stage may read a few seconds early; the session starts at
          // bedtime.
          const stageStartMs = Math.max(current.startMs, bedtimeMs);
          const nextStartMs =
            i < sortedStages.length - 1 ? sortedStages[i + 1].startMs : wakeMs;
          const stageEndMs = Number.isFinite(wakeMs)
            ? Math.min(nextStartMs, wakeMs)
            : nextStartMs;
          const durationSec = Number.isFinite(stageEndMs)
            ? Math.round((stageEndMs - stageStartMs) / 1000)
            : 0;
          if (durationSec > 0) {
            await sleepRepository.upsertSleepStageEvent(
              userId,
              entry.id,
              {
                stage_type: stageType,
                start_time: new Date(stageStartMs).toISOString(),
                end_time: new Date(stageEndMs).toISOString(),
                duration_in_seconds: durationSec,
              },
              createdByUserId
            );
          }
        }
      }
      log(
        'info',
        `Processed Polar sleep entry for user ${userId} on ${entryDate}.`
      );
    } catch (error) {
      log(
        'error',
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        `Error processing Polar sleep for user ${userId}: ${error.message}`
      );
    }
  }
}
/**
 * Processes Polar nightly recharge data.
 */
async function processPolarNightlyRecharge(
  userId: string,
  createdByUserId: string,
  rechargeData = []
) {
  // Normalize input
  const rechargeList = Array.isArray(rechargeData)
    ? rechargeData
    : // @ts-expect-error TS(2339): Property 'recharges' does not exist on type 'never... Remove this comment to see the full error message
      rechargeData.recharges || [];
  if (!rechargeList || rechargeList.length === 0) return;
  for (const recharge of rechargeList) {
    const entryDate = getVal(recharge, 'date');
    if (!entryDate) continue;

    // Overnight average HR is the closest thing Polar gives to a resting HR, and
    // it is one of the fields the Diary wearable health card keys its visibility
    // off. Merges into the same daily row as activity and physical info.
    const restingHeartRate = toFiniteNumber(getVal(recharge, 'heart-rate-avg'));
    if (restingHeartRate !== null) {
      await genericHealthRepository.upsertDailyHealthMetrics(
        userId,
        createdByUserId,
        {
          user_id: userId,
          entry_date: entryDate,
          source_provider: POLAR_HEALTH_PROVIDER,
          resting_heart_rate: Math.round(restingHeartRate),
        }
      );
    }

    // Custom measurements for recharge metrics
    const metrics = [
      {
        name: 'Nightly Recharge Score',
        value: getVal(recharge, 'nightly-recharge-status'),
        unit: 'score',
        frequency: 'Daily',
      },
      {
        name: 'ANS Charge',
        value: getVal(recharge, 'ans-charge'),
        unit: 'score',
        frequency: 'Daily',
      },
      {
        name: 'Overnight HRV',
        value: getVal(recharge, 'heart-rate-variability-avg'),
        unit: 'ms',
        frequency: 'Daily',
      },
      {
        name: 'Overnight RHR',
        value: getVal(recharge, 'heart-rate-avg'),
        unit: 'bpm',
        frequency: 'Daily',
      },
      {
        name: 'Breathing Rate',
        value: getVal(recharge, 'breathing-rate-avg'),
        unit: 'brpm',
        frequency: 'Daily',
      },
    ];
    for (const metric of metrics) {
      if (metric.value !== undefined && metric.value !== null) {
        await upsertCustomMeasurementLogic(userId, createdByUserId, {
          categoryName: metric.name,
          value: metric.value,
          unit: metric.unit,
          entryDate: entryDate,
          entryTimestamp: parsePolarToUTC(entryDate),
          frequency: metric.frequency,
        });
      }
    }

    // Intraday HRV series -> health_metric_samples (metric: 'hrv')
    const hrvPayload =
      getVal(recharge, 'hrv-samples') ?? getVal(recharge, 'hrv_samples');
    if (hrvPayload) {
      const hrvSamples: FlatHealthSample[] = [];
      const intervals =
        getVal(hrvPayload, '5min-intervals') ??
        getVal(hrvPayload, '5min_intervals') ??
        getVal(hrvPayload, 'intervals');

      if (Array.isArray(intervals)) {
        const intervalSec =
          toFiniteNumber(
            getVal(hrvPayload, 'interval-in-seconds') ??
              getVal(hrvPayload, 'interval_in_seconds')
          ) ?? 300;
        const startStr =
          getVal(hrvPayload, 'start-time') ??
          getVal(hrvPayload, 'sample-time') ??
          getVal(recharge, 'sleep-start-time') ??
          getVal(recharge, 'heart-rate-variability-start-time');

        let currentMs = startStr
          ? new Date(parsePolarToUTC(startStr) ?? NaN).getTime()
          : new Date(`${entryDate}T00:00:00Z`).getTime();
        if (!Number.isFinite(currentMs)) {
          currentMs = new Date(`${entryDate}T00:00:00Z`).getTime();
        }

        for (const val of intervals) {
          const rmssd = toFiniteNumber(val);
          if (rmssd !== null && rmssd >= 0) {
            hrvSamples.push({
              entry_date: entryDate,
              timestamp: new Date(currentMs),
              rmssd_ms: rmssd,
              device_name: 'Polar Device',
            });
          }
          currentMs += intervalSec * 1000;
        }
      } else if (Array.isArray(hrvPayload)) {
        for (const item of hrvPayload) {
          const rmssd = toFiniteNumber(
            getVal(item, 'rmssd') ??
              getVal(item, 'hrv') ??
              getVal(item, 'value') ??
              getVal(item, 'data')
          );
          const timeStr =
            getVal(item, 'sample-time') ??
            getVal(item, 'time') ??
            getVal(item, 'timestamp') ??
            getVal(item, 't');
          if (rmssd !== null && timeStr) {
            const timestamp = new Date(parsePolarToUTC(timeStr) ?? NaN);
            if (Number.isFinite(timestamp.getTime())) {
              hrvSamples.push({
                entry_date: entryDate,
                timestamp,
                rmssd_ms: rmssd,
                device_name: 'Polar Device',
              });
            }
          }
        }
      } else if (typeof hrvPayload === 'object') {
        // The shape Polar actually returns: an object keyed by wall-clock
        // "HH:MM" in the recording zone, e.g. { "23:01": 71, "00:06": 66 }.
        //
        // `recharge.date` is the WAKE date, so a night runs from the previous
        // evening into that morning: keys at 23:01 belong to date-1 and keys at
        // 00:06 belong to date. Splitting on midday rather than trusting object
        // key order keeps that correct however the JSON is ordered.
        const tz = await loadUserTimezone(userId);
        const previousDay = addDays(entryDate, -1);

        const parsed = Object.entries(
          hrvPayload as Record<string, unknown>
        ).flatMap(([hhmm, value]) => {
          const match = /^(\d{1,2}):(\d{2})/.exec(hhmm);
          const rmssd = toFiniteNumber(value);
          if (!match || rmssd === null || rmssd < 0) return [];
          const hours = Number(match[1]);
          const minutes = Number(match[2]);
          if (hours > 23 || minutes > 59) return [];
          return [
            {
              // Evening readings belong to the night before the wake date.
              day: hours >= 12 ? previousDay : entryDate,
              minuteOfDay: hours * 60 + minutes,
              hhmm: `${String(hours).padStart(2, '0')}:${match[2]}`,
              rmssd,
            },
          ];
        });

        parsed.sort((a, b) =>
          a.day === b.day
            ? a.minuteOfDay - b.minuteOfDay
            : a.day < b.day
              ? -1
              : 1
        );

        for (const sample of parsed) {
          const timestamp = localDateTimeToUtc(
            `${sample.day}T${sample.hhmm}`,
            tz
          );
          if (Number.isFinite(timestamp.getTime())) {
            hrvSamples.push({
              entry_date: sample.day,
              timestamp,
              rmssd_ms: sample.rmssd,
              device_name: 'Polar Device',
            });
          }
        }
      }

      if (hrvSamples.length > 0) {
        // A night straddles midnight, so each recharge record is a PARTIAL-day
        // write for both days it touches -- and consecutive nights therefore
        // share a day bucket (night N's morning samples and night N+1's evening
        // samples both land on day N). health_metric_samples keeps one row per
        // (user, metric, day, provider), so the default `replace` mode made the
        // later night wipe the earlier night's readings for that shared day.
        const times = hrvSamples.map((sample) => sample.timestamp.getTime());
        await upsertSamplesByDay(
          userId,
          createdByUserId,
          'hrv',
          POLAR_HEALTH_PROVIDER,
          hrvSamples,
          {
            mode: 'merge',
            window: {
              startMs: Math.min(...times),
              endMs: Math.max(...times),
            },
          }
        );
      }
    }
  }
}

/**
 * Processes Polar cardio load data.
 */
async function processPolarCardioLoad(
  userId: string,
  createdByUserId: string,
  cardioLoadData: unknown
) {
  const cardioList = Array.isArray(cardioLoadData)
    ? cardioLoadData
    : (
        cardioLoadData as {
          'cardio-loads'?: unknown[];
          cardio_loads?: unknown[];
        }
      )?.['cardio-loads'] ||
      (
        cardioLoadData as {
          'cardio-loads'?: unknown[];
          cardio_loads?: unknown[];
        }
      )?.cardio_loads ||
      [];
  if (!Array.isArray(cardioList) || cardioList.length === 0) return;

  for (const entry of cardioList) {
    if (!entry || typeof entry !== 'object') continue;
    const entryDate = getVal(entry, 'date');
    if (!entryDate) continue;

    const strain = toFiniteNumber(getVal(entry, 'strain'));
    const tolerance = toFiniteNumber(getVal(entry, 'tolerance'));
    const cardioLoadRatio = toFiniteNumber(
      getVal(entry, 'cardio-load-ratio') ?? getVal(entry, 'cardio_load_ratio')
    );

    if (strain !== null || tolerance !== null || cardioLoadRatio !== null) {
      await genericHealthRepository.upsertDailyHealthMetrics(
        userId,
        createdByUserId,
        {
          user_id: userId,
          entry_date: entryDate,
          source_provider: POLAR_HEALTH_PROVIDER,
          acute_training_load:
            strain !== null ? Math.round(strain * 100) / 100 : null,
          chronic_training_load:
            tolerance !== null ? Math.round(tolerance * 100) / 100 : null,
          acwr_ratio:
            cardioLoadRatio !== null
              ? Math.round(cardioLoadRatio * 100) / 100
              : null,
        }
      );
    }
  }
}

/**
 * Processes Polar continuous heart rate data.
 */
async function processPolarContinuousHeartRate(
  userId: string,
  createdByUserId: string,
  continuousHrData: unknown,
  userTz?: string
) {
  const hrList = Array.isArray(continuousHrData)
    ? continuousHrData
    : (
        continuousHrData as {
          continuous_heart_rates?: unknown[];
          'continuous-heart-rates'?: unknown[];
        }
      )?.['continuous-heart-rates'] ||
      (
        continuousHrData as {
          continuous_heart_rates?: unknown[];
          'continuous-heart-rates'?: unknown[];
        }
      )?.continuous_heart_rates ||
      (continuousHrData && typeof continuousHrData === 'object'
        ? [continuousHrData]
        : []);
  if (!Array.isArray(hrList) || hrList.length === 0) return;

  const tz = userTz || (await loadUserTimezone(userId));
  const hrSamples: FlatHealthSample[] = [];

  for (const dayItem of hrList) {
    if (!dayItem || typeof dayItem !== 'object') continue;
    const entryDate = getVal(dayItem, 'date');
    const samples =
      getVal(dayItem, 'heart-rate-samples') ??
      getVal(dayItem, 'heart_rate_samples') ??
      getVal(dayItem, 'samples');

    if (!entryDate || !Array.isArray(samples)) continue;

    for (const sample of samples) {
      if (!sample || typeof sample !== 'object') continue;
      const bpm = toFiniteNumber(
        getVal(sample, 'heart-rate') ??
          getVal(sample, 'heart_rate') ??
          getVal(sample, 'bpm') ??
          getVal(sample, 'value')
      );
      const sampleTime =
        getVal(sample, 'sample-time') ??
        getVal(sample, 'sample_time') ??
        getVal(sample, 'time');
      if (bpm === null || !sampleTime) continue;

      let timestamp: Date;
      if (String(sampleTime).includes('T')) {
        timestamp = new Date(parsePolarToUTC(sampleTime) ?? NaN);
      } else {
        // "HH:mm:ss" in local device time
        const timePart =
          String(sampleTime).length === 5
            ? `${sampleTime}:00`
            : String(sampleTime);
        timestamp = localDateTimeToUtc(
          `${entryDate}T${timePart.substring(0, 5)}`,
          tz
        );
      }

      if (Number.isFinite(timestamp.getTime())) {
        hrSamples.push({
          entry_date: entryDate,
          timestamp,
          bpm: Math.round(bpm),
          device_name: 'Polar Device',
        });
      }
    }
  }

  if (hrSamples.length > 0) {
    await upsertSamplesByDay(
      userId,
      createdByUserId,
      'heart_rate',
      POLAR_HEALTH_PROVIDER,
      hrSamples
    );
  }
}

/**
 * Processes Polar SpO2 spot test data.
 */
async function processPolarSpO2(
  userId: string,
  createdByUserId: string,
  spo2Data: unknown
) {
  const resultList = Array.isArray(spo2Data)
    ? spo2Data
    : (
        spo2Data as {
          'spo2-test-results'?: unknown[];
          spo2_test_results?: unknown[];
        }
      )?.['spo2-test-results'] ||
      (
        spo2Data as {
          'spo2-test-results'?: unknown[];
          spo2_test_results?: unknown[];
        }
      )?.spo2_test_results ||
      (spo2Data && typeof spo2Data === 'object' ? [spo2Data] : []);
  if (!Array.isArray(resultList) || resultList.length === 0) return;

  const tz = await loadUserTimezone(userId);
  const spo2Samples: FlatHealthSample[] = [];

  for (const item of resultList) {
    if (!item || typeof item !== 'object') continue;
    const testStatus =
      getVal(item, 'test-status') ?? getVal(item, 'test_status');
    // Inconclusive or failed tests must not be plotted as real readings
    if (testStatus && testStatus !== 'SPO2_TEST_PASSED') continue;

    const percentage = toFiniteNumber(
      getVal(item, 'blood-oxygen-percent') ??
        getVal(item, 'blood_oxygen_percent') ??
        getVal(item, 'percentage') ??
        getVal(item, 'spo2')
    );
    if (percentage === null) continue;

    const testTime =
      getVal(item, 'test-time') ??
      getVal(item, 'test_time') ??
      getVal(item, 'time') ??
      getVal(item, 'timestamp');

    let timestamp: Date;
    if (typeof testTime === 'number') {
      // Compare the raw value, not the multiplied one: Polar sends unix
      // SECONDS (spec example 1697787256), and `v * 1000 > 1e12` is true for
      // any seconds value after 2001, which then used the raw seconds as
      // milliseconds and dated every reading to January 1970.
      timestamp = new Date(testTime > 1e12 ? testTime : testTime * 1000);
    } else if (testTime) {
      timestamp = new Date(parsePolarToUTC(testTime) ?? NaN);
    } else {
      continue;
    }

    if (!Number.isFinite(timestamp.getTime())) continue;

    // Never bucket on the UTC day: a test at 01:00 in UTC+2 is 23:00 UTC the
    // day before and would land on the wrong day. The spec supplies
    // time_zone_offset (minutes) per test, which beats the account timezone
    // because it is where the device actually was; fall back to the user's zone.
    const offsetMinutes = toFiniteNumber(
      getVal(item, 'time-zone-offset') ?? getVal(item, 'time_zone_offset')
    );
    const entryDate =
      getVal(item, 'date') ||
      (offsetMinutes !== null
        ? new Date(timestamp.getTime() + offsetMinutes * 60_000)
            .toISOString()
            .slice(0, 10)
        : instantToDay(timestamp.toISOString(), tz));

    spo2Samples.push({
      entry_date: entryDate,
      timestamp,
      percentage: Math.round(percentage * 10) / 10,
      device_name: 'Polar Device',
    });
  }

  if (spo2Samples.length > 0) {
    await upsertSamplesByDay(
      userId,
      createdByUserId,
      'spo2',
      POLAR_HEALTH_PROVIDER,
      spo2Samples
    );
  }
}

/**
 * Processes Polar body temperature biosensing data.
 */
async function processPolarBodyTemperature(
  userId: string,
  createdByUserId: string,
  bodyTempData: unknown
) {
  const tempList = Array.isArray(bodyTempData)
    ? bodyTempData
    : (
        bodyTempData as {
          'body-temperatures'?: unknown[];
          body_temperatures?: unknown[];
        }
      )?.['body-temperatures'] ||
      (
        bodyTempData as {
          'body-temperatures'?: unknown[];
          body_temperatures?: unknown[];
        }
      )?.body_temperatures ||
      (bodyTempData && typeof bodyTempData === 'object' ? [bodyTempData] : []);
  if (!Array.isArray(tempList) || tempList.length === 0) return;

  const bodyTempTz = await loadUserTimezone(userId);
  const vitalsToInsert = [];

  for (const item of tempList) {
    if (!item || typeof item !== 'object') continue;

    // /v3/users/biosensing/bodytemperature returns measurement PERIODS, each
    // with an absolute start_time and a nested samples[] whose entries carry
    // only recording_time_delta_milliseconds. Expand those into absolute
    // readings; a flat item is still handled below for other shapes.
    const periodSamples = getVal(item, 'samples');
    const periodStart =
      getVal(item, 'start-time') ?? getVal(item, 'start_time');
    if (Array.isArray(periodSamples) && periodStart) {
      const startMs = new Date(parsePolarToUTC(periodStart) ?? NaN).getTime();
      if (Number.isFinite(startMs)) {
        for (const sample of periodSamples) {
          if (!sample || typeof sample !== 'object') continue;
          const celsius = toFiniteNumber(
            getVal(sample, 'temperature-celsius') ??
              getVal(sample, 'temperature_celsius')
          );
          const deltaMs =
            toFiniteNumber(
              getVal(sample, 'recording-time-delta-milliseconds') ??
                getVal(sample, 'recording_time_delta_milliseconds')
            ) ?? 0;
          if (celsius === null) continue;
          const sampleTime = new Date(startMs + deltaMs);
          if (!Number.isFinite(sampleTime.getTime())) continue;
          vitalsToInsert.push({
            user_id: userId,
            entry_date: instantToDay(sampleTime.toISOString(), bodyTempTz),
            timestamp: sampleTime,
            body_temperature_celsius: Math.round(celsius * 100) / 100,
            source_provider: POLAR_HEALTH_PROVIDER,
            device_name: 'Polar Device',
          });
        }
        continue;
      }
    }

    const tempCelsius = toFiniteNumber(
      getVal(item, 'temperature-celsius') ??
        getVal(item, 'temperature_celsius') ??
        getVal(item, 'body-temperature-celsius') ??
        getVal(item, 'body_temperature_celsius') ??
        getVal(item, 'temperature')
    );
    if (tempCelsius === null) continue;

    const timeVal =
      getVal(item, 'test-time') ??
      getVal(item, 'test_time') ??
      getVal(item, 'timestamp') ??
      getVal(item, 'time');
    const entryDate = getVal(item, 'date');

    let timestamp: Date;
    if (typeof timeVal === 'number') {
      // Seconds vs milliseconds: compare the raw value (see the note in
      // processPolarSpO2).
      timestamp = new Date(timeVal > 1e12 ? timeVal : timeVal * 1000);
    } else if (timeVal) {
      timestamp = new Date(parsePolarToUTC(timeVal) ?? NaN);
    } else if (entryDate) {
      timestamp = new Date(`${entryDate}T12:00:00Z`);
    } else {
      continue;
    }

    if (!Number.isFinite(timestamp.getTime())) continue;

    // Never fall back to the UTC day: a reading just after local midnight is
    // still the previous day in UTC and would bucket a day early.
    const resolvedDate =
      entryDate || instantToDay(timestamp.toISOString(), bodyTempTz);

    vitalsToInsert.push({
      user_id: userId,
      entry_date: resolvedDate,
      timestamp,
      body_temperature_celsius: Math.round(tempCelsius * 100) / 100,
      source_provider: POLAR_HEALTH_PROVIDER,
      device_name: 'Polar Device',
    });
  }

  if (vitalsToInsert.length > 0) {
    await genericHealthRepository.bulkUpsertVitals(
      userId,
      createdByUserId,
      vitalsToInsert
    );
  }
}

/**
 * Processes Polar skin temperature biosensing data.
 */
async function processPolarSkinTemperature(
  userId: string,
  createdByUserId: string,
  skinTempData: unknown
) {
  const tempList = Array.isArray(skinTempData)
    ? skinTempData
    : (
        skinTempData as {
          'skin-temperatures'?: unknown[];
          skin_temperatures?: unknown[];
        }
      )?.['skin-temperatures'] ||
      (
        skinTempData as {
          'skin-temperatures'?: unknown[];
          skin_temperatures?: unknown[];
        }
      )?.skin_temperatures ||
      (skinTempData && typeof skinTempData === 'object' ? [skinTempData] : []);
  if (!Array.isArray(tempList) || tempList.length === 0) return;

  const skinTempTz = await loadUserTimezone(userId);
  const skinSamples: FlatHealthSample[] = [];

  for (const item of tempList) {
    if (!item || typeof item !== 'object') continue;
    const celsius = toFiniteNumber(
      // Spec field is sleep_time_skin_temperature_celsius; the rest are
      // tolerated spellings.
      getVal(item, 'sleep-time-skin-temperature-celsius') ??
        getVal(item, 'sleep_time_skin_temperature_celsius') ??
        getVal(item, 'skin-temperature-celsius') ??
        getVal(item, 'skin_temperature_celsius') ??
        getVal(item, 'temperature-celsius') ??
        getVal(item, 'temperature_celsius') ??
        getVal(item, 'temperature')
    );
    const deviation = toFiniteNumber(
      getVal(item, 'deviation-from-baseline-celsius') ??
        getVal(item, 'deviation_from_baseline_celsius') ??
        getVal(item, 'deviation-celsius') ??
        getVal(item, 'deviation_celsius') ??
        getVal(item, 'deviation')
    );
    if (celsius === null && deviation === null) continue;

    const timeVal =
      getVal(item, 'test-time') ??
      getVal(item, 'test_time') ??
      getVal(item, 'timestamp') ??
      getVal(item, 'time');
    // Spec field is sleep_date (one value per night, not a series).
    const entryDate =
      getVal(item, 'sleep-date') ??
      getVal(item, 'sleep_date') ??
      getVal(item, 'date');

    let timestamp: Date;
    if (typeof timeVal === 'number') {
      // Seconds vs milliseconds: compare the raw value (see the note in
      // processPolarSpO2).
      timestamp = new Date(timeVal > 1e12 ? timeVal : timeVal * 1000);
    } else if (timeVal) {
      timestamp = new Date(parsePolarToUTC(timeVal) ?? NaN);
    } else if (entryDate) {
      timestamp = new Date(`${entryDate}T12:00:00Z`);
    } else {
      continue;
    }

    if (!Number.isFinite(timestamp.getTime())) continue;

    // Same as body temperature: bucket on the user's day, not the UTC day.
    const resolvedDate =
      entryDate || instantToDay(timestamp.toISOString(), skinTempTz);

    skinSamples.push({
      entry_date: resolvedDate,
      timestamp,
      celsius: celsius !== null ? Math.round(celsius * 100) / 100 : undefined,
      temperature_celsius:
        celsius !== null ? Math.round(celsius * 100) / 100 : undefined,
      deviation_celsius:
        deviation !== null ? Math.round(deviation * 100) / 100 : undefined,
      device_name: 'Polar Device',
    });
  }

  if (skinSamples.length > 0) {
    await upsertSamplesByDay(
      userId,
      createdByUserId,
      'skin_temperature',
      POLAR_HEALTH_PROVIDER,
      skinSamples
    );
  }
}

/**
 * Helper to convert ISO 8601 duration string (e.g., PT1H30M15S) to seconds.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function iso8601ToSeconds(duration: any) {
  if (!duration) return 0;
  const regex = /^PT(?:(\d{1,5})H)?(?:(\d{1,5})M)?(?:(\d{1,5})S)?$/;
  const matches = duration.match(regex);
  if (!matches) return 0;
  const hours = parseInt(matches[1] || 0);
  const minutes = parseInt(matches[2] || 0);
  const seconds = parseInt(matches[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}
export { processPolarExercises };
export { processPolarPhysicalInfo };
export { processPolarActivity };
export { processPolarSleep };
export { processPolarNightlyRecharge };
export { processPolarCardioLoad };
export { processPolarContinuousHeartRate };
export { processPolarSpO2 };
export { processPolarBodyTemperature };
export { processPolarSkinTemperature };
export default {
  processPolarExercises,
  processPolarPhysicalInfo,
  processPolarActivity,
  processPolarSleep,
  processPolarNightlyRecharge,
  processPolarCardioLoad,
  processPolarContinuousHeartRate,
  processPolarSpO2,
  processPolarBodyTemperature,
  processPolarSkinTemperature,
  resolvePolarActivityDate,
  resolvePolarActivitySteps,
};
