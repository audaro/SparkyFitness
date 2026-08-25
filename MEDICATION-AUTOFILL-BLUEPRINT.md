# Medication Autofill Blueprint

_Branch: `feat/medication-autofill` · Written 2026-08-25 · Status: proposed, not implemented_

## The ask

_Scope confirmed 2026-08-25: all peptides, bundled for every user; plus a reconstitution
calculator. See **Decided** at the end._

Type `TEST` → see **Testosterone**. Type `RET` → see **Retatrutide**. Pick one, and the form
offers that drug's real available dosages plus a **Custom** escape hatch. Ideally backed by an API
that knows the whole catalog — names, strengths, frequencies.

## The finding that shapes everything

**Those two examples need two different catalogs, and only one of them is an API.**

I probed the public drug APIs directly rather than reasoning from memory. Results:

| Probe | Testosterone | Retatrutide |
|---|---|---|
| NLM RxTerms autocomplete | **5 products, with strengths** | **0 hits** |
| RxNav `drugs.json` | full concept set | **empty `conceptGroup`** |
| openFDA NDC directory | ~thousands | 12 hits — **all `BULK INGREDIENT` powder** |

Retatrutide is an investigational peptide. It is not FDA-approved, so it is not in RxNorm, so it is
not in RxTerms, and it never will be until approval. openFDA *appears* to have it, but every hit is
a raw-API manufacturer registering bulk powder — `RETATRUTIDE 1 g/g POWDER, Nanjing Chengong
Pharmaceutical Co., Ltd.` Offering that as an autocomplete suggestion is worse than offering
nothing: it is a plausible-looking row that no user can turn into a logged dose.

**This is not an edge case for this app — it is the core user.** The Medications module is built
around GLP-1s (`Glp1Coach`, `Glp1TitrationManager`, `Glp1InventoryManager`, injection-site
rotation). Compounded semaglutide and grey-market peptides are exactly the population that no
national drug catalog will ever list.

### The good news: half of it already exists

`shared/src/medications/glp1.ts` is already a curated drug catalog — ids, display names, brand
aliases, PK constants, cadence — and **it already contains retatrutide**:

```ts
retatrutide: { id: "retatrutide", displayName: "Retatrutide", brands: [],
               halfLifeDays: 6, tMaxDays: 1.5, cadence: "weekly" },
```

`resolveGlp1Profile('Wegovy')` already resolves brand → generic. `AddMedicationDialog.tsx:844`
already has a free-text field placeheld `"e.g. Retatrutide, Compound Semaglutide"`.

So the work is not "integrate a drug API." It is **one search box over two catalogs**, one of which
we already own and one of which we fetch.

And the database already anticipated this. The 2026-06-24 migration ships these columns, unused:

```sql
rxnorm_rxcui VARCHAR(20),   -- only set if user enabled lookups
ndc          VARCHAR(20),
source       VARCHAR(50) NOT NULL DEFAULT 'manual',
strength_value NUMERIC, strength_unit VARCHAR(20),
```

That `-- only set if user enabled lookups` comment is the original author reserving this exact
feature, including its opt-in privacy stance. **No migration is needed for the core feature.**

---

## Recommended architecture

### One box, three tiers, ranked in this order

```
user types "ret"
      │
      ├─ Tier 1  Your medications        ← already in this user's cabinet, instant, offline
      ├─ Tier 2  Curated catalog          ← glp1.ts + peptides, bundled, offline, has Retatrutide
      └─ Tier 3  RxTerms (NLM)            ← ~20k prescribable US products, network, opt-in
                                             has Testosterone + its real strengths
                 ↓ always last
         "Add 'ret' as a custom medication"
```

Tiers 1 and 2 are local and always available. Tier 3 is the only network call, and the only part
that needs a privacy decision.

### Tier 3: which endpoint

**Use NLM Clinical Table Search Service (RxTerms), not RxNav.** It is purpose-built for exactly
this UI — one request returns the display names *and* their strength lists:

```
GET https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search
      ?terms=test&ef=STRENGTHS_AND_FORMS,RXCUIS&maxList=8
```

