# Handoff — Exercise home, C1 complete (recovery has a UI)

_Written 2026-08-24. Branch `feat/ai-coach`, twelve commits ahead of `origin/feat/ai-coach`._

## What shipped

Task **C1** of `~/fitness/EXERCISE-HOME-BLUEPRINT.md` — the recovery endpoint, which had been built
and tested since the engine landed but had **zero UI consumers**, is now rendered on the Exercise
tab. Phases A and B are complete (B is on `origin` through `f843294e`; A through `6cd86765`).

| Commit | What | On origin |
| --- | --- | --- |
| `3fc82739` | C1 — show muscle recovery on the Exercise tab | no |
| `8f347076` | review fix — drop the cached recovery vector when an exercise is logged | no |

New files, all mobile:

| File | Role |
| --- | --- |
| `src/utils/muscleRecoveryDisplay.ts` | `freshnessPercent` (clamped), `freshnessTone` |
| `src/hooks/useMuscleRecovery.ts` | query + focus refetch; derives `percent`/`tone` in `select` |
| `src/components/MuscleRecoveryStrip.tsx` | the horizontally scrolled strip |

Touched: `services/api/workoutRecommendationsApi.ts` (`fetchMuscleRecovery`), `hooks/queryKeys.ts`
(`muscleRecoveryQueryKey`), `hooks/invalidateExerciseCache.ts`, `screens/ExerciseHomeScreen.tsx`,
and `SparkyFitnessMobile/AGENTS.md` (the stale "a marked slot for per-muscle recovery" claim, plus a
new bullet stating the strip's contract).

**C1's five decisions and the two reconciled review findings are written up in the blueprint** under
"What C1 actually shipped" (§C1). Read that before revisiting any of this — it is the reasons, not
a summary.

### The one thing to carry forward

**`freshness` is 0.0–1.0 on the wire.** The ×100 happens exactly once, in `useMuscleRecovery`'s
React Query `select`, so every item arrives carrying a ready `percent` (0–100) and a coarse `tone`
alongside the raw score. **C3's grid must read `percent` from this same hook rather than converting
again.** Converting twice, or rendering the raw score, is what puts every muscle at 1%.

## Gate status

- **Mobile** (`SparkyFitnessMobile/`): `pnpm run validate` clean.
  Full suite `pnpm exec jest --watchman=false --runInBand` → **5508 passed, 1 failed, 339 suites**,
  run before `8f347076`; after it, the 85 hook suites plus the touched screen/component suites are
  green (817 tests). The one failure is the long-standing Pacific-time sleep flake in
  `__tests__/services/healthconnect/dataTransformation.test.ts` (`entry_date` off by a day). It
  fails on `main` too; ignore it.
- **Server** and **frontend** untouched this session; last known green (see
  `exercise-home-phase-a.md`).
- Live verification of `/recovery` was **not** run: the local server answers 401 without
  credentials. The contract is pinned by
  `SparkyFitnessServer/tests/workoutRecommendationRecovery.test.ts` (17-muscle length, 0–1 range,
  freshest-first ordering), which is what the client was written against.

## Exact next step

**Phase C, task C3 — Pick Muscles: splits sheet and muscle grid** (blueprint §C3). Its prerequisites
(C1 and B2) are both done. **C2 is a human task** (`⚠️ SVG muscle paths — DO NOT ATTEMPT`) and
blocks nothing; C3 ships without it via the D5 fallback, so `MuscleTile` must render a labelled
colour tile carrying the recovery % when it is given no SVG path.

Four things that will bite, verified against the code today:

1. **`target_muscles` is `.min(1)`** (`shared/src/schemas/api/WorkoutRecommendations.api.zod.ts:195`).
   "Recovered muscles" — the default split, meaning *no constraint* — must **omit the field**, not
   send `[]`. An empty array is a 400. The schema comment says it outright: omitting the field and
   sending every muscle are different requests.
2. **Read `percent` off `useMuscleRecovery`.** See above.
3. **The display grouping is UI-only** (D7): Back is one tile covering `lats` + `middle back`, but
   the wire carries canonical single muscles. Main (10 tiles / 11 muscles) + Accessory (6) = all 17.
4. **`PickMuscles` is a root-stack screen, so A0 applies**: add it to `RootStackParamList`, register
   a matching `<Stack.Screen>` in `App.tsx` with explicit header options, and give
   `NATIVE_TABS_ROUTE_EXCLUSIONS` an entry with a reason if it is presented above `Tabs`.
   `__tests__/navigation/nativeHeaderContract.test.ts` is a hard gate.

Assert that **every one of the 17 muscles has a tile**, the way the taxonomy partition is asserted
at `SparkyFitnessServer/tests/weeklySetTargets.test.ts:34`.

After C3: C4 (open Pick Muscles from Up Next), then Phase D.

## Open risks

- **Nothing refetches on app foreground or day rollover.** `useFocusEffect` does not re-fire when
  the app foregrounds onto an already-focused tab, so an Exercise tab left open overnight shows
  yesterday's numbers. This is **not** specific to the recovery strip — the week card, `UpNextCard`
  and the screen's own `syncTodayRollover()` all have it identically, which is why C1 did not patch
  one of the four. The fix belongs at the screen level: one AppState `active` effect on
  `ExerciseHomeScreen` driving the rollover and all three refetches, following `useFasting.ts:285`.
  Unassigned — fold into D4 or give it its own task.
- **`weeklySetTargetsQueryKey` is still not invalidated by exercise writes.** C1 added
  `muscleRecoveryQueryKey` to `invalidateExerciseCache`; the weekly ring has the same gap and still
  relies on focus refetch alone. Phase A's to answer, not C1's. Note its key is a factory
  (`weeklySetTargetsQueryKey(historyWeeks)`), so a fix invalidates by the `['weeklySetTargets']`
  prefix.
- **Health sync deliberately does not invalidate recovery.** An imported session lands in
  `exercise_entries` with no sets, and fatigue accrues as `sets × weight × decay`, so it contributes
  zero and cannot move a freshness score — it moves only `lastTrained`, which nothing renders yet.
  **Revisit `refreshHealthSyncCache` the moment C3 or E3 surfaces `last_trained`.**
- **The Exercise tab carries its own date store.** Unchanged from Phase A, still true: anything
  resolving "the day the user is looking at" goes through `useAddSheetActions.getActiveDiaryDate()`.
  The recovery strip is deliberately "now"-based and ignores the selected day, like `UpNextCard`.
- **`isError` from React Query does not mean "no data"** — blueprint trap 13. The strip sidesteps it
  by keying its hide condition on `muscles.length === 0 && !isLoading` and never reading `isError`
  at all. Keep new sections to that shape.
- **Twelve commits are unpushed.** Push to the fork (`origin` = `audaro/SparkyFitness`) only.
