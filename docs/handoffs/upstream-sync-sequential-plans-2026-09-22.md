# Upstream sync: sequential workout plan progression (2026-09-22)

## What shipped

`sync/upstream-sequential-plans` merges 8 upstream commits (CodeWithCJ PR #2558,
upstream head `c67ce90a8`) into the fork as merge commit `17ee5d1b1`. They add a
`sequential` `schedule_type` to workout plan templates: a plan can be a numbered
sequence of sessions the user advances through rather than a fixed weekly grid,
plus an `entry_mode` that either prefills the diary or prompts at start time.

This is the second sync of the day; see `upstream-sync-2026-09-22.md` for the
216-commit merge that preceded it and left the fork 8 behind.

New migration: `20260921140000_add_sequential_workout_plan_mode.sql`
(`schedule_type` / `entry_mode` on `workout_plan_templates`, `session_index` /
`session_name` on `workout_plan_template_assignments`, `day_of_week` made
nullable, two CHECK constraints, one index). Applied locally — id 248 in
`system.schema_migrations`. Existing rows take `weekly` / `prefill`; the column
defaults for *new* rows are `sequential` / `prompt`.

## Conflicts and how they were settled

Eight conflicts. Six were mechanical; two were real divergences.

1. **`SparkyFitnessMobile/src/screens/DiaryScreen.tsx`** — upstream defines a
   ~100-line `handleStartPlanAssignment` beside the exercise list it renders on
   its Diary screen. This fork shows logged exercise on the Exercise tab and
   deliberately keeps the Diary screen free of an exercise list, so the handler
   was lifted into a new hook, **`src/hooks/useStartPlanAssignment.ts`**, and
   `ExerciseHomeScreen` passes it to `<ExerciseSummary onPressPlanAssignment>`.
   The Diary screen keeps only `useActiveWorkoutPlans`, which its empty-day
   check still needs. `makeDefaultStartSet` in `utils/workoutSession.ts` had to
   be exported for it.
2. **`ActiveWorkoutScreen.tsx`** (4 hunks) — abandon paths keep this fork's
   `clearActiveWorkout(queryClient, 'abandoned')`, which also releases the
   stored recommendation, rather than upstream's bare `clearWorkout()`. The
   no-session fallback navigates to the **Exercise** tab; upstream's `'Diary'`
   is not a tab name in this fork, and the Exercise tab is where the workout
   would be listed.
3. **`hooks/queryKeys.ts` / `hooks/invalidateExerciseCache.ts`** — all of the
   fork's keys plus upstream's `activeWorkoutPlanQueryKey`; upstream's unused
   `['activeWorkoutPlan']` invalidation was dropped with a comment.
4. **`hooks/useStartLiveWorkout.ts`** — the options type carries both the fork's
   `sourceRecommendationId` and upstream's `workoutPlanAssignmentId`, and
   `StartLiveWorkoutNavigation` is now exported for the new hook.
5. **`models/workoutPlanTemplateRepository.ts` / `services/workoutPlanTemplateService.ts`** —
   took upstream's typed signatures throughout and its extracted
   `validateAndNormalizeAssignments`, which is a superset of the checks this
   fork had inline (it adds the weekly `day_of_week` validation and the
   sequential null-out). The one thing kept from this side is
   `Number(assignment.workout_preset_id)`, because this fork's
   `getWorkoutPresetById` still takes a `number`.
6. **`docs/src/developer/database-security-tiers.md`** — both sides' table rows.

Two further breakages surfaced only in the gates, both from clean auto-merges:

- **`ai/tools/exerciseTools.ts`** declared its own stricter `WorkoutPlanRow` /
  `WorkoutPlanAssignmentRow`; the repository now publishes row types whose ids
  are `number | string` and whose `day_of_week` is nullable (a sequential
  assignment has none). The local copies were replaced by the published type
  and the projection made null-tolerant.
- **`SparkyFitnessFrontend/src/pages/Diary/ExerciseCard.tsx`** was grafted:
  upstream's plan-session start navigated to `/workout-playback` with a draft in
  route state, using a `navigate` and a helper this fork's component does not
  import. It now goes through `useWorkoutPlaybackStart().requestStart`, which is
  the prompt that stands in front of silently discarding a workout already in
  progress — a plan session is exactly the fourth entry point that hook's
  documentation warns about. `src/api/Exercises/workoutPresets.ts` had a
  duplicate `getWorkoutPresetById` (fork's `string`, upstream's `string | number`);
  deduplicated to the widened one.

## Gate status

| Gate | Result |
| --- | --- |
| `SparkyFitnessServer` `validate` | typecheck + prettier clean; lint errors only in untracked `tmp-*.script.ts` scratch files |
| `SparkyFitnessServer` `pnpm test` | 6867 passed, 71 skipped (454 files) |
| `SparkyFitnessServer` `test:migrations` | completed successfully (needs `set -a && . ../.env && set +a`) |
| `SparkyFitnessMobile` `validate` | pass (i18n generate/audit, typecheck, lint, Knip, native locales, prettier, muscle-art) |
| `SparkyFitnessMobile` jest | 7622 passed (480 suites) |
| `SparkyFitnessFrontend` `validate` | pass |
| `SparkyFitnessFrontend` `pnpm test` | 1629 passed (168 suites) |

Pre-merge database dump:
`~/fitness/db-backups/sparkyfitness_pre-plans-sync_20260922-191314.dump`
(verified inside the container, 111 `TABLE DATA` entries).

## Exact next step

Open the PR into `main`, wait for CI, and merge with
`gh pr merge <n> -R audaro/SparkyFitness --merge --admin` — never squash, the
merge commit is what keeps a common history with upstream. `Validate & Label`
cannot pass on a sync PR (upstream changed non-`en` translations, and the mobile
device-test box is honestly unticked); merge over it once the substantive checks
are green. Then merge any follow-up bot PR (the schema-backup sync).

## Open risks

- **Nothing here has been run on a device or in a browser.** Sequential plans
  are entirely untried by this fork: no plan row exists in the local database
  (`workout_plan_templates` is empty), so every path through the new
  `schedule_type` is covered by tests only.
- **`useStartPlanAssignment` is reachable only from the Exercise tab.** If the
  plan banner in `ExerciseSummary` ever renders somewhere else, that surface has
  to pass `onPressPlanAssignment` too or its Start button silently disappears.
- Upstream relaxed `getWorkoutPlanAssignmentIdByPresetEntryIdWithClient`: it no
  longer throws when a grouped session's children carry more than one distinct
  assignment id, and returns the first non-null instead. That guard predates the
  fork (it is in the merge base), and upstream's own per-exercise
  `workout_plan_assignment_id` writes are what make multiple ids legitimate, so
  it was accepted — but a grouped session is now allowed to be ambiguous.