```jsonc
[ 8,
  ["Testosterone (Injectable)", "DEPO-TESTOSTERONE (Injectable)", "Testosterone (Implant)", …],
  { "STRENGTHS_AND_FORMS": [
      ["100 mg/ml Auto-Injector 0.5 ml", "100 mg/ml Sol", "200 mg/ml Injection 1 ml",
       "200 mg/ml Prefilled Syringe 1 ml", "250 mg/ml Injection 3 ml", …], … ],
    "RXCUIS": [ ["2099689","835829","2099695", …], … ] } ]
```

That single response is the entire feature: the names populate the dropdown, `STRENGTHS_AND_FORMS`
becomes the dosage picker, and the parallel `RXCUIS` array gives the `rxnorm_rxcui` to store.

Properties worth knowing: **no API key, no registration, no quota published, `Access-Control-Allow-Origin: *`.**
US-only catalog, English-only.

Keep **RxNav `approximateTerm`** in reserve for typo tolerance — `testoterone` still resolves to
Testosterone (rxcui 10379) — but it returns concepts without strengths, so it is a fallback for
"no RxTerms hits," not the primary path.

**Do not use openFDA for autocomplete.** See the bulk-powder finding above. It is a reasonable
*secondary* enrichment for NDC/labeler on a drug the user already picked, but only filtered to
`marketing_category:("NDA" "ANDA" "OTC MONOGRAPH*" "BLA")` — never as a search source.

### Privacy: proxy it, don't call it from the client

RxTerms is CORS-open, so the browser *could* call it directly. It should not.

This app's whole premise is that health data stays on infrastructure the user controls. A
keystroke-by-keystroke medication search from the user's browser to `nlm.nih.gov` leaks their
medication list — the most sensitive category in the app — to a third party, tied to their IP,
with no proxy in between. Three requirements:

1. **Proxy through the user's own server**, mirroring `SparkyFitnessServer/integrations/*`. The
   NIH sees the self-hosted server, not the user. Add `integrations/rxterms/RxTermsService.ts`
   alongside the ~21 existing providers (`openfoodfacts`, `usda`, `freeexercisedb` are the
   keyless precedents).
2. **Opt-in, off by default**, honouring the migration's `-- only set if user enabled lookups`.
   A setting in Medications settings: *"Search the public US drug catalog"* — off means Tiers 1–2
   only, which still covers this app's GLP-1 core.
3. **Cache server-side and never log the query.** Prefix-keyed cache with a long TTL; the drug
   catalog changes weekly at most. This also removes any load concern.

### Frequencies: there is no API, and you already have them

No drug catalog carries dosing frequency — frequency is prescription sig data, not product data.
RxNorm will tell you a 200 mg/ml vial exists; nothing public tells you it is weekly.

You already have this, seeded in the same migration:

```
daily · specific_days · every_n_days · cyclic · weekly · monthly · prn · taper
```

Plus `glp1.ts` `cadence: "weekly" | "daily"` per drug. **So the curated catalog can pre-select the
frequency and RxTerms cannot.** Tier 2 picks land on a form that already knows retatrutide is
weekly; Tier 3 picks leave frequency for the user. That asymmetry is a feature — lead with it.

---

## UX specification

### The search box

Replace the plain `<Input id="med-name">` in `AddMedicationDialog.tsx` (line ~661) with a combobox.
Same replacement in mobile `MedicationFormScreen.tsx`.

- Debounce **250 ms**; Tiers 1–2 render at **1 character** (local, free), Tier 3 fires at **3**.
- Group headers so provenance is visible: *Your medications* / *Known drugs* / *US drug catalog*.
- Tier 3 rows carry a subtle "NLM" tag — the user should be able to see when a row came off the
  network.
- The last row is **always** `Add "<what they typed>" as a custom medication`. Never make the user
  back out of the dropdown to type a free-text name. This is the row the peptide user takes.
- Tier 3 unreachable (offline, opt-out, timeout) degrades silently to Tiers 1–2 + custom. It must
  never block the form or surface an error toast — adding a medication cannot depend on the NIH
  being up.

