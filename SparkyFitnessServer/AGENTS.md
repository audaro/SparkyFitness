# AGENTS.md

_Last updated: 2026-08-25_

SparkyFitness Server is the backend API package for the SparkyFitness monorepo. Use this file as the primary guide for work inside `SparkyFitnessServer/`.

**Quick Links for AI Tools:** See `../agent-docs/README.md` for:

- `file-and-domain-reference.md` — Where to find server code by feature
- `testing-patterns.md` — How to test routes, services, repositories, and RLS
- `architecture-permissions.md` — Permission types and RLS patterns
- `new-migration-checklist.md` — 8-step database change checklist

If a task also touches `shared/`, the frontend, or the mobile app, read the relevant package guide before editing outside this directory. Use `../AGENTS.md` for monorepo-level context.

## Scope

- This file is for package-local work in `SparkyFitnessServer/`.
- Keep changes inside this package unless the task clearly crosses package boundaries.
- This is the single source of truth for the package; `CLAUDE.md` just imports it via `See @AGENTS.md`.
- Do not invent alternate boot paths, duplicate route registries, or parallel migration flows when the current startup path already covers the behavior.

## Current Snapshot

- Dev boot path: `pnpm start` -> `nodemon` -> `tsx index.ts`
- `index.ts` loads `../.env`, applies file-backed secrets, runs preflight checks, then imports `SparkyFitnessServer.ts`
- Main app shell: `SparkyFitnessServer.ts`
- Stack: Express 5, PostgreSQL via `pg`, Better Auth, Zod, TypeScript 5, Vitest 4, ESLint 10
- Module system: ESM with `type: "module"` and `moduleResolution: "NodeNext"`
- The package is now effectively TypeScript-first; almost all source files are `.ts`
- Main domains: food and meal tracking, exercise logging, health and sleep data, sleep science, fasting, medications, mood, menstrual cycle and pregnancy, reporting, AI chat, onboarding, identity, admin tooling, and external provider integrations

## Verified Commands

```bash
pnpm start
pnpm run validate
pnpm run typecheck
pnpm run lint
pnpm run lint:fix
pnpm run format:check
pnpm run format
pnpm test
pnpm run test:watch
pnpm run test:coverage
pnpm run test:ci
pnpm exec vitest run tests/mealRoutes.test.ts
pnpm exec eslint routes/v2/foodRoutes.ts services/foodCoreService.ts
```

- `pnpm start` uses hot reload through `nodemon`; `nodemon.json` ultimately executes `tsx index.ts`
- `pnpm run validate` runs typecheck, lint, and Prettier check together
- `pnpm test` runs `vitest run`
- The backend default port is `3010` unless `SPARKY_FITNESS_SERVER_PORT` overrides it
- For targeted test runs, prefer `pnpm exec vitest run tests/<name>.test.ts`

## Source Map

- `index.ts` - real dev entrypoint; loads env, secrets, and preflight checks before booting the app
- `SparkyFitnessServer.ts` - Express app shell, route mounting, Swagger/ReDoc, cron setup, graceful shutdown
- `auth.ts` - Better Auth configuration, plugins, session behavior, SSO provider syncing
- `routes/` - primary HTTP route surface
- `routes/v2/` - newer typed route surface; pair these changes with `schemas/`
- `routes/auth/` - auth-specific route fragments mounted through `routes/authRoutes.ts`
- `services/` - business logic and orchestration
- `models/` - PostgreSQL repositories and persistence helpers
- `middleware/` - auth, permissions, uploads, and shared Express middleware
- `integrations/` - provider adapters and ingest pipelines
- `schemas/` - Zod route schemas
- `types/` - TypeScript declarations, including `Express.Request` augmentation
- `db/` - pool management, grants, migrations, and RLS policies
- `config/` - logging and Swagger config
- `utils/` - startup helpers, CORS, permissions, timezone loading, OIDC helpers, migration helpers
- `ai/` - AI provider configuration (`config.ts`), the unified provider-dispatch helper (`providerDispatch.ts`), and the in-process chatbot tool registry (`ai/tools/`)
- `security/` - encryption utilities (`encryption.ts`)
- `validation/` - legacy express-validator rules for a few older routes (new routes use Zod schemas)
- `constants/` - shared constants and supporting package data
- `tests/` - Vitest suites plus a few utility scripts
- `devdocs/` - local notes and debugging artifacts when present

