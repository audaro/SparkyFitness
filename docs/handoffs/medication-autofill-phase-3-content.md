# Handoff — Medication autofill, phase 3: the content pass

Branch `feat/medication-autofill`. Plan: `~/fitness/MEDICATION-AUTOFILL-BLUEPRINT.md` (outside the
repo; phases at "Phasing"). Previous step: `docs/handoffs/medication-autofill-phase-3-brand-split.md`.

This is phase 3 proper — the content the brand split unblocked. Phase 3 is now **done**.

## What shipped

| Commit | Summary |
|---|---|
| `8b601ba42` | Widen the medication catalog beyond the incretins |

The catalog went from 6 molecules + 8 brands to **32 molecules + 11 brands**, and `vialSizes` is
populated for the first time.

## The content

| Category | Entries |
|---|---|
| `incretin` | the 6 PK-registry molecules + cagrilintide, survodutide, mazdutide; brands Ozempic, **Ozempic tablets**, Wegovy, **Wegovy tablets**, Rybelsus, Mounjaro, Zepbound, Trulicity, Victoza, Saxenda |
| `gh-secretagogue` | tesamorelin, sermorelin, ipamorelin, CJC-1295 with/without DAC, hexarelin, GHRP-2, GHRP-6, ibutamoren |
| `repair` | BPC-157, TB-500, GHK-Cu |
| `melanocortin` | bremelanotide (PT-141) + brand Vyleesi, melanotan II |
| `metabolic` | AOD-9604, 5-Amino-1MQ, MOTS-c |
| `immune` | thymosin alpha-1, KPV, LL-37 |
| `androgen` (the TRT-adjacent bucket) | hCG, menotropins, enclomiphene |

## Both invariants held, and one of them got stronger

`pk` is still non-null only where `GLP1_DRUG_PROFILES` publishes it — **every new entry has
`pk: null`**, including the three new incretins. `strengths` is still only ever `source: 'label'`.

The strengthening is `unlabelled()`, which builds the 25 entries with no sourceable label. It takes
`id`, `displayName`, `aliases`, `category` and `routes` and **nothing else** — `strengths`, `pk`,
`cadence` and `vialSizes` are not parameters, so an entry built through it *cannot* acquire a
fabricated ladder or a defaulted half-life. This is the same move `brandOf` made for brands: the
structure carries the rule, and the test that also checks it is the backstop, not the mechanism.
Anything with real label data is written out longhand, which is what makes it visible in review.

Retatrutide is the deliberate exception and stays longhand: it is investigational *and* has
registry PK.

## `vialSizes`, and what "a defensible source" turned out to mean

Populated on exactly four entries, and the rule that picked them is worth keeping:

**A vial hint exists where an approved product ships the drug as a lyophilized vial the user
reconstitutes, and its label says how much is in it.**

| Entry | Vials | Source |
|---|---|---|
| tesamorelin | 2 mg, 11.6 mg | EGRIFTA SV and EGRIFTA WR US PI |
| thymosin alpha-1 | 1.6 mg | ZADAXIN monograph (**not** FDA — no US approval) |
| hCG | 10,000 iu | PREGNYL US PI |
| menotropins | 75 iu | MENOPUR US PI |

That is the whole defensible set. Everything else is grey-market supply, where the blueprint's
Decided #4 already says an authoritative list would be wrong the moment a vendor shipped a size we
did not anticipate. All four keep `strengths: null`, so the calculator is what actually opens and
the hint lands in it.

## `labelSource` — provenance, and what re-verifying found

Phase 3's brand-split handoff left "nothing tracks when a label is revised" as open risk 2, with
"worth a field if the catalog grows much past this handful". It grew, so the field exists:

```ts
labelSource?: { document: string; reviewed: string }  // present iff strengths or vialSizes
```

`document` names the label precisely enough to find again (DailyMed set id, not a URL — a set id
survives a site redesign). `reviewed` is a day string, **written out per entry rather than pulled
from a shared constant**: a shared constant would let one entry's re-check silently re-date every
other entry in the file. `brandOf` takes it as a *required* parameter, because a brand exists
precisely because its label publishes a ladder.

Writing those citations meant re-reading all eight existing labels, and **two of them had moved on
in the three weeks since the ladders were written**:

1. **Wegovy has a 7.2 mg dose.** The shipped ladder stopped at 2.4.
2. **Novo now labels oral semaglutide under three brands.** One FDA document carries both
   `RYBELSUS tablets: 3, 7, 14 mg` and `OZEMPIC tablets: 1.5, 4, 9 mg`; another carries both Wegovy
   injection and `WEGOVY tablets: 1.5, 4, 9, 25 mg`. Ozempic tablets and Wegovy tablets were
   missing entirely.

Mounjaro, Zepbound, Trulicity, Victoza, Saxenda, Rybelsus and Ozempic injection were all confirmed
unchanged.