### The dosage step

On select, show the strength list as chips, plus a trailing **Custom…** chip that reveals the
existing `strength_value` / `strength_unit` inputs.

- **Tier 3 pick** → chips from `STRENGTHS_AND_FORMS`, e.g. `200 mg/ml Injection 1 ml`. Parse into
  `strength_value` + `strength_unit`, keep the raw string for display, store the row's `RXCUIS`
  entry in `rxnorm_rxcui`, set `source = 'rxterms'`.
- **Tier 2 pick** → chips from the curated ladder (see below), `source = 'catalog'`, cadence
  pre-selects the schedule type.
- **Custom** → today's manual behaviour exactly, `source = 'manual'`.

Parsing `"200 mg/ml Injection 1 ml"` into numeric fields is the one genuinely fiddly bit. Treat a
parse failure as non-fatal: keep the raw string in `display_name`/`notes`, leave the numeric
fields null, let the user correct. **Never silently store a half-parsed strength** — a wrong
number on a medication record is the worst failure this feature can produce.

### The bundled catalog (new data, `shared/src/medications/catalog.ts`)

**Decision: bundled in code, all peptides, one list compiled into every install and visible to
every user.** No migration, works offline, updates ship with releases. This is the same
distribution `glp1.ts` already has — it is `shared/`, so web, mobile and server all read the one
copy.

```ts
export interface CatalogDrug {
  id: string;                    // 'retatrutide'
  displayName: string;
  aliases: string[];             // brands + synonyms, for matching: ['Reta']
  category: CatalogCategory;     // 'incretin' | 'repair' | 'gh-secretagogue' | …
  routes: MedicationRouteId[];   // ['subcutaneous']
  /** Manufacturer vial sizes. Packaging fact, not a dose. Drives the calculator. */
  vialSizes: { amount: number; unit: 'mg' | 'mcg' | 'iu' }[];
  /** Label-derived strengths ONLY. Null means "no approved label" — see the rule below. */
  strengths: { values: number[]; unit: string; source: 'label' } | null;
  /** Published PK, or null. Null must disable the serum-level chart, not default it. */
  pk: { halfLifeDays: number; tMaxDays: number } | null;
}
```

Categories to cover: incretins (semaglutide, tirzepatide, retatrutide, liraglutide, dulaglutide,
cagrilintide, survodutide…), repair (BPC-157, TB-500, GHK-Cu), GH secretagogues (ipamorelin,
CJC-1295 ±DAC, tesamorelin, sermorelin), melanocortins (PT-141, melanotan II), metabolic
(AOD-9604, 5-amino-1MQ), immune (thymosin α-1, KPV, LL-37), and TRT-adjacent non-peptides the same
users track (HCG, HMG, enclomiphene). **The list content needs its own review pass at
implementation time** — this blueprint fixes the shape, not the entries.

### The no-dose rule

**Decision: the catalog originates no dose for any drug without an approved label.**

`strengths` is populated **only** where a real label exists — semaglutide, tirzepatide,
testosterone esters. For everything investigational, `strengths: null`, and the dosage step shows
the reconstitution calculator instead of chips. The app does the arithmetic on numbers the user
supplies; it never supplies the number.

Encode this as a type-level invariant, not a convention: `source: 'label'` is the only permitted
value, so there is no way to add a ladder without asserting a label exists. A reviewer adding
`source: 'community'` has to change the type, which is the point.

### The trap: do not widen `GLP1_DRUG_PROFILES`

The obvious move — adding peptides to the existing `GLP1_DRUG_PROFILES` record — breaks two things
at once:

- `AddMedicationDialog.tsx:815` renders a `<select>` over `Object.values(GLP1_DRUG_PROFILES)`.
  Every peptide added would appear in the **GLP-1 drug** picker.
- `glp1Service.ts:73` resolves a missing half-life as `Number(custom_half_life_days) || 7`. A
  peptide with no published PK would silently inherit **a 7-day half-life** and render a
  confident, fabricated serum-level curve. That is precisely the plausible-but-wrong output this
  repo's tooling rules forbid.

