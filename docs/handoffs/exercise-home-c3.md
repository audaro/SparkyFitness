# Handoff — Exercise home, C3 complete (the muscle grid exists, nothing opens it yet)

_Written 2026-08-24. Branch `feat/ai-coach`, three commits ahead of `origin/feat/ai-coach`._

## What shipped

Task **C3** of `~/fitness/EXERCISE-HOME-BLUEPRINT.md` — Pick Muscles: the splits list and the muscle
grid. Phases A and B are complete; C1 and C3 are done. **C2 is the human SVG task and blocks
nothing** — C3 ships without it through the D5 fallback, exactly as planned.

| Commit | What | On origin |
| --- | --- | --- |
| `ca5b15d0` | C3 — add muscle and split targeting to the mobile app | no |
| `7de430dd` | review fix — keep the muscle grid up when the screen is backed out of | no |

New files, all mobile:

| File | Role |
| --- | --- |
| `src/screens/PickMusclesScreen.tsx` | Root-stack screen, two modes: split list ↔ muscle grid |
| `src/components/MuscleTile.tsx` | One pickable tile, tinted by recovery, optional SVG path |
| `src/constants/muscleTiles.ts` | Main/Accessory display grouping + `musclesForTiles()` |
| `src/hooks/useFreshnessToneColors.ts` | Tone → colour, extracted on the second use |

Touched: `types/navigation.ts`, `navigation/safeScreens.tsx`, `App.tsx` (the root-stack three-file
dance from A0), `components/MuscleRecoveryStrip.tsx` (now uses the extracted colour hook), and
`SparkyFitnessMobile/AGENTS.md`. Three new test suites, 31 tests.

**C3's eight decisions are written up in the blueprint** under "What C3 actually shipped" (§C3).
Read that before revisiting any of this — it is the reasons, not a summary.

### The two things to carry forward

1. **`PickMuscles` is registered but unreachable.** Nothing in the app navigates to it. That is
   C4's entire job, and it is the next task. Do not treat the missing entry point as a bug in C3.
2. **The grid never converts freshness.** `MuscleTile` is handed the `percent` (0–100) that
   `useMuscleRecovery`'s `select` already derived. There is still exactly one ×100 in the app.
   A tile covering two muscles is handed the more fatigued muscle's entry, not an average.

## Gate status

- **Mobile** (`SparkyFitnessMobile/`): `pnpm run validate` clean.
  Full suite `pnpm exec jest --watchman=false --runInBand --coverage=false` →
  **5540 passed, 1 failed, 343 suites**. The one failure is the long-standing Pacific-time sleep
  flake in `__tests__/services/healthconnect/dataTransformation.test.ts` (`entry_date` off by a
  day). It fails on a clean tree. Ignore it.
- `__tests__/navigation/nativeHeaderContract.test.ts` green. `PickMuscles` needs **no**
  `NATIVE_TABS_ROUTE_EXCLUSIONS` entry: it uses `useScreenHeader`, so the contract test counts it as
  a screen-owned-header route (same as `GymProfiles`). `headerBackTitle: 'Up Next'` satisfies the
  back-title assertion.
- **Server**, **frontend** and **shared** untouched this session; last known green (see
  `exercise-home-phase-b.md`).
- Live verification was **not** run: the local server answers 401 without credentials. The request
  contract is pinned by the shared schema (`target_muscles` is `z.array(z.enum(MUSCLES)).min(1)`)
  and by B4's live check of the generate endpoint.

## Exact next step

**Phase C, task C4 — wire Pick Muscles into Up Next** (blueprint §C4). Its prerequisite (C3) is done.

**Files:** `src/screens/UpNextScreen.tsx`.
**Change:** a direct entry point to `PickMusclesScreen`. Per the blueprint, the Swap *affordance*
opens the D1 sheet **once that sheet exists** — it does not yet, so C4 is a plain entry point, not
the sheet. Do not build D1 early.
**Commit:** `Open muscle targeting from Up Next`

Five things that will bite, verified against the code today:

1. **`UpNextScreen` already owns a Swap button** (`testID="up-next-swap"`, `handleSwap` →
   `runGenerate({ swap: true }, 'swap')`). That is whole-workout Swap and it must keep working —
   C4 adds a *second* affordance, it does not repurpose this one.
