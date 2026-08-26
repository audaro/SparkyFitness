# Medication autofill — Phase 6 (openFDA NDC / labeler enrichment)

Branch: `main`. Follows `medication-autofill-phase-5-quality.md`. Phase 5's fork-local i18n
backlog cleared in `418ac6338`, which is the commit this one sits on.

Phase 6 is the last item in `MEDICATION-AUTOFILL-BLUEPRINT.md`. It was blocked on four design
questions that had been asked and never answered; they are answered below, with the reasoning,
because the answers are what the shape of the code follows from.

---

## What shipped

A read-only "Product information" panel under a saved medication, on web and mobile: who labels
the drug, its brand and generic names, its dosage form and route, and its product NDC — from the
FDA's NDC directory, keyed on the medication's stored `rxnorm_rxcui`.

| Layer | File |
| --- | --- |
| Parser + display rules | `shared/src/medications/openfda.ts` |
| Proxy + cache | `SparkyFitnessServer/integrations/openfda/OpenFdaService.ts` |
| Consent gate | `SparkyFitnessServer/services/medicationLabelService.ts` |
| Route | `GET /api/v2/medications/:id/label` in `routes/v2/medicationRoutes.ts` |
| Web | `pages/Medications/MedicationLabelPanel.tsx`, `hooks/useMedicationLabel.ts` |
| Mobile | `components/medications/MedicationLabelPanel.tsx`, `hooks/useMedicationLabel.ts` |

Same three-layer shape as the RxTerms catalog search it sits beside, and deliberately so.

---

## The four blocking questions, answered

### 1. Trigger — already-chosen drug only

Keyed on a stored `rxnorm_rxcui`, which only exists once a medication has been picked from the
catalog and **saved**. There is no per-keystroke path by construction, so nothing in this feature
has to defend against a search box the way `RxTermsService` does. Request volume is one per
medication added, which is what keeps it comfortably inside openFDA's anonymous per-IP limit
(240/min, 1,000/day).

### 2. Consent — reuse `medication_catalog_lookup_enabled`, and rewrite the copy

openFDA receives an **RxCUI**: a public numeric drug code, no name, no user, no prescription.
RxTerms receives a **medication name, mid-typing**. Someone who accepted the larger disclosure has
by any reading accepted the smaller. A second toggle would put two near-identical questions on one
settings page and create a state where a user believes drug lookups are on and silently gets a
degraded record — consent is served by one clear question, not by more of them.

**The honest cost of that decision is the copy, and it has been paid.**
`settings.medications.catalogLookupPrivacy` (web) and `medicationSettings.catalogLookup.privacy`
(mobile) named NLM and only NLM. Both now name **both** recipients and say which gets what, and
both platforms' settings tests assert the FDA is named, so deleting it fails a gate rather than
quietly breaking the promise.

**The rule this rests on, written into the service and both `AGENTS.md` files:** if a future
lookup sends something the copy does not describe, either the copy changes with it or that lookup
gets its own opt-in. "One toggle covers everything" is not the principle.

### 3. Cache — in-memory, no table, no migration

`NodeCache`, 24 h TTL, 2,000 keys, keyed by RxCUI. `RxTermsService`'s own header had already made
and reasoned this call. The data is public, slow-changing and user-independent — none of the
properties that justify a table. The blueprint's optional `medication_catalog_cache` migration
stays unbuilt.

### 4. Surface — read-only provenance, never written to the medication row

A labeler is a fact about the **drug**, not about the user's prescription. If the FDA relists a
product under a new labeler, the right outcome is that the panel shows the new one — not that a
row the user has never edited changes underneath them. `medications.ndc` stays theirs to fill in.

**This is what makes phase 6 need no migration at all**: nothing is persisted, so no
`db/migrations/` file, no `rls_policies.sql` change, no `shared/src/schemas/database/` schema, and
no entry in the database-security-tiers doc. The new-migration checklist does not apply.

