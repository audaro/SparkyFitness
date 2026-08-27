# Handoff: ExerciseDB second exercise source (machines pack)

_Date: 2026-08-27_

## What shipped

- `12594023c` — Add the ExerciseDB catalog classification vocabulary and per-source item gating
- `7d8876146` — Import machine exercises from the ExerciseDB mirror as a second catalog pack

The problem this solves: the free-exercise-db catalog has only 67 machine rows,
and four machine items on a stated gym profile (`lateral-raise-machine`,
`torso-rotation-machine`, `back-extension-machine`, `glute-machine`) admitted
zero rows at all, so a Planet-Fitness-style profile produced thin push/leg
routines. The ExerciseDB v1 mirror (hasaneyldrm/exercises-dataset, 1,324 rows)
tags equipment per machine, so its leverage/smith/sled family maps almost 1:1
onto the granular item vocabulary.

### Shared (`shared/src/constants/exercisedb.ts`)

- `EXERCISEDB_SOURCE = 'exercisedb'`, plus three vocabulary maps that decide
  **every** tag/target the pinned 1,324-row catalog uses (asserted by test):
  equipment tag → coarse enum, target → canonical muscle (only
  `cardiovascular system` maps to null/skip), secondary → canonical muscle
  (curated nulls for values with no canonical home).
- `EXERCISEDB_ITEM_REQUIREMENTS_BY_SOURCE_ID`: 143 curated rows for the
  machines family. Five lever pulldown/pullover rows are deliberate
  cross-layer ANDs (item `lat-pulldown` derives cable, row bucket is machine)
  mirroring free-db's `Weighted_Bench_Dip` pattern; `0578` lever deadlift and
  `2288` lever gripper stay generic on purpose.
- `requiredItemsFor` now consults `CURATED_ITEM_LOOKUP_BY_SOURCE` (a
  per-source registry in `equipmentItems.ts`) instead of hard-wiring the
  free-exercise-db map. Generic coarse-bucket defaults unchanged.

### Server

- `integrations/exercisedb/ExerciseDbMirrorService.ts` — dataset fetch +
  1h cache, mirroring `FreeExerciseDBService`.
- `constants/exerciseCatalogPacks.ts` — packs carry a `source`; new
  `exercisedb-machines` pack (leverage/smith/sled tags, 141 members after the
  3 cardio-target rows leave membership).
- `services/exerciseService.ts` — `createExerciseFromExerciseDbRecord`
  translates vocabulary (unmapped tag/target/secondary = named per-row
  failure, never a guess); pack members/list/import are source-aware; media
  (photo + gif) localize into `uploads/exercises/exercisedb_<id>/` — the
  prefix keeps them out of the free-db-only unauthenticated image-recovery
  route's namespace.
- Tests: `tests/exercisedbCatalog.test.ts` (vocabulary vs pinned fixture,
  `tests/fixtures/exercisedbCatalog.ts` — facts only, no dataset content) and
  `tests/exerciseCatalogPacks.test.ts` (pack membership, mapping, per-source
  dedup, loud failures).

## Gate status

All green before each commit. Phase A ran the full triple gates (shared
changed): server validate + 5051 tests, frontend validate + 1215 tests,
mobile validate + 6311 tests. Phase B (server-only) ran server validate +
5056 tests. One flaky, unrelated failure each in server
(first run only) and mobile `MealTypeSettingsScreen` concurrency (passed
alone and on full re-run).

## Live verification (Phase C, untracked harness)

`tmp-exercisedb-c.script.ts` (UNTRACKED, stays that way) ran ALL PASS against
the live DB with the gate user: full pack walk imported 139 / skipped 2 /
failed 0; `0577` lever chest press stored with coarse `machine`, primary
`chest`, photo + gif on disk; all four previously dead stations now gate rows
(lateral raise 1, torso rotation 1, back extension 2, glute 1); curated gating
holds both ways (0577 unsatisfiable without `chest-press-machine`); generated
PF push routine carried 3 exercisedb rows, legs 4, every row item-satisfiable.
Gate user state fully restored afterwards (profiles, recommendation row,
imported rows, media dirs).

## Licensing constraint (do not regress)

The mirror's media is **© Gym Visual (gymvisual.com)** — commercial stock.
Dataset content (names, instructions, media) must never be committed to this
public repo; it flows only into the local DB/uploads at import time for the
importing user. Classification **facts** (ids, tags, targets, item slugs) are
what the committed fixture and maps contain.

## Open items / next steps

- The unauthenticated `/uploads/exercises` recovery route cannot re-download
  exercisedb media (free-db-only by design); a wiped uploads dir means
  re-importing. Acceptable for now; extend the route only with care — it is
  unauthenticated.
- Upstream names carry occasional mojibake (e.g. `sled 45в° leg press`);
  cosmetic, imported verbatim. A name-cleanup pass at import time is possible
  if it grates.
- The user's own account has not imported the pack yet — it is one tap on the
  mobile packs screen ("Machine Exercises (Extended)").
