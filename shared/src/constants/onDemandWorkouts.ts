import { MUSCLE_SPLIT_MEMBERS, type Muscle } from "./exerciseTaxonomy.ts";

/**
 * A named bundle of generate parameters — one tap for a workout the user did
 * not have to describe.
 *
 * Deliberately NOT a content library and deliberately not a table: every field
 * is a parameter `POST /api/workout-recommendations/generate` already accepts,
 * so a theme adds no backend, no migration, and no authored exercise lists. The
 * engine still programs the session, and the user's gym profile still filters
 * it — a theme only says how long and around what.
 */
export interface OnDemandWorkout {
  /** Stable key. Used for React keys, test ids and the pending-row marker. */
  readonly id: string;
  readonly name: string;
  /** One line saying what the session is for, not what it contains. */
  readonly description: string;
  readonly duration_minutes: number;
  /**
   * Canonical muscles the session is built around.
   *
   * **Omitted, never `[]`, when the theme has no muscle constraint.**
   * `target_muscles` is `.min(1)` on the wire, so an empty array is a 400, and
   * omitting the field is a genuinely different request from naming every
   * muscle: the first tracks recovery, the second overrides it.
   */
  readonly target_muscles?: readonly Muscle[];
}

/**
 * The themes offered under "On Demand" on the Up Next swap sheet.
 *
 * Chosen to be the things the Pick Muscles list *cannot* say. That screen names
 * a split and lets duration fall back to the coach profile, so a theme earns
 * its row by pinning a session length ("I have twenty minutes") or by naming a
 * muscle combination that is not a split (arms, core, chest and back). Where a
 * theme does line up with a split it resolves through `MUSCLE_SPLIT_MEMBERS`
 * rather than repeating the members, so the two lists cannot drift.
 *
 * Ordered shortest-first: the reason to open this list at all is usually that
 * time is short.
 */
export const ON_DEMAND_WORKOUTS: readonly OnDemandWorkout[] = [
  {
    id: "quick-burn",
    name: "Quick Burn",
    // The only theme with no muscle constraint: with this little time, letting
    // the engine spend it on whatever is freshest beats overriding it.
    description: "Twenty minutes on whatever is freshest today",
    duration_minutes: 20,
  },
  {
    id: "core",
    name: "Core",
    description: "Twenty minutes of abs and lower back",
    duration_minutes: 20,
    target_muscles: ["abdominals", "lower back"],
  },
  {
    id: "arms",
    name: "Arms & Shoulders",
    description: "Half an hour on biceps, triceps, forearms and shoulders",
    duration_minutes: 30,
    target_muscles: ["biceps", "triceps", "forearms", "shoulders"],
  },
  {
    id: "lunch-break",
    name: "Lunch Break",
    description: "Half an hour, full body",
    duration_minutes: 30,
    target_muscles: MUSCLE_SPLIT_MEMBERS["full body"],
  },
  {
    id: "chest-and-back",
    name: "Chest & Back",
    description: "Forty-five minutes of pressing and pulling",
    duration_minutes: 45,
    target_muscles: ["chest", "lats", "middle back"],
  },
  {
    id: "leg-day",
    name: "Leg Day",
    description: "An hour on everything below the waist",
    duration_minutes: 60,
    target_muscles: MUSCLE_SPLIT_MEMBERS["lower body"],
  },
  {
    id: "upper-body",
    name: "Upper Body",
    description: "An hour on everything above the waist",
    duration_minutes: 60,
    target_muscles: MUSCLE_SPLIT_MEMBERS["upper body"],
  },
  {
    id: "long-haul",
    name: "Long Haul",
    description: "Ninety minutes, full body, no rush",
    duration_minutes: 90,
    target_muscles: MUSCLE_SPLIT_MEMBERS["full body"],
  },
];

/**
 * The generate request body a theme stands for.
 *
 * Builds the object conditionally rather than assigning `undefined`, because
 * the request schema is `.strict()` with a `.min(1)` array: a theme with no
 * muscle constraint has to send a body with no `target_muscles` key at all.
 */
export function onDemandGenerateRequest(theme: OnDemandWorkout): {
  duration_minutes: number;
  target_muscles?: Muscle[];
} {
  return theme.target_muscles
    ? {
        duration_minutes: theme.duration_minutes,
        target_muscles: [...theme.target_muscles],
      }
    : { duration_minutes: theme.duration_minutes };
}
