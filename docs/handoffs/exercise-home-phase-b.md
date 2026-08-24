# Handoff — Exercise home & muscle targeting: Phase B complete

Branch `feat/ai-coach`. Written 2026-08-24. Plan: `~/fitness/EXERCISE-HOME-BLUEPRINT.md`.

## What shipped

Phase B — target-muscle generation, the one capability the recommendation engine never had. A client
can now say which muscles to build the workout around; before this, recovery alone decided.

- `91b87634` — **B1** `MUSCLE_SPLITS` / `MUSCLE_SPLIT_MEMBERS` in
  `shared/src/constants/exerciseTaxonomy.ts`: Push, Pull, Upper body, Lower body, Full body. Kept
  deliberately separate from `MUSCLE_GROUPS`, which is a partition the weekly set target ring depends
  on; splits overlap. Upper body is derived as the complement of `LOWER_BODY_MUSCLES` so the two
  halves cannot drift apart. "Recovered muscles" is not a member — it is the *absence* of a
  constraint, and enumerating it would freeze a default into a list.
- `31bdda6e` — **B2** optional `target_muscles` on
  `generateWorkoutRecommendationRequestSchema`, validated against the canonical `MUSCLES` enum.
- `480286b0` — **B3** `selectTargetMuscles(freshness, requested?)` returns the request verbatim,
  skipping the freshness floor, the five-muscle cap and the upper/lower balance swap. Threaded
  through `GenerationOptions`, the service's candidate query and the generate route.
- this commit — **B4** live verification against Docker Postgres, recorded below.

No migration. No client changes yet: nothing calls `target_muscles` until Phase C builds the picker.

## Two places the blueprint and the code disagreed

Both resolved in favour of a coherent implementation; neither touches a D1–D11 decision. The
blueprint has been corrected in place.

1. **B2's `.max(8)` could not coexist with B1's splits.** Upper body resolves to 11 muscles and Full
   body to 17, so an 8-item cap makes two of the five splits unsendable — and truncating them
   client-side would contradict D6 (requested muscles honoured exactly). The field is capped at
   `MUSCLES.length` instead. How many muscles a session can actually serve is the planner's
   decision, not the wire's.
2. **`isLowerBodyMuscle` is defined in `exerciseTaxonomy.ts`**, not in `workoutGeneration.ts` where
   the blueprint places it. It is only imported there. The rule it was cited for — one lower-body
   list, no second copy — was followed.

## Gate status

Server `pnpm run validate` clean; `pnpm test` **4141 passed / 2 skipped**, 289 files (baseline was
4113/2 across 287 — the delta is 28 new tests in three files). Frontend and mobile `pnpm run
validate` both clean, run because `shared/` has no scripts of its own and every consumer has to
typecheck against it.

One flake seen once and not since: a full server run failed inside a `getActiveGymProfile` mock in
the gym-profile suites. Both suites pass 3/3 in isolation and the next full run was green. Not
related to this work, which adds a constant and a pure-function argument.

## Live verification (B4), against the running server and Docker Postgres

Account `w6gate@example.test` — the seeded gate account from W6, 16-exercise catalog, four logged
sessions. Its recovery vector had `lower back` freshest at 0.925 and `quadriceps` / `hamstrings`
mid-pack at 0.700 / 0.713, so an unconstrained generate returned
`lower back, triceps, abdominals, abductors, neck`. That is what makes the override observable.

- `{"target_muscles":["quadriceps","hamstrings"]}` → `muscle_groups: ["quadriceps","hamstrings"]`,
  four exercises, **every primary muscle one of the two asked for**: Barbell Squat, Alternating Hang
  Clean, Leg Extensions, 90/90 Hamstring. The freshness ranking wanted a different workout entirely.
- **Order is preserved**: sending `["hamstrings","quadriceps"]` returns them in that order.
- **Deterministic**: two identical requests returned byte-identical payloads.
- **400, not a silent empty result**, for `"Quadriceps"` (mis-cased), `"quads"`, `"lower body"` (a
  split name — the wire takes muscles only, per D7) and `[]`.
- **The free-exercise-db backfill still fires for a requested muscle.** `calves` was the one muscle
  with zero local coverage for this account; requesting it returned a 200 with an imported local
  `Barbell Seated Calf Raise`.
- **An 11-muscle Upper body request** returned exactly one exercise per requested muscle, all 11.
- `swap: true` alongside fixed muscles kept the muscles and re-ran selection; it returned the same
  four exercises because the account's catalog holds exactly four quad/hamstring rows — the
  documented "can still repeat one if nothing else fits".

### One thing Phase C's UI has to account for

That 11-muscle request came back with `estimated_duration_minutes: 99` against a 60-minute budget.
This is **pre-existing engine behaviour, not a regression**: `fitToDuration` only removes a *second*
exercise for a muscle and then trims sets, so it will never drop a target muscle to meet the clock.
Verified independently of this change — an unconstrained generate with `duration_minutes: 15`
returns a 40-minute, five-exercise workout the same way.

It is also the right trade-off under D6: dropping a muscle the user explicitly selected is worse
than an honest over-budget estimate. But it means the muscle grid in C3 lets a user build a
two-hour workout in four taps, and the payload's `estimated_duration_minutes` is the number that has
to be shown back to them.

## Exact next step

Blueprint task **A0** — read-only, the mobile navigation contract — then **A1**. Phase A is the
mobile IA work and is independent of everything above. Phase C needs A2 and B2; B2 is done.

## Open risks

- **Task C2 needs a human** (five canonical muscles have no path in `muscle-male.svg`). D5's
  fallback tile is what keeps it blocking nothing.
- **Tab changes touch five files in lockstep** across two runtime rendering paths, gated by
  `__tests__/navigation/nativeHeaderContract.test.ts`. That is what A0 is for.
- **Nothing consumes `target_muscles` yet.** It is a live server capability with no caller until C3,
  so a regression in it would be invisible to the app until then.
- **Sharing is deferred** and is on the blueprint's STOP list.
