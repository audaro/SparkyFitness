# Handoff — Fitbod blueprint W8: engine quality (stretches and unavailable gear)

Branch `feat/ai-coach`. Plan: `~/fitness/FITBOD-BLUEPRINT.md` (W8 at :566, item 8). Previous step:
`docs/handoffs/fitbod-w7.md`, whose "open risks" section is what this closes.

## What this fixes

Two things the W7 live gate caught the engine doing, both of which put an exercise the user cannot
perform — or cannot perform *that way* — into a proposal card and then into a saved preset:

1. **Stretches programmed as 3x10 weighted sets.** "Chin To Chest Stretch" and "90/90 Hamstring"
   came back as three sets of ten with a rest timer built for a compound lift.
2. **Gear the user does not have.** An Atlas Stone Trainer (equipment `other`) for an account with
   no gym profile, and a Chin-Up for a dumbbells-and-bands home profile — `Chin-Up` is `body only`
   upstream, so every equipment filter in the codebase passed it.

Both were engine-level (W4/W8), which is why W7 logged them rather than fixing them.

## The two mechanisms

### `exercises.category` now reaches the engine

`e.category` was already in `CANDIDATE_COLS`, but only fed `resolveExerciseModality`. It is now a
field on `CandidateExercise`, and it is what separates a hamstring *stretch* from a hamstring
*exercise*: both are `body only`, both name hamstrings as the primary mover, and only one of them is
three sets of ten.

- `isMobilityExercise` — `category === 'stretching'`. `isometric`/`isometrics` deliberately do not
  count: a plank is a training set that happens to be timed, and it already resolves to the
  `duration` modality.
- `prescribeSets` gained a mobility branch **ahead of** the modality branches, returning
  `mobilitySets` (2) holds of `mobilityHoldSeconds` (30) with `restMobility` (30), no reps, no
  weight, no progression, and honouring a logged hold if the user has one.
- `Prescription` gained `modality` and `mobility`. `programExercise` publishes
  `prescription.modality`, not the catalog's stored value, and feeds it to `warmupSetsFor` — so a
  stretch reaches the client as `duration` and gets no ramp.
- `scoreCandidate` applies `mobilityPenalty` (-4), sized to beat `familiarityBonus + levelMatchBonus`
  so a stretch the user has done twenty times still loses to a press they have never done.
- `unservedMuscles` no longer counts a mobility row as coverage, so a stretch-only muscle triggers
  the free-exercise-db import; `importMissingMuscles` then prefers a non-stretching primary mover
  and takes a stretch only if upstream moves that muscle no other way.
- `rationaleFor` says `fresh hamstrings · mobility hold` rather than "first time — starting light",
  which reads as a conservative weight on a movement that has no weight.

### `shared/src/constants/exerciseApparatus.ts` — richer equipment metadata than upstream ships

The blueprint's W8 item 8, done at the point it named ("do it when the engine starts prescribing
these").

- `APPARATUS_BY_SOURCE_ID` — 21 free-exercise-db `source_id`s whose `body only` is a lie: 8 that
  need something to hang from, 11 that need a bench under you, one dip station, one squat rack.
  Verified against `dist/exercises.json` on 2026-08-23; every key is a real upstream id carrying
  `"equipment": "body only"`.
- `isPerformable(candidate, availableEquipment)` replaces `isEquipmentAvailable` at all three engine
  call sites (planner, `unservedMuscles`, alternatives). Equipment subset test first, then apparatus.
- `isEquipmentAvailable` gained one rule: `OPT_IN_EQUIPMENT` (`other`) is not admitted even with no
  gym profile. That case — "the user has not said where they train" — was the only way an Atlas
  Stone reached a card.
- Upstream rows are held to the same bar *before* they are imported (`asExternalCandidate`), so a
  home profile no longer spends a network round trip plus image downloads on a Chin-Up the very next
  plan discards, and no longer sees one in the Replace suggestion list either.

## Four decisions worth knowing before touching this code

1. **The stored `exercises.modality` is left alone, on purpose.** Mapping `stretching` → `duration`
   in `deriveExerciseModality` is the tidier fix and it is wrong here: that function is synced with
   the backfill `CASE` in `20260727100000_set_duration_seconds_modality_distance.sql`, the column is
   `NOT NULL` and already populated, and a migration flipping existing stretch rows would re-render
   sets users have already logged (a stretch logged as 3x10 would lose its reps behind a duration
   editor). So the engine decides the shape of its own prescription and publishes it on the payload.
   **Known consequence:** a stretch accepted into a *preset* still renders per the exercise row's
   own modality, because presets resolve modality from the exercise. The engine no longer programs
   one unless nothing else moves the muscle, which is what makes that acceptable rather than fine.
