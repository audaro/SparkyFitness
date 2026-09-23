"""Alignment: what it is allowed to correct, and what it must leave alone."""

from __future__ import annotations

import numpy as np
import pytest
from conftest import build_figure, flat_image, textured

import alignment
import analysis


def rotate_landmarks(landmarks: np.ndarray, degrees: float, scale: float = 1.0,
                     shift=(0.0, 0.0)) -> np.ndarray:
    theta = np.radians(degrees)
    rotation = scale * np.array(
        [[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]]
    )
    moved = landmarks.copy()
    moved[:, :2] = (rotation @ landmarks[:, :2].T).T + np.array(shift)
    return moved


def test_recovers_a_camera_that_moved():
    """Rotated, moved and taken from a different distance is the SAME photo."""
    _, before = build_figure()
    after = rotate_landmarks(before, degrees=6.0, scale=1.15, shift=(40.0, -25.0))

    fit = alignment.similarity_from_height(before, after)

    assert fit.residual_norm < 1e-6
    assert fit.scale == pytest.approx(1 / 1.15, rel=1e-6)


def test_leaning_cannot_be_fitted_away():
    """A body that changed shape between the shots is not a moved camera.

    Shifting the hips sideways is a lean: no rotation, scale or translation
    maps it onto the original, so it has to survive as residual. This is the
    number the comparability verdict is built on, and a fit that could absorb
    it would report every awkward retake as comparable.
    """
    _, before = build_figure()
    after = before.copy()
    after[[analysis.LEFT_HIP, analysis.RIGHT_HIP], 0] += 60

    fit = alignment.similarity_from_height(before, after)

    assert fit.residual_norm > 0.02


def test_a_narrower_waist_survives_alignment():
    """The property the whole design turns on.

    Align a figure against a version of itself with a 10% narrower waist. The
    alignment must move the body without reshaping it, so the waist difference
    has to be just as visible afterwards. An affine or a homography fit here
    would be free to squeeze x and report the change away - or, run the other
    direction, to invent one.
    """
    before_mask, before_landmarks = build_figure(waist_px=120)
    after_mask, after_landmarks = build_figure(waist_px=108)

    fit = alignment.similarity_from_height(before_landmarks, after_landmarks)
    warped_mask = alignment.warp(
        after_mask, fit, (before_mask.shape[1], before_mask.shape[0])
    )

    before_metrics = analysis.derive_metrics(
        before_landmarks, before_mask, flat_image(before_mask)
    )
    warped_metrics = analysis.derive_metrics(
        before_landmarks, warped_mask, flat_image(warped_mask)
    )

    change = (
        warped_metrics["widths_px"]["waist"] / before_metrics["widths_px"]["waist"] - 1
    )
    assert change == pytest.approx(-0.10, abs=0.02)


def test_a_mirrored_body_is_not_a_good_fit():
    """Procrustes without the determinant correction would accept a reflection.

    On a roughly symmetric standing pose a mirror fits almost perfectly, so the
    pair would read as comparable while the left side had been aligned to the
    right one.
    """
    _, before = build_figure()
    # A body that is not left-right symmetric, so mirroring it is a real error
    # and not a no-op: one shoulder forward and the opposite hip out.
    before[analysis.LEFT_SHOULDER, 0] -= 90
    before[analysis.RIGHT_HIP, 0] += 70

    mirrored = before.copy()
    mirrored[:, 0] = 600 - mirrored[:, 0]

    honest = alignment.similarity_from_height(before, before.copy())
    fit = alignment.similarity_from_height(before, mirrored)

    # The fit is a rotation, never a reflection: a negative determinant is the
    # mirror being accepted as a good fit.
    assert np.linalg.det(fit.matrix[:, :2]) > 0
    assert honest.residual_norm < 1e-9
    assert fit.residual_norm > 0.02


def test_exposure_is_corrected_from_the_wall():
    before_mask, _ = build_figure()
    # A real wall is never one flat tone, and the fit needs a spread to map:
    # see test_a_perfectly_flat_background_is_left_alone for the degenerate
    # case this noise stands in for.
    before = textured(flat_image(before_mask, body=(150, 130, 120), background=(90, 90, 95)))
    # The same scene shot brighter: the wall AND the body came out lighter.
    after = textured(flat_image(before_mask, body=(190, 170, 160), background=(140, 140, 145)))

    corrected = alignment.match_background_exposure(
        after, before_mask, before, before_mask
    )

    wall = before_mask < 0.5
    assert corrected[..., 0][wall].mean() == pytest.approx(
        before[..., 0][wall].mean(), abs=6
    )


def test_exposure_correction_does_not_erase_the_body():
    """Fitted on the background, so a body that genuinely changed still has.

    Whole-frame histogram matching would push the after body's tones onto the
    before body's and delete the signal; this asserts it does not.
    """
    mask, _ = build_figure()
    before = textured(flat_image(mask, body=(120, 100, 95), background=(90, 90, 95)))
    after = textured(flat_image(mask, body=(200, 180, 170), background=(90, 90, 95)))

    corrected = alignment.match_background_exposure(after, mask, before, mask)

    body = mask >= 0.5
    assert corrected[..., 0][body].mean() > before[..., 0][body].mean() + 40


def test_a_perfectly_flat_background_is_left_alone():
    """One tone says how bright the wall is, not how the tones map.

    A single value cannot be interpolated into a curve, and guessing a
    constant offset from it would be wrong wherever the frame is clipped. The
    exposure delta still reports the difference; only the correction declines.
    """
    mask, _ = build_figure()
    before = flat_image(mask, body=(150, 130, 120), background=(90, 90, 95))
    after = flat_image(mask, body=(190, 170, 160), background=(140, 140, 145))

    corrected = alignment.match_background_exposure(after, mask, before, mask)

    assert np.array_equal(corrected, after)


def test_too_little_background_is_left_alone():
    mask = np.ones((900, 600), dtype=np.float32)
    before = flat_image(mask, body=(150, 130, 120))
    after = flat_image(mask, body=(190, 170, 160))

    corrected = alignment.match_background_exposure(after, mask, before, mask)

    assert np.array_equal(corrected, after)
