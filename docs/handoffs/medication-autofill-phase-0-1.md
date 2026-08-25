# Handoff — Medication autofill, phases 0 and 1

Branch `feat/medication-autofill`. Plan: `~/fitness/MEDICATION-AUTOFILL-BLUEPRINT.md` (moved out of
the repo this step; phases at "Phasing"). First implementation step on this branch — the two commits
before it are the blueprint itself.

## What shipped

| Commit | Summary |
|---|---|
| `1eaebd0b6` | Split the medication catalog from the GLP-1 PK registry (phase 0) |
| `b17ee9043` | Add the peptide reconstitution calculator (phase 1) |
| `1a4f6aa2d` | Move the medication autofill blueprint out of the repo |

### Phase 0 — the catalog split

`GLP1_DRUG_PROFILES` was doing two incompatible jobs: backing the "GLP-1 drug (for the PK model)"
`<select>` in `AddMedicationDialog.tsx:815`, and supplying half-lives to the serum-level model. The
new `shared/src/medications/catalog.ts` is the wide search catalog; `glp1.ts` stays the narrow set
with published PK.

The one design decision to carry forward: **a catalog entry does not copy PK, it references it.**
`pkFromGlp1(id)` reads `GLP1_DRUG_PROFILES` and throws at module load on an unknown id. That means
the half-life numbers have exactly one home, and a mistyped profile id is a total, immediate failure
rather than a catalog entry that silently has no PK. `tests/medicationCatalog.test.ts` asserts the
two lists agree, so they cannot drift.

`strengths` carries `source: 'label'` as its only permitted value. Adding a ladder that did not come
off an approved label requires editing the type, which is the point. Every entry currently has
`strengths: null` and `vialSizes: []` — see open risks.

### Phase 0 — the `|| 7` half-life fix

`glp1Service.ts:73` resolved a missing custom half-life as `Number(...) || 7`. Any user-defined drug
that left the field blank inherited a 7-day half-life and rendered a confident, fabricated serum
curve. It now declines to build a profile at all without a half-life.

`getSerumCurve` gained `unavailableReason: 'no_profile' | 'no_half_life' | 'no_injections' | null`
so the chart can say what is actually missing. `Glp1Coach.tsx` shows the new
`medications.glp1.pkNoHalfLife` string on `no_half_life` instead of telling the user to log
injections they already logged. `tMaxDays` keeps a documented default (`DEFAULT_CUSTOM_T_MAX_DAYS`)
— it only shapes the rising edge and cannot fabricate persistence the way a half-life can.

### Phase 0 — a latent bug found in self-review

`resolveGlp1Profile` used a bare `GLP1_DRUG_PROFILES[key]`. A plain object inherits `constructor`,
`toString`, `valueOf` and `__proto__`, so a medication named `constructor` resolved to a truthy
Function whose `halfLifeDays` is `undefined` — an all-NaN curve rendered as confidently as a real
one. Both resolvers now use `Object.hasOwn`. Regression test covers all five keys.

### Phase 1 — the reconstitution calculator

`shared/src/medications/reconstitution.ts`, pure, no DB, no I/O. `reconstitute()` plus the inverse
`diluentForTargetUnits()` ("make my 2 mg dose land on exactly 20 units").

Every result is a discriminated `{ ok: true, ... } | { ok: false, reason, message }`. It refuses
non-positive or non-finite vial/diluent/dose, a dose larger than the vial holds (checked *after*
unit conversion), and an unknown syringe standard. mg↔mcg converts explicitly; **IU never
cross-converts to mass** — that factor is substance-specific, so an IU vial with an mg dose is
`unit_mismatch`, not a guess. Over-capacity and below-measurable-precision draws compute but carry a
warning.

Syringe standard is an input, not an assumption: `'U-100' | 'U-40'` differ by 2.5x, so the caller
names one and every result echoes `syringe` and `syringeUnitsPerMl` back. Capacity defaults to one
full mL of whichever standard is in use (100 u / 40 u).

