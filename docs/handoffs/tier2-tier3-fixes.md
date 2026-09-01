# Handoff — Tier 2 and Tier 3 audit fixes

*Written 2026-09-01. Source: the six-agent audit ledger
(`sparkyfitness-audit-2026-08-31.html`, one directory above the repo), tiers 2
and 3, re-verified against source before this file was written.*

## Status — worked 2026-09-01

Items 1 and 4-10 are done, one commit each (item 1 has no commit — it is a
`.git/info/exclude` change, which is not a tracked file). Item 2 is left open
deliberately: it needs a decision, not an implementation. Item 3 was out of
scope by instruction.

Two things turned up that this handoff did not predict, both in item 9. The
security-tier doc's errors were not only omissions: cross-checking every
classified table against `db/rls_policies.sql` found four tables documented as
Tier 2 **owner-only write** that actually carry `create_diary_policy`, so a
delegate with `can_manage_diary` can write them (`user_goals`,
`user_nutrient_goal_preferences`, `weekly_goal_plans`, `user_water_containers`);
one documented as delegate-readable that is owner-only both ways
(`user_medication_display_preferences`); and three exercise telemetry tables
filed under the check-in heading while their own cells said `can_manage_diary`.
Understating who can write is the direction that matters, so those were fixed in
the same commit.

Both database docs now round-trip against source: every `CREATE TABLE public.*`
in `db_schema_backup.sql` appears in each file, and every classified table's
tier matches the policy actually applied to it. That check is a dozen lines of
Python and is worth re-running whenever either file is touched.

Gate: every item here was Markdown-only — no package `validate` or test script
is sensitive to it. The `docs` package build (`pnpm run generate`) was run to
confirm the two Nuxt content pages still parse. Note that `docs`'s own `lint`
script is broken independently of this work: it invokes ESLint 9 and the package
has no `eslint.config.*`, so it exits 2 on any input. Not fixed here; it is
upstream's Docus starter config, and fixing it is its own change.

---

Follows `tier0-tier1-fixes.md`, which is complete. This tier is the unenforced
rules and the documentation that states things that are false. Nothing here is
running-code breakage; the cost is that an agent or a person reads one of these
files, believes it, and does the wrong thing.

## Gate

Per-package `pnpm run validate` + the package test script for every package you
touch, green before each commit. One commit per numbered item. No AI attribution
in any commit message (root `AGENTS.md`). This fork never PRs to upstream.

Most items here touch only Markdown. Where a doc claim is fixed, the claim must
be re-derived from source at the time of the fix — copying a number out of this
handoff and into the doc defeats the purpose.

---

## Tier 2 — rules that aren't actually enforced

### 1. The seven untracked files are ignored by nothing *(done — no commit)*

`git check-ignore` reported NOT_IGNORED for all three `*-BLUEPRINT.md` files and
all four `SparkyFitnessServer/tmp-*.script.ts` harnesses, so every `git status`
carried seven `??` lines and every `git add -A` was one slip from committing
them to a public repo. That slip actually happened during the tier-0/1 work and
had to be undone with `git rm --cached` and an amend.

Fixed in `.git/info/exclude` — fork-local, so it never conflicts on an upstream
sync and is not itself committable. Verified: `git status --porcelain` is now
empty and all seven report IGNORED.

### 2. The `any` ban is switched off on the package holding the violations

**Needs a decision before any code changes.** `SparkyFitnessServer/eslint.config.js`
sets `no-explicit-any: 'off'`, `ban-ts-comment: 'off'` and
`reportUnusedDisableDirectives: 'off'`. Every one of the ~1,743
`eslint-disable no-explicit-any` comments on the server is therefore decorative:
deleting all of them changes nothing about the lint result, and the rule
`AGENTS.md` states as absolute is not enforced where it is most violated.

About 76% are legacy from the April JS→TS conversion. The ~240 that landed after
June are the ones the rule aims at — clearest case `services/healthDataHandlers.ts`,
which added 33 in July including `userId: any` and `actingUserId: any` in
brand-new code.

Two mechanical reductions exist if the rule is ever switched on: a shared
`errorMessage(unknown)` helper retires ~633 `TS2571` catch-block suppressions,
and a `files: ['tests/**']` override retires 1,243 test-file disables honestly
rather than line by line. That leaves a few hundred real ones.

The decision is whether to turn the rule on at all, and if so whether to do it
behind those two sweeps or as a warning first. Do not start the sweep without
that call — it is a four-figure diff.

### 3. Nothing has had an independent review since 2026-08-24

Out of scope for this handoff by explicit instruction. The reviewer is down for a
plan-entitlement reason recorded in the global guide; it resumes on its own.
Noted here only so the gap is not mistaken for a clean bill of health: the QA
harness, the equipment taxonomy, medication phase 6, workout personalization,
machine-preference generation, the icon redraw, and all nine tier-0/1 commits
have had self-review only.

---

## Tier 3 — docs that will make a reader do the wrong thing

Ordered by how badly the reader is misled, not by size.

### 4. `shared/AGENTS.md:30` tells you to update the schema backup

> Changes to `src/schemas/database/` require a matching migration in the server
> (`SparkyFitnessServer/db/migrations/`), RLS policies, and the schema backup.

