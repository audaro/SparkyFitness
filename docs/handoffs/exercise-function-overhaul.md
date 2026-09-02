# Exercise function overhaul (iOS mobile)

*Session: 2026-09-01*

A full pass over the mobile Exercise experience: how workouts are generated
by the engine and through chat, how sets are logged, saved and reported, and
how a first-time user finds their way around the Exercise tab. Every finding
below was either fixed and committed or is listed under open risks.

## What shipped

| Commit | Package | Summary |
| --- | --- | --- |
| `ef4a78977` | shared, server | Generation engine and server fixes: progression that could not move below ~50 kg, history reader treating a future plan as last session, 160-minute "30-minute" workouts, fatigue earned by pressing Start, chat logging storing pounds as kg, HealthKit re-sync deleting the morning's workout, PR query using a different 1RM formula than the engine. |
| `ec351545b` | server | Generation 422 says which side is empty: the gym profile filtered everything out, or the library has no exercises at all. |
| `0adf526c6` | mobile, qa | Mobile fixes, Today's Workout lifecycle, chat proposal card, UX simplification, QA walks. Details below. |
| `d929f334f` | mobile, qa | Chat proposal card exercised on device (`workout-proposal` scenario) and the three defects it found fixed; sub-minute duration floor. Details below. |
| `a23081026` | mobile | Abandon paths hand Today's Workout back: `clearActiveWorkout` PATCHes the recommendation to `active` (or `completed` from a fully-done HUD clear); the card shows "In progress" while the workout is live. |

### Mobile bug fixes (`0adf526c6`)

- **Reconcile no longer wipes local progress.** `reconcileWithSession` keeps
  local completion and PR state for set ids the device already knows and
  adopts server `completed_at` / `is_pr` only for ids that are new to it.
  Previously any server refresh reset every set the user had just ticked.
- **Activity payload forwards `completed_at` and `is_pr`.** Saving a session
  used to drop which sets were done or hit a PR.
- **Warm-up detection** goes through `isWarmupSetType` everywhere instead of
  a bare string compare that missed alternate spellings.
- **Finish is double-tap safe** via a ref guard. The prior `try/finally`
  inside `useCallback` made the React Compiler bail on the whole component,
  which silently switched off react-hooks lint for the file (symptom: an
  "unused eslint-disable directive" warning elsewhere in the file).
- **Save as Preset backfills skipped sets** with the planned reps, weight,
  duration and distance (`backfillPlannedSetValues`). Live starts create
  every set empty, so a routine saved from a partial workout had blank rows.
- **Today's Workout lifecycle closes.** Starting from Up Next passes the
  recommendation id through the store into the Complete screen, which marks
  it `completed` once. The card shows "Done today"; Up Next offers "Do it
  again" instead of "Start workout".
- **Done returns to the Exercise tab**, not wherever the workout was
  launched from.
- **422 on generation shows the server's reason** (the gym-profile message)
  instead of generic copy.
- **Chat proposal card.** The server's `sparky_propose_workout_preset` tool
  was invisible in the mobile chat. `WorkoutProposalCard` renders it with
  Save routine / Request changes, and the part type is now seeded so it
  survives a history reload.

### Chat proposal on device, and what it found (`d929f334f`)

- **New scenario `qa/flows/workout-proposal.yaml`** with `setup/`, `fixtures/`
  and `oracles/` siblings. The QA stub (`qa/bin/qa-ai-stub.mjs`) now plays a
  chat model: search the library, propose what came back as a
  `sparky_propose_workout_preset` card, acknowledge the acceptance. 19 oracle
  checks read the created preset (sets, kg, rest, order, ids that came from
  the server's search), the persisted history (proposal part, acceptance,
  acknowledgement) and the stub's request log. Flow and oracles all pass.
- **Chat falsely gated on a fresh install.** `VoicePushToTalk` at the app root
  calls `useActiveAiServiceSetting` at launch, before onboarding has created a
  server; `fetchActiveAiServiceSetting` returns `null` silently in that case
  and React Query cached it for five minutes, so the first chat after sign-in
  said "No active AI provider". `ChatScreen` now uses `staleTime: 0`, and
  onboarding, server settings and the setup modal invalidate
  `activeAiServiceSettingQueryKey` when the active server changes.