So: `catalog.ts` is the new, broad list; `GLP1_DRUG_PROFILES` stays the **narrow subset with
published PK** and keeps feeding the coach. A catalog entry references a PK profile through its
`pk` field or has `null`. Two required changes fall out:

1. `Glp1Coach` / the PK chart must **hide itself** on `pk === null` rather than defaulting.
2. That `|| 7` fallback should become an explicit "no half-life known" branch. It is a latent bug
   today for any user-defined custom drug that left the field blank.

Medication rows link to the catalog through `custom_fields.catalog_id` — a new key, not the
GLP-1-specific `custom_fields.glp1_drug`, which stays as-is for coach gating. Still no migration.

---

## The reconstitution calculator

Lyophilized peptide arrives as powder. The user adds bacteriostatic water, and now has to convert
a dose in milligrams into **units on an insulin syringe**. That conversion is where people make
factor-of-ten errors on paper, and it is pure arithmetic — a good thing for software to own.

### The math

```
concentration  = vialAmount / diluentMl              → mg/mL
drawVolumeMl   = doseAmount / concentration          → mL
syringeUnits   = drawVolumeMl × 100                  → U-100 insulin units (1 mL = 100 u)
dosesPerVial   = floor(vialAmount / doseAmount)
vialLastsUntil = dosesPerVial × the schedule's interval
```

Worked example, the retatrutide case: a 10 mg vial + 2 mL BAC water = 5 mg/mL. A 2 mg dose is
0.4 mL = **40 units** on a U-100 syringe, and the vial yields 5 doses.

`dosesPerVial` and `vialLastsUntil` are the two outputs that connect to the rest of the app —
`Glp1InventoryManager` already tracks vials, and `medication_schedules` already knows the interval.

### Failure modes it must refuse, loudly

This is dosing math. Per the repo's rule that data tooling fails loudly rather than emitting a
plausible wrong answer, the calculator returns a discriminated result — `{ ok: true, … }` or
`{ ok: false, reason }` — and **never a number it is not sure of**:

| Condition | Behaviour |
|---|---|
| `diluentMl <= 0` or `vialAmount <= 0` | refuse — no division by zero |
| dose > vial contents | refuse — cannot draw more than the vial holds |
| mg ↔ mcg | convert explicitly (×1000); a silent factor of 1000 here is the dangerous bug |
| **IU vials** (HCG, HMG) | stay in IU end to end — **never** cross-convert IU↔mg; it is substance-specific and there is no general factor |
| `syringeUnits` > syringe capacity | compute, but warn: use a larger syringe or less diluent |
| `syringeUnits` < ~2 u | compute, but warn: below reliable measurement precision |
| result not finite | refuse |

Every one of those gets a unit test, and there is a parity test asserting no silent partial
result — the calculator either returns a complete, checked answer or an error the UI shows.

Home: `shared/src/medications/reconstitution.ts`, pure functions, no DB, no I/O — the same shape
`glp1.ts` already establishes, so web and mobile share one implementation and one test suite.

### Where it appears

1. **In the dosage step** for any catalog drug with `strengths: null` — the calculator *is* the
   dosage picker for peptides, replacing the chips.
2. **Standalone**, reachable from the Medications page, for a user working out a vial before
   committing to a medication record.
3. Its output writes `strength_value` / `strength_unit` (concentration) and `dose_amount` /
   `dose_unit` on the medication — the columns already exist and are already the right shape.

**Framing, everywhere it renders:** it converts numbers the user entered. It does not recommend a
dose, and the existing `MedicationDisclaimer` should be adjacent, not buried.

---

## Data model

No migration for the core feature. Existing columns absorb it:

| Column | Tier 1 | Tier 2 (curated) | Tier 3 (RxTerms) | Custom |
|---|---|---|---|---|
| `source` | `'manual'` (copied) | `'catalog'` | `'rxterms'` | `'manual'` |
| `rxnorm_rxcui` | copied | null | from `RXCUIS` | null |
| `strength_value/_unit` | copied | from ladder | parsed | typed |
| `custom_fields.glp1_drug` | copied | profile id | null | free text |

