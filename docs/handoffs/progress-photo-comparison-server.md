# Progress photo comparison — phase 2 (server half)

_2026-09-18, branch `feat/hold-timer`._

## What shipped

Phase 2 of the progress-photo blueprint is complete: a photo can now be
measured, a pair can be compared, and the result is cached and graded.

| Commit | What |
| --- | --- |
| `440693d79` | The `SparkyFitnessVision` sidecar (pose landmarks, person mask, scale-free ratios, pair alignment, exposure matching) |
| `039bb1210` | `shared/src/schemas/api/ProgressPhotoComparison.api.zod.ts` — the wire contract plus `assessComparability`, its thresholds, and `ratioDeltas` |
| `f9f19ee36` | Migration `20260918160000` — `check_in_photo_analysis` and `progress_photo_comparisons`, RLS, database Zod, docs |
| `05c526751` | `integrations/vision/visionService.ts`, `services/progressPhotoComparisonService.ts`, `routes/progressPhotoComparisonRoutes.ts`, env wiring |

Endpoints, all under `/api/progress-photo-comparisons`:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/status` | Is the sidecar configured and up, and on which engine |
| `POST` | `/` | Compare a pair (idempotent; `force` re-measures) |
| `GET` | `/` | List the caller's comparisons, newest first |
| `GET` | `/:id` | One comparison |

**Nothing is pushed.** Four commits sit on `feat/hold-timer` ahead of origin.

## Gate status

| Gate | Result |
| --- | --- |
| `SparkyFitnessServer` `tsc --noEmit` | pass |
| `SparkyFitnessServer` eslint (new files) | pass |
| `SparkyFitnessServer` full vitest | 6567 passed, 50 skipped |
| Frontend `pnpm run validate` | pass |
| Mobile `pnpm run validate` | pass |
| Fresh-install migrations (empty DB → HEAD `db/migrations` + `rls_policies.sql`) | pass |
| Upgrade-path migrations (empty DB → base, then only the new migration, as the runner does) | pass |
| `rlsPermissionMatrix.integration.test.ts` | 221 passed, 26 skipped |
| `SparkyFitnessVision` pytest | 24 passed (unchanged since `440693d79`) |

Run against scratch databases (`vision_fresh`, `vision_upgrade`, both dropped).
The migration and `rls_policies.sql` were also applied to the dev database, so
a server restart there is a no-op.

**Reproducing the migration gates:** do not replay `db_schema_backup.sql`, and
do not re-run every migration file over a database that already has them. The
runner records applied migrations in `system.schema_migrations`, so the upgrade
path applies only files the base branch did not have. Replaying
`20250703170640_InitialDB.sql` fails with `cannot change name of input
parameter "auth_user_id"` — a harness artifact, not a defect in the migration.

## The two decisions worth not re-litigating

**No `verdict` column.** Comparability thresholds are starting values from the
blueprint, not numbers measured off real pairs. They will move. Storing the
answer would freeze last month's rule onto this month's question, so the tables
store measurements and `assessComparability` runs on every read.

**No localhost default for `VISION_MICROSERVICE_URL`.** Unset means the feature
is absent and `/status` says so. A default would turn "not installed" into a
connection refused on every photo view.

## Exact next step

Phase 3, the aligned before/after slider in the mobile app. It needs one thing
the server does not have yet: an endpoint that returns the aligned pair as
images. The sidecar already produces them (`POST /compare?include_aligned=true`
→ `aligned_before_jpeg` / `aligned_after_jpeg`), and they are deliberately not
stored, so the endpoint re-calls the sidecar and streams the result. Suggested
shape: `GET /api/progress-photo-comparisons/:id/aligned`, served like
`GET /api/measurements/check-in-photos/file/:id` (authenticated, `checkin`
permission, `X-Content-Type-Options: nosniff`).

## Open risks

- **No end-to-end run.** Every test mocks either the sidecar or the database.
  Nothing has yet sent two real photographs through `POST /` against a running
  `SparkyFitnessVision` and a real Postgres. Do that before building UI on it.
- **The thresholds are guesses.** `COMPARABILITY_THRESHOLDS` has never been
  checked against a pair of real photos taken weeks apart. The first honest
  calibration is to shoot a pair deliberately badly and see what it says.
- **Arm overlap is reported, not solved.** `arms_overlap` flags a stop whose
  row an arm was inside; a waist measured that way tracks how someone stood.
  The capture screen still has no hint telling the user to hold their arms
  clear of their body, which is the mitigation that would make it rare.
- **Phase 1 has still never run on a device.** The guided viewfinder is tested
  under jest only.
