import { MUSCLES, normalizeMuscleName } from "../constants/exerciseTaxonomy.ts";
import { daysBetween } from "./timezone.ts";

/**
 * Per-muscle recovery: how fresh each muscle is today, derived from logged
 * training volume rather than from anything the user has to tell us.
 *
 * The inputs are the `exercise_entries` muscle **snapshots** (what was trained,
 * as recorded at log time) joined to their set counts. Nothing here reads a
 * clock, a timezone, or the database: `today` is passed in by the caller, which
 * computes it with `todayInZone(tz)`. That is a tested contract, not a style
 * preference — the generation engine that consumes this must produce the same
 * "Up Next" on every app open, and Swap is only meaningful if the thing it
 * replaces was stable.
 *
 * Supersedes `services/reportService.ts` `calculateMuscleGroupRecovery`, which
 * is a bare last-trained-date map with no volume weighting and no decay. That
 * one stays where it is (it backs a report surface with its own response
 * contract); this is the model the engine uses.
 */

/** One logged exercise entry, reduced to what fatigue accounting needs. */
export interface MuscleFatigueInput {
  /** Calendar day the entry was logged against, YYYY-MM-DD. */
  entryDate: string;
  /** Canonical muscle strings — the entry's `primary_muscles` snapshot. */
  primaryMuscles: string[];
  /** Canonical muscle strings — the entry's `secondary_muscles` snapshot. */
  secondaryMuscles: string[];
  /**
   * Sets that count toward volume: everything except warm-ups, per
   * `isWarmupSetType`. Zero is normal and meaningful — a cardio entry or
   * an import has no sets, so it marks the muscle as trained without adding
   * fatigue.
   */
  workingSetCount: number;
}

/** A muscle's current recovery state. */
export interface MuscleFreshness {
  /** Canonical muscle string. */
  muscle: string;
  /** 0 = fully fatigued, 1 = fully fresh. */
  freshness: number;
  /** Decayed primary-equivalent working sets standing against this muscle. */
  fatigueSets: number;
  /** Most recent day this muscle appeared in a logged entry, or null. */
  lastTrained: string | null;
}

/**
 * The model's four constants, in one place so tests and the engine cannot
 * drift from each other.
 *
 * `halfLifeDays: 2` against `fullFatigueSets: 10` is what makes the numbers
 * behave like a training week: 10 hard primary sets today reads as fully
 * fatigued, ~70% recovered two days later, and effectively clear inside a
 * week. `windowDays: 14` is then generous rather than load-bearing — at seven
 * half-lives an entry retains 0.8% of its fatigue — so the window exists to
 * bound the query, not to shape the score.
 */
export const RECOVERY_TUNABLES = {
  /** How far back the server reads history. */
  windowDays: 14,
  /** Fatigue halves every this many days. */
  halfLifeDays: 2,
  /** A secondary muscle absorbs this fraction of a set. */
  secondaryWeight: 0.5,
  /** Decayed primary-equivalent sets at which freshness bottoms out at 0. */
  fullFatigueSets: 10,
} as const;

interface Accumulator {
  fatigueSets: number;
  lastTrained: string | null;
}

/**
 * Fatigue remaining from a session `ageDays` old: `0.5 ^ (age / halfLife)`.
 *
 * Future-dated entries are clamped to age 0 rather than extrapolated. A
 * negative age would send the exponential the other way — an entry dated one
 * week ahead would count for 11x its real volume and zero out every muscle it
 * touched. Future dates are reachable in practice (a user logging a planned
 * session, or a client a timezone ahead of the one `today` was computed in), so
 * the clamp is a guard against a real input, not a theoretical one.
 */
function decayFactor(ageDays: number): number {
  const age = Math.max(0, ageDays);
  return Math.pow(0.5, age / RECOVERY_TUNABLES.halfLifeDays);
}

