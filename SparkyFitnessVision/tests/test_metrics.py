"""The numbers a report is allowed to cite."""

from __future__ import annotations

import numpy as np
import pytest
from conftest import build_figure, flat_image

import analysis


def metrics_for(**kwargs) -> dict:
    mask, landmarks = build_figure(**kwargs)
    return analysis.derive_metrics(landmarks, mask, flat_image(mask))


def test_measures_the_silhouette_at_its_stops():
    metrics = metrics_for(waist_px=120, shoulder_px=200)

    # Within a pixel: the fixture sets these widths at exactly the rows the
    # analysis samples, so anything larger means the sampling drifted.
    assert metrics["widths_px"]["waist"] == pytest.approx(120, abs=2)
    assert metrics["widths_px"]["shoulder"] == pytest.approx(200, abs=2)
    assert metrics["height_px"] == pytest.approx(700, abs=1)


def test_a_ten_percent_narrower_waist_shows_up_as_ten_percent():
    """The blueprint's phase-2 acceptance case.

    A waist 10% narrower against an unchanged frame must move the
    waist:shoulder ratio by 10%, and must not move anything it did not touch.
    """
    before = metrics_for(waist_px=120)
    after = metrics_for(waist_px=108)

    ratio_change = (
        after["ratios"]["waist_shoulder"] / before["ratios"]["waist_shoulder"] - 1
    )
    assert ratio_change == pytest.approx(-0.10, abs=0.01)
    assert after["ratios"]["shoulder_height"] == pytest.approx(
        before["ratios"]["shoulder_height"], rel=0.01
    )


def test_ratios_survive_the_camera_being_closer():
    """Scale-free means scale-free.

    The same body photographed from closer must report the same ratios: this
    is what stops "you stood nearer the lens" reading as growth.
    """
    near = metrics_for(
        waist_px=180, shoulder_px=300, hip_px=225, thigh_px=105,
        eye_y=100, ankle_y=850,
    )
    far = metrics_for(
        waist_px=120, shoulder_px=200, hip_px=150, thigh_px=70,
        eye_y=300, ankle_y=800,
    )

    assert near["height_px"] > far["height_px"] * 1.4
    assert near["ratios"]["waist_shoulder"] == pytest.approx(
        far["ratios"]["waist_shoulder"], rel=0.02
    )


def test_arms_held_clear_of_the_body_do_not_widen_the_waist():
    """A row through the waist also crosses the arms.

    Counting the row's pixels would add both forearms to the waist and report
    a change the moment someone stood differently.
    """
    plain = metrics_for(waist_px=120, arms=False)
    with_arms = metrics_for(waist_px=120, arms=True)

    assert with_arms["widths_px"]["waist"] == pytest.approx(
        plain["widths_px"]["waist"], abs=2
    )


def test_arms_against_the_waist_are_reported_not_hidden():
    """The case a real photo showed and the synthetic figures did not.

    Standing with the arms down puts them inside the waist row, and the
    measurement then tracks how someone held their arms rather than their
    waist. It cannot be separated out of a silhouette, so it is flagged: a
    report can decline to discuss the waist instead of narrating sleeves.
    """
    clear = metrics_for(arms_down=False)
    against = metrics_for(arms_down=True)

    assert clear["arms_overlap"]["waist"] is False
    assert against["arms_overlap"]["waist"] is True
    # Shoulders are measured well above the hands either way.
    assert against["arms_overlap"]["shoulder"] is False


def test_an_unplaced_arm_landmark_does_not_flag_the_row():
    """A landmark the model is not sure about is ignored.

    Trusting a guessed wrist would flag every photo, which would make the flag
    mean nothing.
    """
    mask, landmarks = build_figure(arms_down=True)
    landmarks[[analysis.LEFT_WRIST, analysis.RIGHT_WRIST,
               analysis.LEFT_ELBOW, analysis.RIGHT_ELBOW], 2] = 0.1

    metrics = analysis.derive_metrics(landmarks, mask, flat_image(mask))

    assert metrics["arms_overlap"]["waist"] is False


def test_background_exposure_is_measured_off_the_room_not_the_body():
    mask, landmarks = build_figure()
    dim = flat_image(mask, body=(180, 150, 140), background=(40, 40, 45))
    bright = flat_image(mask, body=(180, 150, 140), background=(200, 200, 205))

    dim_metrics = analysis.derive_metrics(landmarks, mask, dim)
    bright_metrics = analysis.derive_metrics(landmarks, mask, bright)

    assert bright_metrics["background"]["luminance"] > (
        dim_metrics["background"]["luminance"] + 40
    )


def test_a_body_filling_the_frame_reports_no_exposure_rather_than_the_body():
    mask = np.ones((900, 600), dtype=np.float32)
    _, landmarks = build_figure()

    metrics = analysis.derive_metrics(landmarks, mask, flat_image(mask))

    assert metrics["background"]["luminance"] is None


def test_an_upside_down_pose_is_refused_rather_than_measured():
    _, landmarks = build_figure()
    landmarks[[analysis.LEFT_EYE, analysis.RIGHT_EYE], 1] = 900
    landmarks[[analysis.LEFT_ANKLE, analysis.RIGHT_ANKLE], 1] = 100
    mask = np.ones((900, 600), dtype=np.float32)

    with pytest.raises(analysis.PoseNotDetected):
        analysis.derive_metrics(landmarks, mask, flat_image(mask))