When searching, ignore noisy/generated directories unless you explicitly need them:

- `node_modules/`
- `coverage/`
- `uploads/`
- `temp_uploads/`
- `backup/`
- `mock_data/`

## Architecture

### Boot and App Shell

- `index.ts` is the true local boot path used by `pnpm start`; do not bypass it for normal development because it performs env loading and preflight work
- `SparkyFitnessServer.ts` creates the Express app, configures static upload serving, mounts auth interception, registers routes, exposes API docs, schedules cron jobs, and handles graceful shutdown
- Startup order matters:
  - apply pending migrations
  - reapply `db/rls_policies.sql`
  - upsert env-configured OIDC provider
  - mount Better Auth
  - sync trusted SSO providers
  - register cron jobs
  - optionally promote `SPARKY_FITNESS_ADMIN_EMAIL` to admin
  - start listening
- Public API docs live at:
  - `/api/api-docs/swagger`
  - `/api/api-docs/redoc`
  - `/api/api-docs/json`
- If you change public endpoints, keep Swagger JSDoc and `config/swagger.ts` coverage accurate

### Environment and Secrets

- Runtime `.env` is expected at `../.env`
- The tracked template lives at `../docker/.env.example`
- `utils/secretLoader.ts` loads `*_FILE` secrets before preflight validation
- Current hard startup requirements enforced by `utils/preflightChecks.ts` include:
  - `SPARKY_FITNESS_DB_HOST`
  - `SPARKY_FITNESS_DB_NAME`
  - `SPARKY_FITNESS_DB_USER`
  - `SPARKY_FITNESS_DB_PASSWORD`
  - `SPARKY_FITNESS_APP_DB_USER`
  - `SPARKY_FITNESS_APP_DB_PASSWORD`
  - `SPARKY_FITNESS_FRONTEND_URL`
  - `SPARKY_FITNESS_API_ENCRYPTION_KEY`
- `BETTER_AUTH_SECRET` is currently soft-required: startup will generate a temporary value if it is missing, but that is only appropriate for throwaway local runs because sessions will not survive restarts
- Common operational toggles include `SPARKY_FITNESS_SERVER_PORT`, `SPARKY_FITNESS_ADMIN_EMAIL`, `ALLOW_PRIVATE_NETWORK_CORS`, `ALLOW_PRIVATE_NETWORK_AI`, `SPARKY_FITNESS_EXTRA_TRUSTED_ORIGINS`, and `BETTER_AUTH_URL`
- `ALLOW_PRIVATE_NETWORK_AI=true` lets non-admin users use custom AI service URLs (`custom`/`ollama`/`openai_compatible`) that resolve to private/internal addresses; default off is an SSRF guard enforced by `utils/outboundUrlPolicy.ts` at save/test time and again in the runtime guarded fetch path. Current admins and global admin-created AI settings can use private URLs for self-hosted providers like Ollama

### TypeScript and Module Conventions

- This package is now almost entirely TypeScript; new source files should be `.ts`
- Keep local relative imports using `.js` extensions from TypeScript files, for example `import foo from './foo.js'`
- `eslint.config.js` enforces file extensions in imports
- `tsconfig.json` uses `NodeNext`, `noEmit`, and `allowJs: false`
- `@workspace/shared` resolves directly to `../shared/src/index.ts` here and in Vitest
- Avoid using `any` declarations in models, repositories, and integration services (e.g. `integrations/fatsecret/fatsecretService.ts`). Instead, use base datatypes (like `string`), proper types/interfaces, or import strict type schemas directly from `@workspace/shared`.
- New public endpoints should include TypeScript code, Zod validation, and automated tests

