# Medication autofill — Phase 5 (Quality)

Branch: `feat/medication-autofill`. Follows `medication-autofill-phase-4-clients.md` (Phase 4,
RxTerms tier 3, gate-green through `0fc0edf80`).

Phase 5 in `MEDICATION-AUTOFILL-BLUEPRINT.md` is four items. All four are addressed below; one of
them turned out to have shipped already in Phase 3 and needed no code.

---

## 1. Typo tolerance

The blueprint said "`approximateTerm` typo fallback". It shipped as two independent mechanisms,
and **neither one is `approximateTerm`**.

### Why not `approximateTerm`

Probed live. `approximateTerm` answers `metfromin` with **merbromin** — a mercury antiseptic —
top-ranked, and no metformin anywhere in the first five distinct names. Its candidates also
duplicate per source vocabulary, carry an optional `name` field, and include dose-form concepts
that cannot be re-queried against RxTerms.

`spellingsuggestions` returns clean, deduped, ingredient/brand-level names — exactly the shape you
can re-query RxTerms with — and returns **both** merbromin and metformin. The full reasoning is
written into `shared/src/medications/rxnav.ts` so the next person does not re-derive it.

### Tier 2, local (`shared/src/medications/typo.ts`)

Bounded Damerau-Levenshtein, three rolling rows, early exit when the whole row exceeds the budget.
`MIN_FUZZY_LENGTH = 4`, one edit up to 7 characters, two beyond. It runs as a **separate pass that
only fires when the substring pass returned nothing**, so a near-miss can never sit beside a real
match. Hits come back flagged `viaTypo`.

This matters more than the network half: RxTerms carries no peptides, and peptides are what this
app is built around. `retatrutdie`, `tirzepatdie`, `semaglutde`, `ipamorleni` all resolve locally
and offline.

### Tier 3, network (`SparkyFitnessServer/integrations/rxterms/RxTermsService.ts`)

Three conditions must **all** hold before one spell-check request is made:

1. `matchedNameCount === 0` — RxTerms knew no such drug. This is deliberately different from
   "RxTerms knew it and catalog suppression then dropped it", which is not a spelling problem.
   `parseRxTermsResponseWithCounts` exists to tell those apart.
2. The term is at least `RXNAV_SPELLING_MIN_TERM_LENGTH` (6).
3. `searchCatalog(query, 1)` is empty — the bundled catalog knows nothing about it.

Condition 3 is what keeps every peptide search at exactly **one** request. It was added after a
test caught `retatrutide` making four.

The top **two** suggestions are searched and their rows **interleaved**, not concatenated. Taking
only the first would answer a metformin typo with a mercury antiseptic and nothing else;
concatenating would let the wrong suggestion fill the five-row cap. Only suggestions that actually
produced rows are reported back as `correctedTerms`.

**Failure never caches.** An RxNav failure, or any per-suggestion search failure, returns
`{products: [], unavailableReason: null, correctedTerms: []}` and suppresses the cache write — so
a blip cannot freeze a typo as uncorrectable for 24 hours. The mistyped name still never reaches
the log (the error object carries it in `config.params`), and there is a test asserting that.

### Clients

`MedicationCatalogSearchResponse` gained `correctedTerms: string[]`; both hooks thread it through
and drop it with the rows it explains. Tier 2's heading swaps to **"Did you mean"** when the group
is `viaTypo`; tier 3 gets a sub-line, **"Showing results for merbromin, metformin"**, under the NLM
row. Without that line the rows read as confirmation that the drug was spelled correctly, and one
of them is routinely a different drug.

---

## 2. Brand→generic display — **already shipped, no code**

`catalogRowSubtitle` (`shared/src/medications/catalog.ts:876`) already resolves a brand row to its
generic and renders it as the row subtitle on both platforms. A Wegovy row already reads
"semaglutide". This landed in Phase 3; recording it here so nobody re-implements it.

---

## 3. Recency ranking

**Server.** `listMedications` runs a third aggregate over `medication_entries`
(`status IN ('taken', 'prn_taken')` — a skipped or snoozed dose is evidence *against* use) and
attaches a derived `last_taken_at` to each row. It **does not touch the list's `ORDER BY`**: the
medications page stays alphabetical. The query mirrors the existing schedules pattern (fetch,
group in JS) rather than a lateral join, because `MED_COLS` is a bare column list shared with
`INSERT ... RETURNING`.

