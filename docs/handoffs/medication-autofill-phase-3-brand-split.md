# Handoff — Medication autofill, phase 3: the brand split

Branch `feat/medication-autofill`. Plan: `~/fitness/MEDICATION-AUTOFILL-BLUEPRINT.md` (outside the
repo; phases at "Phasing"). Previous step: `docs/handoffs/medication-autofill-phase-2.md`.

This is the product decision that blocked phase 3, and only that decision. The content pass it
unblocks — widening the catalog beyond the six PK-registry drugs — is still ahead.

## What shipped

| Commit | Summary |
|---|---|
| `1848d8a60` | Split catalog brands into their own entries (closes phase 2 open risk 1) |

## The decision

A strength ladder is a property of a **label**, and a label belongs to a brand rather than a
molecule. Ozempic and Wegovy are both semaglutide and ladder differently (…1, 2 mg vs …1, 1.7,
2.4 mg); Mounjaro and Zepbound are both tirzepatide and differ in indication rather than strengths.
One `CatalogDrug.semaglutide` could not hold both ladders, and picking either one for it would put
a strength on someone's medication record that their pen does not have.

Phase 2 recorded three ways out. This is the first: **brands become their own entries, linked to
their molecule by a new `genericId` and sharing that molecule's `glp1ProfileId`.** The PK model
still sees one drug, because the pharmacokinetics belong to the molecule even though the ladder
does not.

The two rejected options, so they are not re-litigated from scratch:

- *`strengths` as a map keyed by brand* keeps one entry per molecule but pushes a brand choice into
  a second control after the name is already picked, and leaves `catalog_id` unable to say which
  box the user actually has.
- *Union the ladders and let the user pick* is the one that puts a wrong number in front of
  someone: 1.7 mg would be offered under Ozempic, which does not have it.

## How it is built

`shared/src/medications/catalog.ts`, now in three parts:

- **`GENERIC_DRUGS`** — the six molecules, `strengths: null` on every one. That is not a gap. A
  molecule has no label, so it has no ladder; this entry is what a compounded or grey-market vial
  *is*, and it is exactly the case the reconstitution calculator exists for.
- **`brandOf(generic, {...})`** — builds a brand by **spreading the molecule** and overriding only
  what the label actually changes: `id`, `displayName`, `aliases`, `strengths`, plus `genericId`.
  `pk`, `glp1ProfileId`, `category`, `routes` and `cadence` are therefore structurally impossible
  to drift from the molecule — that is the load-bearing part, not the test that also checks it.
  `vialSizes` is cleared rather than inherited: these brands ship as pens, and a vial hint would
  prefill the calculator for a drug nobody reconstitutes.
- **`BRAND_DRUGS`** — eight labels, each the US label's deliverable doses in mg. Ozempic
  `0.25/0.5/1/2`, Wegovy `0.25/0.5/1/1.7/2.4`, Rybelsus `3/7/14`, Mounjaro and Zepbound
  `2.5/5/7.5/10/12.5/15`, Trulicity `0.75/1.5/3/4.5`, Victoza `0.6/1.2/1.8`, Saxenda
  `0.6/1.2/1.8/2.4/3`. Mounjaro and Zepbound share a ladder today and are still separate entries:
  they are separate labels, a user picks the one printed on their box, and nothing guarantees the
  ladders stay identical the next time either is revised. Retatrutide gets no brand entry, because
  it has no brand.

`MEDICATION_CATALOG` is `{...GENERIC_DRUGS, ...BRAND_DRUGS}`, so every existing consumer is
unchanged.

**Brand names are removed from the generics' aliases.** This is the half that is easy to skip:
leaving `Wegovy` on semaglutide's aliases returns *two* rows for one query — the brand, and the
molecule wearing the brand's name. A test asserts no entry answers to another entry's id or display
name.

Two new exports:

- `catalogGenericOf(drug)` — the molecule, or null for a molecule. **Throws** on a `genericId`
  naming no entry, the same fail-loud shape as `pkFromGlp1`: a dangling link should be a total
  failure rather than a brand that silently reads as its own unrelated drug.
- `catalogRowSubtitle(drug, viaAlias)` — the line under a search row. The molecule under a brand,
  so Mounjaro and Zepbound do not read as unrelated drugs; the drug's own name under a synonym
  match, so typing "Sema" does not leave the row unexplained; null when the title already says
  everything. It lives in `shared` rather than in two UIs because both comboboxes render it.