### Logging

- Use `log(level, message, ...args)` from `config/logging.ts`; levels are `'debug'`, `'info'`, `'warn'`, and `'error'`
- Never use `console.error` (or other `console.*`) in application code
- `SPARKY_FITNESS_LOG_LEVEL` controls verbosity (`DEBUG`, `INFO`, `WARN`, `ERROR`, `SILENT`)

### Database and RLS

- Use `getClient(userId, authenticatedUserId?)` from `db/poolManager.ts` for normal user-scoped queries
- `getClient(...)` sets `public.set_app_context(...)`; that is what makes row-level security work correctly
- Use `getSystemClient()` only for admin, migration, startup, or policy-management work that intentionally bypasses RLS
- Always release database clients in a `finally` block
- To learn a table's current shape, read `../shared/src/schemas/database/<Table>.zod.ts` (one small Zod file per table) instead of reading `../db_schema_backup.sql` or reconstructing it from the 185 migration files
- New migrations belong in `db/migrations/` and must use `YYYYMMDDHHMMSS_description.sql`
- **Never manually edit `../db_schema_backup.sql`** — after merge, CI regenerates it from the migrations and opens an automated sync PR (`.github/workflows/schema-backup.yml`). Do not commit copies generated from a local database.
- If you add a new table or change user-visible access behavior, follow `../agent-docs/new-migration-checklist.md`. In short, you MUST:
  1. Add/modify the RLS policies in `db/rls_policies.sql`.
  2. Update the user-facing documentation in `../docs/content/2.features/9.family-friends-sharing.md`.
  3. Update the developer-facing documentation in `../docs/content/8.developer/11.database-security-tiers.md` to define its security tier (Tier 1, Tier 2, or Tier 3).
  4. Add or update the matching Zod schema in `../shared/src/schemas/database/`.
- Startup automatically applies migrations and then reapplies RLS policies; do not create alternate migration mechanisms

### Auth and Request Context

- Better Auth is configured in `auth.ts` and mounted under `/api/auth`
- `SparkyFitnessServer.ts` intercepts `/api/auth*` requests before the normal request logger and has special handling for discovery routes and sign-out cookie cleanup
- `middleware/authMiddleware.ts` populates:
  - `req.userId`
  - `req.authenticatedUserId`
  - `req.originalUserId`
  - `req.activeUserId`
  - `req.user`
- `req.userId` is the active RLS target; `req.authenticatedUserId` is the logged-in actor
- Family and delegated access flow through `middleware/checkPermissionMiddleware.ts`, `middleware/onBehalfOfMiddleware.ts`, and the auth middleware’s active-user switching
- `checkPermissionMiddleware(permissionType)` guards routes; permission types are `'diary'`, `'reports'`, and `'checkin'`
- If you change auth behavior, check both cookie-backed sessions and API key flows

### Dates, Day Strings, and Timezones

- Prefer the shared helpers exported by `@workspace/shared` for day-string and timezone-aware logic
- Common server-side helpers include `todayInZone`, `instantToDay`, `dayToUtcRange`, `dayRangeToUtcRange`, `localDateToDay`, `addDays`, `compareDays`, and `isDayString`
- Load the user timezone through `utils/timezoneLoader.ts` before deriving "today", bucketing events by day, or building date ranges from user context
- Treat `YYYY-MM-DD` values as calendar-day strings, not UTC-midnight timestamps
- Avoid `toISOString().split('T')[0]` for user-facing or business-logic dates; it silently shifts dates near timezone boundaries
- If you touch older code that still uses UTC split patterns, prefer migrating that path to the shared helpers instead of copying the pattern forward
- Timezone/date regression coverage already exists in:
  - `tests/timezone.test.ts`
  - `tests/dateShifting.test.ts`
  - `tests/measurementService.timezone.test.ts`

