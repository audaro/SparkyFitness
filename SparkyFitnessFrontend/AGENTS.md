# AGENTS.md

_Last updated: 2026-08-26_

SparkyFitness Frontend is the React web app for the SparkyFitness monorepo. Use this file as the primary guide for work inside `SparkyFitnessFrontend/`.

If a task also touches the server, mobile app, or `shared/`, read that package guide before editing outside this directory. Use `../AGENTS.md` for monorepo-level context.

## Scope

- This file is for package-local work in `SparkyFitnessFrontend/`.
- `CLAUDE.md` just imports this file via `See @AGENTS.md`.
- Run scripts from this directory.

## Current Snapshot

- Stack: React 19, Vite 8, TypeScript 5, Tailwind CSS v4 (via `@tailwindcss/vite`), shadcn/ui-style Radix primitives, TanStack Query 5, React Router 7 (`createBrowserRouter`), i18next, Better Auth client, Zod 4, Recharts.
- `@/*` maps to `src/`; `@workspace/shared` maps to `../shared/src/index.ts` (also in Jest via `moduleNameMapper`).
- Dev server runs on port `8080` and proxies `/api`, `/mcp`, and `/uploads` to the backend on `3010`; `/health-data` is proxied with an `/api` prefix rewrite. Override the backend host with `VITE_BACKEND_HOST`.
- PWA (`vite-plugin-pwa`) is enabled in production builds only.

## Verified Commands

```bash
pnpm dev
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run format
pnpm run validate
pnpm test
pnpm run test:ci
pnpm run build
```

- `pnpm run validate` runs typecheck, lint (`--max-warnings 0`), and Prettier check together.
- `pnpm test` runs Jest (`ts-jest`, `jsdom`); config is inline in `package.json`, setup in `src/tests/setupTests.ts`.
- `pnpm run build` runs `validate` first, then `vite build`.
- CI (`.github/workflows/ci-tests.yml`) runs `pnpm run validate` and `pnpm run test:ci` for this package when its files change; matching those locally means a green PR.

## Domain-Mirrored Layout (the most important convention)

Features are organized by domain, and the same domain folder name appears in `src/pages/`, `src/api/`, and `src/hooks/`. A feature change usually touches the matching folder in all three:

- Page domains: `Admin`, `Auth`, `Chat`, `CheckIn`, `Cycle`, `Diary`, `Errors`, `Exercises`, `Fasting`, `Foods`, `Goals`, `Integrations`, `Medications`, `Reports`, `Settings`.
- API domains add a few more: `AiConversions`, `Chatbot`, `Onboarding`, `Pregnancy`, `SleepScience`.
- Example: a Medications bug lives in `src/pages/Medications/` + `src/api/Medications/` + `src/hooks/` medication hooks. Start there, not with a repo-wide search.

## Source Map

- `src/main.tsx` - app bootstrap; creates the shared `QueryClient` with global `QueryCache`/`MutationCache` handlers that render toasts from query/mutation `meta` (`errorTitle`, `errorMessage`, `successMessage`).
- `src/App.tsx` - route registry via `createBrowserRouter`, plus `PrivateRoute` and `PermissionRoute` wrappers (permission-gated areas include `reports` and `admin`).
- `src/pages/<Domain>/` - route screens by domain.
- `src/api/api.ts` - `apiCall(endpoint, options)` helper: base URL `/api`, query `params`, JSON/FormData bodies, `responseType`, error toasts, `suppress404Toast`. Use it for all backend requests.
- `src/api/<Domain>/` - per-domain API clients built on `apiCall`.
- `src/hooks/<Domain>/` and `src/hooks/use*.ts(x)` - TanStack Query hooks and shared UI hooks (`use-toast`, `useDebounce`, `useAuth`, ...).
- `src/components/` - shared components; `ui/` holds the shadcn-style primitives (~37 files); domain component folders include `Foods/`, `FoodSearch/`, `FoodUnitSelector/`, `Onboarding/`, `ExerciseCharts/`, `ai/` (assistant-ui chat pieces).
- `src/contexts/` - `ActiveUserContext` (family-access acting-user switching), `PreferencesContext`, `ThemeContext`, `WaterContainerContext`, `ChatbotVisibilityContext`, `ChatToolCategoriesContext` (runtime chat tool-category selection, localStorage-backed).
- `src/layouts/` - `MainLayout.tsx` and `AddComp.tsx`.
- `src/lib/` - `auth-client.ts` (Better Auth React client), `utils.ts` (`cn`), scanner engines, sleep helpers.
- `src/services/` - pure calculation helpers (BMR, body composition, nutrient calculation, preferences), not HTTP clients.
- `src/utils/` - logging, user preferences, date helpers, misc.
- `src/tests/` - Jest suites mirroring `components`/`contexts`/`hooks`/`services`/`utils`, plus `test-utils.tsx`.
- `public/locales/<lng>/translation.json` - i18next resources, loaded over HTTP at runtime.