That is the risk materialising within a month of being written down, which is the argument for the
field better than any reasoning about it.

## Two brands, one name

Ozempic and Wegovy each now label an injection *and* a tablet. Searching "Wegovy" returns two rows,
which looks exactly like the duplicate-row bug the split was built to prevent — it is not. Those
are different products with different molecules, ladders and routes, and the user picks the one
they hold; the subtitle ("Semaglutide" vs "Semaglutide (oral)") is what tells them apart. The old
one-row assertion moved to Zepbound, which still has no same-named sibling, and a new test asserts
the pair behaviour explicitly so the two cases cannot be confused later.

## The brand/alias rule, stated

The split had no stated rule for *when* a brand earns an entry. It does now: **a brand becomes its
own entry when its label publishes a strength ladder; otherwise its name is an alias on the
molecule.** Egrifta is the alias case — its label adds a vial size, and a vial size is the same
fact whoever supplied the powder, so splitting it would buy a duplicate row and nothing. Vyleesi is
the entry case, and the first brand outside the incretins: a one-value ladder (1.75 mg) is still a
ladder, so the chip row replaces the calculator, while grey-market PT-141 picks the molecule and
gets the calculator. The whole split now demonstrably generalises past GLP-1s.

## Found in self-audit (fixed before commit)

**Every ladder-less entry used to be an injection.** `setShowCalculator(drug.strengths === null)`
was therefore correct on both platforms — until this pass added ibutamoren, 5-Amino-1MQ and
enclomiphene, which are oral. Picking one would have opened a syringe-unit calculator for a
capsule. New shared `catalogOpensCalculator(drug)` requires a subcutaneous or intramuscular route
as well; both forms call it. It only decides what opens *by default* — the "Reconstituting a vial?"
link is still there, so it can be wrong about an edge case without stranding anyone.

Also checked and fine: all seven `MedicationRouteId`s exist in the `medication_route_types` seed, so
the new `intramuscular` and `topical` routes are valid FK values on `medications.route_id`.

## Gate status

Run on the committed state, all green:

- Server: `pnpm run validate` pass; `pnpm test` — **4330 passed**, 2 skipped (296 files).
- Frontend: `pnpm run validate` pass; `pnpm test` — **1107 passed** (113 suites).
- Mobile: `pnpm run validate` pass (incl. i18n audit); `pnpm exec jest` — **6120 passed** (378 suites).

One flake: `tests/syncedDataRoutes.test.ts` failed once in a full server run, passed alone and on
the next full run. Unrelated to this diff (nothing here touches synced data) — the phase 2 flake
caveat still stands, and a lone failure in these suites is unproven until re-run.

New tests worth not deleting, all in `SparkyFitnessServer/tests/medicationCatalog.test.ts`:

- **provenance** — an entry carries `labelSource` exactly when it carries `strengths` or a vial;
- **the research peptides** — a named list still has no ladder, no PK, no cadence, no vial;
- **the vial set** — the four ids are asserted *exhaustively*, so a fifth has to be argued for;
- **category coverage** — the specific seven, not a count (a count passes on six more incretins);
- `catalogOpensCalculator` across injectable / oral / laddered / mixed-route.

## What is now unblocked

**Phase 4 — RxTerms behind the opt-in.** Testosterone is deliberately still absent from the bundled
catalog: its labels are concentrations in oil (100 and 200 mg/mL) rather than a deliverable-dose
ladder, and the blueprint makes the testosterone example phase 4's to ship. Leaving it out is the
decision, not an omission.

## Open risks and deliberate skips

1. **Ladders are US labels** (unchanged from the brand split). An EU or UK pen may differ. Still not
   solvable inside `values: number[]`; the chips stay captioned "From the approved label. Type your
   own above if yours differs." and the strength field stays free text.
2. **`labelSource.reviewed` is recorded, not acted on.** Nothing warns when a citation goes stale —
   there is no job, no lint, no UI. The data to build one now exists; the alarm does not.
3. **A brand's cadence is still the molecule's** (unchanged, brand-split risk 3). No case in this
   pass forced the override — the near miss was exenatide, whose Byetta is twice daily and Bydureon
   weekly, and which was **dropped**: AstraZeneca discontinued both US brands (BCise supplies
   exhausted Oct 2025), so it would have added a mcg ladder and a cadence override for a product
   nobody can fill.
4. **Categories are stored but unused.** Nothing groups search results by `CatalogCategory` yet;
   `other` has no members at all. The field is now populated across seven values, so a grouped
   dropdown is cheap whenever it is wanted.
5. **CagriSema and other fixed-dose combinations are not representable.** `genericId` points at one
   molecule. Not worth changing for one entry; worth remembering before adding the second.
6. **Search is still substring, not fuzzy** (blueprint phase 5). With 43 entries a typo returns
   nothing rather than a near miss — the deliberate ordering, but the list is now big enough that
   `approximateTerm` is more valuable than it was.
