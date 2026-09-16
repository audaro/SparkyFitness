import {
  EXPERIENCE_LEVELS,
  projectMuscleGain,
  projectionSexFrom,
  todayInZone,
  type ExperienceLevel,
  type MuscleGainProjection,
  type MuscleGainProjectionResponse,
  type ProjectionRange,
} from '@workspace/shared';
import coachProfileRepository from '../models/coachProfileRepository.js';
import measurementRepository from '../models/measurementRepository.js';
import userRepository from '../models/userRepository.js';
import weeklySetTargetService from './weeklySetTargetService.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';

/**
 * Assembles the inputs to the lean-mass projection and hands back what the
 * card renders.
 *
 * The arithmetic all lives in `@workspace/shared`'s `muscleGainProjection`,
 * which is pure and tested against the studies it is anchored on. This file
 * exists only to answer the four questions that need a database: how heavy is
 * the user, what sex are they, how experienced, and how reliably have they
 * been hitting their weekly targets.
 *
 * The stated dose never leaves this module. `coach_profiles.enhancement` is
 * read here, turned into kilograms, and reported to the client as a boolean —
 * see `muscleGainProjectionResponseSchema`.
 */

/** Default horizon, and the bounds a caller may ask within. */
export const DEFAULT_HORIZON_WEEKS = 12;
export const MIN_HORIZON_WEEKS = 1;
export const MAX_HORIZON_WEEKS = 104;

/**
 * Completed weeks the adherence average looks back over.
 *
 * Four, because that is a training block: one bad week inside a good month
 * should move the estimate, not define it, and a window long enough to include
 * a holiday from six months ago would describe someone the user no longer is.
 */
export const ADHERENCE_WINDOW_WEEKS = 4;

/**
 * The latest weigh-in as kilograms, or null when there is nothing usable.
 *
 * `check_in_measurements.weight` is NUMERIC, which node-postgres would hand
 * back as a string were it not for the global parser in `db/poolManager.ts`;
 * the coercion here does not depend on that parser staying registered. Stored
 * in kilograms whatever the user's display unit is, so there is no conversion
 * to do. Anything absent, zero or negative is "unknown", which the projection
 * reports as a gap rather than guessing around.
 */
function bodyweightKgFrom(
  row: { weight?: unknown } | null | undefined
): number | null {
  const raw = row?.weight;
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The stated experience level, or null.
 *
 * `coach_profiles.experience_level` is plain TEXT with no CHECK constraint —
 * the vocabulary is enforced by Zod at the write paths — so a row written by
 * an older or future version can hold a token outside it. The response schema
 * pins the enum, and parsing it would turn such a row into a 500 on a read-only
 * endpoint. Unrecognised reads as unstated, which is what the projection
 * already does with it.
 */
function statedExperienceLevel(value: unknown): ExperienceLevel | null {
  return typeof value === 'string' &&
    (EXPERIENCE_LEVELS as readonly string[]).includes(value)
    ? (value as ExperienceLevel)
    : null;
}

function toRange(value: ProjectionRange | null) {
  return value === null ? null : { low_kg: value.lowKg, high_kg: value.highKg };
}

/**
 * Mean weekly-target completion over the recent past.
 *
 * Reads the same weekly summary the "This week" ring renders, because "staying
 * on top of my weekly exercise goals" is exactly that number and a second
 * definition of adherence would eventually disagree with the one the user can
 * see.
 *
 * **Completed weeks only.** The current week is excluded: it is partial by
 * definition, and averaging a Tuesday into the mean would report every user as
 * slipping every Monday and recovering by Saturday.
 *
 * When nothing was logged in the window at all, there is no adherence to
 * measure. That is reported as `no_history` rather than as zero — a user who
 * has just answered the questionnaire has not failed at anything, and a
 * projection of +0.0 kg would be both discouraging and untrue.
 */
async function measureAdherence(userId: string): Promise<{
  adherence: number;
  basis: 'measured' | 'no_history';
  weeks: number;
}> {
  const summary = await weeklySetTargetService.getWeeklySetTargets(
    userId,
    ADHERENCE_WINDOW_WEEKS
  );
  const weeks = summary.history;
  const anythingLogged = weeks.some((week) =>
    week.groups.some((group) => group.completed > 0)
  );
  if (weeks.length === 0 || !anythingLogged) {
    return { adherence: 1, basis: 'no_history', weeks: 0 };
  }
  const total = weeks.reduce((sum, week) => sum + week.overall_percent, 0);
  return {
    adherence: total / weeks.length,
    basis: 'measured',
    weeks: weeks.length,
  };
}

async function getMuscleGainProjection(
  userId: string,
  horizonWeeks: number
): Promise<MuscleGainProjectionResponse> {
  const weeks = Math.min(
    MAX_HORIZON_WEEKS,
    Math.max(
      MIN_HORIZON_WEEKS,
      Number.isFinite(horizonWeeks)
        ? Math.round(horizonWeeks)
        : DEFAULT_HORIZON_WEEKS
    )
  );

  const timezone = await loadUserTimezone(userId);
  const today = todayInZone(timezone);

  const [profile, identity, measurements, adherence] = await Promise.all([
    coachProfileRepository.getCoachProfile(userId),
    userRepository.getUserProfile(userId),
    // Bodyweight is stored in kilograms whatever the user's display unit is,
    // so it needs no conversion here; the client converts for display.
    measurementRepository.getLatestCheckInMeasurementsOnOrBeforeDate(
      userId,
      today
    ),
    measureAdherence(userId),
  ]);

  const bodyweightKg = bodyweightKgFrom(measurements);
  const sex = projectionSexFrom(identity?.gender ?? null);
  const experienceLevel = statedExperienceLevel(profile?.experience_level);

  const projection: MuscleGainProjection = projectMuscleGain({
    sex,
    experienceLevel,
    bodyweightKg,
    adherence: adherence.adherence,
    enhancement: profile?.enhancement ?? null,
    horizonWeeks: weeks,
  });

  return {
    horizon_weeks: projection.horizonWeeks,
    projection: {
      natural_kg: toRange(projection.naturalKg),
      enhanced_kg: toRange(projection.enhancedKg),
      total_kg: toRange(projection.totalKg),
      per_month_kg: toRange(projection.perMonthKg),
      at_full_adherence_kg: toRange(projection.atFullAdherenceKg),
      unmodelled: [...projection.unmodelled],
      sources: [...projection.sources],
    },
    inputs: {
      sex,
      experience_level: experienceLevel,
      bodyweight_kg: bodyweightKg,
      adherence: adherence.adherence,
      adherence_basis: adherence.basis,
      adherence_weeks: adherence.weeks,
      // A boolean, never the dose. The card only has to say whether the
      // estimate includes one.
      enhancement_stated: projection.enhancedKg !== null,
    },
  };
}

export { getMuscleGainProjection, measureAdherence };

export default {
  getMuscleGainProjection,
  DEFAULT_HORIZON_WEEKS,
  MIN_HORIZON_WEEKS,
  MAX_HORIZON_WEEKS,
  ADHERENCE_WINDOW_WEEKS,
};
