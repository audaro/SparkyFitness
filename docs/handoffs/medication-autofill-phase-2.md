# Handoff — Medication autofill, phase 2

Branch `feat/medication-autofill`. Plan: `~/fitness/MEDICATION-AUTOFILL-BLUEPRINT.md` (outside the
repo; phases at "Phasing"). Previous step: `docs/handoffs/medication-autofill-phase-0-1.md`.

## What shipped

| Commit | Summary |
|---|---|
| `5a91bf18c` | Rank the medication catalog against a typed query (`searchCatalog`) |
| `e6eeb5813` | Autofill the name field from the cabinet and catalog (web + mobile) |
| `4ab3f1551` | Localize the reconstitution refusals and warnings (closes open risk 2) |
| `f362c2319` | Remember how a vial was mixed and derive its draw (`shared`) |
| `e6b2b3fb3` | Persist the mix and show the draw on the web form (closes open risk 3) |
| `28443f502` | Persist the mix and show the draw on the mobile form |

### The search primitive

`searchCatalog(query, limit)` in `shared/src/medications/catalog.ts`. Phase 0 shipped only
`resolveCatalogDrug`, which matches an exact id/name/alias — enough to rehydrate a saved row, not
enough to suggest anything mid-keystroke.

Ranking is exact > prefix > substring, with **an alias scored one tier below the name it belongs
to**, so a drug's own name always outranks a brand at the same quality of match. Ties break
alphabetically: a row must not move out from under a finger already on its way down the list.
Results carry `matchedOn` and `viaAlias`.

Matching is substring, not fuzzy, on purpose — the catalog is small and the terms are drug names,
where a near-miss suggestion is worse than none. Typo tolerance is a deliberate later step.

### The combobox

`MedicationNameCombobox.tsx` (web) and `MedicationNameSuggestions.tsx` (mobile). Two local tiers —
the user's own cabinet, then `MEDICATION_CATALOG` — with the unconditional
`Add "<typed>" as a custom medication` row **last**. That row is the point of the whole control:
for this user base the drug they want is usually in neither list, and making them dismiss a
dropdown to type free text is the failure being designed out.

Three decisions worth not regressing:

- **No debounce.** Both tiers are in memory. The 250 ms the blueprint calls for belongs to the
  network tier, which does not exist; adding it here only makes an in-memory filter feel slow.
- **A pick keeps `matchedOn`, not `displayName`.** Someone who typed "Wegovy" gets a row named
  Wegovy. Renaming it to "Semaglutide" is a rename they did not ask for and may not recognise in
  their own cabinet.
- **A catalog row is suppressed when the user already has that drug** under the same name — their
  tier-1 row is the same drug carrying their real strength and schedule.

Web uses a floating listbox with full keyboard nav; **mobile uses an inline list, not a popover**,
because an absolutely-positioned overlay in a scroll view fights the keyboard avoider on both
platforms. Mobile gates its tier-1 query on the dropdown being open (`useMedications({ enabled })`)
— the hook refetches on focus, and an edit that never touches the name should not pay for a list
read it will never show.

### The dosage step

Splits on whether an approved label exists. `catalogDrug.strengths` non-null renders the ladder as
chips; null renders `ReconstitutionCalculator`, because the only honest source for that drug's
strength is the vial the user is holding. Every entry had `strengths: null` when this was written,
so every catalog pick routed to the calculator and the chip row never rendered — correct, not a
gap. The brand split in `docs/handoffs/medication-autofill-phase-3-brand-split.md` is what put a
ladder behind that branch for the first time.

Both platforms' calculators call the one `reconstitute()` in `shared`, so neither can drift into
its own arithmetic. Blank inputs are "not filled in yet", not zero: the calculator has no opinion
until all three fields are non-empty, so it never shows a refusal for a mistake the user has not
made yet. The framing line ("converts the numbers you entered … does not recommend a dose") is
rendered adjacent to the number on both platforms.

`onApply` writes the concentration into `strength` as `<unit>/mL` — a reconstituted vial's strength
is what a millilitre of it contains, which is what makes a dose in syringe units meaningful later.

### The catalog link

