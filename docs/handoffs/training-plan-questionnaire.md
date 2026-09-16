# Handoff — Training Plan questionnaire, goal-aware weekly targets, muscle-gain projection

*Written 2026-09-15. Branch `main`, HEAD `05c775ab0`. Nothing from this feature is implemented yet.*

## What this is

Feature request: a questionnaire covering goals, desired physique and training days that tailors
the "This week" set targets to the answers. Alongside it, an optional enhancement input
(natural / TRT / enhanced, with a weekly dose) driving a lean-mass projection over a training
horizon. The natural case is the default and must work on its own.

A blueprint exists and is the spec. **Read it before writing any code:**

    ~/fitness/TRAINING-PLAN-BLUEPRINT.md

It is deliberately outside the repo, matching the other blueprints in `~/fitness/`
(`AI-COACH-BLUEPRINT.md`, `FITBOD-BLUEPRINT.md`, `EXERCISE-HOME-BLUEPRINT.md`).

## Status: drafted, NOT signed off

The blueprint was written and presented but not yet approved. **Three open questions are
unanswered** (Part V of the blueprint):

1. Projection horizon — 12 weeks only, or also 6 and 12 months?
2. Should the projection card appear on Home as well as Exercise?
3. Is the `undecanoate` ester needed, or only weekly esters?

None of them block Phases 1-4. Phase 1 is safe to start without answers. Question 1 shapes the
Phase 4 endpoint signature (`?weeks=` already takes a parameter, so a second horizon is additive).
Question 2 is Phase 6 only. Question 3 is one entry in a lookup table.

**Do not start Phase 5 or 6 without sign-off on the questionnaire's step list** — that is the
part most likely to attract design feedback.

## Exact next step

**Phase 1 — Schema and contract.** Add five nullable columns to `coach_profiles`:
`primary_goal`, `physique_target`, `priority_muscle_groups`, `enhancement`, `plan_completed_at`.
Extend `shared/src/schemas/database/CoachProfiles.zod.ts` and
`shared/src/schemas/api/CoachProfile.api.zod.ts`, then
`SparkyFitnessServer/models/coachProfileRepository.ts` (`PROFILE_COLS`, `PATCHABLE_COLS`,
`JSONB_COLS`). Strip `enhancement` from the chat-context snapshot in
`SparkyFitnessServer/ai/tools/coachProfileTools.ts`.

Gate: `SparkyFitnessServer` `tsc --noEmit` + jest, plus the shared suite. Commit per phase.

## Verified facts the blueprint rests on (re-checked 2026-09-15)

- `coach_profiles` already has `goals`, `training_days_per_week`, `session_minutes`,
  `experience_level`, `limitations`, `weekly_set_targets`. The REST surface is
  `GET`/`PATCH /api/coach-profile` and the PATCH is `.strict()`.
- **Only `experience_level` has a mobile form** (`ExerciseHomeScreen.tsx`, a `BottomSheetPicker`).
  Every other profile field is collected exclusively through the AI chat tool
  `sparky_manage_coach_profile`. That absence is the core of what this feature fixes.
- `deriveDefaultWeeklySetTargets` (`shared/src/utils/weeklySetTargets.ts:173-190`) reads
  **only** `trainingDaysPerWeek`. Goals, experience and physique are ignored today.
- Generation (`workoutRecommendationService.ts:489`) reads `session_minutes`,
  `experience_level` and `limitations` properly, but derives the goal by **regex over free text**
  (`deriveGoal`, L189) — its own comment calls that a stopgap. `training_days_per_week` is not
  consumed by generation at all.
- Sex and age live in `profiles` (`gender`, `date_of_birth`); weight and body fat live in
  `check_in_measurements`. Both are readable from mobile. The questionnaire reads them; it must
  not duplicate them.
- The multi-step pattern to copy is `SparkyFitnessMobile/src/screens/CycleOnboardingScreen.tsx`
  (single `step` state, `useScreenHeader` "Step N of 4", one ScrollView of `{step === n && …}`
  blocks, bottom Next button). `OnboardingScreen.tsx` is connect+auth only and is NOT the pattern.
- Registering a screen is three edits: `types/navigation.ts`, `navigation/safeScreens.tsx`,
  `App.tsx`.
- `onboarding_data` is the **web** nutrition onboarding. Upstream owns it. Do not extend it.

## Repo state

