# Handoff — Workout playback entry points, and the dialog behind them

Branch `feat/ai-coach`. Previous step: `docs/handoffs/exercise-home-phase-e.md`, which closed the
whole of `~/fitness/EXERCISE-HOME-BLUEPRINT.md`. This picks up its first open item, then its second,
and ends with the backlog measured.

Two halves. The playback work is web-only (`SparkyFitnessFrontend/`); the staleness and timezone work
that follows it is mobile-only (`SparkyFitnessMobile/`). Nothing on the server or in `shared/`
changed.

## What shipped

| Commit      | Package | What it did                                                                  |
| ----------- | ------- | ---------------------------------------------------------------------------- |
| `77a88c900` | web     | Start workout on the Up Next card — the last "look but don't touch" surface  |
| `f232deda7` | web     | The in-progress guard, extracted and applied to all three entry points       |
| `56480410a` | web     | `ConfirmationDialog` translates the labels it supplies itself                |
| `ff65d9f87` | web     | `ConfirmationDialog` announces its description to screen readers             |
| `b0d18acbd` | docs    | Phase E handoff records the above                                            |
| `3e576f1e4` | docs    | Phase E handoff's merge-exposure claim replaced with a measurement           |
| `7110066b8` | docs    | This handoff, at the point the web half closed                               |
| `ee7c7531a` | mobile  | Day-scoped tabs refresh on foreground return and on day rollover             |
| `b46644bcd` | mobile  | Health Connect transform tests stop depending on the runner's timezone       |
| `7ddf36da2` | mobile  | The remaining two health test files made timezone-independent                |
| `6312d587e` | docs    | This handoff extended to cover the mobile half                               |
| `8ba95ec91` | mobile  | First suite for `utils/workoutSupersets.ts`, the superset algebra            |
| `19b095ec6` | docs    | Handoff records the superset suite; timezone sweep claim corrected           |
| `e6ee3ccc0` | mobile  | First suite for `hooks/useWorkoutRecommendation.ts`                          |
| `9eaa013a7` | docs    | Handoff records that suite, and corrects its `useFocusEffect` advice         |
| `ecdc227de` | mobile  | First suite for `hooks/useGymProfiles.ts` — closes the untested three        |
| `a9764dba7` | docs    | Handoff records that suite; mobile `AGENTS.md` note retired                  |
| `1f463cd8c` | mobile  | Duplicate-profile-name error classified by status, not by substring          |
| `55d5d8894` | mobile  | The other five status-by-substring sites converted; one new suite            |
| `ca373ea70` | docs    | Handoff records that sweep; MFA-cookie duplication flagged                   |
| `1c41fcae4` | mobile  | Three copies of the MFA error ladder collapsed; code carried on `LoginError` |
| `8d9ab63c9` | docs    | Handoff records the MFA consolidation                                        |
| `2067f1803` | mobile  | Pick Muscles tiles draw real anatomy, generated from the web body-map SVG    |

The long-form write-up for the web half lives in `exercise-home-phase-e.md` under E5 and E6, because
the diagnosis it corrects belongs next to the phase that filed it. What follows is what a fresh
session needs.

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

## The mobile half: staleness, then the tests that hid behind a timezone

**`ee7c7531a` — a screen only refetches on focus, and coming back from the background is not a
focus event.** Both halves of the Phase E staleness item had the same root cause, so both were fixed
at the shared-hook level rather than on `ExerciseHomeScreen`:

- `hooks/useRefetchOnFocus.ts` now also listens on `AppState`, refetching when the app goes `active`
  **while this screen is the focused one**. An unfocused screen deliberately does nothing — it
  refetches when the user navigates to it, which is the focus path. Both paths share the one 30s
  throttle, so a foreground return moments after a tab switch still costs one request. This hook has
  24 callers; the fix reached all of them.
- `hooks/useTodayRollover.ts` (new) is the same two triggers for the day stores, unthrottled.
  `ExerciseHomeScreen`, `DashboardScreen` and `DiaryScreen` each dropped a local `useFocusEffect`
  copy in favour of it. `syncTodayRollover` only moves the selection when the user was sitting on
  today, so a day scrubbed back to is never yanked forward.
