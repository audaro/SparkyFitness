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

The rationale muscle (`replacementTargetMuscle`) is always a **primary** mover of the incoming
exercise, matching what the planner guarantees for a generated row. The alternatives ranker admits
candidates that match the anchor muscle only as a *secondary* mover, so a suggestion picked for "lats"
whose primary is "middle back" is explained against middle back on purpose — naming lats would put a
muscle in the rationale that the card's own `primary_muscles` do not list.

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

## Exit gates — both run, 2026-08-23

Run on an iPhone 17 Pro simulator against the local server (`localhost:3010`) and Docker Postgres,
using a seeded throwaway account (`w6gate@example.test`) with a 16-exercise free-exercise-db catalog
and four logged sessions — back work two weeks out, chest and legs recent.

**W6 passed, both entry points.**

- Up Next row ⋯ → Replace on "Close-Grip Front Lat Pulldown" → the search screen opened with a
  SUGGESTED section above the library: Chin-Up, One Arm Lat Pulldown, Pullups, Wide-Grip Lat Pulldown,
  Bent Over Barbell Row, Seated Cable Rows, Full ROM Lat Pulldown, Rope Straight-Arm Pulldown —
  familiar ones first, each with its equipment. Picking Seated Cable Rows swapped it in place at the
  same position, prescribed **47.7 kg from its own history** (logged at 47.5), and the stored row kept
  `status: active` and its original `generated_at`.
- Live workout ⋯ → Replace on "Bent Over Barbell Row" → same shortlist anchored on middle back;
  picking the Lat Pulldown swapped the live entry in place with PREV 52.5 × 8 from history.
- Server half separately verified by hand: `alternatives` ranked the trained Lat Pulldown top at 10.00,
  `replace` re-prescribed 4 × 10 @ 52.21 kg with a 31.78 kg warm-up (the Chin-Up it replaced had 3
  sets), and the three refusals answered 422/422/400.

**W5 passed too**, closing the gate `docs/handoffs/fitbod-w5.md` left open: dashboard card ("Middle
Back · Lats · Forearms · Glutes · Hamstrings · 6 exercises · 56 min") → Up Next → Start → Complete Set
→ rest timer counted down from the prescribed 1:30 → End workout → `WorkoutCompleteScreen` (1 of 17
sets, 420 kg volume). The logged set moved lats 98% → 43% and middle back → 63%, and the next
`generate` dropped both, returning lower back, triceps, abdominals, abductors, neck.

One thing the live path confirmed, already known as W8 item 6: a live replace seeds **one placeholder
set** with history as PREV rather than fetching the server's full prescription. The Up Next path does
not have this gap — it is server-owned.

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

- **The payload write is a compare-and-set on the payload itself** (`AND payload = $3::jsonb`), not a
  blind `WHERE user_id`. A regenerate landing between the service's read and its write matches no row,
  and Replace answers 422 rather than resurrecting the workout it replaced minus one exercise. The
  guard is the payload and not `updated_at` because Postgres keeps microseconds and `pg` truncates to
  milliseconds, so a round-tripped timestamp would rarely compare equal — every replace would look
  like a conflict. Do not "simplify" it to a timestamp.
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