2. **The one-accent invariant is enforced at runtime.** `useScreenHeader` throws in `__DEV__` when
   more than one header item is `kind: 'primary'` or `role: 'primary'`. `UpNextScreen`'s header is
   `useScreenHeader({ title: 'Up Next', left: { kind: 'back' } })` today; adding a header action
   means checking what else is already accented on that screen.
3. **There is an existing ⋯ row menu** on `UpNextScreen` (`handleOpenRowMenu`, `AnchoredMenu`) —
   that one is per-exercise. The whole-workout ⋯ menu is D2, not C4.
4. **The round trip already works from Up Next.** `PickMusclesScreen` calls
   `navigation.navigate('UpNext')` after a successful generate, which pops back to the existing
   Up Next rather than pushing a second one. Nothing extra is needed on the return path; the
   generated workout is already in the cache `useWorkoutRecommendation` reads.
5. **`headerBackTitle: 'Up Next'`** is already set on the `PickMuscles` route in `App.tsx` on the
   assumption that Up Next is its parent. If C4 adds a *second* entry point from somewhere else,
   that label becomes a small lie — decide deliberately.

After C4: Phase D (D1 swap sheet → D2 ⋯ menu → D3 on-demand → D4 docs), then Phase E.

## Open risks

- **`GymProfilesScreen` has the Android-back gap C3 just fixed.** Its editor mode sets
  `gestureEnabled: !editor, headerBackVisible: !editor` but registers no `beforeRemove` listener, so
  Android's hardware back pops the screen out from under an in-progress edit. Real, unfixed, out of
  scope. The fix is the one in `PickMusclesScreen` (a `beforeRemove` listener plus a flag for the
  screen's own departure).
- **`useScreenHeader` does not honour a `kind: 'text'` left item.** Its comment claims "a
  dismiss/text left item replaces the system back button", but only `dismiss` sets
  `headerBackVisible: false`. A labelled Cancel would render beside the system back button on the
  native path. C3 used `dismiss` to avoid it; fix the hook if a screen needs the label.
- **`` `${color}20` `` alpha suffixes are silently dropped.** The theme's values are `hsl(...)`
  strings; `processColor('hsl(220, 91%, 64%)20')` returns the same opaque colour as the unsuffixed
  value. `WorkoutCard.tsx:53` and `SwipeableExerciseRow.tsx:126` therefore render fully saturated
  backgrounds where a 12% wash was intended. Cosmetic, unfixed, out of scope.
- **Nothing refetches on app foreground or day rollover.** Unchanged from C1. `useFocusEffect` does
  not re-fire when the app foregrounds onto an already-focused tab, so an Exercise tab left open
  overnight shows yesterday's numbers — true of the week card, `UpNextCard`, the recovery strip and
  `syncTodayRollover()` alike. The fix belongs at the screen level: one AppState `active` effect on
  `ExerciseHomeScreen`, following `useFasting.ts:285`. Still unassigned — fold into D4 or give it
  its own task.
- **`weeklySetTargetsQueryKey` is still not invalidated by exercise writes.** Unchanged from C1.
  Its key is a factory (`weeklySetTargetsQueryKey(historyWeeks)`), so a fix invalidates by the
  `['weeklySetTargets']` prefix.
- **Health sync still deliberately does not invalidate recovery.** The C1 reasoning holds: an
  imported session has no sets, so it cannot move a freshness score — only `last_trained`, which
  **C3 does not render either**. Revisit `refreshHealthSyncCache` when E3 or a later task surfaces
  `last_trained`.
- **`isError` from React Query does not mean "no data"** — blueprint trap 13. `PickMusclesScreen`
  sidesteps it by never reading the flag: the grid renders every tile whether or not recovery
  arrived, showing `—` in place of a percentage. Keep new sections to that shape.
- **Three commits are unpushed.** Push to the fork (`origin` = `audaro/SparkyFitness`) only.
  Note the C1 handoff's "twelve commits ahead" is stale — that work reached `origin` at `b554e801`,
  verified with `git ls-remote`.
