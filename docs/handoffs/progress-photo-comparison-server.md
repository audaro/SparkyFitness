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
| `f2dd1e6ee` | `unreliableRatios` — names the ratios an arm was resting on (found by the end-to-end run below) |
| `e4ede33b1` | The capture-screen hint that stops it happening |
| `9760dce24` | The second-opinion reconciliation below — recompute-on-read, the posture rule for silhouette area, and `arms_obscured` |

Endpoints, all under `/api/progress-photo-comparisons`:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/status` | Is the sidecar configured and up, and on which engine |
| `POST` | `/` | Compare a pair (idempotent; `force` re-measures) |
| `GET` | `/` | List the caller's comparisons, newest first |
| `GET` | `/:id` | One comparison |

**Nothing is pushed.** Thirteen commits sit on `feat/hold-timer` ahead of origin
(eight of them this feature, five predating it).

## The end-to-end run, and what it found

One real photograph was compared against a copy of itself that had only been
moved and relit — 2.5° of roll, 3% closer, 18px across, a little brighter and
warmer — through the real service, a real RLS-scoped Postgres and a running
sidecar. Nothing mocked.

The plumbing held: residual 0.20% of body height, verdict `comparable`, the
exposure correction fired, the repeat call came back from cache in 3ms instead
of 534ms, the guard rails refused a self-pair and a reversed pair, and a
different user saw nothing.

The measurements did not:

| stop | drift from a pure camera move | arm inside the row |
| --- | --- | --- |
| shoulder | −0.1% | no |
| thigh | −2.1% | no |
| chest | +0.6% | yes |
| waist | −5.0% | yes |
| hip | +6.2% | yes |

A silhouette cannot tell an arm from the torso it rests against, and how much
arm falls in a row moves with every degree of roll. The response was offering a
5% narrower waist and a 5% wider hip on a body that had not changed at all.
`f2dd1e6ee` names those ratios so a report cannot attribute them to the body;
`e4ede33b1` asks the user to hold their arms clear, which is what makes the
problem rare rather than merely labelled.

**Re-running it:** `SparkyFitnessServer/tmp-vision-e2e.script.ts` (untracked,
git-excluded — it needs the ~29 MB model and a live sidecar, so CI cannot have
it). It wants a scratch database built from `db/migrations` + `rls_policies.sql`
plus the grants from `db/grantPermissions.ts`, two seeded `check_in_photos` rows
with real JPEGs on disk, `SPARKY_FITNESS_DB_NAME` pointed at the scratch
database and `VISION_MICROSERVICE_URL=http://localhost:8100`.

The pair itself is built from one real full-body photograph: save it as the
before, then for the after rotate it −2.5°, scale it 1.03×, crop 18px right and
9px down, and multiply the R/G/B channels by 1.06/1.04/1.01 with offsets
+6/+5/+3. That is a camera that moved and a room that got brighter and warmer,
with the body held constant — which is the only way to tell a real shape change
from the measurement noise the alignment and exposure machinery exists to
absorb.

## The second-opinion review, and what was done about it

Four findings came back. Three were accepted, one partly.

**1. `unreliable_ratios` was persisted.** It was written into the analysis row
beside the measurements, so a change to the contamination rule reached only
pairs compared after the change. The reviewer suggested backfilling old rows;
recomputing on read is better, because it needs no backfill and cannot drift
again. The list is now derived from the stored `arms_overlap` flags on every
read, exactly as the verdict already was, and `storedDeterministicSchema` omits
the field so a future author cannot reintroduce it by accident.

**2. The silhouette-area ratio was struck out too eagerly.** It listed no stops,
so the first implementation marked it unreliable whenever an arm touched
anything. Accepted, but narrowed: it is now struck out on a posture *change*
between the two photos rather than on any overlap. Area integrates over the
whole body instead of reading one row of pixels, and it held to 0.05% across
the same pair whose arm-crossed waist and hip moved 4.7% and 5.4% — it is the
one shape number that survives an arms-down habit, and throwing it away would
leave such a pair with nothing.

**3. A stub `deterministic` blob could crash the read path.** Real. Added a
`safeParse` guard in `readDeterministic` and realistic fixtures in the service
tests.

**4. Degrade the verdict whenever any ratio is unreliable.** Partly accepted.
A pair with *no* trustworthy shape ratio left is now `not_comparable` with
reason `arms_obscured` — "comparable" is a promise that something can be
compared, and with every shape number struck out there is nothing behind it.
The blanket degrade to `marginal` was declined: two well-framed photos of
someone who always stands with their arms down really are comparable, and
saying otherwise would punish exactly the consistency the feature wants.

The reconciled code was re-run through the same end-to-end harness. Same
posture in both photos, so silhouette area survived (−0.05%) alongside the
arm-free shoulder (−0.05%) and thigh (−0.27%), while `waist_shoulder`,
`waist_height` and `hip_shoulder` came back struck out carrying the 4–5% drift.
A row fetched back from Postgres produced the same struck-out list with no
column storing it, and the verdict stayed `comparable`.

## Gate status

| Gate | Result |
| --- | --- |
| `SparkyFitnessServer` `tsc --noEmit` | pass |
| `SparkyFitnessServer` eslint (new files) | pass |
| `SparkyFitnessServer` full vitest | 6580 passed, 50 skipped |
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

**Nothing stores a judgement — not the verdict, not `unreliable_ratios`.**
Comparability thresholds and the arm-contamination rule are starting values
from the blueprint, not numbers measured off real pairs. They will move.
Storing either answer would freeze last month's rule onto this month's
question, so the tables store measurements and both `assessComparability` and
`unreliableRatios` run on every read. `storedDeterministicSchema` omits the
field so the type system enforces it.

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

- **The end-to-end run covered the service, not the route.** Express, auth and
  the permission middleware were exercised only by the mocked route tests.
- **It was one photograph moved, not two sessions weeks apart.** That proves
  the alignment and exposure path on real pixels; it proves nothing about how
  the numbers behave when a body actually changes.
- **The thresholds are guesses.** `COMPARABILITY_THRESHOLDS` has never been
  checked against a pair of real photos taken weeks apart. The first honest
  calibration is to shoot a pair deliberately badly and see what it says.
- **Arm overlap is labelled and discouraged, not solved.** A stop an arm was
  inside is still measured and still reported; `unreliable_ratios` only says
  not to believe it. Anyone who photographs with their arms down gets a
  comparison resting on shoulder, thigh and silhouette area alone — enough to
  stay `comparable`, but a thinner answer than the capture hint would give.
- **Phase 1 has still never run on a device.** The guided viewfinder is tested
  under jest only.
