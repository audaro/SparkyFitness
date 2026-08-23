# Handoff — Fitbod blueprint W7 (AI coach integration)

Branch `feat/ai-coach`, unpushed. Plan: `~/fitness/FITBOD-BLUEPRINT.md` (W7 at :510). Previous step:
`docs/handoffs/fitbod-w6.md`.

## What shipped

| Commit     | Milestone                                                                       |
| ---------- | ------------------------------------------------------------------------------- |
| `a8942356` | W7.2 — the coaching prompt fragment + AGENTS.md routing                          |
| `322c5770` | W7.3 — gym-profile actions on `sparky_manage_coach_profile`                      |
| `4cc89b59` | W7.1/W7.4 — `get_muscle_recovery` and `generate_workout` on `sparky_manage_exercise` |

### W7.1 — two engine read actions (`4cc89b59`)

- `ai/tools/schemas/exercise.ts` — `getMuscleRecoverySchema` (no args) and `generateWorkoutSchema`
  (`{ duration_minutes?: 15..180 int, swap?: boolean }`), both added to `manageExerciseSchema`, the
  published action enum, and (for `swap`) the flat `manageExerciseInput`.
- `ai/tools/exerciseTools.ts` — `VALID_ACTIONS` extended and **exported**; `renderMuscleRecovery`,
  `formatRecommendationSet`, `renderRecommendedExercise`, `renderGeneratedWorkout`; the two handler
  cases; a `swap` branch in the action-inference function.
- Tests: `tests/chatbotToolsExercise.test.ts` grew a recovery describe (2), a generate describe (6),
  and an action-surface describe (1). 95 in the file.
- `tests/chatbotToolSchemas.test.ts` — the `manageExerciseInput` property and action pins.

### W7.3 — gym profiles from chat (`322c5770`)

- `ai/tools/schemas/coachProfile.ts` — `gymProfileSelectorFields`, `getGymProfilesSchema`,
  `setActiveGymProfileSchema`.
- `ai/tools/coachProfileTools.ts` — `describeGymProfile`, `renderGymProfiles`, the two cases,
  `VALID_ACTIONS` exported, and a `set_active_gym_profile` branch in action inference.
- Tests: `tests/chatbotToolsCoachProfile.test.ts` grew a gym-profiles describe (8). 17 in the file.

### W7.2 — prompt (`a8942356`)

`prompts/chatbot-full-coaching.md` gained a "Today's session comes from the engine" section above the
progression rules, which now open by saying what they govern (multi-week PLAN updates — the engine
owns one session at a time). `SparkyFitnessServer/AGENTS.md`'s recommendation-engine routing entry
names the four new actions and the handoff mechanism.

### Five decisions worth knowing before touching this code

1. **The handoff sentence is the whole mechanism.** `generate_workout` prints the payload **with its
   local exercise uuids** and closes with `Now present this to the user by calling
   sparky_propose_workout_preset with these exercises and sets verbatim — do not alter the
   programming.` Tool results are stripped from later turns, so a same-turn instruction is the only
   reliable way to move the ids into the proposal card — the same reason confirm-food replays
   `food_id`/`external_id` in its flattener. Drop the ids or the sentence and the model invents ids
   and the card commits nothing. Pinned by an exact-string golden.
2. **`WorkoutGenerationError` maps to VALIDATION, not DB_ERROR.** An empty catalog is a state of the
   user's data, not a fault; the REST route answers it 422 for the same reason. It matters because
   `ERRORS.DB_ERROR`'s suggestion text is *"Do NOT retry the same call"* — the opposite of the right
   advice when adding an exercise and asking again is exactly the next move. Caught inside the case
   rather than the outer handler so it also does not log at error level. A second test pins that a
   genuine failure still reaches DB_ERROR.
3. **The action list lives in three places** — the handler switch, the enum published to the model,
   and the strict union that validates the call. An action in one and not the others either never
   reaches the model or is rejected on arrival (the blueprint calls this out as a known trap).
   `VALID_ACTIONS` is now exported from both tool modules purely so one test pins all three
   together; there is a copy of that test in each tool's suite.
