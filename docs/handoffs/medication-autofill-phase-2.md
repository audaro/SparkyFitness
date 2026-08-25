# Handoff — Medication autofill, phase 2

Branch `feat/medication-autofill`. Plan: `~/fitness/MEDICATION-AUTOFILL-BLUEPRINT.md` (outside the
repo; phases at "Phasing"). Previous step: `docs/handoffs/medication-autofill-phase-0-1.md`.

## What shipped

| Commit | Summary |
|---|---|
| `5a91bf18c` | Rank the medication catalog against a typed query (`searchCatalog`) |
| `e6eeb5813` | Autofill the name field from the cabinet and catalog (web + mobile) |

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
strength is the vial the user is holding. Every entry currently has `strengths: null`, so today
every catalog pick routes to the calculator — that is correct, not a gap (see open risks).

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

## Gate status

Run on the committed state, all green:

- Server: `pnpm run validate` pass; `pnpm test` — **4258 passed**, 2 skipped (295 files).
- Frontend: `pnpm run validate` pass; `pnpm test` — **1093 passed** (112 suites).
- Mobile: `pnpm run validate` pass (incl. i18n audit, EN + PL); `pnpm exec jest` — **6105 passed**
  (377 suites).

19 new tests. The retatrutide example runs end to end in both suites: pick "Reta" →
`catalog_id: retatrutide`, `route_id: subcutaneous`, `type_id: injection`, no ladder, calculator
opens; 10 mg + 2 mL, 2 mg dose → **40 units (U-100)**.

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
it beyond the six PK-registry drugs. It is blocked on open risk 1 below.

## Open risks and deliberate skips

1. **Strength ladders are brand-shaped; the catalog is generic-shaped.** Unchanged from phase 0 and
   still the decision that blocks phase 3. One `CatalogDrug.semaglutide` cannot hold both Ozempic
   (0.25/0.5/1/2 mg) and Wegovy (0.25/0.5/1/1.7/2.4 mg), and Mounjaro/Zepbound differ the same way.
   Three ways out: split brands into their own entries sharing a `glp1ProfileId`; make `strengths` a
   map keyed by brand; or take the union and let the user pick. Until then `strengths: null` is
   correct everywhere and routes to the calculator, which is a working answer rather than a guessed
   one. **Phase 2 makes this cheaper to decide**: the chip UI is already built and gated on
   `strengths` being non-null, so populating the data is the only remaining work.
2. **`reconstitute()`'s refusal and warning messages are English-only.** They come from `shared`,
   which has no `t`. Every label around them is localised; the messages are not. The fix is for the
   UI to translate from the `reason` / `code` — both are already on the result — rather than render
   `message`. Worth doing before this reaches a non-English user.
3. **Web and mobile disagree on `custom_fields` merge semantics.** Mobile spreads the existing
   object and adds `catalog_id`; web replaces it wholesale (pre-existing behaviour — web already
   sent `{}` for a non-GLP-1 medication). So editing on web a row that mobile enriched drops keys
   web does not know about. Not introduced here, but phase 2 is the first change that puts a
   *shared* key in there, which makes it matter. Fix by spreading `editMed.custom_fields` on web.
4. **`vialSizes` is empty on every entry**, so the calculator's vial chips never render yet. Valid
   working state — the field is a suggestion, never a constraint, because grey-market vial sizes
   vary by vendor. Phase 3 content work.
5. **The calculator toggle shows on every non-supplement medication**, including a plain pill. It
   is one muted ghost line and it is the only way a user with no catalog match reaches the
   calculator, which is the case that matters most here. Revisit if it reads as noise.
6. **`listInjections` is still capped at `limit: 60`.** Pre-existing, untouched.