- Branch `main`. This handoff's own commit is the only thing ahead of `origin/main` (1 ahead,
  0 behind) and it is **unpushed** — push it if the next session is on another machine.
- **Two uncommitted files, pre-existing and unrelated to this feature** — they add a `videos`
  field to the mobile exercise transform:
  `SparkyFitnessMobile/src/services/api/exerciseApi.ts` and its test. They came from the
  demonstration-video work in `1a7d66905`. Decide whether to commit or stash them before
  starting; do not fold them into a Phase 1 commit.
- Gate at handoff time: root `tsc --noEmit` green; `SparkyFitnessServer` suite green at
  313 files / 5168 tests. Note one test failed on a first run and passed on an identical re-run,
  so there is a flake somewhere in the server suite — if a single unexplained failure appears,
  re-run before chasing it. The mobile and frontend gates were not run, because this commit
  touches only a markdown file.

## Local database state (no repo change)

A fresh Fitbod CSV export was re-imported locally, so the new weekly targets will be exercised
against real history rather than an empty account.

- The importer is idempotent: it updated existing history in place rather than duplicating it,
  and set counts were spot-checked against the CSV.
- Two exercise names new to the map were added to the **untracked, git-excluded**
  `SparkyFitnessServer/tmp-fitbod.script.ts`: `'Plank'` and `'Side Plank Lift'`. That file is
  excluded via `.git/info/exclude`, so those mappings exist on one machine only.
- A custom `Plank` exercise row had **no muscle tags**, so its sets counted toward nothing. It
  was updated to `primary_muscles=["abdominals"]`, `equipment=["body only"]`,
  `modality='duration'`. Worth checking for on any hand-created exercise row.

## Open risks and gotchas

- **The Apple Health path cannot feed the week card, by design.** Fitbod writes only a workout
  summary to HealthKit (type, duration, calories), so Sparky imports one generic "Functional
  Strength Training" entry with a single placeholder set and no muscle tags. It contributes zero
  to every group. The only ways to populate the ring are a Fitbod CSV re-import or logging inside
  Sparky. If a "0 sets this week" report comes up again, check for muscle tags before suspecting
  the sync.
- **Clearing per-group target overrides is a destructive step.** Phase 5's save clears stored
  `weekly_set_targets` so the new plan is visible. It must be behind a confirm, and it changes
  `targets_are_custom`. Get this right or manually set targets are silently lost.
- **`enhancement` must never reach the chat model.** It is sensitive health data and the chat
  provider is third-party. Strip it in the tool's get-branch and in the cached chat context that
  PATCH invalidates. This is a Part V non-negotiable in the blueprint, not a preference.
- **Mobile i18n is a blocking gate.** Every string needs `t('key', { defaultValue })` with the
  defaultValue matching `src/localization/locales/en/translation.json` exactly. `pnpm run validate`
  in `SparkyFitnessMobile` runs the audit; `hardcoded-ui-text` is at zero and must stay there.
  Never run prettier on mobile files.
- **Do not change the week card's accounting.** `getWeeklySetCountInputs`, Sunday-start weeks,
  and secondary movers at 0.5 stay as they are. This feature changes targets, not counting.
- The projection's numbers are from named studies (Bhasin 1996/2001, Aragon/Helms). They belong
  in `PROJECTION_TUNABLES` with sources cited inline, never hard-coded in a component.

## Correction to the global notes

The local `~/.claude/CLAUDE.md` described the `codex` second-opinion reviewer as **DOWN since
2026-08-24** on an account tier that excluded it. **That is now stale.** As of 2026-09-15 the
plan claim reads `plus` and the documented ping succeeds:

    env -u ANTHROPIC_API_KEY codex exec --model gpt-5.6-sol \
      -c model_reasoning_effort=low --sandbox read-only "Reply with exactly: PONG"
    # -> PONG

So reviews fire again. `.git/second-opinion/last-error.txt` is dated 2026-09-02 and predates the
plan upgrade, so it is a stale artifact, not evidence of a current outage — ignore it, and do not
read it as the "reviewer is down" breadcrumb that CLAUDE.md describes.

**CLAUDE.md has been corrected** (2026-09-15): the bullet now reads
"ACTIVE 2026-08-08 → 2026-08-24, DOWN 2026-08-24 → 2026-09-15, ACTIVE AGAIN since 2026-09-15" and
keeps the original diagnosis, because a recurrence will again look like a bad model name rather
than an entitlement failure.