**Shared.** `rankOwnMedications` (`shared/src/medications/ownRanking.ts`) — active first, then most
recently taken, then the never-taken alphabetically, then the cap. Structural input, so both
packages' separate `Medication` types work. It copies before sorting: the cabinet is React Query's
cached list on both clients, and sorting it in place would reorder the medications page as a side
effect of opening a dropdown.

**Match quality is deliberately not a factor.** A display-name hit on a drug taken this morning is
a better suggestion than a prefix hit on one never logged; layering a relevance score on top of
recency would only get in the way of that.

The failure this fixes: a user with a dozen medications typing "t" got the four that sorted first,
not the one they inject weekly.

---

## 4. Vial life feeding `Glp1InventoryManager`

`vialInventoryPrefill` (`shared/src/medications/reconstitutionRecord.ts`) derives concentration,
volume and doses-per-vial from the reconstitution record already on the medication's
`custom_fields`, and `Glp1InventoryManager` opens its vial fields from it. A medication with a mix
on record also opens the dialog on `vial` rather than `pen`.

Before this, the form opened on constants — blank concentration, blank volume, `doses_total` of 10
— for a medication that already knew all three. A 10 mg vial in 2 mL at a 2 mg dose holds **five**
doses, and the run-out date the inventory card draws from `doses_total` was wrong by a factor of
two until someone corrected it by hand.

**Every field it declines to fill is a refusal, not an omission**, and that is the part to preserve:

| Case | Behaviour |
|---|---|
| IU vial (HCG, HMG) | `concentrationMgMl: null` — no factor from IU to mass, and the column is mg/mL |
| mcg vial | converted (÷1000); writing 2500 into a mg/mL column is the dangerous bug |
| no dose on the medication | `dosesTotal: null`, concentration and volume still filled — they are facts about the bottle |
| dose the vial cannot hold, or a cross-family dose | `dosesTotal: null` — `reconstitute` refuses, so this does too |
| no record, or a half-written one | returns `null`; the form stays on `DEFAULT_PEN_DOSES` / `DEFAULT_VIAL_DOSES` |

**The 28-day BUD window was left alone.** It is hardcoded in `calculatedBudDate` and is the
pen-in-use figure, not a reconstituted peptide's beyond-use date. Changing a safety-adjacent
default without a source is exactly what the blueprint's "it converts numbers the user entered, it
does not recommend" framing rules out. Flagging it as an open question rather than silently
picking a number.

---

## Gate status

All three packages green — `validate` (typecheck + lint + prettier) and the full suite, each run to
a real exit code:

| Package | validate | tests |
|---|---|---|
| Server | pass | 299 suites, 4446 passed, 2 skipped |
| Frontend | pass | 116 suites, 1145 passed |
| Mobile | pass | 381 suites, 6156 passed |

New suites: `medicationTypo.test.ts` (14), `medicationOwnRanking.test.ts` (12). Extended:
`medicationCatalogSearch.test.ts`, `medicationCatalog.test.ts`, `medicationRepository.test.ts`
(+4 on `listMedications`), `reconstitutionRecord.test.ts` (+9), and both platforms'
combobox/suggestion and catalog-search-hook suites.

**Two traps worth knowing about, both of which hid failures during this work:**

1. **`pnpm run validate | tail` reports `tail`'s exit code, not validate's.** Three "green" runs
   proved nothing. Redirect to a file and read `$?` instead.
2. **Adding a field to `useMedicationCatalogSearch`'s return breaks every hand-written mock of it**,
   and the crash lands inside the *component* (`correctedTerms.length`), not the hook. There are
   currently six such mocks — `AddMedicationDialog.test.tsx` and `MedicationFormScreen.test.tsx` are
   the two easy ones to miss because they mock the hook to test something else entirely. Grep for
   `useMedicationCatalogSearch` across both `src/tests/` and `__tests__/` when the shape changes.

Note also that `tests/exercisesApiSchemas.test.ts` and `tests/exerciseEntriesApiSchemas.test.ts` are
slow enough (~30s each) to time out when several package gates run concurrently. They pass in
isolation; run the server suite on its own.

## Guides updated

`SparkyFitnessServer/AGENTS.md`, `SparkyFitnessFrontend/AGENTS.md`, `SparkyFitnessMobile/AGENTS.md`
— the medication-search sections now carry the typo guards, the tier-1 ranking rule, and (web) the
vial prefill.

## Open risks / next step

- **The 28-day BUD window** above. Needs a decision, not a guess.
- `last_taken_at` is one extra aggregate on every medications list read. Indexed by
  `idx_medication_entries_user_id`; watch it if a user's entry history gets large.
- Phase 5 is complete. The blueprint's remaining phases are what to pick up next.
