# Handoff — Fitbod blueprint W5 (mobile "Up Next" surface)

Branch `feat/ai-coach`, unpushed. Plan: `~/fitness/FITBOD-BLUEPRINT.md`. Previous step:
`docs/handoffs/fitbod-w4.md`.

## What shipped

| Commit     | Milestone                                                                      |
| ---------- | ------------------------------------------------------------------------------ |
| `1f4c9f1e` | W5.1/W5.3 — API client, `useWorkoutRecommendation`, `buildRecommendationStartPayload` |
| `318a6b5b` | W5.2/W5.4 — `UpNextScreen`, `UpNextCard`, preset-search row, route wiring       |

New files, all in `SparkyFitnessMobile/`:

- `src/services/api/workoutRecommendationsApi.ts` — `fetchRecommendation` / `generateRecommendation`
  / `patchRecommendationStatus`.
- `src/hooks/useWorkoutRecommendation.ts` — query + generate mutation, and
  `useUpdateRecommendationStatus`.
- `src/screens/UpNextScreen.tsx`, `src/components/UpNextCard.tsx`.
- Tests: `__tests__/services/workoutRecommendationsApi.test.ts` (6),
  `__tests__/screens/UpNextScreen.test.tsx` (10), `__tests__/components/UpNextCard.test.tsx` (4),
  plus a `workout recommendations` describe block in `__tests__/utils/workoutSession.test.ts`.

Touched: `apiClient.ts` (added `PATCH` to the method union — the status route needs it),
`queryKeys.ts`, `utils/workoutSession.ts`, `types/navigation.ts`, `navigation/safeScreens.tsx`,
`App.tsx`, `nativeHeaderContract.test.ts`, `stores/appPreferencesStore.ts` (`upNextCardVisible`),
`DashboardScreen.tsx`, `DashboardSettingsScreen.tsx`, `PresetSearchScreen.tsx`.

### Two decisions worth knowing before touching this code

1. **Set-type vocabulary is re-keyed at the payload boundary.** The engine emits the shared
   canonical `'Working Set' | 'Warmup' | 'Drop Set' | 'Failure'`; mobile's `setTypeLetter` and
   `isDropSetType` match the lowercase `'normal' | 'warmup' | 'drop' | 'failure'` **exactly**.
   Passing canonical values straight through fails silently — warm-ups render as numbered working
   sets and drop sets get a full rest. `CANONICAL_TO_MOBILE_SET_TYPE` in `workoutSession.ts` does
   the mapping; two tests pin it. Anything else that consumes a server payload client-side needs the
   same treatment.
2. **404 is not an error.** The GET route answers 404 for a user who has never generated. The API
   client resolves that to `null` (via `ApiError.statusCode`, not string matching) so the first-run
   user sees the Generate CTA rather than a retry screen.

## Gate status

`pnpm run validate` clean (tsc + expo lint `--max-warnings 0` + i18n audit: 0 errors).
Full mobile suite: **5432 passed, 1 failed, 5433 total** across 331 suites.

The single failure is **pre-existing and unrelated**: `__tests__/services/healthconnect/
dataTransformation.test.ts`, a sleep-session `entry_date` expecting `2024-01-16` and getting
`2024-01-15`. Confirmed by `git stash -u` — it fails identically at HEAD without any W5 change.
It is timezone-dependent and will presumably pass in CI; worth fixing separately.

**W5 exit gate (the milestone demo) has NOT been run** — it needs a device/simulator build:
open app → Dashboard shows Up Next → tap through → swap → start → complete a set → rest timer
fires with the prescribed rest → finish → `WorkoutCompleteScreen`, then confirm the next
`generate` drops the freshly-trained muscles. Do this before treating W5 as closed.

## Deliberate deviations from the blueprint

1. **Duration/gym chips use `BottomSheetPicker`, not `WorkoutDurationSheet`.** Read the latter first
   as the blueprint asked; it is a max-capped free-entry editor for a *completed* workout's counted
   minutes — wrong semantics for a target. Discrete options (30/45/60/75/90/120) match both Fitbod
   and the server's 15–180 constraint.
2. **No `upNext` i18n namespace (W5.5).** Mobile screens are plain English strings today — the i18n
   audit reports 2512 hardcoded UI strings as "informational, PR5 scope", and only
   `AppSettingsScreen` and `useScreenHeader` call `t()`. One translated screen among untranslated
   siblings would be the inconsistency, not the fix. Fold it into the PR5 sweep.
3. **No per-row ⋯ overflow (Replace / "Don't recommend").** Both need W6: the
   `suggestForExerciseId` route param and `POST /api/workout-recommendations/replace`. A dead menu
   is worse than none — add it as part of W6.1.

## Exact next step

**W6 — Smart Replace** (blueprint :512). Order:

1. `workoutRecommendationsApi.ts` gains `fetchAlternatives(exerciseId, limit)` — the W4.8 endpoint
   is already live and returns ranked `CandidateExercise[]`.
2. `ExerciseSearchScreen` gains the optional `suggestForExerciseId` route param (extend
   `RootStackParamList['ExerciseSearch']` additively at `navigation.ts`), rendering a "Suggested"
   section above search results. External rows import on select via the existing `importExercise`
   (`externalExerciseSearchApi.ts:37`).
3. Pass the param from `ActiveWorkoutScreen.handleReplaceExercise` **and** add the deferred ⋯ menu
   to the `UpNextScreen` exercise rows.
4. Non-live replace needs the new `POST /api/workout-recommendations/replace`
   `{ exercise_id_out, exercise_id_in }` so prescriptions stay server-owned (~40 lines reusing
   W4.5).

## Open risks

- **Start marks the recommendation `'started'` optimistically.** `useStartLiveWorkout.startLiveWorkout`
  swallows its own failures (it owns the toast) and returns the same void promise either way, and
  the "workout already in progress" prompt makes the store's `sessionId` a false success signal —
  so there is nothing honest to gate on. Nothing server-side branches on the status yet, so this is
  currently free. If W7+ starts reading `status`, this needs a real success signal from the start
  hook first.
- **Regeneration is guarded by a `useRef`, not the mutation's pending state.** Disabled props follow
  a render, so they cannot stop a fast second tap. Same pattern `useStartLiveWorkout` uses. Any
  refactor that drops the ref reintroduces double-generate.
- **The card and screen are "now"-based and ignore `selectedDate`.** Deliberate — a recommendation
  is for today — but it sits inside a date-navigating dashboard, so a user scrolled to last Tuesday
  still sees today's workout. Left as-is; flagged in a comment at the insertion site.
- **Null weights render as a blank, not a zero** (band/bodyweight prescriptions, per the W4 handoff).
  `formatRecommendedSets` drops the weight segment entirely when `weight` is null. Preserve that.
- **`upNextCardVisible` defaults to `true`**, so every existing user gets a new dashboard card on
  next launch. Toggle lives in Dashboard Settings.