When searching, ignore `node_modules/`, `dist/`, and every locale except `public/locales/en/`.

## Navigation Shape

The top nav is deliberate, not an accumulation. Two rules shape it, and one thing breaks it.

**Food and Exercise are the two destinations.** `/` is the day's food; `/exercises` is everything
about training. Neither leaks into the other: the day's logged exercise lives on `/exercises`
(`pages/Exercises/ExerciseDayCard.tsx`), not in the diary's widget grid.

**A library is not a tab.** `/foods` is still a route but not a nav entry — it is reached from the
Food page (`pages/Diary/FoodLibraryCard.tsx`) and from the "+" menu on small screens. That is a
cold-load decision as much as an IA one: mounting the foods table, meals and the meal-plan calendar
on `/` would put three more list queries on the route every session starts on. The exercise library
is the exception that proves it — it is already inline on `/exercises`, which is its own page.

Both nav lists live in `layouts/MainLayout.tsx` (`availableTabs` for desktop,
`availableMobileTabs` for the bottom bar) and **both must be edited together**; nothing asserts that
they agree.

**Acting on behalf is a different nav, and it is the trap here.** A delegate's tab list is a small
subset that has never included `/exercises` — the recommendation, gym-profile and weekly-target
tables are owner-only at the RLS layer. `isCurrentPathAllowed` redirects them off any route not in
their list, so _anything moved onto `/exercises` becomes unreachable for a delegate_. That is why
the diary keeps its exercise widget while `isActingOnBehalf` and drops it otherwise, and why the
diary's `/` tab keeps the Diary label for them. Check that branch whenever you move a surface
between pages.

## Coaching Surfaces (`/exercises`)

The suggested-workout family — Up Next, muscle recovery, weekly set targets, gym profiles — is
`api/Exercises/{workoutRecommendations,weeklySetTargets,gymProfiles,coachProfile}.ts`,
`hooks/Exercises/use{WorkoutRecommendation,MuscleRecovery,WeeklySetTargets,GymProfiles,CoachProfile}.ts` and one
card per reading under `pages/Exercises/`. Five rules, each of which has already cost something:

- **Nothing about a workout's content is decided on the client.** The engine is server-side and
  deterministic; the web sends parameters and renders what comes back.
- **`freshness` is 0.0-1.0, not a percentage.** Convert exactly once, in the hook's `select`
  (`useMuscleRecovery`). A second `×100` anywhere is a bug waiting to be a display of 1%.
- **`isError` does not mean "no data".** It is also true when a _refetch_ fails over cached data, so
  hide a section on `isError && !data`, never on `isError` alone.
- **The experience select on `UpNextCard` is a profile edit, not a request parameter.** The
  footer's experience-level select PATCHes `/api/coach-profile` (owner-only, hidden with the
  rest of the card through `useCoachingContextAvailable`) and applies on the _next_ generate —
  unlike the duration select beside the Generate button, which travels with one request. What
  leaves the client is the lowercase catalog token (`beginner`/`intermediate`/`expert`) or an
  explicit null to clear; `'unset'` is a Radix-only sentinel (Select cannot carry an empty
  string) and must never reach the wire. The chat coach edits the same row.
- **Owner-only vs delegatable is per-surface, not per-page.** Recovery rides the `diary` permission
  and stays available to a delegate who has it (so its cache key is scoped by acting user);
  everything else on that page is owner-only and hides itself through
  `hooks/Exercises/useCoachingContextAvailable.ts`, with its query disabled so no request is made.
- **Starting a generated workout goes through playback, not the preset path.** "Start workout" builds
  a `WorkoutPlaybackDraft` with `createWorkoutPlaybackDraftFromRecommendation` and hands it to
  `/workout-playback` in route state. The day is always today in the user's timezone, never the
  page's `?date=`, because the workout was programmed against today's recovery. `preset_id` is null
  on such a draft — a recommendation is not a preset, and nothing resolves one through that field.