- `weeklySetTargetsQueryKey` gained a root key (`weeklySetTargetsRootQueryKey`), and
  `invalidateExerciseCache` invalidates by that prefix — the key is parameterised by `historyWeeks`,
  so invalidating a reconstructed exact key would miss whatever window another screen had asked for.

Adding `useRefetchOnFocus` to `useWorkoutRecommendation` broke two screen suites with _"Couldn't find
a navigation object"_. That was the suites' mock, not the hook — they now stub `useFocusEffect`.
Weakening the production hook to tolerate no navigation container would have been the wrong fix.

**`b46644bcd` and `7ddf36da2` — the health test suites encoded the timezone they were written in.**
Health records are dated by their **device-local** day, so an expected date can only be a literal
when the fixture instant lands on that day in _every_ zone — and no instant does: UTC-11 and UTC+14
are 25 hours apart. These passed in UTC, where CI runs, and failed on a machine outside it. Three
files, two different defects:

- **Literal date assertions** (`healthconnect/dataTransformation`, 12 assertions;
  `healthkit/dataTransformation`, 5). They now derive the expected day from the fixture instant via
  `__tests__/helpers/localDay.ts`. That helper is a deliberate second implementation on top of
  `Date`, **not** a re-export of the production helper — importing the code under test would only
  assert it agrees with itself. It lives outside any suite, so `"__tests__/helpers/"` is in
  `testPathIgnorePatterns` (alongside the existing `__tests__/screens/helpers/`).
- **Value assertions**, in `healthConnectService`. Its heart-rate and HRV fixtures put three readings
  at 08:00Z / 12:00Z / 18:00Z and assert they collapse into one day's min/max/avg — but those
  instants straddle a local midnight outside a narrow band of zones, so the aggregator produced two
  day buckets and `find()` returned the wrong one. The failure was on the _value_, which is why it
  did not look like a date bug. The fix is in the fixture: **local-naive timestamps**
  (`'2024-01-15T08:00:00'`, no `Z`) pin all three to one local day anywhere. The spanning-midnight
  test alongside them already used that idiom.

`b46644bcd` also added a case asserting a sleep session is dated by when it **ended**, not when it
began — the behaviour the original broken assertion was accidentally covering.

**`TZ=UTC` was considered for the jest run and rejected.** It would make the suite green everywhere
by making it blind to exactly the local-vs-user day distinction this app's correctness rests on.

## Gate status

Web, run from `SparkyFitnessFrontend/`. Green at `3e576f1e4`.

| Command             | Result                        |
| ------------------- | ----------------------------- |
| `pnpm run validate` | clean (tsc, eslint, prettier) |
| `pnpm test`         | **1081 passed, 111 suites**   |

Up from 1066 / 108 at the close of Phase E. The delta is `useWorkoutPlaybackStart.test.tsx` (6),
`ConfirmationDialog.test.tsx` (5, the component's first suite), `ExerciseCard.test.tsx` (2, also its
first) and two cases on `WorkoutPresetsManager.test.tsx`.

`ExerciseCard.test.tsx` covers the preset-playback path only. The component is ~600 lines and the
rest of it is still untested; the suite exists as a place to add to, not as coverage.

Mobile, run from `SparkyFitnessMobile/`. Green at `2067f1803`.

| Command                                                        | Result                        |
| -------------------------------------------------------------- | ----------------------------- |
| `pnpm run validate`                                            | clean (tsc, lint, i18n audit) |
| `pnpm exec jest --watchman=false --runInBand --coverage=false` | **6144 passed, 377 suites**   |

Up from 5971 / 371. The delta is four new suites — `utils/workoutSupersets` (41),
`hooks/useWorkoutRecommendation` (19), `hooks/useGymProfiles` (17), `hooks/useUpdateFoodEntryMeal`
(4) — plus one misclassification case appended to each of the four suites `55d5d8894` touched, and
`services/api/authErrors` (18) with four transport cases added to `authService` in `1c41fcae4`, and
`constants/muscleArt` (66) in `2067f1803`.

