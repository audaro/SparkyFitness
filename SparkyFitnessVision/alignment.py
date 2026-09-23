"""Pair alignment and photometric normalisation (blueprint IV.3).

The one rule this file exists to enforce: the warp that maps the after photo
onto the before photo is a SIMILARITY transform - rotation, uniform scale and
translation, nothing else. An affine or a homography has independent x and y
scales and shear, so it can narrow a waist while leaving the height alone, and
fit it out of the data entirely. A similarity transform physically cannot: it
moves the body without reshaping it, which is the whole point of aligning.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
import analysis


# Below this spread of background tones there is nothing to fit a curve to.
MIN_BACKGROUND_SPREAD = 4.0
# A correction outside this range is not an exposure difference; it is two
# different rooms, or a mask that caught the body in the "background".
MIN_GAIN = 0.25
MAX_GAIN = 4.0


@dataclass(frozen=True)
class Alignment:
    matrix: np.ndarray  # 2x3, maps after-space into before-space
    residual: float  # RMS landmark error after the warp, in before-space px
    residual_norm: float  # the same, as a fraction of before's body height
    scale: float  # before_height / after_height


def similarity_from_height(
    before_landmarks: np.ndarray, after_landmarks: np.ndarray
) -> Alignment:
    """Fit the after->before similarity transform.

    Scale is LOCKED to the ratio of the two ankle-to-eye heights rather than
    estimated (blueprint III.6 / IV.3). Least squares given freedom over scale
    would shrink whichever body is wider to reduce its own residual, and the
    residual is the number that decides whether the pair is comparable at all -
    letting the fit improve that number by resizing the person is the fit
    marking its own homework.

    Rotation and translation are then the Procrustes solution at that fixed
    scale, over the four anchor midpoints.
    """
    before = analysis.anchor_points(before_landmarks)
    after = analysis.anchor_points(after_landmarks)

    before_height = analysis.body_height_px(before_landmarks)
    after_height = analysis.body_height_px(after_landmarks)
    if before_height <= 0 or after_height <= 0:
        raise analysis.PoseNotDetected("inverted_pose")
    scale = before_height / after_height

    before_centroid = before.mean(axis=0)
    after_centroid = after.mean(axis=0)
    before_centered = before - before_centroid
    after_centered = after - after_centroid

    # Orthogonal Procrustes: the rotation minimising |before - s*R*after|.
    # det() correction keeps R a rotation rather than a reflection - a
    # reflection would silently mirror the body and align a left shoulder to a
    # right one, which reads as a near-perfect fit on a symmetric pose.
    u, _, vt = np.linalg.svd(after_centered.T @ before_centered)
    d = np.sign(np.linalg.det(u @ vt))
    rotation = (u @ np.diag([1.0, d]) @ vt).T

    linear = scale * rotation
    translation = before_centroid - linear @ after_centroid
    matrix = np.hstack([linear, translation.reshape(2, 1)])

    warped = (linear @ after.T).T + translation
    errors = np.linalg.norm(warped - before, axis=1)
    residual = float(np.sqrt(np.mean(errors**2)))
    return Alignment(
        matrix=matrix,
        residual=residual,
        residual_norm=residual / before_height,
        scale=float(scale),
    )


def warp(image: np.ndarray, alignment: Alignment, size: tuple[int, int]) -> np.ndarray:
    """Apply the transform. `size` is (width, height) of the before frame."""
    return cv2.warpAffine(
        image,
        alignment.matrix.astype(np.float32),
        size,
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0),
    )


def match_background_exposure(
    after_rgb: np.ndarray,
    after_mask: np.ndarray,
    before_rgb: np.ndarray,
    before_mask: np.ndarray,
) -> np.ndarray:
    """Correct the after photo's exposure to the before photo's, fitted on
    BACKGROUND pixels only (blueprint III.7).

    Fitting on the whole frame is the trap: the body is most of the frame, so
    whole-frame histogram matching pushes the after body's tones onto the
    before body's and erases the very change being measured. The wall behind
    the person did not change between the two shoots, so the wall is what says
    how the light differed.

    The fit is a per-channel gain and offset over matched background
    QUANTILES, not the nonparametric histogram match the blueprint first
    reached for. A histogram LUT is only defined across the tones the
    background actually contains: a wall spanning 78..102 leaves every skin
    pixel above it pinned to the value 102, which does not correct the body so
    much as delete it. A line through the quantile pairs extrapolates past the
    wall's own range, which is exactly what applying a wall's correction to a
    body requires.

    Returns the after photo unchanged when the background is too small or too
    flat to fit on - a correction estimated from a handful of pixels, or from
    a single tone, is worse than none, and the exposure delta in the verdict
    still reports the difference either way.
    """
    after_background = after_mask < 0.5
    before_background = before_mask < 0.5
    min_pixels = 0.02 * after_mask.size
    if after_background.sum() < min_pixels or before_background.sum() < min_pixels:
        return after_rgb

    quantiles = np.linspace(0.05, 0.95, 19)
    corrected = np.empty_like(after_rgb)
    for channel in range(3):
        source = after_rgb[..., channel][after_background].astype(np.float64)
        reference = before_rgb[..., channel][before_background].astype(np.float64)
        source_q = np.quantile(source, quantiles)
        reference_q = np.quantile(reference, quantiles)
        spread = source_q[-1] - source_q[0]
        if spread < MIN_BACKGROUND_SPREAD:
            # One tone says how bright the wall is, not how its tones map.
            return after_rgb
        gain, offset = np.polyfit(source_q, reference_q, 1)
        # A wildly non-linear or degenerate fit means the two backgrounds are
        # not the same wall, which is a comparability problem rather than
        # something to correct away.
        if not (MIN_GAIN <= gain <= MAX_GAIN):
            return after_rgb
        corrected[..., channel] = np.clip(
            after_rgb[..., channel].astype(np.float64) * gain + offset, 0, 255
        ).astype(np.uint8)
    return corrected
