-- exercise_entry_laps has no moving-time or moving-speed columns, so the "Avg
-- Moving Pace" column in the lap table is permanently N/A for every stored
-- workout, even though the data already flows through this codebase and is
-- discarded on the way in:
--   * Garmin FIT sets dto.movingDuration / dto.averageMovingSpeed from
--     LapMesg.totalTimerTime (integrations/garminfit/fitActivityTransform.ts),
--     but extractGarminLaps() never reads either field.
--   * Garmin Connect's lapDTOs carry the same two fields; also unread.
--   * Strava's lap.moving_time is read only as a duration *fallback*
--     (stravaTelemetryExtractors.ts), never captured as its own value.
--   * HealthKit/Health Connect laps are derived server-side from the GPS
--     track (services/workoutTelemetryDerivation.ts deriveLaps()), which
--     already computes avg_speed_mps from point speeds and can compute a
--     moving-time-filtered version the same way.
--
-- exercise_entries already has moving_time_seconds / avg_moving_speed_mps at
-- the whole-workout level (20260730000000_create_generic_health_and_workout_
-- tables.sql); this adds the same two fields at lap granularity so the schema
-- stays symmetric. Precision matches the existing avg_speed_mps /
-- max_speed_mps columns on this table.

ALTER TABLE exercise_entry_laps
  ADD COLUMN IF NOT EXISTS moving_time_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS avg_moving_speed_mps NUMERIC(6, 2);