The three health files were run at `Pacific/Midway` (UTC-11), `America/Los_Angeles`, `UTC`,
`Europe/London`, `Asia/Tokyo` and `Pacific/Kiritimati` (UTC+14), and then the **whole** suite was run
at both extremes: 371/371 at each. So the mobile suite is timezone-independent as of `7ddf36da2`,
not just the files that were fixed — a stronger claim than this doc made when it was first written.
`TZ=Pacific/Midway pnpm exec jest …` is the cheap way to keep it that way.

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

**Nothing in this thread is open.** Both classification sweeps are finished, and the muscle-grid art
that was the only human-blocked item turned out not to need a human.

`55d5d8894` ended the status-by-substring sweep: no site in `src/` reads a status out of an error
message, and `hasApiStatus(error, status)` / `isAuthzError(error)` in `services/api/errors.ts` are
where new classification goes. `1c41fcae4` closed the MFA-cookie duplication the same way — three
screens each held the whole `LoginError` ladder, identical down to the message strings, and it now
lives in `services/api/authErrors.ts` as `classifyLoginError` / `loginErrorMessage`. Two lessons from
that pair are worth keeping:

- **The copies had drifted, which is the argument for the rule of two rather than an illustration of
  it.** Two of the three screens skip the stale-cookie branch when the error carries no status — a
  `LoginError` without one never came from a server response. `OnboardingScreen` had no such guard,
  so a local failure whose message happened to say "expired" would clear the user's cookies. Latent
  rather than live, and invisible until the three were read side by side.
- **Text matching is a symptom, not the disease.** Both bugs existed because the transport above the
  classifier discarded structure — `apiClient` folding the status into a message, `parseAuthErrorText`
  folding the server's error code into one. Fix the transport and the classifier collapses to a field
  read. And the _fixtures_ were load-bearing both times: suites that threw bare `Error`s with
  status-shaped messages had been pinning the broken behaviour all along.

`2067f1803` did the muscle art. The task had been filed as "someone has to draw seventeen muscles";
in fact the artwork was already in the repo — `SparkyFitnessFrontend/public/images/muscle-male.svg`,
which the web body map renders, labels each path with its muscle. It is now extracted into
`SparkyFitnessMobile/src/constants/muscleArt.generated.ts` by `pnpm run muscle-art:generate`. Four
things to know before touching it:

1. **The generated file is generated.** Do not hand-edit it; re-run the script. It is a script rather
   than a pasted constant precisely because the SVG is upstream's and will be redrawn.
2. **Coverage is twelve of seventeen.** `abductors`, `adductors`, `lats`, `middle back` and `neck`
   are not in the illustration, so their tiles keep the labelled colour block. **Back is the one that
   matters** — it covers `lats` + `middle back`, it is picked often, and it is the most visible
   remaining gap. Closing it needs either art for those two muscles or a different source
   illustration; it is the only part of this that still wants a human.
3. **The illustration draws the body twice, front beside back.** Five muscles are labelled in both.
   Measuring them together frames the whole canvas — two shrunken half-figures in a tile — so the
   generator splits at the midline and keeps one view. It throws if any path crosses the midline,
   which is how a re-laid-out SVG announces itself instead of quietly producing nonsense.
4. **Which view a muscle uses is a heuristic, and is pinned.** More paths wins, ties to the front.
   Picking by area instead put the abs on someone's back — obliques wrap further round the back than
   the abs reach across the front. `__tests__/constants/muscleArt.test.ts` asserts the chosen view
   per muscle and that every viewBox actually contains its path's ink, so a regeneration that flips
   one or clips one fails there.

One method note that outlived all three: **a green first run on a suite for previously untested code
is evidence of nothing.** Every suite in this stretch was verified by breaking the source instead —
and it kept paying. One case in `workoutSupersets` passed under its own mutation; and the first
"square viewBox" assertion in `muscleArt` survived removing the squaring entirely, because a box
sized off width alone is still square. It took asserting the real invariant — nothing clipped — to
catch it.

