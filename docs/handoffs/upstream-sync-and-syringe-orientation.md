# Upstream sync, syringe orientation, inventory i18n

_2026-08-26. Supersedes the open-risks list in
`medication-autofill-phase-5-quality.md`, two entries of which are now closed._

## What shipped

Three commits on `main`, all pushed.

| Commit      | What                                                             |
| ----------- | ---------------------------------------------------------------- |
| `42f87be03` | Merge `upstream/main` — 51 commits, four conflicts                |
| `3fa1631f7` | Vertical syringe on web, needle at the 0 mark, inventory i18n     |

(`8e210fd32`, the syringe diagram itself, was already on `main` before this step.)

## The merge

Four conflicts, all resolved as unions of two independent changes:

- **`SparkyFitnessServer/ai/tools/foodTools.ts`** — kept `MEAL_TYPE_ALIASES` alongside
  upstream's `QUICK_ADD_NOT_APPLIED`, and combined the `create_food` tool description so it
  documents both `is_quick_food` (upstream) and `confirmed_zero` (ours). Checked against the
  merge base rather than eyeballed: `git diff <base> HEAD` showed our side changed only the
  `create_food` line, upstream's changed both, so upstream's text plus our trailing sentence is
  the whole of it.
- **`SparkyFitnessServer/tests/chatbotToolsFood.test.ts`** — kept both sets of `create_food`
  golden tests, seven in total. Their exact output strings are a parity contract with the MCP
  tool set, so neither side's assertions were rewritten to fit the other.
- **`SparkyFitnessMobile/package.json`** and **`AGENTS.md`** — `validate` now runs both chains:
  `i18n:generate:check`, `typecheck`, `lint`, `i18n:audit`, `native-locales:check`,
  `muscle-art:check`.

### The one judgement call: two audit rules stay informational

Upstream's audit rewrite flipped `hardcoded-ui-text` and `manual-pluralization` from
informational to **blocking**, which failed this fork's gate with **252 findings**. They are not
new debt — running our pre-merge scripts against the merged tree reports the same 248 hardcoded
strings, labelled "informational, PR5 scope".

Both rules describe one backlog: the exercise/workout screens (`UpNextScreen` 34,
`GymProfilesScreen` 26, `ExerciseHomeScreen` 23, `DiaryScreen` 21, `muscleTiles` 20,
`PickMusclesScreen` 18, `VoicePushToTalk` 17, `ExercisePacksScreen` 17,
`WeeklySetTargetsScreen` 16, ~20 more) predate the localization contract and have never been
translated. Blocking on them gates every unrelated change on that migration, and the four
pluralization findings sit *inside* hardcoded English sentences —
`{exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}` under a hardcoded "Up Next" —
so localizing the plural noun alone is not an improvement.

So both stay informational here, and `locale-unsafe-number-format` keeps upstream's blocking
severity because it has no backlog and stands at zero. The severity lives in
`SparkyFitnessMobile/scripts/i18n-audit/core.cjs` (`hasErrors`), the reason is in its header
comment, and `SparkyFitnessMobile/AGENTS.md` says to **re-check it on every upstream sync** —
upstream keeps flipping it back.

## The syringe was drawn backwards

`syringeBarrel` documents position 0 as the **needle end** — 0 is where the stopper rests on an
empty syringe, and the liquid sits between the needle and the stopper. Both platforms drew the
needle at the *far* end, so the fill grew from the plunger and the numbers counted down toward
the needle.

The mark still landed on the right number, so no dose could be misread and **every existing test
passed either way**. What it rendered was a syringe held backwards. The needle is now at the 0
end on both platforms, and each has a test for the orientation alone — mutation-checked against a
mirrored mapping (2 web failures, 1 mobile), because that is the only thing that distinguishes it.

`SyringeDiagram` on web now takes an `orientation`. The calculator passes `vertical`: the barrel
stands beside its numbers in a two-column panel that stacks below `sm`. `horizontal` is the
default and is what mobile draws, having only one column.

## Inventory i18n

`Glp1InventoryManager` was almost entirely hardcoded English, not just the three strings the
phase-5 handoff named. All of it now goes through `t()` — the row chrome, the whole add/edit
dialog, and the three-way beyond-use caption — as 36 new keys under `medications.glp1.inv`, plus
the existing `common.cancel` / `common.saving` / `common.saveChanges`.

The caption uses three **literal** keys rather than one interpolated
`medications.glp1.inv.bud${reason}`, because `translationKeysCoverage.test.ts` scans keys
statically and a computed one is invisible to it. That test was mutation-checked (a renamed key
fails it), so the 36 keys are known to resolve.

Only `public/locales/en/translation.json` was touched; the other 27 locales are machine-synced.

## Gate status

All three packages, run to real exit codes after the last commit:

| Package  | validate | tests                        |
| -------- | -------- | ---------------------------- |
| Server   | 0        | 4523 passed, 2 skipped       |
| Frontend | 0        | 1195 passed                  |
| Mobile   | 0        | 6290 passed                  |

**One intermittent flake**, pre-existing and unrelated:
`__tests__/screens/MealTypeSettingsScreen.test.tsx` →
_"concurrency: an earlier FAILED visibility update never rolls back a later SUCCESS"_ failed once
under full-suite load and passed 3/3 in isolation and on the following full runs. It asserts
pending-state ordering across two in-flight mutations; if it recurs, the test is racing, not the
component.

## Next step

**Phase 6 (openFDA NDC/labeler enrichment + a persistent cache table) is not started, and is
deliberately not begun here.** The only description of it anywhere in the repo is the single line
in `medication-autofill-phase-5-quality.md`; the blueprint that scoped it is not in the working
tree. Building it would mean inventing the whole specification — which openFDA endpoint and
fields, where the enrichment surfaces, the cache table's shape and TTL, and whether the lookup
rides the existing `medication_catalog_lookup_enabled` opt-in or needs its own. That last one is
the reason not to guess: tier 3 is opt-in and silent precisely because a medication name is
sensitive, and openFDA is a second place to send it.

Before starting it, decide:

1. **Trigger** — enrichment on an already-chosen drug only, or during search too?
2. **Consent** — reuse `medication_catalog_lookup_enabled`, or a separate opt-in?
3. **Cache** — a new table (migration + RLS + `db_schema_backup` CI sync + Zod schema + the two
   docs updates in `agent-docs/new-migration-checklist.md`), or in-memory with a TTL?
4. **Surface** — what a user actually sees: labeler, NDC, dosage form, route?

## Also fixed, outside the repo

The second-opinion reviewer has been **down since 2026-08-24**, which is why no review has fired
for two days of consumed markers. Every Codex model is refused with
`400 — "The '<model>' model is not supported when using Codex with a ChatGPT account"`, including
the config default, so it is the account's Codex entitlement rather than the model name.
`codex login status` still reports logged in (last token refresh 2026-08-17). The fix is the
user's: `codex login` again, or check the ChatGPT plan.

`consult.py` failed **silently** by design, which is how this went unnoticed. It now writes
`<repo>/.git/second-opinion/last-error.txt` on any failure and clears it on success, so a
`last-error.txt` newer than `last-review.md` means the reviewer is down rather than that the
turns were unworthy. `~/.claude/CLAUDE.md` records both.
