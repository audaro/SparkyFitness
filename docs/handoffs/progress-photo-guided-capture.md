# Progress photos: guided capture (phase 1 of 4)

_2026-09-18 — commits `27624a08b`, `7e79aa388`, `24cf402fa` on `feat/hold-timer`, not pushed._

## What shipped

Phase 1 of the progress-photo comparison work: capture consistency. Before/after
photos already shipped end to end (`check_in_photos`, the gallery / compare /
time-lapse screens, the authenticated `/file/:id` streamer); what was missing was
any way to take the second photo the same way as the first, and any record of how
either was taken.

- **`ProgressPhotoCaptureScreen`** — an `expo-camera` viewfinder reached from
  `PhotoDaySlots`'s new first action. It ghosts the previous shoot at the same
  angle over the live preview (opacity 0.25 / 0.4 / 0.6), offers a 0/3/10s
  self-timer, and draws crosshair guides when there is no reference yet. The
  reference is the most recent photo of that angle **from another day**, so a
  retake aligns to the series rather than to the shot it corrects, and it is
  mirrored while the front camera is selected because the preview is.
- **`capture_meta`** — a versioned JSONB column on `check_in_photos` recording
  mode, device, facing, reference photo + opacity, timer, tilt (reserved), and
  local wall-clock time with offset. Shape is owned by `captureMetaSchema` in
  `@workspace/shared`; unknown fields are omitted, never defaulted. The legacy
  OS-camera and library paths report their mode too, so an unguided shot is
  distinguishable from a photo predating the column (`capture_meta IS NULL`).
  Malformed metadata is a 400 rather than a photo stored without it.

Blueprint: `~/fitness/PROGRESS-PHOTO-BLUEPRINT.md` (untracked, outside the repo).
Phase 1 covers §VII phase 1; decisions III.1–III.12 are settled there.

## Gate status — all green at commit time

| Gate | Result |
| --- | --- |
| Server `tsc --noEmit`, lint, `prettier --check` | pass |
| Server vitest | 6521 passed, 50 skipped (424 files) |
| Mobile `pnpm run validate` | pass (i18n audit 0 blocking, knip, format, muscle-art) |
| Mobile jest | 7396 passed (466 suites) |
| Frontend `tsc -b` | pass |
| `pnpm run test:migrations` fresh install | pass (`capture_meta \| jsonb` present) |
| `pnpm run test:migrations` upgrade path | pass |

The upgrade path was run the way CI runs it: empty database → migrations with the
new file moved aside (the base state) → migrations with it restored. Do **not**
try to reproduce it by restoring `db_schema_backup.sql` and replaying every
migration — the initial migration (`20250703170640_InitialDB.sql`) re-creates
`can_access_user_data` with its third parameter named `authenticated_user_id`,
while `rls_policies.sql` later renames it to `auth_user_id`, so replaying over a
current dump dies on `cannot change name of input parameter "auth_user_id"`. That
is a property of the dump-replay, not of any new migration.

The migration is already applied to the local dev database (`sparkyfitness_db`).

## Second-opinion review

Reviewed by gpt-5.6-sol at high effort. One finding was real and is fixed in
`24cf402fa`: the shutter did not wait for the gallery to answer or for the ghost
to paint, so a shot fired in the first frames after opening the screen was framed
against an empty overlay while its `capture_meta` claimed a reference photo and an
opacity — and before the gallery answered, the screen told the user this was their
first shot at the angle when it was not. `SafeImage` now exposes the loaded /
terminally-failed state it already tracked (`onSettled`), and a ghost that fails
every retry settles as failed rather than pending, so an unreachable reference
cannot disable the shutter for good.

Two findings were declined:

- *"`capture_meta = EXCLUDED.capture_meta` erases metadata when an older client
  omits it; COALESCE it."* The same `DO UPDATE` sets `file_path = EXCLUDED.file_path`
  and a new image is always written, so the row after a conflict describes a
  different photo. Preserving the previous `capture_meta` would attach the old
  shot's reference, opacity, timer and device to an image taken some other way —
  a plausible, wrong record, which is worse than the honest NULL that says the
  conditions are unknown. The reasoning is in a comment on the statement.
- *"The mandatory migration documentation updates are missing."* Checklist steps 6
  and 7 classify a **table**; `check_in_photos` was classified when it was created
  and its tier, permissions and sharing model are unchanged by a column. The
  security-tiers row was extended to say the row now also carries how the photo was
  taken, which is the part an auditor would want; `9.family-friends-sharing.md`
  needed nothing, since no permission changed.

## Exact next step

Phase 2 of the blueprint: the `SparkyFitnessVision` Python sidecar (shaped like
`SparkyFitnessGarmin`) and Layer 1 — the deterministic metrics. Nothing of it
exists yet. In order:

1. Scaffold the sidecar (FastAPI, `main.py` / `routes.py` / `service.py` /
   `schemas.py`), no ML yet, one `/health` route and a server-side client.
2. Pose landmarks (MediaPipe) + person segmentation, then the similarity
   transform — **similarity only**, never affine or homography, since an affine
   can narrow a waist and fake progress. Scale normalizes on ankle→eye height,
   never shoulder width.
3. Histogram matching fitted on **background** pixels only, and the comparability
   verdict from the thresholds in blueprint §IV.

## Open risks

- Phase 1 has had no on-device run. The ghost overlay, the mirrored front-camera
  preview and the timer are covered by unit tests against a mocked `CameraView`;
  how the ghost actually reads over a live preview at 0.25/0.4/0.6 has not been
  looked at. Do that before building on it.
- Tilt (`pitch_deg` / `roll_deg`) is in the schema but never populated:
  `expo-sensors` is not installed and adding it forces a native rebuild, which
  breaks OTA. The fields are optional, so the sensor work stays purely additive.
- The chat model still cannot see a photo — `ai/tools/progressPhotoTools.ts`
  lists and deletes but never passes image bytes. That is phase 4, not a bug.