- **First tap on the card only dismissed the keyboard.** The thread FlatList
  used the RN default; it now sets `keyboardShouldPersistTaps="handled"`.
- **Stub tool-call ids collided** (per-second timestamp) and the client merged
  the proposal into the search's part, rendering a generic chip. Serial ids
  now, and the oracle asserts distinctness.
- **Duration floor.** `formatDuration` returns "<1 min" for sub-minute
  sessions instead of "0 min".
- Composer Send button has an accessibility label and `testID="chat-send"`.

### UX simplification (`0adf526c6`)

Audit stance: a non-technical person opening the Exercise tab for the first
time. Nothing was removed; labels and entry points were made legible.

- Primary **"Start a workout"** button under the Today's Workout card. The
  only way to start before was the + sheet or scrolling to Quick access.
- Renames: Up Next → **Today's Workout**, Pick muscles → **Choose muscles**,
  On demand → **Quick workouts**, Create from scratch → **Build my own**,
  Generate → **Build today's workout**. Add-sheet options now carry a
  one-line "what this does" (Track sets as you go / Sets you already did /
  Run, walk, ride: time & distance).
- Header back labels on Gym Profiles, Exercise Packs and Weekly Set Targets
  read "Back" instead of a truncated screen name.
- Recovery tiles widened so "Abdominals" no longer wraps; "Today at" no
  longer runs into the time; "End without saving" says what it actually
  does (saves what it can, then removes the workout from this device).
- Push-to-talk mic hidden on the workout-picking screens where it sat on top
  of the primary action.

## Gate status

| Gate | Result |
| --- | --- |
| Server `pnpm run validate` + vitest | green (committed in `ec351545b`) |
| Mobile `pnpm run validate` | green (tsc, expo lint 0 warnings, i18n audit 0 blocking) |
| Mobile jest `--runInBand` | 389 suites, 6335 tests, all passing |
| Maestro `ux-walk` | PASS |
| Maestro `ux-walk-2` | PASS (4m 35s), screenshots in `qa/run/shots2/40..62` |
| Second-opinion review | not run: codex reviewer is down (see `~/.claude/CLAUDE.md`) |

## QA harness notes learned this session

- Native header items (Edit, Cancel, Save in the navigation bar) are not
  visible to Maestro by text or testID. Anchor on body content instead.
- After "Complete Set" the bottom bar becomes a rest timer; tap "Skip rest"
  before the next set.
- Settings has a row titled "Home", so `tapOn: "Home"` from Settings opens
  dashboard options. Tap the tab by position (`point: "10%,93%"`).
- Tapping a gym-profile row toggles it active; the pencil ("Edit <name>")
  opens the editor.
- Assistant replies (`react-native-enriched-markdown`) expose nothing to
  XCUITest: `maestro hierarchy` shows the user bubble and `syncing, Retry`
  but never the reply text. Wait on the user bubble and `id: chat-send`
  instead, and let the oracle read the reply from `sparky_chat_history`.
- Card buttons are disabled while the reply streams; wait with
  `visible: {id: …, enabled: true}` before tapping or the tap is dropped.
- `maestro hierarchy` needs the harness Java: run it through
  `bash -c '. qa/bin/qa-env.sh; maestro --device $(cat qa/run/sim.udid) hierarchy'`.

## Open risks

- ~~Clearing the live HUD leaves the recommendation `started`.~~ Fixed in
  `a23081026`: every abandon path goes through `clearActiveWorkout`.
- ~~Duration rounding on the Complete screen.~~ Fixed in `d929f334f`.
- ~~The chat proposal card is untested on device.~~ Fixed in `d929f334f`:
  `workout-proposal` drives it against the stub, 19 oracle checks green.
- **Codex reviewer is down**, so neither `0adf526c6` (~1.9k lines) nor
  `d929f334f` has had independent review. Re-run the marker once the
  ChatGPT plan is active.
- **VoiceOver on assistant replies is unverified.** The markdown view builds
  its own accessibility elements, but XCUITest sees none of them; whether
  VoiceOver reads Sparky's replies has not been checked on a device.

## Exact next step

Nothing is blocked and nothing is open apart from the review and VoiceOver
notes above. If picking this up fresh: `bash qa/bin/qa-run.sh ux-walk-2` and
`bash qa/bin/qa-run.sh workout-proposal` both pass at `d929f334f`; run them
before changing the exercise or chat flows.
