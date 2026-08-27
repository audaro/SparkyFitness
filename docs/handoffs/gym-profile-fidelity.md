# Handoff — Gym-profile fidelity (blueprint phases 1–4)

*Written 2026-08-26. Blueprint: `GYM-PROFILE-FIDELITY-BLUEPRINT.md` (repo root, intentionally untracked — never commit it).*

## What shipped

Four commits, one per blueprint phase, each with all gates green before commit:

1. `a7dc08a66` — **Phase 1: apparatus column + API.** `gym_equipment_profiles.apparatus JSONB NULL`
   with tri-state semantics: SQL `NULL` = never stated (engine keeps inferring from
   barbell/cable/machine), `[]` = stated none (authoritative), array = stated exactly.
   `toJsonbParam` in the repository exists because `JSON.stringify(null)` produces the *string*
   `"null"` → jsonb-null, which is not SQL NULL and silently breaks the tri-state.
2. `107fc61d0` — **Phase 2: engine honors stated apparatus.** When apparatus is stated the
   performability gate uses it verbatim (empty array blocks every apparatus exercise); the
   familiarity escape hatch only applies while apparatus is unstated.
3. `5a05fa933` — **Phase 3: load limits.** `load_limits JSONB NULL`
   (`{"<equipment>": {"max_kg": n, "increment_kg"?: n}}`, kg, dumbbell per-hand). The engine caps
   prescriptions: binding cap floor-quantizes to the effective increment, recomputes the applied
   multiplier, remaps progression, sets `Prescription.capped`, and only says "at this gym's max
   load" when the cap actually decreased the load. `PUT` **replaces** the whole map.
4. *(this commit)* — **Phase 4: edit surfaces.** Web `GymProfilesManager`, mobile
   `GymProfilesScreen`, and the chat `manage_coach_profile` tool can all state apparatus and the
   heaviest-dumbbell limit.

Phase 5 (granular machine taxonomy) is deliberately **not built** — blueprint marks it backlog.

## Phase 4 shape (the part this commit adds)

- **Both UI surfaces**: "Specify apparatus" / "Let Sparky assume" toggle writing `apparatus`
  array-or-null; specified check is `Array.isArray(profile.apparatus)` — never `!== null`,
  because permissive clients can omit the key and `undefined` must read as "never stated".
- **Dumbbell max input** kept as display-unit *text*, converted to kg only at save
  (`Math.round(x*100)/100`), so 22.5 kg → "49.6" lbs → 22.5 kg round-trips at 2 dp. Web converts
  via `usePreferences().convertWeight`; mobile via `weightFromKg`/`weightToKg` +
  `parseDecimalInput` (locale-aware). Both spread the existing `load_limits` map and touch only
  the `dumbbell` key, so another equipment's limit or a stored `increment_kg` survives an edit.
- **Chat tool**: `gym_apparatus` (lowercased/trimmed enum preprocess, deduped in the handler;
  empty array = stated none, omit = leave unstated) and `gym_dumbbell_max_kg` (positive, ≤200 kg).
  The dumbbell path fetches the current row and merges
  `{...existing, dumbbell: {...existing.dumbbell, max_kg}}` — merge, not replace, unlike the REST
  PUT. `describeGymProfile` now renders `; apparatus: <list|none>` (only when stated) and
  `; dumbbells up to X kg` — golden-tested in `chatbotToolsCoachProfile.test.ts`.
- System prompt teaches the Planet Fitness preset (machine/dumbbell/cable/body only; bench only;
  ~22.5 kg dumbbells).

## Gate status (all run 2026-08-26, exit codes captured explicitly)

- Server: `pnpm run validate` ✅, full `pnpm test` 4626 passed / 2 skipped ✅
- Frontend: `pnpm run validate` ✅ (after `pnpm run format`), `test:ci` 1212 passed ✅
- Mobile: `pnpm run validate` ✅ (i18n audit blocking, all rules), full jest 6308 passed ✅

## Live definition-of-done check (blueprint Part V) — PASSED

Ran the real repository + `generateRecommendation` via tsx against the running Docker Postgres as
test user `w6gate@example.test` (`352c8b4f-…`), with a "DoD PF Test" profile: equipment
`[machine, dumbbell, cable, body only]`, apparatus `[bench]`, `load_limits {dumbbell:{max_kg:22.5}}`.
Two generation passes (engine's own pick, then `targetMuscles: chest/shoulders/biceps/triceps` to
force dumbbells):

- No barbell equipment, no pull-up/dip-station/squat-rack movements in either pass.
- Bench movements correctly *allowed* (Bench Dips, Dumbbell Bench Press) because the profile
  states a bench — note `Bench_Dips` is classified `["bench"]` in `APPARATUS_BY_SOURCE_ID`, not
  dip station, so it is not a violation.
- Dumbbell Bench Press prescribed at **22 kg** (cap 22.5 floor-quantized to the 2.5 kg
  increment); 6 dumbbell sets checked, all ≤ 22.5 kg.
- Legacy NULL-profile byte-identical output is pinned in unit tests (Phase 1–3 goldens).

All touched rows restored afterward (profile deleted, previous active state and the
`workout_recommendations` row put back). Side effect knowingly left: the generation passes
imported a few free-exercise-db exercises for the test user (Hyperextensions With No
Hyperextension Bench, Bench Dips, Thigh Abductor, Alternate Hammer Curl) — harmless for a test
account, same as the W7 live gate.

## Exact next step

Nothing in flight. If work resumes here, candidates in priority order:

1. Watch the next real generation for sayhijordy's own profiles (does the cap read well in the UI?).
2. Blueprint Phase 5 (granular machine taxonomy) only if real usage shows machine-level gaps.

## Open risks

- `load_limits` REST `PUT` replaces the whole map; any *new* client edit surface must re-send
  untouched entries (both current UIs and the chat merge path already do).
- Chat caps `gym_dumbbell_max_kg` at 200 kg while the shared schema ceiling is 500 kg — deliberate
  (chat inputs are conversational), but a future audit may flag the mismatch.
- The apparatus vocabulary (`EXERCISE_APPARATUS`) is engine-internal, not upstream's equipment
  enum; anything new that persists or filters apparatus must keep it out of `?|` catalog filters.
