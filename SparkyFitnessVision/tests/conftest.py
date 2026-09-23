"""Synthetic bodies.

The model cannot be tested here - it needs real photographs, and this repo has
none to ship. What CAN be tested exactly is everything downstream of it: given
a mask and a landmark set, the numbers are arithmetic, and arithmetic over a
figure whose waist is 10% narrower by construction has one right answer.

So these fixtures build the silhouette and the landmarks directly, which is
also what the sidecar does internally once the model has run.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import analysis  # noqa: E402

CANVAS = (900, 600)  # height, width


def build_figure(
    *,
    waist_px: int = 120,
    shoulder_px: int = 200,
    hip_px: int = 150,
    thigh_px: int = 70,
    center_x: int = 300,
    eye_y: int = 120,
    ankle_y: int = 820,
    arms: bool = False,
    arms_down: bool = False,
) -> tuple[np.ndarray, np.ndarray]:
    """A blocky standing figure: (mask, landmarks).

    Widths are set at the exact rows the analysis samples, so a test that
    changes `waist_px` by 10% is changing precisely the thing being measured.
    """
    height, width = CANVAS
    mask = np.zeros((height, width), dtype=np.float32)
    body_height = ankle_y - eye_y

    stops = sorted(analysis.WIDTH_STOPS.items(), key=lambda item: item[1])
    widths_at = {
        "thigh": thigh_px,
        "hip": hip_px,
        "waist": waist_px,
        "chest": (waist_px + shoulder_px) // 2,
        "shoulder": shoulder_px,
    }
    # Fill every row by interpolating between the named stops, so the figure is
    # continuous rather than five floating bands.
    fractions = [fraction for _, fraction in stops]
    values = [widths_at[name] for name, _ in stops]
    for y in range(eye_y - 40, ankle_y + 1):
        fraction = (ankle_y - y) / body_height
        span = float(np.interp(fraction, fractions, values))
        half = int(round(span / 2))
        mask[y, max(0, center_x - half) : min(width, center_x + half + 1)] = 1.0

    if arms:
        # Two bands clear of the torso at waist height, the shape a person
        # standing with their arms out from their sides makes.
        waist_y = int(ankle_y - analysis.WIDTH_STOPS["waist"] * body_height)
        for y in range(waist_y - 60, waist_y + 60):
            mask[y, center_x - 200 : center_x - 160] = 1.0
            mask[y, center_x + 160 : center_x + 200] = 1.0

    landmarks = np.zeros((33, 3), dtype=np.float64)
    landmarks[:, 2] = 1.0
    shoulder_y = ankle_y - analysis.WIDTH_STOPS["shoulder"] * body_height
    hip_y = ankle_y - analysis.WIDTH_STOPS["hip"] * body_height
    landmarks[analysis.LEFT_EYE] = [center_x - 20, eye_y, 1.0]
    landmarks[analysis.RIGHT_EYE] = [center_x + 20, eye_y, 1.0]
    landmarks[analysis.LEFT_SHOULDER] = [center_x - shoulder_px / 2, shoulder_y, 1.0]
    landmarks[analysis.RIGHT_SHOULDER] = [center_x + shoulder_px / 2, shoulder_y, 1.0]
    landmarks[analysis.LEFT_HIP] = [center_x - hip_px / 2, hip_y, 1.0]
    landmarks[analysis.RIGHT_HIP] = [center_x + hip_px / 2, hip_y, 1.0]
    landmarks[analysis.LEFT_ANKLE] = [center_x - 30, ankle_y, 1.0]
    landmarks[analysis.RIGHT_ANKLE] = [center_x + 30, ankle_y, 1.0]

    # Where the hands are. `arms_down` puts them against the waist, which is
    # how most people stand for a photo and the case that contaminates the
    # waist measurement; otherwise they are held clear of the body.
    waist_y = ankle_y - analysis.WIDTH_STOPS["waist"] * body_height
    hand_offset = (waist_px // 2 - 10) if arms_down else 250
    for index, sign in (
        (analysis.LEFT_WRIST, -1),
        (analysis.RIGHT_WRIST, 1),
        (analysis.LEFT_ELBOW, -1),
        (analysis.RIGHT_ELBOW, 1),
    ):
        landmarks[index] = [center_x + sign * hand_offset, waist_y, 1.0]
    return mask, landmarks


def flat_image(mask: np.ndarray, body=(180, 150, 140), background=(60, 60, 65)) -> np.ndarray:
    """An RGB frame for a mask: one tone for the body, one for the room."""
    image = np.zeros((*mask.shape, 3), dtype=np.uint8)
    image[...] = background
    image[mask >= 0.5] = body
    return image


@pytest.fixture
def figure():
    return build_figure


def textured(image: np.ndarray, amplitude: int = 12, seed: int = 7) -> np.ndarray:
    """Add mild noise.

    Flat synthetic tones are the one thing a real photo never has, and several
    steps here need a spread of values to fit against - a histogram match on a
    single-valued wall has nothing to map. Deterministic, so the numbers a test
    asserts do not move between runs.
    """
    rng = np.random.default_rng(seed)
    noise = rng.integers(-amplitude, amplitude + 1, size=image.shape)
    return np.clip(image.astype(np.int16) + noise, 0, 255).astype(np.uint8)
