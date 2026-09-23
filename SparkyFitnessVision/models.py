"""Model files and where they come from.

The weights are downloaded rather than vendored: the pose bundle alone is
29 MB, and committing it would put a binary blob in a public repository for
every clone to pay for. `models/download.sh` fetches them into `.models/`.

Absence is a hard, loud failure at startup rather than a lazy one at the first
photo: a sidecar that answers /health while it cannot actually analyse anything
is exactly the silent-failure shape this repo's data tooling rules forbid.
"""

from __future__ import annotations

import os
from pathlib import Path

MODEL_DIR = Path(os.getenv("VISION_MODEL_DIR", Path(__file__).parent / ".models"))

# The pose bundle. "heavy" rather than "full"/"lite" because this runs once per
# photo on a self-hosted box, not per video frame: accuracy is free here, and
# the landmark positions are what every downstream number is built on.
POSE_MODEL = MODEL_DIR / "pose_landmarker_heavy.task"

POSE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task"
)

# Bumped whenever anything that changes the numbers changes: the model file,
# the landmark set, or the metric definitions. Stored next to every analysis so
# a cached row computed by an older pipeline is recognisable as stale rather
# than silently compared against a new one.
ENGINE = "mediapipe-0.10.35/pose_landmarker_heavy/metrics-1"


def require_models() -> None:
    """Raise unless every model file is present."""
    if not POSE_MODEL.exists():
        raise FileNotFoundError(
            f"Pose model missing at {POSE_MODEL}. Run models/download.sh "
            "(or set VISION_MODEL_DIR to a directory that has it)."
        )