4. **`set_active_gym_profile` resolves names server-side** (exact lowercase, then substring). The
   uuids are never in the conversation and the user names a profile — "I'm at home today" — so
   requiring the id would force a round trip through `get_gym_profiles` on every switch. Activation
   does **not** invalidate the chat-context cache, unlike `update_coach_profile` directly above it:
   the system prompt embeds the coach profile, not the gym profile.
5. **`duration_minutes` is shared with `log_exercise`, `swap` is not.** So the inference function
   routes a bare `swap` to `generate_workout` and deliberately leaves a bare `duration_minutes`
   inferring `log_exercise` — its older meaning (the length of a logged session) is far more common.
   The union's 15..180 bounds mirror `generateWorkoutRecommendationRequestSchema` in
   `@workspace/shared`, so the tool and the REST route reject the same values.

The recovery table carries `RECOVERY_TUNABLES` in a closing sentence rather than a hard-coded copy:
"36% fresh" is not actionable without the fatigue load and half-life that produced it, and a second
copy of those constants in a render function drifts the first time they are retuned.

The MCP surface needs no parallel edit — `ai/mcp/mcpAdapter.ts` builds from `buildChatbotTools`, so
it picks the actions up automatically. No new tool was added, so `chatbotToolsIndex.test.ts`'s
surface pins, `CATEGORY_ORDER`, and the Anthropic cache breakpoint are untouched.

## Gate status

