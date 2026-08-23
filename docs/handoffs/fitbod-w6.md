# Handoff — Fitbod blueprint W6 (Smart Replace)

Branch `feat/ai-coach`, unpushed. Plan: `~/fitness/FITBOD-BLUEPRINT.md` (W6 at :512). Previous step:
`docs/handoffs/fitbod-w5.md`.

## What shipped

| Commit     | Milestone                                                                     |
| ---------- | ----------------------------------------------------------------------------- |
| `ece4480b` | W6.4 — `POST /api/workout-recommendations/replace`, server-owned re-prescription |
| `f0d4a294` | W6.1/W6.3 — `suggestForExerciseId`, the Suggested section, Up Next ⋯ menu        |

### Server + shared (`ece4480b`)

- `shared/.../WorkoutRecommendations.api.zod.ts` — `replaceRecommendationExerciseRequestSchema`
  (`{ exercise_id_out, exercise_id_in }`, both uuid, `.strict()`).
- `shared/src/utils/workoutGeneration.ts` — `isCompound` is now exported.
- `models/workoutRecommendationRepository.ts` — `updateWorkoutRecommendationPayload(userId, payload)`.
- `services/workoutRecommendationService.ts` — `replaceRecommendationExercise` plus the private
  `replacementTargetMuscle`.
- `routes/workoutRecommendationRoutes.ts` — `POST /replace`, registered **before** `PATCH /:id`.
- `tests/workoutRecommendationService.test.ts` — a `replaceRecommendationExercise` describe (12) and
  five route tests. 65 in the file.

### Mobile (`f0d4a294`)

- `services/api/workoutRecommendationsApi.ts` — `fetchAlternatives`, `replaceRecommendationExercise`.
- `hooks/useWorkoutRecommendation.ts` — `useExerciseAlternatives`, `useReplaceRecommendationExercise`;
  `hooks/queryKeys.ts` — `exerciseAlternativesQueryKey`.
- `screens/ExerciseSearchScreen.tsx` — the Suggested section (the bulk of the diff).
- `screens/UpNextScreen.tsx` — per-row ⋯ → Replace (the menu W5 deliberately deferred).
- `screens/ActiveWorkoutScreen.tsx` — passes `suggestForExerciseId` through.
- `types/navigation.ts` — `ExerciseSearch.suggestForExerciseId`, `UpNext` selection params.
- `utils/workoutSession.ts` — `titleCaseCanonical` extracted (rule of two).
- Tests: `workoutRecommendationsApi` (9), `UpNextScreen` (14), `ExerciseSearchScreen` (22),
  `ActiveWorkoutScreen` (31).

### Four decisions worth knowing before touching this code

1. **Replace writes the payload, not the row.** `updateWorkoutRecommendationPayload` exists because
   `upsertWorkoutRecommendation` resets `status → 'active'` and `generated_at → now()`. Substituting
   an exercise must not un-start a workout in progress or claim the suggestion is newly generated.
   Pinned by a test that asserts the upsert is never called and `status: 'started'` survives.
2. **The replacement's slot comes from its own mechanic**, via the newly exported `isCompound` — not
   inherited from the outgoing exercise. A compound standing in for an isolation movement gets
   compound set counts and rest. `isCompound` is exported rather than copied because the slot drives
   both, and a second copy would prescribe differently depending on how the exercise got in.
3. **Prescription options are re-derived from the stored row** — its `target_duration_minutes`, its
   `gym_profile_id` — not from whatever is active now, so a replacement is never programmed against a
   different session than the one it joins. The incoming exercise is deliberately **not** filtered by
   `isEquipmentAvailable`: the user named it. A test pins that ("does not veto a replacement the gym
   profile could not have suggested").
4. **Suggested rows are resolved in full before selection.** `AlternativeExercise` carries no
   `category`, `modality` or `calories_per_hour`, and every caller snapshots the exercise it is
   handed — so a local row is refetched with `fetchExerciseById` and an external one imported, rather
   than the ranked row being reshaped client-side. Skipping this lands an exercise in a live workout
   with no modality and a zero calorie rate.

`muscle_groups` on the payload deliberately does **not** move when an exercise is replaced: it is the
"5 Muscles" header describing what the workout was *built around*, not a derived index of its current
contents. `estimated_duration_minutes` **is** recomputed.

## Gate status

- Server: `pnpm run validate` clean; `pnpm test` → **3958 passed / 2 skipped**, 274 files.
- Frontend (shared consumer): `pnpm run validate` clean; `pnpm test` → **954 passed**, 101 suites.
- Mobile: `pnpm run validate` clean (tsc + expo lint `--max-warnings 0` + i18n audit: 0 errors);
  full suite → **5446 passed, 1 failed, 5447 total** across 331 suites.

The single mobile failure is the known pre-existing timezone flake the blueprint says not to chase:
`__tests__/services/healthconnect/dataTransformation.test.ts`, a sleep-session `entry_date` expecting
`2024-01-16` and getting `2024-01-15`. Identical at HEAD without any W6 change.

**Neither the W5 nor the W6 exit gate has been run** — both need a device/simulator build. W6's:
in a live workout, ⋯ → Replace on "Lat Pulldown" suggests other back exercises doable with the active
gym profile, ranked with familiar ones first; picking one swaps it in place. W5's is still listed in
`docs/handoffs/fitbod-w5.md:52`. Do both before treating either milestone as closed.

## Deliberate deviations from the blueprint

1. **W6.2 (web parity) not done** — the blueprint itself says "do nothing, log it in W8". Logged
   here: web has no Replace affordance and no `/replace` client.
2. **No "Don't recommend again"** in the ⋯ menu. It needs a persisted exclusion list nothing has yet;
   it is a W8 item. The menu currently has exactly one action, which reads oddly but beats a dead row.
3. **No i18n namespace**, same reasoning as W5.2 — mobile screens are plain English today; folding
   these strings into the PR5 sweep keeps them consistent with their siblings.

## Exact next step

**W7 — AI coach integration** (blueprint §W7.1–W7.4). Nothing in W7 depends on unfinished W6 work.

## Open risks

- **`updateWorkoutRecommendationPayload` matches on `user_id` only.** A `generate` landing between
  the service's read and its write would be clobbered by the spliced older payload. Judged not worth
  guarding: the UI is single-user and sequential, and a `generated_at` guard would surface as a 404
  with a misleading message. If W7 ever regenerates in the background, this needs a real compare-and-set.
- **The mutation writes the server response straight into the cache** (`setQueryData`, no invalidate),
  matching the rest of the recommendation hooks. Correct only while `/replace` returns the complete
  row — if it is ever narrowed to a delta, this silently truncates the cached workout.
- **Active-workout Replace and Up Next Replace are different code paths.** The live one swaps in the
  Zustand session store (`activeWorkoutStore.replaceExercise`) and never calls the server; the Up Next
  one is server-owned. They share only the search screen. A change to "what Replace means" has to be
  made twice.
- **`ExerciseSearchScreen`'s selection path has no `finally`.** Deliberate — the react-compiler-backed
  `react-hooks/*` rules cannot lower `finally` in an async component callback, so the resolving-row
  state is cleared on both branches by hand, mirroring `handleImportExercise`. A refactor that
  "tidies" this into a `finally` will fail `expo lint --max-warnings 0`.
- **The Suggested section is a `ListHeaderComponent` on both lists.** That is what keeps it reachable
  when a typed search matches nothing (`StatusView`'s default `flex-1` container collapses inside a
  list content container, hence the `inline` parameter on `renderSearchEmptyState`). A regression test
  covers it; do not re-inline those empty-state short-circuits.
