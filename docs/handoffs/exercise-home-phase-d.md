# Handoff — Exercise home & muscle targeting: Phase D complete

Phase D is done. `UpNextScreen` now has every affordance the design called for, and the mobile side
of this project is finished: Phases A–D all shipped. What remains is Phase E, web parity, which is
greenfield.

## What shipped

| Task | Commit | What it added |
| --- | --- | --- |
| D1 | `0a734853` | The **Swap sheet** — an `ActionSheet` of the ways to get a *different* workout |
| D2 | `0668baf5` | The **⋯ menu** — Save workout, Refresh, and (once D2's second half landed) Build superset/circuit |
| D2 | `3b1ec8da` | **Superset/circuit building on Up Next**, applied at start-workout rather than stored |
| D3 | `02f0ef34` | **On Demand** — themed one-tap generation, the sheet's fourth row |
| D4 | this commit | The `SparkyFitnessMobile/AGENTS.md` pass for all of the above |

The resulting split of responsibility on `UpNextScreen` is worth stating once, because it is the
thing most likely to be undone by accident: **the swap sheet is how you get a different workout,
and the ⋯ menu is how you act on the one already there.** Refresh (`generate({swap: true})`) is a
⋯ row, not a sheet row — it produces a different workout for the *same* targets, and it is the
screen's only whole-workout swap path. Share is deferred indefinitely and is deliberately not a row
anywhere.

### D3's two decisions

1. **A theme is a bundle of generate parameters, not content.** `ON_DEMAND_WORKOUTS` in
   `shared/src/constants/onDemandWorkouts.ts` is a list of `{duration_minutes, target_muscles?}`
   with names on them. No table, no migration, no endpoint, no authored exercise lists — the engine
   programs the session as it does everywhere else, and the active gym profile still filters it.
   The constant lives in `shared/` rather than mobile `constants/` because it is a *request body*,
   not display layout (`constants/muscleTiles.ts` is the counter-example and correctly stayed
   local). `shared/` has no test runner, so `SparkyFitnessServer/tests/onDemandWorkouts.test.ts`
   parses every theme against `generateWorkoutRecommendationRequestSchema` — nothing type-checks a
   duration against the wire's 15–180 bound, and a theme with no muscle constraint must **omit**
   `target_muscles` rather than send `[]` (the field is `.min(1)`). Use
   `onDemandGenerateRequest(theme)` to build the body; do not assemble it by hand.

2. **On Demand is a screen, not a second sheet stage.** `ActionSheetItem` carries no subtitle, and
   "Quick Burn" without "twenty minutes on whatever is freshest" under it is just a word. So
   `OnDemandWorkoutsScreen` follows `PickMusclesScreen`: the picker owns its generate and lands on
   the workout it built. That made the guarded generate-then-navigate a second copy, so it is now
   `hooks/useGenerateAndShowWorkout.ts` and both pickers use it. A third picker must reuse it —
   the guards are the whole substance. The in-flight check is a **ref**, because a `disabled` prop
   follows a render and loses to a fast double-tap; the mounted check exists because backing out
   mid-request is legitimate (the workout still lands in the cache Up Next reads) while pushing a
   screen at someone who already left is not.

The themes themselves are chosen to be what the Pick Muscles split list *cannot* say — a pinned
session length (20 / 30 / 45 / 60 / 90) or a combination that is not a split (Core, Arms &
Shoulders, Chest & Back). Where a theme does line up with a split it resolves through
`MUSCLE_SPLIT_MEMBERS` so the two lists cannot drift.

## Gate status

Green, as of 2026-08-24, run per the blueprint's validation matrix.

| Package | Command | Result |
| --- | --- | --- |
| `SparkyFitnessMobile/` | `pnpm run validate` | clean |
| `SparkyFitnessMobile/` | `pnpm exec jest --watchman=false --runInBand --coverage=false` | **5585 passed, 1 failed** — the known Pacific-time sleep flake |
| `SparkyFitnessServer/` | `pnpm run validate && pnpm test` | clean; **4159 passed, 2 skipped** |
| `SparkyFitnessFrontend/` | `pnpm run validate` | clean (the `shared/` consumer check) |

The one mobile failure is `__tests__/services/healthconnect/dataTransformation.test.ts`, which fails
on a clean tree on a Pacific-time machine. Baseline before D3 was 5575 passed / 1 failed; D3's new
suite adds exactly 10.

**A server ordering flake was observed for the first time and is not a regression.** One full
`pnpm test` run failed a single case in `tests/medicationRoutes.test.ts` (~line 404,
delete-medication). It passed in isolation, the suite was green with the new test file removed, and
it was green again on a full re-run of the *identical* tree. Adding any test file reshuffles
vitest's worker distribution, which is enough to surface it — same family as the mobile
`MealTypeSettingsScreen` ordering flake. Re-run before believing it; do not attribute it to your
diff.

## Exact next step

**Phase E — web parity** (blueprint §E). It is the last phase, and it is greenfield: verified today,
`SparkyFitnessFrontend/src` has **zero** references to `workout-recommendations`, gym profiles,
weekly set targets, or muscle recovery. The web app has no awareness of this entire family, and no
dashboard to hang it on — `/` renders the Diary behind flat nav tabs.

Order, per the blueprint:

- **E1** — gym profile manager UI (`src/pages/Exercises/`). Commit: `Add gym profile management to the web app`
- **E2** — Up Next card + recommendation API/hooks. Commit: `Add Up Next to the web app`
- **E3** — recovery + weekly set targets. Commit: `Add recovery and weekly targets to the web app`
- **E4** — nav restructure mirroring Phase A. Commit: `Restructure web navigation`

Frontend conventions to follow: domain-mirrored `src/pages/<Domain>/`, `src/api/<Domain>/`,
`src/hooks/<Domain>/`; **all** HTTP through `apiCall` from `src/api/api.ts`; query keys in
`src/api/keys/`; toast text declared via React Query `meta` (`errorTitle`, `errorMessage`,
`successMessage`); i18n keys added **only** to `public/locales/en/translation.json`, never the other
27; routes in `src/App.tsx`.

Three things carried over from the mobile build that Phase E will hit:

1. **`freshness` is 0.0–1.0, not a percentage.** Derive `percent` once, at the hook's `select`, the
   way `hooks/useMuscleRecovery.ts` does. There should stay exactly one `×100` per client.
2. **`isError` from React Query does not mean "no data"** (blueprint trap 13). It is also true when
   a *refetch* fails over cached data. Hide a section on `isError && !data`, never on `isError`
   alone. This bit two mobile surfaces already.
3. **Per blueprint D10, do NOT consolidate the two web body-map implementations.**
   `BodyMapFilter.tsx` and `WorkoutSessionBodyMap.tsx` duplicate the asset. Real, out of scope,
   leave it.

Also still open and independent of E: **C2, the anatomical SVG muscle paths, is a human task** and
blocks nothing — `MuscleTile` renders a labelled colour block when given no `svgPath`, which is what
let the grid ship without it. The seam is the `svgPath` + `svgViewBox` prop pair.

## Open risks

New, or newly sharpened by Phase D:

- **`utils/workoutSupersets.ts` has no test suite of its own.** Its three exported helpers are
  covered only through `UpNextScreen` and `ActiveWorkoutScreen`, which means the shared algebra
  behind superset building is only as tested as those two screens happen to make it. The same is
  true of `hooks/useWorkoutRecommendation.ts` and `hooks/useGymProfiles.ts`. Worth a targeted unit
  suite before anything else builds on them.
- **Superset grouping is deliberately not persisted** (blueprint D9), so it is silently discarded by
  Swap, Refresh, Replace and the duration/gym chips — anything that replaces the payload. It is
  keyed by a signature of the prescribed exercise ids and derived during render, so a stale key
  drops it rather than re-homing groups onto a workout the user never saw grouped. Do not "fix"
  this by storing it on the recommendation.
- **Nothing refetches on app foreground or day rollover.** `useFocusEffect` does not re-fire when
  the app foregrounds onto an already-focused tab, so an Exercise tab left open overnight shows
  yesterday's numbers. The C4 handoff suggested folding this into D4; it was **not** folded in,
  because D4 is a documentation task and this is a behaviour change with its own test surface. It
  needs its own task. The fix belongs at screen level: one AppState `active` effect on
  `ExerciseHomeScreen`, following `useFasting.ts:285`.

Carried forward unchanged from C4, none introduced by Phase D:

- **`GymProfilesScreen` has the Android-back gap `PickMusclesScreen` fixed in C3.** Its editor mode
  sets `gestureEnabled`/`headerBackVisible` but registers no `beforeRemove` listener, so Android's
  hardware back pops the screen out from under an in-progress edit.
- **`useScreenHeader` does not honour a `kind: 'text'` left item.** Its comment claims a text left
  item replaces the system back button, but only `dismiss` sets `headerBackVisible: false`.
- **`` `${color}20` `` alpha suffixes are silently dropped** — the theme's values are `hsl(...)`
  strings and `processColor` returns the same opaque colour. `WorkoutCard.tsx:53` and
  `SwipeableExerciseRow.tsx:126` render fully saturated where a wash was intended. Cosmetic.
- **`weeklySetTargetsQueryKey` is still not invalidated by exercise writes.** Its key is a factory,
  so a fix invalidates by the `['weeklySetTargets']` prefix.
- **Health sync deliberately does not invalidate recovery.** An imported session has no sets, so it
  cannot move a freshness score — only `last_trained`, which nothing renders yet. Revisit
  `refreshHealthSyncCache` when E3 surfaces it.
- **Two competing equipment stores** (`coach_profiles.equipment`, AI-chat-only and not read by the
  generator, vs `gym_equipment_profiles.equipment`, which is what the generator reads). Do not add
  a third, and do not unify them here — that is its own migration.
- **The branch is unpushed.** Eleven commits ahead as of D4. Push to the fork (`origin` =
  `audaro/SparkyFitness`) only, never upstream.

## Device testing

Unchanged from C4 — see `docs/handoffs/exercise-home-c4.md` §"Working remotely", which is still
accurate and still the thing to read before touching Metro. The short version: Metro is served over
HTTPS on the tailnet and **must** be started with `EXPO_PACKAGER_PROXY_URL` set to that origin, or
the manifest loads and the bundle then fails in a way that looks like a broken app. All of Phase D
was pure JS, so nothing in it needed a new binary.
