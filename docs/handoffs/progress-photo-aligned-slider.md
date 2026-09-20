# Progress photos, phase 3 — the aligned before/after slider

_2026-09-19_

## What shipped

Phase 3 of the progress-photo comparison feature, in two commits on
`feat/hold-timer`:

- `5ab089d4a` — `GET /api/progress-photo-comparisons/:id/aligned` on the
  server, plus the `alignedPairSchema` wire contract in `@workspace/shared`.
- `65fb112e5` — the mobile half: the API client, `useAlignedPhotoPair`,
  `AlignedPhotoSlider`, the Align switch on `ProgressPhotoCompareScreen`, the
  English catalog entries, and tests for all of it.

Nothing is pushed. The branch is 16 ahead of `origin`.

## The shape of it

`ProgressPhotoCompareScreen` grew an **Align** switch above its two panes. Off
(the default) it is the screen it was: two days side by side, each picking its
own date. On, the panes are replaced by one frame with a draggable divider —
the after photo warped onto the before photo's frame by the similarity
transform the comparison already measured, with its exposure matched to the
before photo's on background pixels only.

The switch renders only when `useVisionAvailability()` reports the sidecar
reachable. A server with no `VISION_MICROSERVICE_URL` shows no switch and makes
no request, which is the same "the feature is simply absent" behaviour the rest
of this feature has.

## Decisions worth not relitigating

**One JSON call carrying both frames as base64, rather than two image routes.**
The sidecar produces both frames in a single pass, so two streaming routes
would have meant two passes over the same pair. Exposing the 2×3 matrix and
warping on the client was the other candidate and is worse: the exposure match
cannot be done client-side at all, and mapping sidecar pixel space onto a
laid-out view is fragile in a way a server-rendered frame is not. Both frames
also come back from the same encoder, so a crossfade shows no encoder artefact
that could read as a change in the body.

**The route is read-only.** It re-calls the sidecar, but it never writes the
measurements back. Re-measuring on a view would mean that merely opening a
slider silently rewrote the stored numbers — and with the sidecar upgraded,
rewrote them to different ones — which is exactly the kind of invisible
mutation the whole "store measurements, never a judgement" rule exists to
avoid. A pair that was never measurable is a 422 here, not a retry.

**Nothing stores the aligned frames**, on the server or on the device. The
query's 30-minute `staleTime` is the entire cache. The photos on disk stay the
ones that were taken; the aligned pair is a rendering, and a rendering that
outlives the rule that produced it is a lie waiting to be believed.

**The clipped frame takes a fixed pixel width.** The before photo is clipped
over the after photo from the left, the divider being the clip container's
width. A percentage width on the inner `<Image>` would resize the photo as the
divider moved — a change in the picture that is in neither photograph, on a
screen whose whole purpose is to show only real change.

**The divider is adjustable without a drag.** `accessibilityRole="adjustable"`
plus increment/decrement actions in 10% steps. The value wording is `"60%
before"`, because the clipped left portion is the before frame; it read
"% after" in the first draft and was backwards.

## Traps

- The Pan gesture clamps **inline** (`Math.min(Math.max(...))`). A module-level
  `clamp()` called from a Reanimated 4 worklet throws "tried to synchronously
  call a non-worklet function on the UI thread" at runtime, and no test catches
  it — the gesture-handler jest mock never runs the worklet.
- Because of that mock the drag itself is not unit-tested. The component test
  covers the accessibility path, both frames rendering, and the fixed width.
  The drag is device-verified only, and has not been device-verified yet.
- Mobile i18n keys go in `src/localization/locales/en/translation.json`, not
  `locales/en.json`, and a `defaultValue` alone does not satisfy the audit.

## Gate status

Green at `65fb112e5`. `pnpm run validate` passes in mobile (including Knip and
the format check), and the full jest suite is 467 suites / 7407 tests passing.
Server was green at `5ab089d4a` (13 route tests, 20 service tests).

## Exact next step

Phase 4: the narrative report. A comparison currently yields numbers and a
verdict; phase 4 turns a `comparable` pair into prose the user reads. The
blueprint's position is that the LLM sees the *measurements*, never the photos,
and that it is told what it may not say — no body-composition claims, no health
judgements, no numbers the deterministic pass did not produce.

Before that, two cheaper things are worth doing:

1. **Run it on a device.** Phase 1's guided viewfinder and now this slider have
   both only ever run under jest.
2. **Calibrate the thresholds.** See the open risks below.

## Open risks

- **The slider has never run on a device.** Neither has phase 1's viewfinder.
- **`COMPARABILITY_THRESHOLDS` are still blueprint guesses.** They have never
  been checked against a pair of real photographs taken weeks apart. The first
  honest calibration is to shoot a pair deliberately badly and see what it
  says.
- **The server e2e covered the service, not Express.** Auth and the permission
  middleware on the new route are exercised only by mocked route tests.
- **Arm overlap is labelled, not solved** — see
  `docs/handoffs/progress-photo-comparison-server.md`.