### Integrations and Background Work

- Provider-specific adapters live under `integrations/`; coordinating logic usually lives in `services/` and persistence in `models/`
- Current adapters span food/nutrition (OpenFoodFacts, FatSecret, Nutritionix, USDA, Mealie, Tandoor, Norish, SwissFood, Yazio), fitness devices (Garmin Connect sync plus FIT file import via `integrations/garminfit/` + `services/fitImportService.ts`, Withings, Fitbit, Oura, Polar, Strava, Hevy), exercise databases (Wger, FreeExerciseDB), drug catalogs (NLM RxTerms), and health-data import (Google Health, generic/mobile health data)
- Scheduled jobs currently include backups, session cleanup, and hourly sync loops for Withings, Garmin, Fitbit, Oura, Polar, and Strava
- Integration work often spans route, service, repository, cron, and external-provider settings code; inspect the whole path before calling the work complete

### AI Services

- AI calls go through the Vercel `ai` SDK (v6) with provider adapters for OpenAI, Anthropic, and Google, plus OpenAI-compatible, Mistral, Groq, OpenRouter, and Ollama service types
- `ai/config.ts` holds default model and vision-model selection per provider; `ai/providerDispatch.ts` is the unified dispatch helper used by chat, food-photo analysis, nutrition-label scan, and unit conversion
- Prefer routing new AI features through `providerDispatch.ts` instead of calling provider SDKs directly
- Chatbot tool calls run in-process through the registry in `ai/tools/`
- `ai/tools/index.ts` exposes `buildChatbotTools(userId, tz)`, composing the per-domain builders (`build<Domain>Tools` in `ai/tools/<domain>Tools.ts`); handlers close over the authenticated user — so two-actor services receive `(userId, userId, ...)` — and the user's IANA timezone, used for "today" defaults and day bucketing
- Tool handlers follow a fixed contract: publish a flat Zod schema, validate with a strict union `safeParse` inside `execute`, orchestrate through existing services and repositories, and never throw - errors come back as `ERRORS.*` strings from `ai/tools/errors.ts`
- Tool output text is a parity contract with the MCP tool set; golden tests in `tests/chatbotTools*.test.ts` assert exact returned strings, so do not reword tool output casually

## Testing and Validation

- Test runner: Vitest, not Jest
- Auto-discovered test files match `tests/**/*.test.ts`
- `tests/check_routes.ts` and `tests/*.script.ts` are utility scripts, not normal test suites
- For route or contract work, targeted `supertest`-based Vitest tests are the normal validation path
- Prefer `pnpm run typecheck` after touching `routes/v2/`, `schemas/`, `types/`, or shared request/response contracts
- Prefer `pnpm run lint` after multi-file edits; if unrelated package-wide issues make that noisy, run targeted `pnpm exec eslint <paths>` on the touched files before stopping
- Use `pnpm run test:coverage` after broad service, route, repository, middleware, or auth refactors

## Quick Routing

- Startup, env, or deployment issue:
  inspect `index.ts`, `SparkyFitnessServer.ts`, `utils/secretLoader.ts`, `utils/preflightChecks.ts`, and `config/logging.ts`
- Auth, session, MFA, or API key issue:
  inspect `auth.ts`, `middleware/authMiddleware.ts`, `routes/authRoutes.ts`, and `routes/auth/`
- Migration, RLS, or permission issue:
  inspect `db/migrations/`, `db/rls_policies.sql`, `db/poolManager.ts`, `utils/applyRlsPolicies.ts`, and the permission middleware/helpers
- Public v2 contract issue:
  inspect the matching file in `routes/v2/` plus the related Zod schema in `schemas/`
- Food, barcode, or external provider issue:
  inspect the relevant `integrations/*` code, then the matching service and repository files