Directly contradicts the root guide, the server guide and
`agent-docs/new-migration-checklist.md` §4, all of which say the backup is
generated and must never be hand-edited (`.github/workflows/schema-backup.yml`
regenerates it after merge and opens a sync PR). A reader who consults only the
shared guide will hand-edit a 337 KB generated file.

Fix: drop "and the schema backup" and point at the checklist. This is also the
oldest guide in the repo (stamped 2026-07-08) — check its other claims while in
there.

### 5. `agent-docs/file-and-domain-reference.md` asserts two schema families don't exist

Line 48 says `(no `Workout*.zod.ts`)`. There are seven:
`WorkoutPresets`, `WorkoutRecommendations`, `WorkoutPlanTemplates`,
`WorkoutPlanTemplateAssignments`, `WorkoutPlanAssignmentSets`,
`WorkoutPresetExercises`, `WorkoutPresetExerciseSets` — plus
`api/WorkoutPresets.api.zod.ts` and `api/WorkoutRecommendations.api.zod.ts`.

Line 66 says `no `schemas/database/Medication*.zod.ts``. There are two:
`Medications.zod.ts` and `MedicationEntries.zod.ts`.

These are assertions of *absence*, so they don't merely under-inform — they send
someone off to define a shape that already exists. The equivalent claims for
Cycle (line 72) and Pregnancy (line 73) were re-checked and are still true;
leave them.

### 6. The coaching / recommendation domain has no row in the domain index

Gym profiles, coach profile, weekly set targets, muscle recovery and workout
recommendations — the largest feature area added since that file was written —
appear nowhere in the file billed as "find any code by feature in seconds". It
spans four route files, three services, three repositories, five frontend cards,
four mobile screens and four shared utils. Both package guides cover it; the
index that routes you there does not.

Fix: add a row in the same shape as its neighbours, deriving the actual paths
from the tree rather than from this paragraph.

### 7. "Definition of done" omits the two Postgres migration jobs

`AGENTS.md:67` describes the gate as `pnpm run validate` plus the package test
script. CI also runs **Fresh-install Migrations** (`ci-tests.yml:238`) and
**Upgrade-path Migrations** (`:313`) against Postgres 18.3, plus the RLS
permission matrix (`tests/rlsPermissionMatrix.integration.test.ts`). Satisfy the
doc on a migration change and you can still go red.

`agent-docs/new-migration-checklist.md` §8 has the same hole — it never names
`pnpm run test:migrations`, the one command that reproduces those jobs locally.

Fix both, and note in the checklist that the fresh-install job runs
`test:migrations` twice to simulate a restart reapplying RLS.

### 8. The server guide's permission list is missing `medications`

`SparkyFitnessServer/AGENTS.md:173` lists only `'diary'`, `'reports'` and
`'checkin'`. `middleware/checkPermissionMiddleware.ts:58` has an explicit
`medications` branch resolving to `medications_read` on GET, and two routes use
it. Counted across the route files the live set is: `diary` (67 uses),
`checkin` (37), `reports` (8), `medications` (2). This is the file an agent
working on a medications route reads first.

### 9. Both database docs claim total coverage and don't have it

Source of truth is `db_schema_backup.sql` (106 `CREATE TABLE`, of which three
are outside `public`: `auth.users`, `system.schema_migrations`,
`system.set_duration_premigration_backup`).

`docs/content/8.developer/4.database.md` is missing seven real tables —
`coach_profiles` (the backing table of the entire coaching domain),
`food_favorites`, `goal_presets`, `passkey_registration_tickets`,
`user_custom_symptom_locations`, `user_oidc_links`, `weekly_goal_plans` — and
lists two that do not exist: `meal_plan_assignment_sets`, and a phantom
`water_containers` that duplicates the real `user_water_containers` nine rows
later.

`docs/content/8.developer/11.database-security-tiers.md` opens with "All
tables… are classified" and omits six: `goal_presets`, `meal_plans`,
`meal_plan_templates`, `user_allergen_preferences`, `user_custom_nutrients`,
`user_meal_visibilities`. For a doc whose only value is that claim, a silent
omission is worse than a missing row — a reader takes absence as "no such
table", not "unclassified".

Re-derive both lists from the backup at fix time rather than trusting the names
above.

### 10. Stale counts and maps

Low blast radius, one commit for the lot:

- 27 → 33 locales, and `en/translation.json` ~120 KB → 237 KB (root + frontend guides)
- `shared/`: ~60 → 79 schema files; `src/nutrients/` missing from the structure list
- Server: 185 → 221 migration files
- The `qa/` Maestro harness is in neither the root monorepo map nor the mobile guide
- Root proxy list omits `/mcp`; frontend API-domain list omits `Health/`; skill list omits `pr-submission`
- `.github/workflows/README.md` — already corrected under tier-1 item 7; re-check rather than re-fix

Every number above must be re-counted at fix time.

---

## Open risks

- Item 2 is the only one that needs a human decision, and it is the only one
  that touches code. Everything else is Markdown.
- No independent review is available (item 3), so self-review is again the only
  check.
- Tiers 4 (QA harness oracles), 5 (deliberate feature backlog) and 6 (upstream
  drift, 249 ahead / 179 behind, to be merged in five stages) are untouched and
  each needs its own handoff.
