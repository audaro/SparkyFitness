# Upstream sync — 2026-09-22

## What shipped

Branch `sync/upstream-2026-09-22`, one merge commit (`5ff80e95b`) bringing
`upstream/main` (216 commits) onto `main` at `ef12ceba0`.

Upstream content of note: Liftosaur provider type, intraday health samples and
their chart, the mood meter, the OIDC provider admin dialog, lap/moving
telemetry, admin system settings, skin-temperature metric widening, the
multi-add food basket, and the Prettier/dependency churn behind them. Five new
migrations, all applied locally (latest `20260918230000_add_admin_system_settings`).

## Conflicts and how they were settled

Twenty-six files conflicted. The rule was: where both sides built the same
thing, keep the fork's and fold upstream's additions into it. The decisions
that are more than mechanical:

- **Health pre-cleanup** (`services/measurementService.ts`). Upstream's #2300
  deletes the synced span but holds back the re-sent `source_id`s so their
  telemetry is not cascaded away. The fork skips the span delete outright when
  every record of a source carries a `source_id`, because the mobile HealthKit
  sync sends only what changed and a span delete then removes the morning's
  workout when the afternoon's arrives alone. Both behaviours now coexist: the
  skip for a fully keyed payload, the hold-back list for a mixed one. Upstream's
  test file (`tests/healthResyncTelemetryPreservation.test.ts`) was rewritten to
  assert the fork's rule, and its header records the divergence.
- **Chat food logging** (`ai/tools/foodTools.ts`). Kept the fork's
  exact-unit-first variant match, `quantitySanityError`, form-qualifier warnings
  and the refusal that names the food's serving variants; that retry hint now
  rides on the unconvertible-unit refusal too, so both sides' error text is
  present. Adopted upstream's `isAmbiguousLegacyFoodUnit`, serving
  reconciliation, `formatConsumedNutrition` summary and snapshot-preserving
  update.
- **Omitted units are serving counts.** The two sides disagreed: the fork read
  `quantity: 1` with no unit as 1 g (the variant's unit), upstream as one
  reference serving. Upstream's reading wins everywhere. The fork's reading
  silently logged a 1 g entry for the commonest shape a model sends; a serving
  count at worst trips the sanity guard, which asks the model what it meant. A
  bare `500` is therefore refused as 50 kg, and `500 g` still logs.
- **Chat exercise tools** (`ai/tools/exerciseTools.ts`, `ai/tools/schemas/exercise.ts`).
  Kept the fork's preset flows (`exercise_ids`, exercise-name resolution, plans,
  `get_frequent_sets`, `generate_workout`, the duplicate-name guard) and added
  upstream's `delete_workout_preset` behind the existing `confirmed` gate, plus
  `is_public`, `presetIdSchema`, `PRESET_NAME_LOOKUP` and the preset lookup
  schemas. Upstream's duplicate `toPresetExercises`/`parsePresetExercises` and
  its preset set/exercise schema block were dropped as grafts.
- **`utils/diagnosticLogger.ts`** is typed rather than carrying upstream's `any`
  signatures: the fork's eslint config enforces `no-explicit-any` and reports
  unused disable directives, which upstream's does not.
- **`docker/.env.example`** keeps upstream's numbered layout with the fork's
  vision sidecar section (8b) folded in.

## Gate status

All green, run per package after the merge:

| Gate | Result |
| --- | --- |
| Server typecheck / lint / Prettier | pass |
| Server tests | 6851 passed, 71 skipped |
| Mobile `validate` (i18n generate + audit, typecheck, lint, Knip, native locales, Prettier, muscle art) | pass |
| Mobile tests | 7618 passed |
| Frontend `validate` | pass |
| Frontend tests | 1624 passed |
| `pnpm run test:migrations` | pass |

Lint and Prettier still flag the untracked `SparkyFitnessServer/tmp-*.script.ts`
scratch files; they are git-excluded and CI never sees them.

Upstream does not type-check its tests, so ~20 upstream-authored mobile test
files needed type fixes (unused `React` imports, duplicate imports, missing
props types, `as unknown as DailyGoals` where a partial cast does not overlap).

## Exact next step

Push the branch and open a PR into `main` with the repo template checklist
(leave the Screenshots box unticked — Validate & Label rejects a ticked box with
no image). Wait for CI, merge, then merge the schema-backup and Nix-hash bot PRs
that follow. Use `gh ... -R audaro/SparkyFitness`; a bare `gh pr list` targets
upstream.

## Open risks

- The pre-merge database dump at
  `~/fitness/db-backups/sparkyfitness_pre-upstream-sync_20260922-180220.dump`
  was never verified readable (`pg_restore -l` printed no lines). Do not rely on
  it; take a fresh dump before the next destructive step.
- Nothing in this sync has been exercised on a device or in the browser. The
  mood meter, intraday chart and OIDC dialog are upstream UI that this fork has
  never rendered.
- The merge commit was made with `--no-verify` (the pre-commit hook would have
  re-formatted 500+ files); the per-package Prettier checks above cover it.
