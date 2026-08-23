# Handoff — Fitbod blueprint W4 (workout generation)

Branch `feat/ai-coach`, unpushed. Plan: `~/fitness/FITBOD-BLUEPRINT.md`.

## What shipped

| Commit                                | Milestone                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `f6a5af71` (+ `4932872f`, `c6e10901`) | W2 — gym equipment profiles                                                                  |
| `e1d0472f`                            | W3 — muscle recovery model                                                                   |
| `23fb24d2`                            | W3 follow-up — fatigue window bounded at today; unperformed plan sets excluded               |
| `042d26b3`                            | W4.1/4.2 — `workout_recommendations` table + payload contract                                |
| `e6b164d6`                            | W4.3/4.5/4.6 — the deterministic generation engine (`shared/src/utils/workoutGeneration.ts`) |
| `0c7b2aba`                            | W4.4/4.7/4.8/4.9 — repository, service, routes, alternatives, tests                          |

`GET/POST /api/workout-recommendations`, `POST …/generate`, `GET …/alternatives/:exerciseId`,
`PATCH …/:id` are live. Generation is pure and deterministic; the service supplies `today` from
`todayInZone(tz)` and never calls `Date.now()` inside the engine.

## Gate status

`pnpm run validate` clean (tsc + eslint `--max-warnings 0` + prettier). Full server suite
**3941 passed | 2 skipped**. `23fb24d2` was verified green in isolation (detached worktree,
tsc clean, 3659 passed / 0 failed) so neither commit lands on a red gate.

W4 exit gate run live against the dev server on a throwaway account, seeded through the real
REST API rather than by writing rows, then deleted:

- **Plausible workout** — every target muscle served, compounds first, 38 min against a 60 min target.
- **Determinism** — two `POST /generate` calls and a `GET` hashed byte-identical (`fcbfcdf1a9f0f440`).
- **Swap / alternatives** — local candidates ranked above external padding (`Incline Bench Press` 7,
  `Dumbbell Fly` 4, externals 0).
- **Progression** — a lift with real history came back `3x10 @ 82.5kg`, "+2.5% from last session",
  warm-up ramp `8x37.5kg / 4x57.5kg`. That is 80 × 1.025 = 82 quantized up to a loadable barbell.

Two defects the live gate caught that the unit tests could not (they always used distinct
freshness values, so the tiebreak never decided anything) are fixed and now pinned by tests:

1. Muscle ranking fell through to an alphabetical tiebreak whenever freshness tied — which is
   most of the vector for a new or rested user — and produced abdominals/abductors/adductors/
   calves/glutes. Ties now break by muscle size.
2. The thin-catalog fallback imported upstream's first hit, but free-exercise-db matches primary
   **or** secondary muscles while the planner slots on the primary mover only. It now requires a
   primary match and pages `catalogImportSearchLimit` (50) deep to find one — the first primary
   triceps result is the 20th row, so the old `limit: 5` covered nothing at all for triceps or
   forearms.

## Exact next step

**W5 — mobile "Up Next" surface** (blueprint :450). Start with W5.1: add
`SparkyFitnessMobile/src/services/api/workoutRecommendationsApi.ts` in the `apiFetch` style of
`workoutPresetsApi.ts`, plus `src/hooks/useWorkoutRecommendation.ts` with a query key in
`src/hooks/queryKeys.ts`. Types come from `@workspace/shared`; the payload contract is already
exported. Then W5.3's `buildRecommendationStartPayload`, mirroring
`buildPresetStartExercisesPayload` (`src/utils/workoutSession.ts:1408`) — the blueprint is explicit
that no new session machinery is needed and `activeWorkoutStore` does not change.

## Open risks

- **`exercises` has no foreign key on `user_id`.** Deleting a user leaves orphan exercise rows, so
  the gate cleanup had to delete them explicitly. Pre-existing, not introduced here, but any future
  account-deletion work needs to know.
- **Pool safety.** `db/poolManager.ts` caps at `max: 10`. Per-exercise history is read in a
  sequential loop for that reason, pinned by a test asserting peak in-flight reads stays at 1.
  Anything that later fans these out with `Promise.all` will deadlock on a wide workout.
- **Band and bodyweight prescriptions carry a null weight.** The modality comes from the catalog
  category, so a band exercise is still `weight_reps`; there is no honest kilogram to print and the
  engine declines to invent one. Mobile must render that as a blank, not a zero.
- Recommendation rows are `UNIQUE (user_id)` — generating replaces the previous row rather than
  accumulating history. Intentional for v1; W7+ may want the history.
