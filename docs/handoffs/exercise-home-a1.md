# Handoff — Exercise home & muscle targeting: A0 + A1 complete

Branch `feat/ai-coach`. Written 2026-08-24. Plan: `~/fitness/EXERCISE-HOME-BLUEPRINT.md`.
Previous handoff: `docs/handoffs/exercise-home-phase-b.md` (Phase B, target-muscle generation).

## What shipped

- **A0** — read-only, the mobile navigation contract. No code change. Findings folded into the
  blueprint and into `SparkyFitnessMobile/AGENTS.md`.
- `233749e2` — **A1** the mobile tabs are now **Home, Exercise, Add, Food, Settings** (from
  Dashboard, Diary, Add, Library, Settings). Pure re-labelling and re-wiring: `Home` renders
  `DashboardScreen` and `Food` renders `DiaryScreen`, both rendering exactly what they rendered
  before. Deep link `''` now resolves to `Home`.

Phase B is done and lives on the server with no caller yet. Phase A is independent of it.

## The one thing A0 found that the blueprint did not have

Renaming a tab means editing **six** things, not five. The sixth is
**`src/components/CustomTabBar.tsx:10` `TAB_ICONS`**, keyed by route name, and
**`__tests__/navigation/nativeHeaderContract.test.ts` does not cover it** — that test only guards the
native iOS path. Miss it and Android + iOS < 26 render five label-only tabs: `iconName` goes
`undefined` and the `{iconName && …}` guard drops the icon with no error and no failing test.

Typecheck (not the contract test) catches three more the blueprint's list omitted:
`src/hooks/useAddSheetActions.ts` (the `NonAddTabName` default and the `'Diary'`/`'DiaryRoot'`
lookups inside `getActiveDiaryDate`), `App.tsx`'s linking config, and the four cards typed
`BottomTabNavigationProp<TabParamList, 'Dashboard'>` (`UpNextCard`, `MedicationsCard`, `CycleCard`,
`FastingCard`).

Both are now written into `SparkyFitnessMobile/AGENTS.md` and the blueprint's A0 section.

## Three calls made during A1, all recorded in the blueprint

1. **A1 creates `src/screens/ExerciseHomeScreen.tsx` as an empty placeholder**, not A2 as written.
   The contract test forces the whole six-file tab dance into one commit, so the new tab needed a
   body the moment it existed. A2 fills in its sections; the file and its registration already exist.
2. **The Library rows are orphaned between A1 and A3.** `LibraryScreen` is the *only* navigator into
   `FoodsLibrary`, `MealsLibrary`, `ExercisesLibrary`, `WorkoutPresetsLibrary` and `MedicationsList`.
   Dropping the Library tab makes all five unreachable until A3 redistributes them. This is the
   blueprint's own sequencing and an intra-branch state, not a shipped one. Do not "fix" it by
   putting the tab back.
3. **Stale cross-tab labels deferred to A4.** `App.tsx` still has `headerBackTitle: 'Library'` (×4,
   `:347-362`) and `'Diary'` (`:497`, `:502`, `:507`, `:555`, `:578`), and `SettingsScreen.tsx:191/199`
   still has "Dashboard"/"Diary" rows. Renaming them in A1 would guess at destinations A3/A4 has not
   chosen: the workout pair (`WorkoutDetail`, `ActivityDetail`) becomes `'Exercise'`, the food-flow
   three become `'Food'`. A4's task description now carries that sweep. No gate catches these.
   `WhatsNewScreen.tsx:159-161` keeps the old tab names **on purpose** — it illustrates a shipped
   release; renaming it would falsify history.

## Blueprint edits are NOT under version control

`~/fitness/EXERCISE-HOME-BLUEPRINT.md` sits outside the repo (`~/fitness` is not a git repo), so the
A0/A1/A4 corrections above exist only on this machine. They are not in any commit.

## Gate status

Mobile `pnpm run validate` clean (typecheck + expo lint `--max-warnings 0` + i18n audit).
Full jest: **5490 passed, 1 failed, 336 suites** — exactly the blueprint's recorded baseline. The one
failure is the documented Pacific-time sleep flake in
`__tests__/services/healthconnect/dataTransformation.test.ts`, which fails on a clean tree and is
untouched by this work. Server and frontend were not touched, so their gates were not re-run.

`__tests__/navigation/nativeHeaderContract.test.ts` passes 7/7.

## Exact next step

Blueprint task **A2** — build out the Exercise tab screen. `ExerciseHomeScreen.tsx` exists and is
registered; it currently renders an empty scroll view with a title on the fallback path. Fill in the
five sections top to bottom: Up Next (reuse `UpNextCard` verbatim, do not fork), This week (the
weekly-set-target ring at summary size via `HexagonProgressRing` + `useWeeklySetTargets`), Recovery
(placeholder — C1 fills it), Quick access, Setup. Session length and training days in Setup need A5.

Then A3 → A4 → A5 → A6. The React Compiler is on: if lint reports "Existing memoization could not be
preserved", delete the offending `useMemo`/`useCallback` rather than fighting it.

## Open risks

- **Five library screens are unreachable right now** (see call 2 above). A3 is what restores them.
  Anyone reviewing the branch mid-phase will notice; it is intentional.
- **Nothing consumes `target_muscles` yet.** Still true from Phase B — a live server capability with
  no caller until C3, so a regression in it is invisible to the app.
- **Task C2 needs a human** (five canonical muscles have no path in `muscle-male.svg`). D5's fallback
  tile is what keeps it blocking nothing.
- **Sharing is deferred** and is on the blueprint's STOP list.