**The list below is closed** — the three modules `AGENTS.md` called out as having no suite of their
own now have one, and that note has been retired. Kept for the pattern each established, since the
next untested module should follow them:

1. ~~`utils/workoutSupersets.ts`~~ — **done in `8ba95ec91`**: 41 cases, mutation-checked against
   nine source mutations. Left as the model for the two below, in two respects. It is organized by
   _rule_ rather than by exported name, because the nine exported wrappers are one core with
   different field accessors and a per-export layout would have asserted the same rule nine times
   while pinning the accessors not at all. And every case was checked by breaking the source in the
   way it claims to catch — one of them passed under its own mutation and had to be rewritten, which
   a green first run would never have revealed.
2. ~~`hooks/useWorkoutRecommendation.ts`~~ — **done in `e6ee3ccc0`**, 19 cases, mutation-checked
   seven ways. It mocks `useRefetchOnFocus` outright rather than stubbing `useFocusEffect` as this
   doc previously suggested: what the hook owns is that it hands its refetch to the shared focus
   hook gated on `enabled`, and how React Navigation delivers focus belongs to that hook's own
   suite. The `useFocusEffect` stub is still what a _screen_ suite needs, since those render real
   trees.
3. ~~`hooks/useGymProfiles.ts`~~ — **done in `ecdc227de`**, mutation-checked seven ways; 17 cases
   after `55d5d8894` added the misclassification case and folded its local error builder onto the
   shared one.

All JS-only, including the `409` fix. **No native change, so no `expo prebuild` and no
`expo run:ios`** — and Metro is
already running detached with `EXPO_PACKAGER_PROXY_URL`, so do not restart it with a bare
`pnpm start`. Gate with `pnpm run validate` plus
`pnpm exec jest --watchman=false --runInBand --coverage=false` from `SparkyFitnessMobile/`, and do
not run Prettier on mobile files. Any new suite asserting a date must use
`__tests__/helpers/localDay.ts` or a local-naive fixture rather than a literal — see the mobile half
above.

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
- **Three suites were written by mutating the source, not by watching them go green.** All three
  passed on the first run; nine, seven and seven deliberate breakages then confirmed each case bites,
  and one case in `workoutSupersets` passed under its own mutation and had to be rewritten. A green
  first run on a suite for untested code is evidence of nothing. `SparkyFitnessMobile/AGENTS.md` was updated in the
  same commit: its "no suite of their own" note for these three modules named them by hand, so
  leaving it would have told the next session to rely on screen coverage that is no longer the only
  thing there.
- **A literal date in a mobile test is a latent failure, not a passing assertion.** Three files were
  fixed; the sweep stopped there deliberately rather than becoming a repo-wide pass. Everything the
  app dates by device-local day is a candidate — the health suites were simply where it surfaced.
  `TZ=Pacific/Midway pnpm exec jest …` finds the next one in one run.
- **`useRefetchOnFocus` fires on foreground return only for the _focused_ screen.** That is the
  design, not an oversight. Anyone "fixing" an unfocused screen to refetch on resume turns one
  request into one per mounted screen, on every app switch.
- **The `?date=` on `/exercises` and the day a workout logs to are deliberately different things.**
  Anyone "fixing" the coaching surfaces to respect the browsed date will be reintroducing a bug — the
  workout was programmed against today's recovery.
- Carried forward from Phase E, all still true and none blocking: the web weekly-targets card draws
  linear bars where mobile draws a Skia hexagon; C2's anatomical art is no longer human-blocked — `2067f1803`
  generated it from the illustration the web body map already renders, leaving five muscles the
  illustration does not draw; muscle targeting (Pick Muscles, splits, On Demand) is
  mobile-only and is a UI gap, not a contract one; the three untested mobile modules are closed, and so is
  the status-by-substring sweep they led to; the two web body-map implementations stay unconsolidated per blueprint
  D10; health sync
  deliberately does not invalidate recovery; and the two equipment stores
  (`coach_profiles.equipment`, AI-chat-only, vs `gym_equipment_profiles.equipment`, what the
  generator reads) must not become three.
