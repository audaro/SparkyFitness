"""The HTTP surface.

The model is stubbed: these tests are about what the endpoints do with an
answer, not about whether MediaPipe finds a body, which no synthetic image can
exercise honestly.
"""

from __future__ import annotations

import base64
import io

import numpy as np
import pytest
from conftest import build_figure, flat_image, textured
from fastapi.testclient import TestClient
from PIL import Image

import analysis
import main


@pytest.fixture
def client(monkeypatch):
    masks_and_landmarks = {}

    def fake_detect(image_rgb):
        key = int(image_rgb[0, 0, 0])
        if key in masks_and_landmarks:
            return masks_and_landmarks[key]
        raise analysis.PoseNotDetected("pose_not_detected")

    monkeypatch.setattr(analysis, "detect", fake_detect)
    monkeypatch.setattr(analysis, "get_landmarker", lambda: object())
    client = TestClient(main.app)
    client.bodies = masks_and_landmarks  # type: ignore[attr-defined]
    return client


def upload(image: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(image).save(buffer, format="PNG")
    return buffer.getvalue()


def register(client, marker: int, **kwargs) -> bytes:
    """Build a figure, and make the stubbed model return it for this image."""
    mask, landmarks = build_figure(**kwargs)
    image = textured(flat_image(mask))
    image[0, 0] = (marker, marker, marker)
    client.bodies[marker] = (landmarks, mask)
    return upload(image)


def test_health_reports_the_engine(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["engine"] == analysis.ENGINE


def test_analyze_returns_the_metrics_and_the_landmarks(client):
    response = client.post(
        "/analyze", files={"image": ("front.png", register(client, 10), "image/png")}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["widths_px"]["waist"] == pytest.approx(120, abs=2)
    # Cached by the server so a second comparison never re-runs the model.
    assert len(body["landmarks"]) == 33


def test_a_photo_with_no_body_in_it_says_so(client):
    blank = upload(np.full((400, 300, 3), 200, dtype=np.uint8))

    response = client.post("/analyze", files={"image": ("wall.png", blank, "image/png")})

    # 422 rather than 500: the request was fine, the photo was not.
    assert response.status_code == 422
    assert response.json()["detail"] == "pose_not_detected"


def test_compare_reports_the_residual_and_the_exposure(client):
    before = register(client, 10, waist_px=120)
    after = register(client, 20, waist_px=108)

    response = client.post(
        "/compare",
        files={
            "before": ("a.png", before, "image/png"),
            "after": ("b.png", after, "image/png"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["alignment"]["residual_norm"] < 0.01
    assert body["exposure"]["luminance_delta"] == pytest.approx(0, abs=2)
    # Not asked for, so not sent: the images dwarf everything else here.
    assert body["aligned_after_jpeg"] is None


def test_compare_returns_the_aligned_pair_on_request(client):
    before = register(client, 10)
    after = register(client, 20, center_x=340, eye_y=140)

    response = client.post(
        "/compare?include_aligned=true",
        files={
            "before": ("a.png", before, "image/png"),
            "after": ("b.png", after, "image/png"),
        },
    )

    body = response.json()
    aligned = Image.open(
        io.BytesIO(base64.b64decode(body["aligned_after_jpeg"]))
    )
    # Warped into the before photo's frame, so the two can be cross-faded
    # without the client doing any geometry.
    assert aligned.size == (600, 900)


def test_one_unreadable_photo_fails_the_pair(client):
    response = client.post(
        "/compare",
        files={
            "before": ("a.png", register(client, 10), "image/png"),
            "after": ("b.png", b"not an image", "image/png"),
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "unreadable_image"


def test_an_empty_upload_is_refused(client):
    response = client.post(
        "/analyze", files={"image": ("empty.png", b"", "image/png")}
    )

    assert response.status_code == 400