- Health data or date bucketing issue:
  inspect `integrations/healthData/healthDataRoutes.ts`, `services/measurementService.ts`, and `utils/timezoneLoader.ts`
- Self-service "delete synced data by source" issue:
  inspect `routes/syncedDataRoutes.ts`, `services/syncedDataService.ts`, and `models/syncedDataRepository.ts` (the `SYNCED_SOURCE_TABLES` whitelist)
- AI chat or chatbot tool issue:
  inspect `services/chatService.ts`, `ai/tools/`, and the matching domain service and repository
- Fasting or mood issue:
  inspect `routes/fastingRoutes.ts` / `routes/moodRoutes.ts` and `models/fastingRepository.ts` / `models/moodRepository.ts`
- Gym equipment profile issue (the named, switchable equipment sets that constrain exercise suggestions):
  inspect `routes/gymEquipmentProfileRoutes.ts`, `models/gymEquipmentProfileRepository.ts`, and the `useActiveGymProfile` branch of `GET /api/exercises/search` in `routes/exerciseRoutes.ts`. At most one profile per user is active, enforced by a partial unique index; activation is a transaction in `setActiveGymProfile`, never a plain `PUT` field
- Muscle recovery / workout recommendation issue (the Fitbod-style "Up Next" generator):
  inspect `routes/workoutRecommendationRoutes.ts`, `services/workoutRecommendationService.ts`, `models/workoutRecommendationRepository.ts`, and the pure halves in `../shared/src/utils/muscleRecovery.ts` (freshness) and `../shared/src/utils/workoutGeneration.ts` (selection, prescription, warm-ups, duration fitting). Nothing is logged for recovery — fatigue is derived from the `exercise_entries` muscle **snapshots** joined to their set counts, with an exponential decay. Which muscles a workout is built around is the engine's choice only when the client does not make one: `POST /generate` takes an optional `target_muscles`, and when it is present `selectTargetMuscles` returns it verbatim — no freshness floor, no five-muscle cap, no upper/lower balance swap, because a user who taps Legs on sore legs is deciding, not erring, and the picker shows them the recovery percentage anyway. It is validated against the canonical `MUSCLES` enum (a mis-cased muscle has to be a 400, since `::jsonb ?|` would silently match nothing) and bounded by the size of that vocabulary rather than a smaller number, because clients resolve training splits to muscles before sending — the wire carries muscles, never split names, and `MUSCLE_SPLIT_MEMBERS` in `../shared/src/constants/exerciseTaxonomy.ts` is that (overlapping) split vocabulary, deliberately separate from the `MUSCLE_GROUPS` partition the weekly set target ring depends on. Note that the duration fitter never drops a target muscle to meet the time budget — it removes a second exercise for a muscle, then trims sets, then stops — so a request naming many muscles returns an honest over-budget `estimated_duration_minutes` rather than a shorter workout missing something the user asked for. Neither pure module reads a clock, a random source, or a database (the caller passes `today` from `todayInZone(tz)`), because "Up Next" has to be stable across app opens and Swap — `POST /generate` with `swap: true`, which passes the current payload's exercise ids as a scoring penalty — is what is supposed to change it; keep it that way. There is at most one `workout_recommendations` row per user (`UNIQUE(user_id)`, written by upsert). Tuning constants live in `GENERATION_TUNABLES` / `RECOVERY_TUNABLES`, not inline. A target muscle with no eligible local candidate triggers a free-exercise-db import and a catalog re-query before the planner runs, so a stored `exercise_id` is always a local uuid ("eligible" excludes mobility rows: a muscle whose only local coverage is a stretch counts as unserved, and the import prefers a non-stretching primary mover). What the engine will prescribe is `isPerformable`, not `isEquipmentAvailable`: on top of the gym-profile subset test it applies `../shared/src/constants/exerciseApparatus.ts`, a deliberate divergence from the pinned upstream equipment enum covering the 21 `body only` rows that actually need a pull-up bar, a bench, a dip station or a rack, keyed on `source_id` and inferred available from a profile carrying barbell/cable/machine (or from the user having logged the exercise). `other` is opt-in even with no gym profile at all. Prescription shape comes from `exercises.category`, not from the stored modality: `stretching` rows are stored `weight_reps` (the modality derivation and its backfill migration know only `cardio` and `isometric`, and changing that would re-render sets users already logged), so the engine reads the category and programs them as holds, publishing `prescription.modality` on the payload rather than the catalog's value. Single-exercise Replace is `GET /alternatives/:exerciseId` (ranked candidates for the same primary muscle, local first, free-exercise-db appended only when the local catalog is thin) followed by `POST /replace` `{exercise_id_out, exercise_id_in}` — the client names two exercises and the **server** re-runs prescription for the incoming one, so sets, load, rest and the warm-up ramp stay engine-owned; it writes through `updateWorkoutRecommendationPayload` (payload only) rather than the upsert, which would reset `status` and `generated_at` and so un-start a workout already in progress. The chat coach reaches the same engine through two read actions on `sparky_manage_exercise` (`get_muscle_recovery`, `generate_workout`) and switches gyms through `sparky_manage_coach_profile` (`get_gym_profiles`, `set_active_gym_profile`); `generate_workout` renders the payload **with its local exercise uuids** and closes with an instruction to re-propose it through `sparky_propose_workout_preset`, because tool results are stripped from later turns and a same-turn sentence is the only reliable handoff. `prompts/chatbot-full-coaching.md` is what points the model at it
