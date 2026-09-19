# SparkyFitness Vision

A small, stateless Python service that measures a progress photo: where the body
is (pose landmarks), which pixels are the person (a mask), and the handful of
scale-free numbers a before/after comparison is allowed to cite.

It is the Layer 1 half of the progress-photo comparison feature. Everything it
returns is deterministic arithmetic over a model's output; nothing it produces
is a judgement, and no language model is involved at this layer.

## Why a separate service

The Node server has no image library at all — no `sharp`, no `jimp`, no
`canvas` — and the models used here are Python-first. Doing this work in the
iOS app instead was the other option, and was rejected because the web client
would then have no comparison feature at all.

## Why one model

MediaPipe's Pose Landmarker returns a **segmentation mask alongside the
landmarks**, so this service does not carry `rembg`/`u2net` and an ONNX runtime
as well. That is not only a smaller install: the mask and the landmarks come
out of one detection, so the silhouette being measured is guaranteed to belong
to the body whose joints were located. Two independent models can disagree
about who the subject is.

## What it never does

- **It does not store anything.** Photos arrive in a request and leave as
  numbers. These are pictures of someone's body; the service that looks at them
  is the last place that should keep copies. Storage, permissions and retention
  stay with the main server, which already has row-level security for them.
- **It does not decide.** No verdict, no narrative, no advice. The
  comparability thresholds live in `@workspace/shared` so they are tunable and
  testable in the language the rest of the app is tested in.
- **It does not guess.** A photo without a confident, whole-body pose is
  refused with a reason (`pose_not_detected`, `landmark_not_visible:ankles`),
  never measured approximately.

## Running it

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
models/download.sh          # ~29 MB, not in git
.venv/bin/python main.py    # VISION_SERVICE_PORT, default 8100
```

The main server finds it through `VISION_MICROSERVICE_URL`. With that variable
unset the whole feature is simply absent — no comparison endpoints, no errors,
and every other part of the app behaves exactly as it did before.

```bash
.venv/bin/python -m pytest tests/ -q
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Loads the model, so a bad model path fails here rather than on someone's first photo |
| `POST` | `/analyze` | One photo → landmarks + metrics |
| `POST` | `/compare` | Two photos → both analyses, the alignment residual, the exposure delta, and optionally the aligned pair as JPEG |

## The numbers, and what they are worth

Widths are sampled at **fixed fractions of ankle-to-eye height** (0.82 shoulder,
0.72 chest, 0.60 waist, 0.52 hip, 0.38 thigh) rather than at landmark
positions, so a landmark that jitters a few pixels between two shoots cannot
move the measuring tape. Everything reported as a ratio is divided by that same
height, which is what makes "you stood closer to the camera" cancel out.

Height is ankle-to-eye rather than shoulder width on purpose: shoulder width is
something training is supposed to change, and normalising by it would divide the
signal out of the data. It is measured as the **distance** between the two
midpoints rather than the difference in their y, because a vertical extent
shrinks with the cosine of camera roll and that error would otherwise leak into
the alignment residual as if the body had changed.

**These are trend numbers against the same person's own earlier photo, not
circumferences.** A silhouette width is not a tape measure, and a row measured
across the waist also crosses the arms when they hang against the body. That
case cannot be separated out of a silhouette, so it is reported rather than
corrected: `arms_overlap` marks each stop where an arm was inside the measured
run, and a consumer should decline to discuss that region instead of narrating
the position of someone's elbows. A real photograph turned this up immediately —
the first full-body test image measured a waist within 2% of its shoulders.

## Alignment

The after photo is mapped onto the before photo with a **similarity transform**:
rotation, uniform scale, translation. Never an affine, never a homography. An
affine has independent x and y scales and shear, so it can narrow a waist while
leaving the height alone — it can fit progress out of the data, or invent it. A
similarity transform physically cannot; it moves the body without reshaping it.

Scale is locked to the ratio of the two body heights rather than fitted. Given
freedom over scale, least squares would shrink whichever body is wider to reduce
its own residual — and that residual is the number deciding whether the pair is
comparable at all, so a fit free to improve it by resizing the person would be
marking its own homework.

Exposure is matched on **background pixels only**. The body is most of the
frame, so a whole-frame match pushes the after body's tones onto the before
body's and erases exactly what is being measured. The wall did not change
between the shoots, so the wall is what says how the light did. The fit is a
per-channel gain and offset over matched background quantiles rather than a
histogram lookup: a lookup is only defined across the tones the background
actually contains, so a wall spanning 78–102 pins every skin pixel above it to
102, which does not correct the body so much as delete it.
