"""Per-photo analysis: pose landmarks, person mask, and the numbers derived
from them (blueprint IV.2).

Split deliberately in two halves. `detect()` runs the model and is only
testable against real photographs; `derive_metrics()` is pure arithmetic over a
mask and a landmark set, so the numbers that a report is allowed to cite can be
tested exactly, with synthetic silhouettes of known proportions.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

from models import ENGINE, POSE_MODEL, require_models

# MediaPipe Pose's 33-landmark indices. Named here because an index literal
# three files deep is unreadable and a wrong one is silent.
NOSE = 0
LEFT_EYE = 2
RIGHT_EYE = 5
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_ELBOW = 13
RIGHT_ELBOW = 14
LEFT_WRIST = 15
RIGHT_WRIST = 16
LEFT_HIP = 23
RIGHT_HIP = 24
LEFT_ANKLE = 27
RIGHT_ANKLE = 28

# The landmarks that say where the arms are. A row measured across the torso
# also crosses these whenever someone stands with their arms down, which is
# how most people stand for a photo.
ARM_LANDMARKS = (LEFT_ELBOW, RIGHT_ELBOW, LEFT_WRIST, RIGHT_WRIST)

# The landmarks a comparison is anchored on. Chosen because they are the four
# points that a standing person cannot move independently of their skeleton:
# eyes, shoulders, hips, ankles. Elbows and wrists are deliberately excluded -
# arm position is the single most variable thing between two shoots.
ANCHOR_GROUPS: tuple[tuple[str, tuple[int, int]], ...] = (
    ("eyes", (LEFT_EYE, RIGHT_EYE)),
    ("shoulders", (LEFT_SHOULDER, RIGHT_SHOULDER)),
    ("hips", (LEFT_HIP, RIGHT_HIP)),
    ("ankles", (LEFT_ANKLE, RIGHT_ANKLE)),
)

# Below this, a landmark is a guess. A body span computed from a guessed ankle
# is worse than no number at all, so this gates the whole analysis.
MIN_VISIBILITY = 0.5

# Rows to measure the silhouette at, as fractions of ankle-to-eye height
# measured UP from the ankle line. Fixed fractions rather than landmark
# y-positions on purpose (blueprint IV.2): a landmark that jitters by a few
# pixels between two shoots would otherwise move the measuring tape, and the
# resulting "change" would be the jitter.
WIDTH_STOPS: dict[str, float] = {
    "shoulder": 0.82,
    "chest": 0.72,
    "waist": 0.60,
    "hip": 0.52,
    "thigh": 0.38,
}


@dataclass(frozen=True)
class Analysis:
    """One photo's analysis. `landmarks` is (33, 3): x, y in pixels, visibility."""

    landmarks: np.ndarray
    mask: np.ndarray
    metrics: dict
    engine: str


class PoseNotDetected(Exception):
    """No body, or not enough of one, was found in the photo.

    Carries the reason so the caller can tell the user which of the two it was:
    "no person in this photo" and "your feet are cut off" need different fixes.
    """

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


_landmarker: vision.PoseLandmarker | None = None


def get_landmarker() -> vision.PoseLandmarker:
    """The model, loaded once. Loading costs ~1s and holds a GPU context."""
    global _landmarker
    if _landmarker is None:
        require_models()
        _landmarker = vision.PoseLandmarker.create_from_options(
            vision.PoseLandmarkerOptions(
                base_options=mp_python.BaseOptions(
                    model_asset_path=str(POSE_MODEL)
                ),
                running_mode=vision.RunningMode.IMAGE,
                # One body. A progress photo with two people in it is a photo
                # of the wrong thing, and picking one of them silently would
                # measure a stranger.
                num_poses=1,
                output_segmentation_masks=True,
            )
        )
    return _landmarker