- Coach profile issue (the training constraints a user states once — session length, training days per week, goals, limitations):
  inspect `routes/coachProfileRoutes.ts` and `models/coachProfileRepository.ts`. `GET`/`PATCH /api/coach-profile` expose only the four fields a person edits directly; `equipment` belongs to gym profiles and `weekly_set_targets` has its own endpoint whose partial-merge semantics a general PATCH would break, so both are absent from the contract and rejected by its strict schema. The route is **owner-only** on top of the diary permission for the same reason `weeklySetTargetRoutes.ts` is — `coach_profiles` RLS matches the authenticated caller, not the switched context — and `requireSelf` is copied from there deliberately rather than re-derived. A user with no row gets every field null rather than a 404, because "no profile yet" and "profile with nothing stated" are the same thing to every reader; a null `training_days_per_week` is exactly what makes weekly set targets report themselves as derived. Null on a scalar clears it back to unstated (a real edit, distinct from omitting the field), `limitations` clears with `[]`, and an empty patch is a 400 rather than a no-op that touches `updated_at`
- Weekly set target issue (working sets per training group against a weekly goal):
  inspect `routes/weeklySetTargetRoutes.ts`, `services/weeklySetTargetService.ts`, and the pure half in `../shared/src/utils/weeklySetTargets.ts`. Counting goes through `getWeeklySetCountInputs` in `models/workoutRecommendationRepository.ts`, which is deliberately **stricter** than the `getMuscleFatigueInputs` predicate next to it: fatigue is smoothed over days so crediting a set early costs little, but a weekly ring is a number the user reads, and a live workout started from a preset carries no `workout_plan_assignment_id` — under the fatigue predicate every set the session laid out is credited the moment the app autosaves, filling the ring before a rep is lifted. So an uncompleted set counts only when nothing in its entry carries a `completed_at` (a plain diary log); once any set in the entry is ticked the entry is a live session and only its ticked sets count. The plan-assignment exclusion and the warm-up exclusion stay on top of that. Do not "unify" the two predicates — volume, PR detection and the recommendation engine all read the looser one. The query is also bounded at **today**, not at the week end, so an entry dated later this week cannot fill the ring early. Groups come from `MUSCLE_GROUP_MEMBERS` in `../shared/src/constants/exerciseTaxonomy.ts`, which must cover every canonical muscle exactly once (asserted in `tests/weeklySetTargets.test.ts`); a muscle falling through would silently discard logged sets. An entry credits each group **once** at its strongest claim (primary 1, secondary 0.5), so a compound naming two muscles in one group is not double counted. Targets live in `coach_profiles.weekly_set_targets` (JSONB, empty means "derive from `training_days_per_week`"), and a partial map merges rather than replaces so a client changing one group cannot clear the rest — the merge is `coachProfileRepository.mergeWeeklySetTargets`, a single `||` statement, because a read-modify-write in JavaScript loses an edit whenever the phone and the browser save different groups at once. The route is **owner-only** on top of the diary permission: `coach_profiles` RLS matches `user_id` against the authenticated caller rather than the switched context, so a delegate would read derived defaults as though the owner had set nothing and a delegated write would fail inside Postgres as a 500 — `requireSelf` returns 403 instead. Weeks run Sunday–Saturday in the user's timezone; history reuses the _current_ targets for every week shown, because nothing records what a target was in the past