---

## Decisions inside the code worth not undoing

- **A 404 is an answer, not an outage.** openFDA reports "no matches" with a 404 body rather than
  an empty result set. It is classified `not_found` and **cached**; a thrown error or a non-404
  non-200 is `lookup_failed` and deliberately **not** cached, so an upstream blip cannot freeze a
  drug as unlisted for a day.
- **Access is settled before consent.** The medication is read under the owner's RLS context
  first, so a row that is not the caller's yields `no_rxcui` and no request — a caller cannot
  learn from a response whether someone else's medication has an RxCUI.
- **The RxCUI is pattern-validated before a request is built**, because it is interpolated into a
  Lucene query and digits are the only thing that belongs there.
- **Nothing logs the error object.** `config.params` carries the RxCUI. Same rule as
  `RxTermsService`, tested in `tests/medicationLabel.test.ts`.
- **The panel renders nothing in all four unavailable cases.** No RxCUI, not opted in, not listed,
  FDA unreachable. It is provenance under a record that has already rendered; a card explaining
  why there is no card is worse than no card. Most of both client test suites assert absence.
- **A truncated list always states the real total.** `totalMatches` prefers the FDA's own
  `meta.results.total` — a generic is listed by every manufacturer that packages it, so
  `results.length` would render "5 of 5" for a drug with 31.
- **A record with no `product_ndc` is dropped**, not rendered blank: the NDC is the one field that
  makes a row mean a specific product.

---

## Gate status — all green

| Package | Command | Result |
| --- | --- | --- |
| Server | `pnpm run validate` | pass |
| Server | `pnpm test` | 4562 passed, 2 skipped (305 files) |
| Frontend | `pnpm run validate` | pass |
| Frontend | `pnpm run test:ci` | 1203 passed (119 suites) |
| Mobile | `pnpm run validate` | pass (i18n audit: every blocking rule at 0) |
| Mobile | `pnpm exec jest --runInBand` | 6298 passed (388 suites) |

New tests: `SparkyFitnessServer/tests/openfda.test.ts` (20, the shared parser — asserted from the
server package because `shared/` has no runner), `SparkyFitnessServer/tests/medicationLabel.test.ts`
(19, route → gate → cache → wire), plus a `MedicationLabelPanel` suite on each client and an added
"names the FDA" assertion in both settings suites.

One existing suite needed a change: `SparkyFitnessMobile/__tests__/screens/MedicationDetailScreen.test.tsx`
mocks every hook the screen calls directly and had no `QueryClientProvider`; the new panel reaches
the query client for real, so the render helper now wraps in one. With no preferences seeded the
panel reads as not-opted-in, makes no request and renders nothing — the right shape for that
suite, and the panel's own behaviour stays asserted where it belongs.

---

## Not done, and why

- **`docs/`** — unchanged. Neither tier 3 nor the catalog opt-in is documented under `docs/`
  today; this feature family's knowledge lives in the three `AGENTS.md` files, all three of which
  were updated. Inventing a docs page for phase 6 alone would document the smaller half of the
  feature and leave the larger half undocumented.
- **The unreviewed diff still has no second opinion.** `codex` has been down since 2026-08-24 —
  every model is refused with `400 … not supported when using Codex with a ChatGPT account`, which
  is the account's entitlement, not the model name. The user selected "I'll resubscribe to ChatGPT
  Plus"; until that lands, `.git/second-opinion/last-error.txt` will keep outrunning
  `last-review.md` and every review silently produces nothing. Verify with:
  `env -u ANTHROPIC_API_KEY codex exec --model gpt-5.6-sol -c model_reasoning_effort=low --sandbox read-only "Reply with exactly: PONG"`

## Next step

`MEDICATION-AUTOFILL-BLUEPRINT.md` has no phase 7. This closes the blueprint. The open thread is
the review above, not more medication work.