Two details worth not regressing:

- `dosesPerVial` floors with an `EPSILON`. `0.3 / 0.1` is `2.9999999999999996` in IEEE 754, and a
  bare `Math.floor` silently costs the user a dose.
- Warnings are computed from the **rounded** figure, so the caution always matches the number the
  user reads on screen.

## Gate status

Run on the committed state, all green:

- Server: `pnpm run validate` pass; `pnpm test` — **4250 passed**, 2 skipped (295 files).
- Frontend: `pnpm run validate` pass; `pnpm test` — **1088 passed** (112 suites).
- Mobile: `pnpm run validate` pass.

The four medication suites specifically:

```bash
cd SparkyFitnessServer && pnpm exec vitest run \
  tests/reconstitution.test.ts tests/medicationCatalog.test.ts \
  tests/glp1Service.test.ts tests/glp1Logic.test.ts
```

No migration was needed and none was added — the 2026-06-24 migration already ships
`rxnorm_rxcui`, `ndc`, `source` and `strength_value/_unit` unused.

## Next step

**Phase 2 — local autofill, no network.** A combobox over Tier 1 (the user's own medications) and
Tier 2 (`MEDICATION_CATALOG`), with the always-present `Add "<typed>" as a custom medication` row
last. Replaces the plain `<Input id="med-name">` in `AddMedicationDialog.tsx` (~line 661) and the
same field in mobile `MedicationFormScreen.tsx`. Ships the retatrutide example end to end with zero
privacy surface.

Two things phase 2 needs that phase 0 deliberately did not build:

1. **A search function.** `catalog.ts` exports only `resolveCatalogDrug` (exact id/name/alias
   match). Tier 2 needs prefix/substring ranking — build it in `catalog.ts` as a pure function so
   mobile shares it.
2. **A mobile combobox primitive.** Unverified whether `MedicationFormScreen` can host one; the
   mobile guide points at `AnchoredMenu` / `BottomSheetPicker` as the likely fits.

Medication rows should link to the catalog through `custom_fields.catalog_id` — a new key, *not*
the existing `custom_fields.glp1_drug`, which stays as-is for coach gating.

## Open risks and deliberate skips

1. **Strength ladders are brand-shaped; the catalog is generic-shaped.** This is the one that needs
   a decision, and it blocks phase 3's content pass. One `CatalogDrug.semaglutide` cannot hold two
   ladders, but Ozempic (0.25/0.5/1/2 mg) and Wegovy (0.25/0.5/1/1.7/2.4 mg) genuinely differ, as do
   Mounjaro and Zepbound. Three ways out: split brands into their own entries sharing a
   `glp1ProfileId`; make `strengths` a map keyed by brand; or take the union and let the user pick.
   Until it is decided, `strengths: null` is correct everywhere and routes the dosage step to the
   calculator, which is a working answer rather than a guessed one.
2. **`vialSizes` is empty on every entry.** Sourcing per-peptide vial sizes is phase 3 content work.
   Empty is a valid, working state — the field is a suggestion that pre-fills the calculator, never
   a constraint, because grey-market vial sizes vary by vendor.
3. **The calculator has no UI yet.** Phase 1 shipped the pure module and its tests; the standalone
   screen and the in-dialog dosage step land with phase 2, where the surfaces exist. The
   `MedicationDisclaimer` must be adjacent wherever it renders — it converts numbers the user
   entered and does not recommend a dose.
4. **`convert()` throws rather than returning a failure.** Unreachable by construction
   (`sameUnitFamily` gates every call and all in-family pairs are handled); it exists so that adding
   a fourth unit without updating both functions fails loudly instead of silently doing an identity
   conversion. If a unit is ever added, handle it in both places.
5. **`listInjections` is capped at `limit: 60`.** Pre-existing, untouched. A user with a long
   injection history models only the most recent 60 doses.