- Medications, cycle, or pregnancy issue:
  inspect the matching v2 route (`routes/v2/medicationRoutes.ts`, `routes/v2/cycleRoutes.ts`, `routes/v2/pregnancyRoutes.ts`), its Zod schema in `schemas/`, then `services/cycleService.ts` / `services/pregnancyService.ts` and the `models/medication*Repository.ts` / `models/cycleRepository.ts` / `models/pregnancyRepository.ts` files
- Medication name autocomplete issue (the three-tier search behind `GET /api/v2/medications/catalog-search`):
  tiers 1 and 2 are local and never reach the server — the user's own cabinet, and the bundled catalog in `../shared/src/medications/catalog.ts`, which is a _search catalog_ and must not be confused with the pharmacokinetic registry in `glp1.ts`. Only tier 3 is server-side: `services/medicationCatalogService.ts` (the opt-in gate) over `integrations/rxterms/RxTermsService.ts` (the proxy, the cache) over `../shared/src/medications/rxterms.ts` (the envelope and strength parsing, in `shared/` because web and mobile both render the results). Four things about it are deliberate and easy to undo by accident. **The lookup is proxied rather than fetched from the browser** even though RxTerms is CORS-open, because the query is a medication name; for the same reason nothing in that service may log the error object, whose `config.params` carries the term. **The opt-in is the record owner's**, read through `user_preferences.medication_catalog_lookup_enabled` — that table's SELECT policy is `has_profile_read_access`, so a medications delegate really does read the owner's answer rather than a default. **Products the bundled catalog already covers are dropped**, because RxTerms describes an incretin as the concentration in its pen (`0.68 mg/ml`) while the catalog gives the ladder the pen dials (`0.25/0.5/1/2 mg`), and offering both invites logging a concentration as a dose. **A strength either parses or does not** — `parseRxTermsStrength` refuses combinations, percentages and unknown units rather than guessing, and the raw string stays authoritative. The route is registered before `/:id` on the same router, and no failure of the upstream may ever become an error the user has to dismiss.

  **Typo tolerance** is two independent mechanisms, and the guard between them is the load-bearing part. Locally, `searchCatalog` falls back to a bounded Damerau-Levenshtein pass (`../shared/src/medications/typo.ts`) **only when the substring pass returned nothing**, so a near-miss can never sit beside a real match; the hits come back flagged `viaTypo` so the clients can label the group as a guess rather than as known drugs. Server-side, `RxTermsService` re-queries through RxNav `spellingsuggestions` — deliberately **not** the blueprint's `approximateTerm`, which answers a metformin typo with merbromin top-ranked and no metformin in the first five names; the reasoning is written out in `../shared/src/medications/rxnav.ts`. Three conditions must all hold before a single network spell-check fires: RxTerms matched **no** names (`matchedNameCount === 0` — distinct from "matched names that catalog suppression then dropped", which is not a spelling problem), the term is at least `RXNAV_SPELLING_MIN_TERM_LENGTH`, and `searchCatalog` knows nothing about it. That last one is why every peptide search is still exactly one request. The top **two** suggestions are searched and their rows **interleaved**, not concatenated — taking only the first would answer a metformin typo with a mercury antiseptic and nothing else, and concatenating would let the wrong suggestion fill the five-row cap. The corrected spellings that actually produced rows come back as `correctedTerms` so the UI can say what it searched for; a failure anywhere in the chain returns empty **without writing the cache**, so an upstream blip cannot freeze a typo as uncorrectable for 24 hours.

  **Tier 1 ranking** is the one part of this that is not about the catalog at all. `listMedications` runs a third aggregate over `medication_entries` (`status IN ('taken', 'prn_taken')` — a skipped or snoozed dose is evidence _against_ use) and attaches a derived `last_taken_at` to each row. It does **not** touch the list's `ORDER BY`: the medications page stays alphabetical, and the field exists so `rankOwnMedications` (`../shared/src/medications/ownRanking.ts`, shared because both clients cap tier 1 at three or four rows) can spend those rows on the drugs someone actually takes rather than the ones early in the alphabet. Match _quality_ is deliberately not a factor in that ranking — a display-name hit on a drug taken this morning beats a prefix hit on one never logged. That aggregate matches medications with a bare `= ANY($1)` and **no `::uuid[]` cast**, unlike the exercise queries next door; `tests/medicationLastTaken.integration.test.ts` runs it against a real Postgres precisely because the mocked repository suite cannot tell a working type inference from a broken one, and a break there would fail every medications list read at runtime with the whole mocked suite green.

