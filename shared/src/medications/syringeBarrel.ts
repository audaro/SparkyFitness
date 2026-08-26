/**
 * The geometry behind the syringe picture.
 *
 * A number of units is easy to misread and hard to picture; a barrel filled to a mark is not.
 * Both platforms draw that barrel, so the part they must agree on — where the marks sit, which
 * ones carry a printed number, and how far up the fill goes — lives here rather than twice in
 * two different SVG dialects.
 *
 * Everything is expressed as a **fraction of the barrel**, 0 at the needle end and 1 at the
 * plunger stop, so a renderer can lay it out horizontally or vertically at any size without
 * doing arithmetic of its own. Nothing here knows about pixels.
 */

import { SYRINGE_UNITS_PER_ML, type SyringeStandard } from "./reconstitution.ts";

/** One mark on the barrel. */
export interface SyringeBarrelTick {
  /** The mark's value in syringe units. */
  units: number;
  /** Where it sits along the barrel: 0 at the needle end, 1 at full capacity. */
  position: number;
  /**
   * Whether this mark carries a printed number. Real barrels number a minority of their marks
   * and the rest are bare; numbering all of them would be unreadable at any size that fits in
   * a form.
   */
  labelled: boolean;
}

export interface SyringeBarrel {
  /** The barrel this was scaled to, in marks. */
  capacityUnits: number;
  /** The draw as asked for, unclamped — what the user should read on the barrel. */
  units: number;
  /**
   * How full to draw the barrel, 0 to 1. **Clamped**: a draw that does not fit renders as a
   * full barrel rather than as paint past the end of it. Read `overCapacity` to find out that
   * the picture is a floor rather than the answer.
   */
  fill: number;
  /**
   * The draw is larger than the barrel holds. `reconstitute()` already returns a warning saying
   * so in words; this is the same fact in a form the picture can act on.
   */
  overCapacity: boolean;
  /** Marks from the needle end to the plunger stop, ascending. Always includes 0 and capacity. */
  ticks: SyringeBarrelTick[];
}

/**
 * Candidate spacings for the numbered marks. Deliberately a fixed ladder rather than a formula:
 * a barrel numbered every 7 units is arithmetically fine and useless to read against.
 */
const NICE_MAJOR_STEPS = [1, 2, 5, 10, 20, 25, 50, 100] as const;

/** Numbered marks to aim for. Fewer looks empty; more will not fit at a form's width. */
const MAX_LABELLED_INTERVALS = 10;

/** Bare marks between each pair of numbered ones, as on a real barrel. */
const MINOR_TICKS_PER_MAJOR = 5;

/**
 * The spacing of the numbered marks: the smallest nice step that divides the barrel into at most
 * `MAX_LABELLED_INTERVALS` intervals. A 100-unit barrel gets one every 10, a 40-unit barrel one
 * every 5 — which is how both are actually printed.
 */
function majorStepFor(capacityUnits: number): number {
  for (const step of NICE_MAJOR_STEPS) {
    if (capacityUnits / step <= MAX_LABELLED_INTERVALS) return step;
  }
  // A barrel too large for the ladder still has to be drawn: fall back to ten even intervals.
  return capacityUnits / MAX_LABELLED_INTERVALS;
}

/**
 * Where the marks sit and how far up the fill goes, for one answer from `reconstitute()`.
 *
 * `capacityUnits` should come from the result's own `syringeCapacityUnits` rather than from the
 * standard, so a caller that asked for a non-default barrel gets that barrel drawn. It falls back
 * to one full mL of the given standard, which is what `reconstitute()` itself assumes.
 *
 * Returns `null` for input it cannot draw honestly — a negative draw, or a capacity that is not a
 * positive finite number. A blank space where the picture was is recoverable; a barrel drawn to a
 * scale nobody can name is not.
 */
export function syringeBarrel(
  units: number,
  syringe: SyringeStandard,
  capacityUnits?: number,
): SyringeBarrel | null {
  const capacity = capacityUnits ?? SYRINGE_UNITS_PER_ML[syringe];
  if (!Number.isFinite(capacity) || capacity <= 0) return null;
  if (!Number.isFinite(units) || units < 0) return null;

  const majorStep = majorStepFor(capacity);
  const minorStep = majorStep / MINOR_TICKS_PER_MAJOR;

  const ticks: SyringeBarrelTick[] = [];
  // Counting in steps rather than accumulating avoids the drift that would put the last mark
  // just short of the end of a barrel it is supposed to sit exactly on.
  const count = Math.round(capacity / minorStep);
  for (let i = 0; i <= count; i += 1) {
    const tickUnits = Math.min((i * capacity) / count, capacity);
    ticks.push({
      units: tickUnits,
      position: tickUnits / capacity,
      labelled: i % MINOR_TICKS_PER_MAJOR === 0,
    });
  }

  return {
    capacityUnits: capacity,
    units,
    fill: Math.min(units / capacity, 1),
    overCapacity: units > capacity,
    ticks,
  };
}
