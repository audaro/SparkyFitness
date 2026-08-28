# Machine-preference workout generation

_2026-08-28_

## What this fixes

A push-day generation on the "PF" (Planet Fitness) gym profile returned six exercises and only one
machine — Around The Worlds, Face Pull, Dip Machine, Incline Cable Flye, lever seated reverse fly,
Kneeling Cable Triceps Extension — on a floor that is almost entirely machines. Reproduced against
the live database, it was three separate causes stacked:

1. **All 138 imported ExerciseDB rows had `mechanic = NULL` and `level = NULL`.** The mirror has
   neither field, and `createExerciseFromExerciseDbRecord` stored nothing for them.
2. **`levelMatchBonus` was proxying for equipment.** On an `intermediate` profile, of 58 eligible
   machine rows across chest/shoulders/triceps, **zero** earned the level bonus — every level-matched
   candidate was a free-exercise-db cable or dumbbell row. The bonus meant "free-exercise-db",
   not "right difficulty".
3. **Nothing expressed a preference at all.** Even with 1 and 2 fixed, a cable flye and a pec deck
   scored identically and the uuid tiebreak decided.

## What shipped

**Data model.** `SparkyFitnessServer/db/migrations/20260828120000_add_gym_profile_equipment_preference.sql`
adds `gym_equipment_profiles.equipment_preference` (TEXT, nullable). NULL means never stated. TEXT
rather than jsonb because a scalar has no "stated empty" state to protect — the tri-state rules that
govern `apparatus` and `equipment_items` do not apply here. RLS needs no change: the table's owner
policy is table-level.

**Scoring** (`shared/src/utils/workoutGeneration.ts`) gained four terms, and they only work together
— the first three alone put a Smith-machine shoulder raise in the chest slot:

- `equipmentPreferenceNearPenalty` / `equipmentPreferenceFarPenalty` grade a candidate through
  `EQUIPMENT_PREFERENCE_TIERS`. A multi-equipment row takes its **best** tier; an empty equipment
  list is never penalized. It is a preference, not a filter — a muscle whose only coverage is
  off-preference still gets programmed.
- `canonicalPatternBonus` rewards a name matching `CANONICAL_MOVEMENT_PATTERNS` for the target
  muscle (a chest press or fly over a pullover).
- `variantPenalty` nudges past reverse-grip / one-arm / behind-neck rows via
  `VARIANT_NAME_MARKERS`. `incline`/`decline` are deliberately **not** markers — a programming
  choice, not a lesser version.
- The tiebreak is now `isPlainerName` (shorter name wins, id only settling a true tie) instead of
  the uuid comparison, which is what let "Machine Decline Chest Press" beat the plain press by luck.

`mobilityPenalty` deepened from -6 to -14 to preserve its invariant against the new penalties; the
arithmetic is written out at the constant, and `tests/workoutGeneration.test.ts` asserts it as
behaviour.

`GenerationOptions.equipmentPreference` is **required, not defaulted** — a forgotten call site is a
compile error, matching the `availableApparatus` convention.

**Catalog.** `EXERCISEDB_MECHANIC_BY_SOURCE_ID` in `shared/src/constants/exercisedb.ts` decides
compound-vs-isolation for all 141 pack members by hand, with the joint-count rule documented and the
judgement calls commented in place. The importer now **throws** on an unmapped row rather than
storing NULL, and stores `level: null` deliberately (the mirror has no difficulty field, and a
guessed label is a thumb on the scale).

**Surfaces.** The preference is editable on web (`GymProfilesManager`), mobile
(`GymProfilesScreen`), and through the chat coach (`gym_equipment_preference` on
`create_gym_profile` / `update_gym_profile`, null on update clearing it). On both clients the
control sits **outside** the detailed/coarse branch and rides with all four save payloads: it says
what to pick from whatever the gym has, not what the gym has, so it is orthogonal to the
items-vs-coarse derivation contract.

## Verified

Against the live database, the same PF profile that produced the reported workout now produces:
`lever chest press`, `Machine Military Press`, `Dip Machine`, `Butterfly` (the pec deck),
`Reverse Machine Flyes`, `lever triceps extension`. With no preference stated, selection is
unchanged in character; with `free_weights` it mirrors.

Gates: server `pnpm run validate` + `pnpm test` (5093 passed, 2 skipped), frontend `validate` +
`test:ci`, mobile `validate` + the gym-profile suites. The user's PF profile has been set to
`equipment_preference = 'machines'` in the database.

## Open items

- **13 duplicate ExerciseDB rows still carry their upstream jargon names** ("lever chest press",
  "lever triceps extension"). The name-cleanup repair renamed 125 of 138 rows and left these because
  the cleaned name collides with an existing free-exercise-db or manual row. Nothing references any
  of them (0 `exercise_entries`, 0 `workout_preset_exercises`, 0 `workout_plan_template_assignments`),
  so deleting the duplicates is safe — but deletion is destructive and is the user's call. This is
  also the only reason the machine push day still reads with two lowercase "lever" names.
- No user-facing docs mention gym profiles, so nothing there needed updating. The two database docs
  (`docs/content/2.features/9.family-friends-sharing.md`, `docs/content/8.developer/11.database-security-tiers.md`)
  are unchanged on purpose: no new table, and no change to who can read the row.
- Nothing is committed yet.

## Next step

Review the diff, then commit per phase (shared + migration; server; web; mobile; chat coach + docs)
and decide on the 13 duplicate rows.