/**
 * Per-entry muscle weights, primary winning over secondary.
 *
 * An exercise can name the same muscle in both snapshot columns (hand-entered
 * rows do this, and a few catalog imports do too). Summing both would charge it
 * 1.5 sets; taking the maximum charges it the 1.0 it earned.
 */
function weightedMuscles(input: MuscleFatigueInput): Map<string, number> {
  const weights = new Map<string, number>();
  for (const raw of input.secondaryMuscles) {
    weights.set(normalizeMuscleName(raw), RECOVERY_TUNABLES.secondaryWeight);
  }
  for (const raw of input.primaryMuscles) {
    weights.set(normalizeMuscleName(raw), 1);
  }
  return weights;
}

/**
 * Current freshness for every muscle in `muscles` (default: the whole canonical
 * vocabulary), given a window of logged entries.
 *
 * Accounting, per entry: each primary muscle accrues `workingSetCount`, each
 * secondary accrues `workingSetCount × secondaryWeight`, and the whole entry is
 * scaled by {@link decayFactor} for its age. Summing across entries gives
 * `fatigueSets`, and `freshness = 1 − min(1, fatigueSets / fullFatigueSets)`.
 *
 * `lastTrained` tracks the latest day a muscle appears at all, independent of
 * volume — a muscle can be freshly trained and still score 1.0 if the entry
 * logged no sets. That split is deliberate: it lets the engine say "trained
 * yesterday, but only cardio" instead of guessing. Cardio-driven fatigue needs
 * a signal sets do not carry (Garmin's `training_readiness_score`) and is a
 * later refinement.
 *
 * Muscles with no history come back `freshness: 1, lastTrained: null` rather
 * than being omitted, so callers get a complete, fixed-shape vector.
 *
 * Throws if any `entryDate` is not a `YYYY-MM-DD` day string. That is the one
 * loud failure here, and it is deliberate: a date we cannot place is not a date
 * we can safely treat as "today", and silently scoring it that way would
 * inflate fatigue against a muscle for a reason nobody could trace. Callers
 * reading from the database are responsible for excluding null/garbage dates —
 * the repository's query does.
 *
 * Results are returned in the order `muscles` gives them, de-duplicated.
 * Ranking is the caller's job — see the service's freshest-first sort.
 */
export function computeMuscleFreshness(
  inputs: readonly MuscleFatigueInput[],
  today: string,
  muscles: readonly string[] = MUSCLES,
): MuscleFreshness[] {
  const wanted: string[] = [];
  const accumulators = new Map<string, Accumulator>();
  for (const raw of muscles) {
    const muscle = normalizeMuscleName(raw);
    if (accumulators.has(muscle)) continue;
    wanted.push(muscle);
    accumulators.set(muscle, { fatigueSets: 0, lastTrained: null });
  }

  for (const input of inputs) {
    // A malformed count must not poison the whole vector with NaN; an entry we
    // cannot score still counts as having trained the muscle.
    const sets =
      Number.isFinite(input.workingSetCount) && input.workingSetCount > 0
        ? input.workingSetCount
        : 0;
    const decay = decayFactor(daysBetween(input.entryDate, today));

    for (const [muscle, weight] of weightedMuscles(input)) {
      const accumulator = accumulators.get(muscle);
      // Outside the requested vocabulary (a custom exercise's free-text
      // muscle, say) — not an error, just nothing to report it against.
      if (!accumulator) continue;
      accumulator.fatigueSets += sets * weight * decay;
      if (
        accumulator.lastTrained === null ||
        input.entryDate > accumulator.lastTrained
      ) {
        accumulator.lastTrained = input.entryDate;
      }
    }
  }

  return wanted.map((muscle) => {
    const { fatigueSets, lastTrained } = accumulators.get(muscle)!;
    return {
      muscle,
      freshness:
        1 - Math.min(1, fatigueSets / RECOVERY_TUNABLES.fullFatigueSets),
      fatigueSets,
      lastTrained,
    };
  });
}