- **Every way into playback goes through `hooks/Exercises/useWorkoutPlaybackStart.tsx`.** A
  route-state draft **replaces** whatever is in `localStorage` for that day, so starting a workout on
  a day that already has an unfinished one destroys it. The hook is the prompt in front of that, used
  by all three entry points (Up Next, the presets manager row menu, the diary's preset selector);
  drop its `guardDialog` in the tree and call `requestStart`. Navigating to `/workout-playback` with a
  draft any other way reintroduces the data loss. Pass `createDraft` as a callback, not a built draft
  — building one stamps `started_at`, which must not happen for a start the user cancels.

## Medication Name Search (`/medications`)

`MedicationNameCombobox.tsx` is a **three-tier** search, ranked by how much each tier knows about
this user: tier 1 is their own cabinet (`useMedications`), tier 2 the bundled catalog in
`@workspace/shared` (`searchCatalog`, offline), tier 3 the US drug catalog (NLM RxTerms) over the
network. The combobox reports a `MedicationNamePick` and applies nothing —
`AddMedicationDialog.handleNamePick` owns which fields a pick fills in, which is what makes the
dialog testable without a dropdown in the way. Mobile mirrors the same pick type in
`MedicationNameSuggestions.tsx`; a change to one is a change to both.

- **Tier 3 is opt-in and silent.** `hooks/useMedicationCatalogSearch.ts` gates every request on the
  `medicationCatalogLookupEnabled` preference, a 250 ms debounce and `RXTERMS_MIN_TERM_LENGTH`. The
  server gate is the binding one; the client not asking is what keeps the medication name on the
  machine. It sets no `meta.errorMessage` and the API client is called with `suppressErrorToast`,
  so a failed lookup is invisible — tiers 1-2 have already rendered, and adding a medication must
  never depend on the NIH being reachable. The `active` flag is the dropdown's open state, because
  the edit dialog mounts with a name already in the box and `useDebounce` seeds from it.
- **The highlight resets on any change to the row set**, and the stored index is keyed by query
  _and row count_: tier 3 arrives late and inserts rows above the custom one, so a still-in-range
  index can point at a different drug than it did a keystroke ago.
- Where the two catalogs overlap, **tier 2 wins** (the server drops any RxTerms product the curated
  catalog resolves). Tier 1 suppression is the client's job and matches on `baseName`.
- A tier 3 row is a **product**, not a strength: one row with a hint from `rxTermsStrengthHint`
  (shared, so web and mobile make the same call), and a product with several strengths asks in the
  dialog rather than guessing. `rxnorm_rxcui` is stored from the strength picked, never the
  product, and is cleared the moment the name stops describing it.
- **Tier 1 is ranked by use, not by alphabet.** `rankOwnMedications` (shared) orders the cabinet
  active-first, then most recently taken, then the never-taken alphabetically, and only then
  applies the four-row cap — a user with a dozen matches was otherwise offered whichever four
  sorted first. It reads `last_taken_at`, a **derived** field only the list endpoint fills in.
- **A tier 2 group can be a guess.** When `searchCatalog` matches nothing by substring it falls
  back to edit distance and flags the hits `viaTypo`; the heading then says "Did you mean" rather
  than "Known drugs". Tier 3 does the same in words: `correctedTerms` from the server names the
  spellings its rows were actually found under, rendered as a sub-line under the NLM row, because
  RxNav answers a metformin typo with merbromin as well as metformin.
- The opt-in is `pages/Settings/MedicationSettings.tsx` (wellness tab). There is deliberately no
  nudge inside the dropdown.

## Medication Label Provenance (`/medications`)

`MedicationLabelPanel.tsx` sits under the selected medication's detail card and says who makes the
drug, from the FDA's NDC directory — `api/Medications/medicationService.getMedicationLabel` →
`hooks/useMedicationLabel.ts` → `GET /api/v2/medications/:id/label`. Mobile mirrors it component
for component; the server half is `SparkyFitnessServer/AGENTS.md`.

- **It renders nothing in every unavailable case.** No RxCUI, not opted in, not listed, FDA
  unreachable — four different answers, told apart only so the panel can be sure none is worth
  showing. It is provenance layered under a record that has already rendered, and a card
  explaining why there is no card is worse than no card. The tests are mostly assertions of
  absence, and that is deliberate.
- **It rides the same `medicationCatalogLookupEnabled` preference** as tier 3 of the name search,
  because it sends strictly less: an RxCUI, a public numeric drug code, rather than a name being
  typed. The condition on that is the copy — `settings.medications.catalogLookupPrivacy` names
  **both** the NLM and the FDA and says which gets what, and `MedicationSettings.test.tsx` asserts
  the FDA is named. **If a future lookup sends something that copy does not describe, either the
  copy changes with it or that lookup gets its own opt-in.**
- **Nothing it returns is written to the medication row.** A labeler is a fact about the drug, not
  about this prescription; an FDA relisting should change what the panel shows, not rewrite a
  record the user never edited. `medications.ndc` stays theirs to fill in by hand.
- The preference and the RxCUI are checked in the hook as well as on the server, so a medication
  with no RxCUI costs no request at all rather than a round trip answering `no_rxcui`.
- A truncated list always states the real total (`totalMatches` can far exceed the five products
  returned — a generic is listed by every manufacturer that packages it), or it reads as a
  complete list when it is a sample.

## Translations (i18n)

- Only ever edit `public/locales/en/translation.json`. The other 27 locales are machine-synced through the `sync-translations.yml` workflow and a separate SparkyFitnessTranslations repo; hand-editing them creates conflicts with that pipeline.
- UI strings go through `useTranslation()` / `t('...')` keys, not hardcoded literals.
- `en/translation.json` is ~120 KB - grep for the key or section you need instead of reading the whole file.
- Developer docs: `../docs/content/8.developer/9.translations.md`.

## Conventions

- Use `apiCall` (or an existing per-domain client) for backend requests; don't hand-roll `fetch`.
- Prefer declaring toast text via React Query `meta` on the query/mutation instead of imperative `toast(...)` calls where the global handlers cover it.
- Use `src/utils/logging.ts` helpers instead of bare `console.*`; verbosity follows the user's logging-level preference.
- Keep `YYYY-MM-DD` values as calendar-day strings; use the shared timezone/day helpers from `@workspace/shared` instead of `toISOString().split('T')[0]`.
- To learn a database table's shape, read `../shared/src/schemas/database/<Table>.zod.ts` - do not read `../db_schema_backup.sql` or the migrations.
- Auth flows go through `src/lib/auth-client.ts` and `useAuth`; acting-user (family access) state lives in `ActiveUserContext` and affects most data hooks.
- New UI should reuse `src/components/ui/` primitives and existing shared components before adding new ones.

## Testing and Validation

- Test files live in `src/tests/`, mirroring the source area they cover; use `test-utils.tsx` for rendering with providers.
- Run the tests nearest the touched surface first, then `pnpm run validate` for cross-cutting changes.
- Lint is strict (`--max-warnings 0`); unused imports fail the build.

## Quick Routing

- Routing/navigation/permission issue: `src/App.tsx` (router, `PrivateRoute`, `PermissionRoute`) and `src/layouts/MainLayout.tsx`. Read "Navigation Shape" above first — the desktop and mobile tab lists are two arrays that must move together, and the acting-on-behalf branch is a different nav.
- Suggested workouts / recovery / weekly targets / gym profiles: "Coaching Surfaces" above, then `src/pages/Exercises/` and the matching `src/api/Exercises/` + `src/hooks/Exercises/`.
- Diary widget missing, duplicated, or in the wrong place: `src/pages/Diary/Diary.tsx` builds the widget registry, `src/utils/dashboardLayout.ts` supplies the keys and default tiles for it, and the two must agree — a default tile for a widget the page does not render is a phantom entry in every new user's saved layout.
- API/error-toast issue: `src/api/api.ts`, then the domain client in `src/api/<Domain>/`, then the query/mutation `meta` in the calling hook.
- Auth/session issue: `src/lib/auth-client.ts`, `src/hooks/useAuth.tsx`, `src/pages/Auth/`, and the server's `auth.ts` if it crosses packages.
- Family-access/acting-user issue: `src/contexts/ActiveUserContext.tsx` and the hooks consuming it.
- Chat (Sparky) issue: `src/pages/Chat/`, `src/components/ai/`, `src/api/Chatbot/`.
- Theme/preferences issue: `src/contexts/ThemeContext.tsx`, `src/contexts/PreferencesContext.tsx`, `src/services/preferenceService.ts`, `src/utils/userPreferences.ts`.
- Medication autofill issue (a suggestion missing, a wrong strength, a name that should not have been sent): "Medication Name Search" above, then `src/pages/Medications/MedicationNameCombobox.tsx`, `src/hooks/useMedicationCatalogSearch.ts`, and `AddMedicationDialog.handleNamePick`. Tier 3's _content_ is decided in `shared/src/medications/rxterms.ts` and on the server, not here.
- Pen/vial inventory issue (a wrong doses-per-vial, a blank concentration): `src/pages/Medications/Glp1InventoryManager.tsx` opens its vial fields from `vialInventoryPrefill` (shared), which derives concentration, volume and doses-per-vial from the reconstitution record on the medication's `custom_fields`. Every field it declines to fill is a refusal, not an omission — an IU vial has no mg/mL, and a dose the vial cannot divide has no dose count — so the fix for a blank box is almost never to invent a default there. **`DEFAULT_PEN_DOSES` / `DEFAULT_VIAL_DOSES` apply only when there is no mix on record at all.** Once there is one, a field the prefill refuses stays empty rather than falling back to the constant: `doses_total` is what the run-out date is computed from, and a plausible number on a vial whose mix was actually measured reads as derived when it is a guess.
- Beyond-use date: the suggestion is `vialBudGuidance(record.diluent)` (shared), reached through `vialInventoryPrefill(...).bud`, and it is a _suggestion_ — prefilled from the opened date, overwritable, with the assumption it makes spelled out next to the field. It has **three** answers, and the caption must say which one it is giving: `preserved` (28 days, because the mix records a bacteriostatic diluent and the benzyl alcohol is what buys the month), `preservative_free` (**no date at all** — sterile water and saline are good for hours, not days, and the calculator refuses to invent a number rather than suggesting a dangerous one), and `unstated` (28 days from a record saved before the diluent field existed, captioned as the assumption it is). A pen has no mix, so it takes `PEN_BUD_GUIDANCE` — 28 days, `unstated`. Once a BUD is the user's (typed here, or already stored on the row) `budTouched` stops the opened date from recomputing it; do not "fix" that by re-deriving on every change.
- The draw is drawn: `SyringeDiagram.tsx` renders a barrel filled to `result.syringeUnits` above the number, because a unit count is easy to misread (5 for 50 is one glance away) and hard to picture. The geometry is `syringeBarrel()` in shared — tick spacing, which marks carry a number, and the fill fraction — so the web SVG and the mobile `react-native-svg` component mark their barrels identically. Three rules: it takes `result.syringeCapacityUnits` rather than re-deriving capacity from the standard (a custom barrel would otherwise render to the wrong scale and the picture would disagree with the number beside it); an over-capacity draw renders as a **full** barrel in amber, matching the warning already on screen, with the un-clamped number still in the accessible name; and `syringeBarrel` returning `null` renders nothing, because a barrel at a scale nobody can name is worse than no picture. **Position 0 is the needle end**, and that fixes both ends of the drawing: the 0 graduation is where the stopper rests on an empty syringe, which is against the needle, and the liquid sits between the needle and the stopper. So the needle goes at the 0 end, the fill grows away from it, and the numbers count up toward the plunger — in both orientations. Drawn the other way round the mark still lands on the right number, so the answer survives and only the dedicated orientation tests catch it; what it renders is a syringe held backwards. The web component takes an `orientation`: the calculator passes `vertical`, standing the barrel beside its numbers in a two-column panel that stacks below `sm`, while `horizontal` is the default and is what mobile draws, having only one column.
- The diluent itself is picked in `ReconstitutionCalculator.tsx` and stored on the record as `ReconstitutionDiluent | null`. It is the **one** optional field on `ReconstitutionRecord`: `readReconstitutionRecord` is otherwise all-or-nothing, and making this one required would have voided every mix already saved. Absent, null, and a value this version does not recognise all read back as `null`, "not stated" — which is a real answer, not a parse failure, because the field feeds only the beyond-use suggestion and never the syringe arithmetic.
- Medication label panel missing, or showing the wrong maker: "Medication Label Provenance" above, then `src/pages/Medications/MedicationLabelPanel.tsx` and `src/hooks/useMedicationLabel.ts`. A missing panel is almost always correct — it is silent for a row with no `rxnorm_rxcui`, an owner who has not opted in, a drug the FDA does not list, and an unreachable FDA alike, so check `unavailableReason` on the response before suspecting the component. The _content_ of a listing is decided in `shared/src/medications/openfda.ts` and on the server, not here.
- Missing/wrong UI text: the i18n key in `public/locales/en/translation.json` and the `t('...')` call site.
- Chart issue: Recharts usage in the domain page plus `src/components/ExerciseCharts/` or `ZoomableChart.tsx`.

## Priority Rule

- For work inside `SparkyFitnessFrontend/`, this file wins over repo-root guidance on package-specific details.
- If a task spans packages, combine this guide with the other affected package guides.
- If you add a new domain folder, route family, or cross-cutting convention, update the Domain list, Source Map, and Quick Routing sections of this file in the same change.