def detect(image_rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Run the model. Returns (landmarks, mask) or raises PoseNotDetected."""
    result = get_landmarker().detect(
        mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(image_rgb))
    )
    if not result.pose_landmarks:
        raise PoseNotDetected("pose_not_detected")

    height, width = image_rgb.shape[:2]
    points = result.pose_landmarks[0]
    landmarks = np.array(
        [[p.x * width, p.y * height, p.visibility] for p in points],
        dtype=np.float64,
    )

    # The body has to be whole. A cropped-off head or feet does not just lose a
    # landmark, it loses the height scale every other number is divided by.
    for name, (left, right) in ANCHOR_GROUPS:
        if min(landmarks[left, 2], landmarks[right, 2]) < MIN_VISIBILITY:
            raise PoseNotDetected(f"landmark_not_visible:{name}")

    # The model hands the mask back as (H, W, 1). Everything downstream indexes
    # it against 2-D image planes, where that trailing axis is an extra index
    # and a hard error - so flatten it here, once, rather than in each caller.
    mask = np.squeeze(
        result.segmentation_masks[0].numpy_view().astype(np.float32)
    )
    if mask.ndim != 2:
        raise PoseNotDetected("unexpected_mask_shape")
    if mask.shape != (height, width):
        mask = cv2.resize(mask, (width, height), interpolation=cv2.INTER_LINEAR)
    return landmarks, mask


def midpoint(landmarks: np.ndarray, left: int, right: int) -> np.ndarray:
    """The point between a symmetric pair, in pixels."""
    return (landmarks[left, :2] + landmarks[right, :2]) / 2.0


def anchor_points(landmarks: np.ndarray) -> np.ndarray:
    """The four anchor midpoints, in ANCHOR_GROUPS order, as a (4, 2) array."""
    return np.array(
        [midpoint(landmarks, left, right) for _, (left, right) in ANCHOR_GROUPS]
    )


def body_height_px(landmarks: np.ndarray) -> float:
    """Ankle line to eye line, in pixels.

    The scale every ratio is expressed in. Ankle-to-eye rather than shoulder
    width (blueprint III.6): shoulder width is a thing training is supposed to
    change, so normalising by it would divide the signal out of the data.

    The DISTANCE between the two midpoints, not the difference in their y.
    A vertical extent shrinks by cos(roll) when the camera is held at an
    angle - at 6 degrees that is half a percent, which then leaks into the
    alignment residual as if the body had changed, because the alignment locks
    its scale to this number. A distance is rotation-invariant, so a tilted
    camera stays a tilted camera instead of becoming a smaller person.
    """
    eyes = midpoint(landmarks, LEFT_EYE, RIGHT_EYE)
    ankles = midpoint(landmarks, LEFT_ANKLE, RIGHT_ANKLE)
    height = float(np.linalg.norm(ankles - eyes))
    # Signed by the direction the body actually runs, so an upside-down or
    # mis-detected pose is still rejected downstream rather than measured.
    return height if ankles[1] >= eyes[1] else -height


def _row_span(row: np.ndarray, center_x: int) -> tuple[float, int, int]:
    """Width of the silhouette at one row, as the contiguous run through the
    body's midline.

    Not the pixel count of the row: at chest and waist height a row also
    crosses the arms, and on a photo where the arms hang clear of the torso
    that would add two disconnected bands of "body" to the waist. Walking out
    from the midline stops at the first gap, which is the torso edge. Where the
    arms touch the torso the run does include them - documented in the README
    as the reason these are trend numbers against the same person's own
    earlier photo, never circumferences.
    """
    width = row.shape[0]
    center_x = int(np.clip(center_x, 0, width - 1))
    if row[center_x] < 0.5:
        # The midline missed the body (an unusual pose, or a bad mask). Fall
        # back to the widest run in the row rather than reporting zero.
        best_length, best_left, best_right = 0, center_x, center_x
        start = None
        for index, value in enumerate(row):
            if value >= 0.5 and start is None:
                start = index
            elif value < 0.5 and start is not None:
                if index - start > best_length:
                    best_length, best_left, best_right = index - start, start, index - 1
                start = None
        if start is not None and width - start > best_length:
            best_length, best_left, best_right = width - start, start, width - 1
        return float(best_length), best_left, best_right

    left = center_x
    while left > 0 and row[left - 1] >= 0.5:
        left -= 1
    right = center_x
    while right < width - 1 and row[right + 1] >= 0.5:
        right += 1
    return float(right - left + 1), left, right


# How far from a measured row an arm landmark still counts as being "at" it,
# as a fraction of body height. Generous, because the landmark is the joint
# centre while the limb around it is what the mask actually contains.
ARM_ROW_TOLERANCE = 0.08


def _arms_inside(
    landmarks: np.ndarray,
    row_y: float,
    left: int,
    right: int,
    height_px: float,
) -> bool:
    """Whether an arm is inside a measured run.

    Only arm landmarks near this row count: a wrist at thigh height says
    nothing about a chest measurement two feet above it. A landmark that is
    not confidently placed is ignored rather than trusted - a guessed wrist
    would flag every photo.
    """
    tolerance = ARM_ROW_TOLERANCE * height_px
    for index in ARM_LANDMARKS:
        x, y, visibility = landmarks[index]
        if visibility < MIN_VISIBILITY:
            continue
        if abs(y - row_y) <= tolerance and left <= x <= right:
            return True
    return False


def derive_metrics(landmarks: np.ndarray, mask: np.ndarray, image_rgb: np.ndarray) -> dict:
    """The numbers a report may cite (blueprint IV.2). Pure."""
    height_px = body_height_px(landmarks)
    if height_px <= 0:
        raise PoseNotDetected("inverted_pose")

    ankles = midpoint(landmarks, LEFT_ANKLE, RIGHT_ANKLE)
    shoulders = midpoint(landmarks, LEFT_SHOULDER, RIGHT_SHOULDER)
    rows, cols = mask.shape[:2]

    widths: dict[str, float] = {}
    arms_overlap: dict[str, bool] = {}
    for name, fraction in WIDTH_STOPS.items():
        y = ankles[1] - fraction * height_px
        row_index = int(np.clip(round(y), 0, rows - 1))
        # The midline leans with the body: straight down from the shoulders to
        # the ankles, interpolated by how far up this row is.
        center_x = shoulders[0] + (ankles[0] - shoulders[0]) * (1.0 - fraction)
        span, left, right = _row_span(mask[row_index], int(round(center_x)))
        widths[name] = span
        arms_overlap[name] = _arms_inside(landmarks, y, left, right, height_px)

    def ratio(numerator: float, denominator: float) -> float | None:
        return float(numerator / denominator) if denominator > 0 else None

    body = mask >= 0.5
    background = ~body
    lab = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    if background.any():
        luminance = float(np.median(lab[..., 0][background]))
        chroma = float(
            np.mean(
                np.sqrt(
                    (lab[..., 1][background] - 128.0) ** 2
                    + (lab[..., 2][background] - 128.0) ** 2
                )
            )
        )
    else:
        # A person filling the whole frame leaves no background to measure, so
        # the exposure comparison simply has no opinion rather than reporting
        # the body's own colour as the room's.
        luminance, chroma = None, None

    return {
        "height_px": height_px,
        "image_size": [int(cols), int(rows)],
        "widths_px": widths,
        # Per stop: was an arm inside the measured run? A waist measured with
        # the arms hanging against it is a measurement of the arms, and it
        # moves with how the person happened to stand rather than with their
        # waist. Reported rather than silently corrected, so a report can
        # decline to talk about that region instead of narrating sleeves.
        "arms_overlap": arms_overlap,
        "ratios": {
            "waist_shoulder": ratio(widths["waist"], widths["shoulder"]),
            "waist_height": ratio(widths["waist"], height_px),
            "hip_shoulder": ratio(widths["hip"], widths["shoulder"]),
            "shoulder_height": ratio(widths["shoulder"], height_px),
            "thigh_height": ratio(widths["thigh"], height_px),
            "mask_area_height2": ratio(float(body.sum()), height_px**2),
        },
        "background": {"luminance": luminance, "chroma": chroma},
        "visibility": {
            name: float(min(landmarks[left, 2], landmarks[right, 2]))
            for name, (left, right) in ANCHOR_GROUPS
        },
    }


def analyze(image_rgb: np.ndarray) -> Analysis:
    """Detect and measure one photo."""
    landmarks, mask = detect(image_rgb)
    return Analysis(
        landmarks=landmarks,
        mask=mask,
        metrics=derive_metrics(landmarks, mask, image_rgb),
        engine=ENGINE,
    )
