# Handoff — Stated equipment in chat, unit-aware load steps, and the Swap chain

Branch `main`. Previous step: `docs/handoffs/workout-playback-entry-points.md`. All three fixes are
server/`shared/` only; no web or mobile code changed, and no API response contract moved.

## What shipped

| Commit      | Package         | What it did                                                                   |
| ----------- | --------------- | ----------------------------------------------------------------------------- |
| `683f0997c` | server + shared | Chat honours per-session equipment; loads step in the user's unit; Swap rotates |
| (this)      | docs            | This handoff                                                                  |

One commit rather than three because the service and its test carry all three changes in
interleaved hunks; the commit body separates them.

### The three fixes, and where each lives

1. **Chat proposed machines to "I have dumbbells and a bench".** `generate_workout` had no per-call
   equipment input, so the model used the active gym profile. `ai/tools/schemas/exercise.ts` adds
   `available_equipment` / `available_apparatus`; `ai/tools/exerciseTools.ts` resolves speech
   ("Dumbbells", "bodyweight", "ez bar") onto the canonical vocabulary and passes
   `GenerateOptions.equipmentOverride`, which replaces the profile's constraints for that call only.
   The stored row gets `gym_profile_id = null` because no profile was used. Prompt bullet in
   `prompts/chatbot-full-coaching.md`. **Never** route a one-off session through
   `set_active_gym_profile` / `create_gym_profile` — that deactivates the real gym for every later
   request.
2. **Loads like 60.1 lb and 22 lb.** Stack steps were a rounded 2.27 kg and pin-count × step drifts;
   now exactly `5 * KG_PER_LB` (`shared/src/utils/strengthMath.ts`). A pounds user
   (`user_preferences.default_weight_unit`) gets `IMPERIAL_EQUIPMENT_INCREMENT_KG` (5 lb for
   dumbbell/barbell/e-z bar/kettlebell) through the new required `GenerationOptions.incrementDefaultsKg`;
   a profile's `increment_kg` still wins; metric users are byte-identical. Cold starts snap onto the
   rack before the cap floors them.
3. **Swap alternated between the same two routines.** Deterministic engine + penalty on only the
   outgoing workout = A→B→A→B. New column `workout_recommendations.swap_excluded_exercise_ids`
   (`uuid[]`, migration `20260914120000`, never on the wire). Plain generate starts the chain at its
   own ids; Swap penalizes the whole chain and appends what it produced; a Swap that finds nothing new
   resets the chain to its own workout (`nextSwapHistory` in `services/workoutRecommendationService.ts`).
   Live on the maintainer's machine-preference pull day: 5 rounds, 5 distinct routines.

Also in the live database, outside git: 122 Fitbod catalog rows for TRX/BOSU/rings/GHD-class gear were
retagged from `["body only"]` to `["other"]` so a bodyweight-only request cannot pick a TRX row; the
git-excluded importer (`tmp-fitbod-catalog.script.ts`) now maps that gear to `other` on re-import.

## Gate status

| Gate                          | Result                                        |
| ----------------------------- | --------------------------------------------- |
| `tsc --noEmit` server         | clean                                         |
| `tsc --noEmit` web            | clean                                         |
| `tsc --noEmit` mobile         | clean                                         |
| `vitest run` server           | 313 files, 5168 passed, 2 skipped             |
| `eslint . --max-warnings 0`   | clean on tracked files                        |
| `prettier --check`            | clean on tracked files                        |
| Migration                     | applied at server boot; column verified live  |

`pnpm run validate` as a whole still exits non-zero on this machine because the git-excluded scratch
scripts (`tmp-*.script.ts`) are inside the `eslint .` / Prettier globs; nothing tracked is red.

## Migration checklist

Column-only change on an existing owner-only table: RLS (`create_owner_policy`), the security-tier
docs and the sharing docs are all unchanged and still correct. `shared/src/schemas/database/
WorkoutRecommendations.zod.ts` carries the new field; `db_schema_backup.sql` left for CI.

## Next step

Nothing queued from this work. Candidates, in order of what the user will notice next:

- Watch the reviewer: `.git/second-opinion/last-error.txt` is newer than `last-review.md`, so codex
  has not reviewed any of this. Re-run the marker once the ChatGPT plan is active.
- The mobile `videos` WIP diff in `SparkyFitnessMobile/src/services/api/exerciseApi.ts` and its test
  predates this session, sits uncommitted on top of `1a7d66905`, and was deliberately left alone.

## Open risks / skips

- Two concurrent Swaps race on the history read; the loser's ids drop out of the chain for one round
  and the next Swap re-unions the stored payload. Accepted; the upsert itself is one statement.
- Where a machine-preference gym has only two on-tier options for a muscle those two still alternate:
  the far-tier equipment penalty (−5) outweighs `swapPenalty` (−3) by design.
- Docker Desktop is not set to start at login; after a reboot the launchd server agent waits on
  Postgres until Docker is opened by hand.