- Server: `pnpm run validate` clean; `pnpm test` → **3978 passed / 2 skipped**, 274 files (+20 over
  W6's 3958).
- Frontend, mobile, shared: **not run — not touched.** Every change in this milestone is inside
  `SparkyFitnessServer/`.
- Registry smoke test outside vitest (mocks hide import cycles): `buildChatbotTools` loads the real
  modules and returns 37 tools with both new action families in their descriptions.

## Exit gate — passed, 2026-08-23

### Tool half, against the seeded account

Ran the real tool handlers against the running Docker Postgres as `w6gate@example.test`
(`352c8b4f-…`), bypassing vitest's pool-boundary mocks:

- `get_muscle_recovery` returned all 17 muscles ordered freshest-first — lower back 89% (last trained
  2026-08-22) down to lats 43% (2026-08-23) — with the tunables sentence.
- `get_gym_profiles` returned the no-profile explanation (that account has none).
- `generate_workout` with `duration_minutes: 45` built a 43-min, 5-exercise session around lower
  back, triceps, abdominals, abductors and neck, each row carrying its local uuid, modality,
  equipment, rationale and per-set prescription, closing with the handoff sentence.

### Chat half, against the real account with a live OpenAI call

Two gym profiles were created first on the maintainer's own account through
`createGymProfile`, not raw SQL, so RLS and the activation transaction both applied: **Commercial
Gym** (barbell, cable, dumbbell, machine, body only, e-z curl bar, kettlebells — matching that
account's own catalog, which is all Machine/Cable/Dumbbell rows) set active, and **Home** (dumbbell,
bands, body only). That account has **zero exercise entries and 16 hand-made exercises with no
muscles and no equipment**, so every candidate came from a live free-exercise-db import.

**Turn 1 — "What should I train today?"** The coach called `generate_workout`, then
`sparky_propose_workout_preset`. Comparing the card's arguments to the stored
`workout_recommendations` row: all five exercises matched **verbatim** — same uuids, same 3×10, same
loads (Alternating Floor Press 8 kg, Barbell Glute Bridge 20 kg, Bent-Arm Barbell Pullover 20 kg,
90/90 Hamstring bodyweight, Alternating Kettlebell Row 8 kg), same 120/90 s rests. Nothing
hand-written, nothing altered.

**Turn 2 — "I am at home today, regenerate"** produced exactly the gate's three calls in order:

1. `sparky_manage_coach_profile { action: 'set_active_gym_profile', gym_profile_name: 'Home' }` —
   the name resolved from prose, with no `get_gym_profiles` round trip;
2. `sparky_manage_exercise { action: 'generate_workout', swap: false }`;
3. `sparky_propose_workout_preset` with a visibly different, equipment-appropriate session — Around
   The Worlds 5 kg, Chin-Up, Bent Over Two-Dumbbell Row 5 kg, Butt Lift (Bridge), 90/90 Hamstring —
   again matching the regenerated payload verbatim. `Home` is now the active profile in the DB.

**Accept** was then driven with the card's arguments mapped exactly as
`WorkoutPresetProposalToolUI.handleAccept` maps them, through `workoutPresetService.createWorkoutPreset`
— the same service the REST route calls. It created **preset 167 "Home Workout"**, and the stored
rows carry the engine's programming intact: 5 exercises, 3 sets each, 10 reps, 5 kg where the engine
prescribed it and null where it did not, 120/90 s rests.

Two caveats on how this was driven, both harness-level rather than product-level:

- It went through `processChatMessage`, not `processChatMessageStream`. Tool orchestration, system
  prompt, tool selection and stop conditions are the same code; only the client-visible text handling
  differs. `processChatMessage` has **no production caller** — grep finds only `chatService.test.ts`.
- That path's empty-text fallback invented "I've recorded that for you!" for a turn that only
  proposed. It is a pre-existing wart in the unused path, not a W7 regression: the streaming path
  special-cases a turn ending on a proposal call (`chatService.ts:2559`) and never fabricates a
  confirmation. Worth knowing if anything ever revives `processChatMessage`.

The literal button click and the card's pixels are the only things not exercised.

## Deliberate deviations from the blueprint

1. **No `Warmup` set in the live-generated sessions above** — the seeded account's exercises had no
   load history, so the engine prescribed bodyweight-style working sets only. The render path for
   warm-ups is covered by the golden test, not by that live run.
2. **The generated workout is not announced as saved.** `generate_workout` upserts the
   `workout_recommendations` row (it is the same call the Up Next card makes), but the rendered text
   does not say so — the model is told in the tool description instead. Putting it in the output
   competed with the proposal-card instruction for the model's attention.
3. **`swap` re-rolls but cannot always differ.** On the 16-exercise seeded catalog the swap call
   returned an identical workout: the penalty is a score adjustment, and each target muscle had one
   eligible candidate. That is the documented behaviour, not a regression — it needs a real catalog
   to demonstrate.

## Open risks

- **The three-list action sync is guarded by a test, not by the type system.** Adding an action to
  the handler switch alone still compiles; the pins in both tool suites are what fail.
- **The strict union rejects stray keys on the zero-arg action.** A model that sends
  `{action: 'get_muscle_recovery', entry_date: '…'}` gets a VALIDATION error rather than the table.
  This is pre-existing for every no-arg action (`get_workout_presets`, `get_workout_plans`) and was
  left consistent on purpose — do not loosen one without the others.
- **The coaching prompt fragment loads with the `coaching` category, which does not imply the
  `exercise` tools are active.** The new section carries the same activate-or-ask guard the
  progression rules already use; if the tool selector ever stops gating by category, that sentence
  becomes dead weight rather than wrong.
- **Live generation surfaced W8 item 8 again**: with no gym profile, the engine prescribed "Atlas
  Stone Trainer" (equipment `other`) and programmed "Chin To Chest Stretch" as 3×10 `weight_reps`;
  the real account's gated run programmed "90/90 Hamstring" — a stretch — as 3×10 in both sessions.
  Engine-level (W4/W8), not W7 — but W7 is what puts them in front of the model in prose, and now in
  a saved preset, where they read worse than they do as a card.
- **On a thin catalog the first chat `generate_workout` blocks on sequential free-exercise-db
  imports** — one GitHub contents call plus one raw-file fetch per unserved muscle, up to five, all
  inside the tool call. The REST path pays the same cost behind a spinner; in chat it is dead air
  before the card appears, and it counts against `CHAT_REQUEST_TIMEOUT_MS`. Only hits accounts whose
  catalog cannot serve the target muscles, which is exactly a fresh install.
- **`renderGeneratedWorkout` has no length guard.** Unlike `formatList`/`formatSuccess` it does not
  go through `truncateIfNeeded`, because truncating this output mid-workout would hand the proposal
  card a partial routine — silently dropping the last exercises the user is told they will do. A
  ten-exercise session runs around 2 KB; if the engine's ceiling ever rises materially, cap the
  exercise count in the engine rather than cutting the string here.

## Exact next step

**W8 backlog** (blueprint §W8) — no ordering constraint; pick what adjacent work makes cheap. The
items this milestone touched or re-surfaced: item 8 (equipment vocabulary), item 6 (live-replace
prescriptions, carried from W6), item 3 (web parity).