## What this lights up

The `strengths` branch of the dosage step had no data behind it until now, so **the "Label
strengths" chip row shipped in phase 2 and had never rendered.** Picking a pen now offers its
ladder *and* leaves the vial calculator shut (`strengths === null` is what opens it), which is
correct: a pen is not reconstituted. Both platforms have an end-to-end test for that path — pick
Wegovy, see 1.7 mg and not 2 mg, no calculator, tap 2.4 mg, save.

`matchedOn` vs `displayName` now differ only on a synonym match, since a brand's row title *is* its
display name. Both name-pick handlers still keep `matchedOn` — someone who types "Sema" gets a row
named Sema — and their comments were repointed off the stale Wegovy example.

## Saved rows

Rows created before the split carry the **molecule's** id in `custom_fields.catalog_id`. Those
entries did not move, so **nothing needs migrating** — there is a test pinning all six ids. Such a
row shows no ladder, which is what it did before the split too.

Every `catalog_id` consumer round-trips it through `resolveCatalogDrug`, and `glp1_drug` — the key
that gates the PK coach — still holds the molecule's profile id, not the brand's. Nothing on the
server reads `catalog_id` at all; `custom_fields` is opaque JSONB there.

## Gate status

Run on the committed state, all green:

- Server: `pnpm run validate` pass; `pnpm test` — **4317 passed**, 2 skipped (296 files).
- Frontend: `pnpm run validate` pass; `pnpm test` — **1107 passed** (113 suites).
- Mobile: `pnpm run validate` pass (incl. i18n audit, EN + PL); `pnpm exec jest` — **6120 passed**
  (378 suites).

12 new tests. The catalog invariants are the ones worth not deleting: every brand's `genericId`
resolves and is one level deep; a brand's `pk`, `glp1ProfileId`, category, routes and cadence equal
its molecule's; every brand carries an ascending positive `source: 'label'` ladder; every molecule
carries none; no entry answers to another entry's name; and a brand query returns exactly one row.

Note the flake caveat from the phase 2 handoff still stands — a lone failure in these suites is
unproven until re-run, and **capture the `FAIL` line, not only the summary counts**. Nothing
flaked during this step's runs.

## Found in self-audit (fixed before commit)

- The duplicate-row invariant initially failed on every entry, because an entry legitimately
  answers to both its own id and its own name (`ozempic` / `Ozempic`). Narrowed to two *different*
  entries sharing a name, which is the bug it exists to catch.
- The mobile save assertion was written expecting `glp1_drug` in `custom_fields`. Mobile
  deliberately does not write it — it records the catalog row, and the PK coach is the web's
  surface. The test now says so rather than asserting the web's shape on mobile.

## Next step

**Phase 3 — the content pass.** Now unblocked. Widen `MEDICATION_CATALOG` beyond the six
PK-registry drugs, and populate `vialSizes` where a defensible source exists. The shape is proven
against both cases it has to carry: a labelled brand with a ladder, and a molecule with none.

Two rules the content pass must not break, both enforced by tests: a new entry may only carry
`pk` when the registry publishes it (`pkFromGlp1` throws otherwise), and `strengths` may only ever
be `source: 'label'` — a community-sourced ladder requires changing the type, which is the point.

## Open risks and deliberate skips

1. **Ladders are US labels.** A user on an EU or UK pen may see a strength their box does not have,
   or miss one it does. Not solved, and not solvable inside a `values: number[]`; it would need a
   region on the entry and a region on the user. The chips are captioned "From the approved label.
   Type your own above if yours differs.", and the strength field stays free text, so a mismatch is
   recoverable rather than binding.
2. **Nothing tracks when a label is revised.** The ladders are a point-in-time copy with no source
   URL and no review date on the entry. If a label changes, only a reader noticing will catch it.
   Worth a `source`/`reviewed` field if the catalog grows much past this handful.
3. **A brand's cadence is the molecule's.** True today for all eight, but it is an inherited field,
   so a brand whose label prescribes a different interval would silently be wrong. `brandOf` would
   need to take an override; the test asserting equality would have to change with it.
4. **`vialSizes` is still empty on every entry** (unchanged, phase 2 open risk 4), so the
   calculator's vial chips never render. Valid working state — the field is a suggestion, never a
   constraint.
5. **A legacy row naming a brand but holding the molecule's `catalog_id` gets no ladder.** No
   regression, and a backfill would have to guess which brand from a free-text name. Left alone.
