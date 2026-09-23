/**
 * Withings wraps every response as `{ status, body }`, and the arrays inside
 * `body` are deeply variable: which measure types, sleep stages and workout
 * fields are present depends on the devices the account owns. The integration
 * service only paginates and forwards those arrays -- the individual fields are
 * read in `integrations/withings/withingsDataProcessor.ts` -- so an opaque
 * record is an accurate description of what it handles, and it keeps the
 * pagination accumulators off `any`.
 */
interface WithingsPayloadRecord {
  [key: string]: unknown;
}

/**
 * A single reading inside a measure group. `type` selects the metric from
 * `WITHINGS_METRIC_MAPPING`, and `unit` is a power of ten applied to `value`.
 */
interface WithingsMeasure extends WithingsPayloadRecord {
  type: number;
  value: number;
  unit: number;
}

/**
 * A `measuregrps` entry from `/measure?action=getmeas`. Unlike the other
 * payloads this one is destructured field by field in the processor, so the
 * fields it reads are declared rather than left opaque.
 */
interface WithingsMeasureGroup extends WithingsPayloadRecord {
  category?: number;
  date?: number;
  timestamp?: number;
  // Not guaranteed: a malformed or partial group can omit it, so consumers
  // must narrow before iterating.
  measures?: WithingsMeasure[];
}

/** A `series` entry from `/v2/heart?action=list`. */
type WithingsHeartSeries = WithingsPayloadRecord;

/** A `series` entry from `/v2/sleep?action=get` or `action=getsummary`. */
type WithingsSleepSeries = WithingsPayloadRecord;

/** An `activities` entry from `/v2/measure?action=getactivity`. */
type WithingsActivity = WithingsPayloadRecord;

/** A `series` entry from `/v2/measure?action=getworkouts`. */
type WithingsWorkout = WithingsPayloadRecord;

export type {
  WithingsActivity,
  WithingsHeartSeries,
  WithingsMeasureGroup,
  WithingsSleepSeries,
  WithingsWorkout,
};

/**
 * The flattened measurement `upsertCustomMeasurementLogic` persists. It is
 * assembled in-process from a `WITHINGS_METRIC_MAPPING` entry plus one reading,
 * so unlike the raw payloads above its shape is fully known here.
 */
interface WithingsCustomMeasurement {
  categoryName: string;
  value: number;
  unit?: string;
  entryDate: string;
  entryHour: number;
  entryTimestamp: string;
  frequency?: string;
}

export type { WithingsCustomMeasurement };