Rows link through **`custom_fields.catalog_id`** — a new key, deliberately *not* `glp1_drug`, which
gates the PK coach and may only ever hold a profile the registry publishes. `catalog_id` records
what the user picked, including drugs with no published PK.

It is written as an **explicit null** when there is no match, never omitted. Typing over a matched
name detaches the row; leaving the previous drug's id on a medication that is no longer that drug
would attribute the wrong drug's data to it. Tested on both platforms.

`source` (`'catalog'` / `'manual'`) and `route_id` are now written too. Both were already in the
schema and unused. No migration was needed and none was added.

### Reconstitution persistence and the draw

Phase 2 shipped a calculator that computed the right answer and then threw it away. Applying it
wrote a concentration into `strength` and nothing else, so the derivation was gone: a 30 mg vial in
3 mL and a 10 mg vial in 1 mL are the same strength and a different bottle, an edit reopened on an
empty form, and the number the user actually acts on — 0.2 mL, 20 marks on a U-100 — existed only
inside a calculator they had to re-run from memory.

`shared/src/medications/reconstitutionRecord.ts` closes both halves.

**`ReconstitutionRecord`** is the mix as entered, under one `custom_fields` key — no migration.
`readReconstitutionRecord` returns null for anything that is not complete and valid, because
`custom_fields` is free-form JSONB that older rows, other clients and hand edits all write into,
and half a mix repopulating a syringe calculator is how someone draws to the wrong mark.

**`concentrationDraw` derives the draw from the medication's own `strength` and `dose` columns, not
from the record.** This is the load-bearing decision of the step. The record only repopulates the
calculator; if it fed the readout as well, a hand-edited strength and the marks shown beside it
would disagree, and the marks would win. Only the syringe standard comes from the record, because
0.2 mL is 20 marks on a U-100 and 8 on a U-40 and reading one against the other is a 2.5x error.

It deliberately does **not** reuse `reconstitute()`, which refuses `dose_exceeds_vial` when the
dose exceeds the *concentration* — 20 mg at 10 mg/mL is a valid 2 mL draw, not an error. Like
`reconstitute()` it returns nothing rather than a guess wherever the answer is not knowable: no
concentration (a 500 mg tablet has no draw volume), no dose, or IU against a mass vial, for which
there is no general factor.

Both forms now save the mix on apply, reopen the calculator on it when editing, and render the draw
next to the two fields it comes from.

**The web `custom_fields` write changed from wholesale replace to merge** (open risk 3). The
consequence is easy to miss and is the thing to remember here: *once a form merges, absent stops
meaning cleared*. Every key the dialog owns — the six GLP-1 fields, `units_per_serving`, the record
— is now written explicitly `null` when off. `NO_GLP1_FIELDS` is a module constant spread **first**
and then overridden, because a literal null property placed before a spread that redeclares it is a
TS2783 error.

## Gate status

Run on the committed state, all green:

- Server: `pnpm run validate` pass; `pnpm test` — **4306 passed**, 2 skipped (296 files).
- Frontend: `pnpm run validate` pass; `pnpm test` — **1106 passed** (113 suites).
- Mobile: `pnpm run validate` pass (incl. i18n audit, EN + PL); `pnpm exec jest` — **6119 passed**
  (378 suites).

74 new tests across the phase. The retatrutide example runs end to end in both suites: pick "Reta" →
`catalog_id: retatrutide`, `route_id: subcutaneous`, `type_id: injection`, no ladder, calculator
opens; 10 mg + 2 mL, 2 mg dose → **40 units (U-100)**.

The retatrutide round trip is covered end to end on both platforms too: apply 30 mg + 3 mL at a
2 mg dose, save, reopen — the calculator comes back on 30/3/2 and the form reads
**Draw 0.2 mL — 20 units on a U-100 syringe**. Editing the strength to 20 mg/mL moves it to
0.1 mL / 10 units; the same mix read against a U-40 reads 8.

One caveat, in the same shape on two suites now. During the localization commit's gate run, one
full mobile run reported a single failure that three subsequent runs did not reproduce; during this
step's gate run the same thing happened on the **server** suite, with four clean full runs around
it. Neither failing test name was captured. The two steps have no code in common, which points at
worker distribution rather than any one diff — adding a test file reshuffles it. Treat a lone
failure here as unproven, not as a known-good result: re-run before believing it, and **capture the `FAIL` line rather than only the summary counts**,
which is what both of these runs failed to do.