- Sleep or sleep-science issue:
  inspect `routes/sleepRoutes.ts`, `routes/sleepScienceRoutes.ts`, `services/sleepAnalyticsService.ts`, `services/sleepScienceService.ts`, and the sleep repositories

## Architecture Resources

Before adding a feature or changing auth/permission behavior, read:

- `../docs/content/8.developer/4.database.md` — Quick table index (all ~120 tables with purpose) + migration best practices
- `../docs/content/8.developer/11.database-security-tiers.md` — Security tier, permission type, and RLS rules for every table (authoritative)
- `../agent-docs/architecture-permissions.md` — Permission types, links to tier classification doc
- `../agent-docs/data-flow-patterns.md` — Data flow from frontend through server to database, safe RLS patterns
- `../agent-docs/new-domain-template.md` — Checklist for adding a major feature domain
- `../agent-docs/anti-patterns.md` — Common mistakes (using getSystemClient(), forgetting RLS, cache invalidation, timezone bugs, cross-package contract mismatches)

## Working Rules

- Match the existing service/repository/middleware layering instead of introducing parallel abstractions
- If your change adds a new domain, route family, or table, update this file's Snapshot, Source Map, and Quick Routing sections (and the `Last updated` date) in the same change
- If you add persisted or user-visible data, think through migration, RLS, permissions, tests, API docs, and downstream client contracts together
- Validate shared-contract changes from the affected consumers, not just from this package
- Keep package-specific guidance here; use `../AGENTS.md` only for cross-package context

## File Naming Conventions

- Routes: `*Routes.ts` (e.g., `foodEntryRoutes.ts`)
- Services: `*Service.ts` (e.g., `foodEntryService.ts`)
- Repositories: `*Repository.ts` (e.g., `foodRepository.ts`, `mealRepository.ts`)
- Some domain model files predate the Repository suffix and remain without it (e.g., `food.ts`, `foodEntry.ts`, `exercise.ts`)

## Planning

- Before presenting a plan for server work, self-review it against `../agent-docs/plan-review-checklist.md` and fix any gaps first.

## Priority Rule

- For work inside `SparkyFitnessServer/`, this file wins over repo-root guidance on package-specific details
- Use `../AGENTS.md` for monorepo context
- If a task spans multiple packages, combine this guide with the other affected package guides instead of relying on one file alone
