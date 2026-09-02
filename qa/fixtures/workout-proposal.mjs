/**
 * The routine the fake model proposes in qa/flows/workout-proposal.yaml, and
 * the words the flow and the stub exchange to get there.
 *
 * One file, three readers: the stub (qa/bin/qa-ai-stub.mjs) builds its tool
 * calls from it, the oracle (qa/oracles/workout-proposal.mjs) asserts the
 * saved preset against it, and the flow types USER_MESSAGE verbatim — which
 * the oracle cross-checks in the stub's request log, so the YAML cannot drift
 * from this file without the run saying so.
 *
 * The exercises are not fixed here. The proposal tool wants real exercise ids
 * and the stub has no database, so the stub does what the tool description
 * tells a real model to do: call sparky_search_exercises first and program the
 * exercises that come back. `pickExercises` is that choice, made deterministic
 * — the seeded catalog (qa/fixtures/exercise-catalog.mjs) has exactly two
 * chest exercises, and both are used, in name order.
 */

/** What the flow types. Carries "workout" so the keyword classifier routes it
 *  to the exercise tools without an LLM round trip. */
export const USER_MESSAGE = 'Build me a chest workout routine I can save';

/** The search the stub runs before proposing. */
export const SEARCH_QUERY = 'chest';

export const PROPOSAL_NAME = 'QA Chest Day';
export const PROPOSAL_DESCRIPTION = 'Two chest movements, proposed by the QA stub.';
export const PROPOSAL_RATIONALE = 'Both exercises target the chest and are in your library.';

/** Per-exercise programming, applied to the search hits in order. Metric, as
 *  the tool schema requires: kg and seconds. */
export const PROGRAMMING = [
  {
    sets: [
      { set_number: 1, set_type: 'Working Set', reps: 8, weight: 40, rest_time: 90 },
      { set_number: 2, set_type: 'Working Set', reps: 8, weight: 40, rest_time: 90 },
      { set_number: 3, set_type: 'Working Set', reps: 6, weight: 45, rest_time: 120 },
    ],
  },
  {
    sets: [
      { set_number: 1, set_type: 'Working Set', reps: 12, weight: 20, rest_time: 60 },
      { set_number: 2, set_type: 'Working Set', reps: 12, weight: 20, rest_time: 60 },
    ],
  },
];

/** Total sets across the proposal — the card's summary line reads this. */
export const TOTAL_SETS = PROGRAMMING.reduce((n, e) => n + e.sets.length, 0);

/** What the stub says once the user has accepted. */
export const ACCEPT_REPLY = 'Saved. QA Chest Day is in your workout presets.';

/**
 * Chooses which search hits to program: every hit whose name mentions the
 * search term, in name order, capped at the programming available.
 */
export function pickExercises(hits) {
  return hits
    .filter((e) => typeof e?.id === 'string' && typeof e?.name === 'string')
    .filter((e) => e.name.toLowerCase().includes(SEARCH_QUERY))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, PROGRAMMING.length);
}

/** The tool arguments for sparky_propose_workout_preset. */
export function buildProposal(exercises) {
  return {
    name: PROPOSAL_NAME,
    description: PROPOSAL_DESCRIPTION,
    rationale: PROPOSAL_RATIONALE,
    exercises: exercises.map((exercise, index) => ({
      exercise_id: exercise.id,
      exercise_name: exercise.name,
      modality: 'weight_reps',
      sort_order: index,
      sets: PROGRAMMING[index].sets,
    })),
  };
}
