# Ceiling-aware progression and the open-ended final set

*2026-09-22, branch `feat/hold-timer`*

## What shipped

Workout generation now keeps progressing once an exercise hits the heaviest load the active gym profile owns, instead of holding the same weight and reps forever.

- `shared/src/utils/workoutGeneration.ts`: `isAtLoadCeiling` detects that the next equipment step would not change the capped load. When it fires, `prescribeSets` keeps the weight and progresses reps (step 2 up to 20 for hypertrophy; step 1 up to 8 for strength), then sets (up to 5), then reports `outgrown`. Two short sessions in a row deload reps (`fewer-reps`). Reps-only and bodyweight exercises use the same path. The last working set of every hypertrophy dumbbell/machine/bodyweight exercise is stamped with the canonical `Failure` set type (`OPEN_FINAL_SET_TYPE`) so the user takes it as far as they can; barbell and strength-goal exercises are excluded. `dropLastWorkingSet` re-stamps the previous set when the fitter removes it.
- `rationaleFor` says what happened: "at this gym's max load — reps up to 12", "— adding a set", "outgrown this gym's max load — try a harder variation".
- `SparkyFitnessServer/services/workoutRecommendationService.ts`: a chat session-equipment override that names a subset of the profile's equipment keeps the profile's `load_limits`; an override with equipment the profile lacks still drops them.
- Data: the user's Home profile now has `load_limits = {"dumbbell": {"max_kg": 13.61}}` (30 lb). No migration.

## Gate status

- Server: `tsc --noEmit` clean; `pnpm test` 6607 passing. `betterAuthSchemaCheck.integration.test.ts` fails under the parallel full run and passes alone (pre-existing flake). `pnpm run validate` lint fails only on git-excluded `tmp-*.script.ts` files.
- Mobile and frontend: `tsc --noEmit` clean; frontend `UpNextCard` jest green.
- End-to-end: a real generation for the user produced Stiff-Legged Dumbbell Deadlift 3x10 @ 30 lb "at this gym's max load" (history was 35 lb, so the engine dropped to the cap and held; rep progression starts next session), Dumbbell Squat +25%, and every last set marked Failure. The stored recommendation row was restored afterwards.

## Next step

- Phase 3 (not built): when an exercise is `outgrown`, swap to a harder variation automatically instead of only saying so in the card.
- Check on device that the exercise sheet shows the Failure chip for plan sets (mapping is in `workoutSession.ts`).
- The dev server does not watch `shared/`; restart it after any shared change.

## Open risks

- Rep progression for reps-only exercises has no upper bound beyond the goal ceiling; very easy bodyweight moves will climb to 20 reps and 5 sets before `outgrown`.
- The ceiling test uses a 0.005 kg tolerance around `capLoadKg`; a profile `max_kg` stored with more than 2 dp could sit just off a step boundary.
- Users who never set a heaviest dumbbell get the old behaviour (weight keeps climbing) with no hint to set one.
