# Handoff — Workout playback entry points, and the dialog behind them

Branch `feat/ai-coach`. Previous step: `docs/handoffs/exercise-home-phase-e.md`, which closed the
whole of `~/fitness/EXERCISE-HOME-BLUEPRINT.md`. This picks up its first open item and ends with the
backlog untouched but measured.

Everything here is web-only (`SparkyFitnessFrontend/`). Nothing on the server, mobile, or `shared/`
changed.

## What shipped

| Commit      | What it did                                                                 |
| ----------- | --------------------------------------------------------------------------- |
| `77a88c900` | Start workout on the Up Next card — the last "look but don't touch" surface |
| `f232deda7` | The in-progress guard, extracted and applied to all three entry points      |
| `56480410a` | `ConfirmationDialog` translates the labels it supplies itself               |
| `ff65d9f87` | `ConfirmationDialog` announces its description to screen readers            |
| `b0d18acbd` | Phase E handoff records the above                                           |
| `3e576f1e4` | Phase E handoff's merge-exposure claim replaced with a measurement          |

The long-form write-up lives in `exercise-home-phase-e.md` under E5 and E6, because the diagnosis it
corrects belongs next to the phase that filed it. What follows is what a fresh session needs.

## The one thing to know about playback

**Every way into `/workout-playback` goes through `hooks/Exercises/useWorkoutPlaybackStart.tsx`.**

`WorkoutPlaybackPage` prefers a route-state draft over the one in `localStorage` and then overwrites
storage with it. So handing it a draft for a day that already has an unfinished workout silently
destroys that workout, sets and timings included. The hook is the prompt standing in front of that:
it checks storage, offers Cancel / Resume / Start new, and owns the navigate. Callers do two things —
call `requestStart({ entryDate, createDraft, onStarted? })` and drop `guardDialog` in their tree.

Three call sites use it: `UpNextCard`, `WorkoutPresetsManager` (row menu and the header's preset
dialog), and `ExerciseCard` (the diary's preset selector). It became a hook rather than a third copy
of the prompt precisely so a fourth entry point cannot quietly reintroduce the data loss. **Adding a
`navigate('/workout-playback', { state: { draft } })` anywhere else brings the bug back.**

Two contracts inside it are load-bearing and easy to break by "simplifying":

- **`createDraft` is a callback, not a draft.** Building a draft stamps `started_at`. Build it eagerly
  and a start the user cancels leaves a start time that never happened.
- **Resume navigates with no draft at all.** Falling back to the stored draft _is_ resuming; passing
  one is the overwrite being guarded against.

The day a workout lands on differs by surface, on purpose: the coaching surfaces always use
`todayInZone(timezone)` (the workout was programmed against today's recovery), while `ExerciseCard`
uses the diary's `selectedDate`, because the diary is a day view. `WorkoutPresetsManager` used the
machine's local date for both starting and logging until this work; a user whose timezone differs
from their laptop's could put the two on different days.

## Gate status

Run from `SparkyFitnessFrontend/`. Green at `3e576f1e4`.

| Command             | Result                        |
| ------------------- | ----------------------------- |
| `pnpm run validate` | clean (tsc, eslint, prettier) |
| `pnpm test`         | **1081 passed, 111 suites**   |

Up from 1066 / 108 at the close of Phase E. The delta is `useWorkoutPlaybackStart.test.tsx` (6),
`ConfirmationDialog.test.tsx` (5, the component's first suite), `ExerciseCard.test.tsx` (2, also its
first) and two cases on `WorkoutPresetsManager.test.tsx`.

`ExerciseCard.test.tsx` covers the preset-playback path only. The component is ~600 lines and the
rest of it is still untested; the suite exists as a place to add to, not as coverage.

## Upstream state

**Synced 2026-08-24 after this work: a no-op.** `upstream/main` (`fda0c167f`), `upstream/dev` and
`upstream/dev2` are all ancestors of this branch, and the one upstream branch ahead of `main`
(`nix/update-pnpm-hashes`) has an empty diff against it. Nothing upstream is in flight against any
file the fork has modified.

The fork's delta is 157 added files, 123 modified, 2 deleted. Conflict risk tracks upstream's churn
rate on the modified ones, not their importance — the per-file table is in `exercise-home-phase-e.md`
under "Merge exposure". Short version for the web: `public/locales/en/translation.json` (137 upstream
commits in six months) dominates everything, `MainLayout.tsx` and `Diary.tsx` are the permanent
conflict zone, and `ConfirmationDialog.tsx` — despite being a shared primitive — is the coldest file
the fork has touched, at one upstream commit in six months.

## Exact next step

**Mobile Exercise-tab staleness. Two bugs, one surface, one session.** Both are carried-forward
Phase E open items, both verified still true at `3e576f1e4`:

1. **Nothing refetches on app foreground or day rollover.** An Exercise tab left open overnight shows
   yesterday's numbers. `src/screens/ExerciseHomeScreen.tsx` has no `AppState` listener at all. The
   pattern to copy is `src/hooks/useFasting.ts:296` — one `AppState.addEventListener('change', …)`
   effect at screen level, not per-hook.
2. **`weeklySetTargetsQueryKey` is never invalidated by an exercise write.** Nothing in `src/` calls
   `invalidateQueries` against it. The key is a factory (`src/hooks/queryKeys.ts:120`, parameterised
   by `historyWeeks`), so a fix invalidates by the `['weeklySetTargets']` prefix rather than
   reconstructing the exact key.

Both are JS-only. **No native change, so no `expo prebuild` and no `expo run:ios`** — and Metro is
already running detached with `EXPO_PACKAGER_PROXY_URL`, so do not restart it with a bare
`pnpm start`. Gate with `pnpm run validate` plus
`pnpm exec jest --watchman=false --runInBand --coverage=false` from `SparkyFitnessMobile/`, and do
not run Prettier on mobile files.

## Open risks and items

- **23 of the 67 files using `<DialogContent>` still have no description at all**, so Radix has
  nothing to point `aria-describedby` at and a screen reader announces the title and buttons only.
  `ConfirmationDialog` was fixed because this work was already inside it; the rest are untouched.
  **Do not sweep them all.** Nearly all 23 are upstream files, and a blanket a11y pass would trade a
  cold conflict surface for 23 warm ones on a fork that never PRs out — the fix would have to be
  re-applied by hand on every sync, forever. Fix them opportunistically, when a task is already in
  the file.
- **`ConfirmationDialog.cancelLabel` has no caller.** Added for symmetry with `confirmLabel` when the
  hardcoded strings came out. Defensible, but it is unused API until something needs "Keep editing".
- **The `?date=` on `/exercises` and the day a workout logs to are deliberately different things.**
  Anyone "fixing" the coaching surfaces to respect the browsed date will be reintroducing a bug — the
  workout was programmed against today's recovery.
- Carried forward from Phase E, all still true and none blocking: the web weekly-targets card draws
  linear bars where mobile draws a Skia hexagon; C2's anatomical SVG paths remain the only
  human-blocked task and block nothing; muscle targeting (Pick Muscles, splits, On Demand) is
  mobile-only and is a UI gap, not a contract one; `utils/workoutSupersets.ts`,
  `hooks/useWorkoutRecommendation.ts` and `hooks/useGymProfiles.ts` have no mobile suites of their
  own; the two web body-map implementations stay unconsolidated per blueprint D10; health sync
  deliberately does not invalidate recovery; and the two equipment stores
  (`coach_profiles.equipment`, AI-chat-only, vs `gym_equipment_profiles.equipment`, what the
  generator reads) must not become three.