One optional migration, **Phase 4 only**: a `medication_catalog_cache` table if the server-side
cache should survive restarts. Start with in-process — the catalog is small and the cache is warm
within a session. If it lands, follow `agent-docs/new-migration-checklist.md` (RLS, shared Zod
schema, security-tier docs — this table is global reference data, not user data, so it is Tier 1).

---

## Phasing

Each phase is independently shippable and independently useful.

**Phase 0 — Split the catalog from the PK registry.** Add `catalog.ts` with the GLP-1 entries
migrated across; make `pk` nullable; fix the `|| 7` half-life fallback and hide the serum chart on
null. No user-visible change, but everything else stands on it, and it closes a latent bug that
exists today.

**Phase 1 — The reconstitution calculator.** `shared/src/medications/reconstitution.ts` plus the
standalone screen. Pure math, fully tested, no dependency on search or catalog work. *Independently
shippable and independently useful* — it is worth having even if autofill never lands.

**Phase 2 — Local autofill, no network.** Combobox over Tiers 1 + 2 with the always-present custom
row; label-derived chips where they exist, the Phase 1 calculator where they don't. Web and mobile.
*Ships the retatrutide example end to end with zero privacy surface and zero external dependency.*

**Phase 3 — Full peptide catalog.** Populate `catalog.ts` across all categories, with the content
review pass. Mechanical once Phase 0 fixes the shape; the cost is sourcing vial sizes accurately.

**Phase 4 — RxTerms behind the opt-in.** `integrations/rxterms/RxTermsService.ts`, a v2 route, the
settings toggle, server cache, graceful degradation. *Ships the testosterone example.*

**Phase 5 — Quality.** `approximateTerm` typo fallback; brand→generic display ("Wegovy →
semaglutide"); recency weighting so a user's own drugs outrank the catalog; vial-life feeding
`Glp1InventoryManager`.

**Phase 6 — Optional enrichment.** Filtered openFDA for NDC/labeler on an already-chosen drug;
persistent cache table.

---

## Decided

1. **Catalog distribution — bundled in code.** One list in `shared/`, every install, every user,
   offline, no migration.
2. **Dose data — calculator only, no originated doses.** Label-derived `strengths` where a label
   exists; `null` plus the reconstitution calculator everywhere else, enforced by the type.

## Still open for you

1. **Opt-in default for RxTerms.** I recommend off, matching the migration's `-- only set if user
   enabled lookups`. Counter-argument: a self-hosted user who enabled the module probably wants the
   catalog, and a toggle they never find makes Phase 4 look broken.
2. **Syringe standards.** U-100 covers insulin syringes, which is what essentially everyone uses.
   Support U-40 (veterinary, and some international supply) as well, or refuse non-U-100 rather
   than risk a 2.5× conversion error?
3. **Vial-size sourcing.** Phase 3's cost is entirely in getting vial sizes right per peptide, and
   for grey-market supply "the vial size" varies by vendor. Ship a short list of common sizes per
   drug, or let the user type the vial size every time and keep the catalog identity-only?
4. **Blueprint location.** This file is committed to the branch; the other blueprints
   (`AI-COACH-BLUEPRINT.md`, `FITBOD-BLUEPRINT.md`) live outside the repo in `~/fitness/`. Say the
   word and I'll move it.

## What I did not verify

- RxTerms has **no published rate limit**; I did not load-test it. The server cache makes this
  moot in practice, but if Phase 2 goes wide, confirm before assuming unlimited.
- Coverage is **US-only and English-only**. The app ships 28 locales. A non-US user gets Tiers 1–2
  and the custom row — acceptable, but it means Phase 2 is a US-user feature, not a global one.
- I did not check whether `MedicationFormScreen` on mobile can host a combobox without new
  primitives; the mobile guide points at `AnchoredMenu` / `BottomSheetPicker` as the likely fits.
