# Equipment taxonomy — final handoff

Implements the granular equipment taxonomy end to end: a 79-item, 9-category
vocabulary overlaid on the coarse 12-value `EQUIPMENT` enum, stated per gym
profile, derived server-side, gated in the workout engine, editable on web,
mobile, and chat, and drawn as a shared icon set.

## Shipped commits

| Phase | Commit | Subject |
| --- | --- | --- |
| A | `be810ccf1` | Add the granular equipment-item vocabulary and its catalog classification overlay |
| B | `6ef4852b6` | Add equipment_items column to gym profiles with server-side derivation |
| C | `b758593da` | Gate workout generation on stated equipment items |
| D (web) | `5a216fe45` | Let the web gym-profile editor state granular equipment items |
| D (mobile) | `9ccf9d63f` | Let the mobile gym-profile editor state granular equipment items |
| D (chat) | `82cd3e65e` | Teach the chat coach granular equipment items and gym templates |
| E1 | `eee78a816` | Add an equipment icon set with category fallbacks and render it in the item pickers |
| E2 | this commit | Draw bespoke icons for all 79 equipment items |

Phase D was split into three commits (each surface's diff cleared the ~800-line
guideline); Phase E into two (fallback infrastructure, then the full bespoke
set — see deviations).

## Gate status

Every commit above was made with all gates green in every affected package.
Final state (E2, after the full bespoke icon set):

- **Server**: `pnpm run validate` clean; `pnpm test` 5037 passed, 2 skipped
  (includes `tests/equipmentItems.test.ts` and `tests/equipmentIcons.test.ts`,
  which cover the shared package because `shared/` has no test runner).
- **Frontend**: `pnpm run validate` clean; `pnpm test` 1215 passed.
- **Mobile**: `pnpm run validate` clean (mobile i18n audit, generated-locale
  check, and muscle-art check all blocking and green);
  `pnpm exec jest --watchman=false --runInBand` 6311 passed.

## Live definition of done (run 2026-08-26, w6gate user `352c8b4f-2394-483c-853a-156e23821cd1`)

All three scenarios ran against the live Docker Postgres via untracked
harnesses (`tmp-equipment-baseline.script.ts`, `tmp-equipment-dod.script.ts`),
each snapshotting and restoring the touched rows in `finally`. **All passed.**

1. **Planet Fitness, item-stated, dumbbell cap 22.5 kg, leg day forced via
   `targetMuscles`** — the plan admitted machine rows (Leg Extensions →
   `leg-extension-machine`, Calf Press → `calf-machine`), every row was
   item-satisfiable against the PF template's 35 items, no free-barbell row
   and no Atlas-anything appeared, and no dumbbell prescription exceeded the
   cap (the run's leg-day plan happened to include no dumbbell rows, so the
   cap check was satisfied vacuously; the cap itself is pinned by unit tests
   from Phase C).
2. **Garage gym (dumbbells, loop bands, pull-up bar, flat bench), lats
   forced** — Chin-Up was admitted, and the plan contained zero machine or
   cable rows.
3. **Legacy coarse profile byte-identical** — the coarse-profile and
   no-profile generations were re-captured post-change and diffed against the
   pre-change baselines: the no-profile run is byte-identical; the coarse run
   differs only in `gym_profile_id`, the UUID of the ephemeral profile each
   capture creates (a volatile id the harness deliberately doesn't scrub).

## Deferred

- **40×40 visual QA of the icon set.** All 88 drawings (79 bespoke + 9
  category fallbacks) are covered by automated checks only: well-formedness
  (tag balance), the shared 48×48/currentColor/2.5-stroke style, inertness
  (no scripts, handlers, external references, or hard-coded colors), and a
  ≤1KB size cap. Nobody has eyeballed them at render size; expect a pass over
  the small-multiples to tune geometry.

## Deviations from the blueprint (all recorded as they were made)

- **79 items, not 73.** The blueprint's totals line says 73 but its Part I
  tables enumerate 79 rows; the tables are authoritative and the count is
  pinned in tests.
- **Free-barbell generic default.** The blueprint's own PF scenario requires
  free-bar rows to stay out of a `fixed-barbells` gym, so the generic
  `barbell`-bucket item requirement is `['barbell']` (the Olympic bar item
  only) — `fixed-barbells` derives the coarse bucket for search and load
  limits but does not satisfy the 170 free-bar rows.
- **isPerformable stage order** is coarse → items → apparatus (the blueprint
  listed apparatus before items); the apparatus stage can early-return true,
  so items must be checked first for the gating to hold.
- **Coarse rewrite drops items.** Rewriting an item-stated profile with
  coarse fields sets `equipment_items` back to NULL (route and chat tool
  alike) — a coarse statement can't co-exist with a stale item list.
- **Cross-layer AND exemptions** in the reachability test:
  `Weighted_Bench_Dip`, `Seated_Band_Hamstring_Curl`,
  `Weighted_Sit-Ups_-_With_Bands` intentionally require an item from a
  different bucket than the row's own.
- **Phase E ran as two commits, not "batches".** With visual QA deferred
  regardless, splitting the bespoke set into multiple review-sized batches
  bought nothing; E1 shipped the infrastructure with the missing-icon pin at
  all 79, E2 shipped all 79 drawings and shrank the pin to `[]`.

## Known flakes observed (rerun before believing a red)

medicationRoutes delete, mobile dataTransformation sleep timezone,
MealTypeSettingsScreen ordering, fastingRoutes 401-vs-404. None fired in the
final gate runs.

## Untracked working files (leave untracked)

`EQUIPMENT-TAXONOMY-BLUEPRINT.md`, `GYM-PROFILE-FIDELITY-BLUEPRINT.md`,
`WORKOUT-PERSONALIZATION-BLUEPRINT.md` (repo root),
`SparkyFitnessServer/tmp-equipment-baseline.script.ts`,
`SparkyFitnessServer/tmp-equipment-dod.script.ts`.

## Exact next step

Nothing in flight. The one queued follow-up is the deferred visual pass over
the icon set; everything else is shipped and green. Do not push — the branch
is intentionally local.