2. **Apparatus availability is inferred, and it is the only option.** `gym_equipment_profiles.equipment`
   is validated against the pinned upstream enum (`GymEquipmentProfiles.zod.ts`), so a user
   *literally cannot* declare a pull-up bar. `APPARATUS_IMPLYING_EQUIPMENT` is `barbell`/`cable`/
   `machine` — the three values a dumbbells-and-bands room does not have and every real gym does.
   A garage with a barbell but no pull-up bar is the case it gets wrong, and it gets it wrong in the
   recoverable direction. **Having logged the exercise before overrides the inference**; it does not
   override the profile itself, because a barbell squat logged at the gym last month is still not
   doable in a dumbbell-only garage today.
3. **It is a code constant, not the override table the blueprint sketched.** The data it overrides is
   itself a pinned, versioned dataset. A table would need seeding from this same list plus a backfill
   for every already-imported row, and would then be a second copy to keep in step. Keyed on
   `source_id` because the importer stores the upstream id verbatim and — unlike the name — the user
   cannot edit it out from under us. The lookup is a `Map`, not the object literal: `source_id` is a
   database value, and `APPARATUS_BY_SOURCE_ID["constructor"]` returns a function whose truthy
   `.length` would read as "needs one apparatus" and hide the row from every home profile.
4. **The mobility penalty is soft, the apparatus gate is hard.** A muscle whose catalog offers only a
   stretch still gets the stretch — programmed as a hold — because an empty slot is worse. A muscle
   whose only candidate needs a bar the user has not got gets nothing, because a set they cannot
   perform is worse than one fewer exercise.

## Where the bench list stops

The rule is "no ordinary household substitute". Hanging is the clear case: without a fixed overhead
bar the movement is impossible, not harder. The bench entries are the ones whose instructions have
the lifter lying or seated *on* a bench (hips off the end, hands gripping the sides). Incline
Push-Up, Bench Jump, Step-up with Knee Raise and Push-Ups With Feet Elevated all work off a chair or
a step and are **absent on purpose** — the blueprint's argument against dropping `body only`
wholesale is that it would trade ~12 wrong suggestions for ~99 missing correct ones, and the same
argument bounds this list.

## Gate status

- Server: `pnpm run validate` clean; `pnpm test` → **4043 passed / 2 skipped**, 280 files (+65 over
  W7's 3978).
- Frontend: `pnpm run validate` clean. Mobile: `pnpm run validate` clean (typecheck + lint + i18n).
  Both were run because `shared/` changed; neither package's source was touched.
- **One unidentified flake.** The first full server run after the last edit reported `1 failed`
  without naming it in the captured output; five subsequent full runs were green. It is not in the
  two suites this change touches (those were run in isolation repeatedly). Worth watching rather
  than assumed benign.

## Not done — deliberately

- **No live gate.** W7's exit gate was demonstrated against the running Docker Postgres and a real
  OpenAI call; this change was not. Everything here is covered by unit tests at the pure and service
  layers, and the two live symptoms are pinned as service-level tests with the real upstream ids
  (`Chin-Up`, `Atlas_Stone_Trainer`, a `stretching` row). Re-running the W7 chat gate against a home
  profile is the obvious confirmation and is cheap; it just was not run here.
- **The stretch-in-a-preset rendering mismatch** (decision 1) is untouched.
- **`COLD_START_LOAD_KG[normalizeEquipmentName(item)]`** has the same inherited-property hazard the
  apparatus lookup was fixed for: equipment literally named `constructor` would return a function
  through a `Record<string, number>` type. Pre-existing, needs a user to name equipment that, and
  left alone rather than widened into this change.

## Exact next step

**Remaining W8 backlog** (blueprint §W8): item 1 (mobile body map), item 3 (web parity), item 4
(server-side live session), item 5 (readiness modifiers), item 6 (live-replace prescriptions,
carried since W6), item 7 (don't-recommend-again list). No ordering constraint.

The durable version of item 8 — letting the user *state* their apparatus instead of inferring it —
needs a gym-profile vocabulary that is no longer upstream's, which means a second column or a second
list on `gym_equipment_profiles` plus picker changes in web and mobile. It is a real project and
nothing above depends on it.