## Found in self-audit (fixed before commit)

- `role="option"` sat on a grandchild of `role="listbox"` (each row wrapped in an `<li>`), so the
  options were not owned by the listbox. Rebuilt as a flat `div[role=listbox]` with `Fragment`
  row wrappers and `role="presentation"` group headers.
- Mobile fired a medications-list query on every form open, including edits that never touch the
  name. Now gated on the suggestions being open.
- Mobile's "pick one of my own rows" path could set `typeId` to `undefined` in the edits object,
  blanking a type the medication being edited already carried. Now only overwrites when the picked
  row actually has one.
- The web highlight index was reset with `setState` inside an effect (lint caught it, correctly).
  Replaced with a derive-during-render index keyed by the query that produced it.

## Next step

**Phase 3 — the content pass.** Populate `strengths` and `vialSizes` across the catalog and widen
it beyond the six PK-registry drugs. This was blocked on open risk 1 below, a product decision
rather than an implementation one; it has since been decided and shipped — see
`docs/handoffs/medication-autofill-phase-3-brand-split.md`.

Phase 2 is otherwise complete: the catalog link, the name autofill, the dosage step, the localized
refusals and the reconstitution round trip are all shipped and covered.

## Open risks and deliberate skips

1. ~~**Strength ladders are brand-shaped; the catalog is generic-shaped.**~~ **Decided and fixed
   in `1848d8a60`** — the first of the three recorded ways out: brands are their own entries, linked
   to their molecule by `genericId` and sharing its `glp1ProfileId`. See
   `docs/handoffs/medication-autofill-phase-3-brand-split.md`. Phase 3's content pass is no longer
   blocked.
2. ~~**`reconstitute()`'s refusal and warning messages are English-only.**~~ **Fixed after this
   handoff was written.** Every failure and warning now also carries `details` — the values its
   sentence interpolates — and each UI rebuilds the sentence from `reason` / `code` + `details`
   through its own `t` (`SparkyFitnessFrontend/src/pages/Medications/reconstitutionMessages.ts`,
   `SparkyFitnessMobile/src/utils/reconstitutionLocalization.ts`). Both switches are exhaustive
   with no `default`, so a reason added in `shared` fails the typecheck rather than silently
   falling back to English. `shared`'s `message` is now documented as a fallback for a caller with
   no i18n, and is what nothing in the app renders. One reason was split out while doing it:
   `diluentForTargetUnits` was reporting a bad target-units input as `invalid_syringe_capacity`,
   so one reason carried two different sentences; it is now `invalid_target_units`.
3. ~~**Web and mobile disagree on `custom_fields` merge semantics.**~~ **Fixed in `e6b2b3fb3`.**
   Web now spreads `editMed.custom_fields` before its own keys, so a row mobile enriched survives a
   web edit. The cost of the fix is that absent no longer means cleared on that form — see the
   reconstitution section above for which keys now have to be written explicitly `null`, and why
   `NO_GLP1_FIELDS` is spread first rather than written as literal properties.
4. **`vialSizes` is empty on every entry**, so the calculator's vial chips never render yet. Valid
   working state — the field is a suggestion, never a constraint, because grey-market vial sizes
   vary by vendor. Phase 3 content work.
5. **The calculator toggle shows on every non-supplement medication**, including a plain pill. It
   is one muted ghost line and it is the only way a user with no catalog match reaches the
   calculator, which is the case that matters most here. Revisit if it reads as noise.
6. **`listInjections` is still capped at `limit: 60`.** Pre-existing, untouched.
7. **There is no way to clear a saved mix except by picking a different name.** Edit a
   reconstituted vial's strength back to a plain `500 mg` and the draw correctly disappears — it is
   derived from the columns — but `custom_fields.reconstitution` stays, so the calculator still
   reopens on the old vial. Harmless today (the record is prefill only, and it is the user's own
   last mix) and deliberately not solved with a "this is no longer a vial" affordance nobody asked
   for. If it starts to matter, clear the record when the strength unit stops being a
   concentration, not on every strength edit.
