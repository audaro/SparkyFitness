# Upstream sync — 2026-09-16

Brings this fork up to date with `CodeWithCJ/SparkyFitness` after roughly three weeks of
divergence: 646 upstream commits, merged as one commit with 175 conflicts resolved by hand.

## What shipped

| Commit | What |
| --- | --- |
| `b2f62039a` | `Merge upstream/main into sync/upstream-2026-09-16` — 2104 files, +255520 / -48636 |
| `a353e458c` | `mobile: adopt the repository Prettier convention` — 161 files, whitespace only |

Plus the eleven local training-plan commits `d5b567370..a64849a0e`, which had never been
pushed and go out with this.

The large things upstream brought: Expo SDK 57 / React Native 0.86 / React 19.2 on mobile,
assistant-ui 0.15 and AI SDK v7 on the web chat, i18next 26, Vitest 4 and ESLint 10 on the
server, Knip added to the mobile and frontend `validate` gates, and 15 new server migrations.

## Gate status

All three packages green, each run to completion on the merged tree:

| Package | `validate` | Tests |
| --- | --- | --- |
| Server | typecheck + lint + format clean | 6505 passed, 50 skipped |
| Frontend | clean (tsc, eslint, prettier, knip) | 1557 passed / 162 suites |
| Mobile | clean (all eight stages) | 7238 passed / 459 suites |

Two caveats worth knowing:

- The server `validate` script still reports the three untracked `tmp-*.script.ts` scratch
  files. They are listed in `.git/info/exclude`, so CI never sees them; `eslint . --ignore-pattern
  'tmp-*.script.ts'` is clean.
- Under full-suite load a couple of 5-second-timeout tests flake (`pregnancyRoutes` "rejects a
  non-UUID id", frontend `GymProfilesManager` "creates the first profile as active"). Both pass
  alone and on a re-run of the full suite. Not merge damage, but worth raising the timeout if
  they recur.

## The two failure modes this merge kept producing

Worth knowing for the next sync, because every instance was found by a gate rather than by
reading the diff:

- **Grafts** — both sides add in the same place and git keeps both. `manageMedicationsInput`
  ended up with 16 duplicate keys (TS1117); `DashboardScreen` with duplicate imports.
- **Merge losses** — a fork-only export vanishes because its hunk resolved to upstream.
  `getWorkoutPresetById`, `activeAiServiceSettingQueryKey` and `getDraftSupersetRuns` all went
  this way.

The gates that caught them, in the order they earn their keep: typecheck, then Knip (new here,
and it found two dead exports on its first run), then the i18n audit, then the suites.

## Decisions worth not re-litigating

- **Withings and Polar callbacks lost their permission gate on purpose.** Upstream replaced the
  fork's Withings-local OAuth-state design with shared `utils/oauthState.ts`: a server-issued
  single-use nonce, claimed and cleared in one UPDATE whose WHERE predicate names the
  authenticated actor. That binding is strictly stronger than a permission check — a read-only
  delegate passing `diary_read` on a GET is exactly what it removes — so the callback tests now
  assert `/fitbit` and `/oura` are gated and the other two are not.
- **Every state failure is one opaque 400.** Missing, forged, replayed, expired and cross-user
  all return `Invalid or expired authorization state.`, so the response never says which check
  rejected the value. The route has no early `if (!state)` guard for that reason; the stateless
  case is rejected inside the exchange.
- **Tab routes stay `Home`/`Food`** (upstream's are `Dashboard`/`Diary`), so header back titles
  and their English fallbacks follow this fork's catalogue, not upstream's wording.
- **`fetchExercisesCount` and the `useMedications` barrel re-export are gone.** Their only
  consumer was upstream's `LibraryScreen`, which this fork replaced with the Food and Exercise
  tab hubs.
- **Mobile is Prettier-formatted now.** The old "never run Prettier on mobile files" rule is
  retired — upstream's root `lint-staged` formats staged mobile files and `format:check` is part
  of mobile `validate`, so keeping the package out meant a permanently red gate. What stays
  unformatted is in `.prettierignore` with its reason.
- **`db_schema_backup.sql` is upstream's copy verbatim.** It is CI-owned
  (`.github/workflows/schema-backup.yml` regenerates it and opens a sync PR), and hand-editing or
  locally regenerating it is against the repo rule, so the fork-only objects it is missing get
  restored by that workflow rather than by hand.

## Exact next step

1. **Run the 15 new migrations against the live database**, then restart the server. Pre-sync
   backup is at `~/fitness/db-backups/sparkyfitness_pre-upstream-sync_20260916-183733.dump`
   (verified readable with `pg_restore -l`: 1283 objects). Migrations run on server start.
2. **`npx expo prebuild --clean` and build a fresh iOS dev client.** SDK 56 → 57 makes the
   installed dev client unusable, and the Maestro harness has been dead since August for the
   same reason (`ExpoVideo` missing from a stale binary), so this also unblocks `qa/`.
   `expo-video` deliberately gets **no** entry in `app.config.ts` `plugins`: its config plugin
   only sets background playback and picture-in-picture, both of which default off and neither
   of which this app wants — the exercise hero video is muted, looping and foreground-only.
3. **Restore `stash@{0}`** — the `exerciseApi` videos change and its test, deliberately kept out
   of the training-plan commits. Note that `fetchExercisesCount` was deleted from that file in
   this merge, so expect a small conflict.
4. **Watch the schema-backup workflow** on the first push and confirm it opens its sync PR.
