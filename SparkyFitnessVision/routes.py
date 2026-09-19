"""HTTP surface of the vision sidecar.

Stateless by design: photos arrive in the request, numbers leave in the
response, and nothing is written to disk or remembered between calls. These are
photographs of someone's body - the service that looks at them is the last
place that should be keeping copies. Storage, permissions and retention belong
to the main server, which already has the row-level security for them.
"""

from __future__ import annotations

import base64
import io

import cv2
import numpy as np
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from PIL import Image, ImageOps

import alignment
import analysis
from models import ENGINE
from schemas import (
    AlignmentSummary,
    AnalyzeResponse,
    CompareResponse,
    ExposureSummary,
)

router = APIRouter()

# Long edge. Bigger buys no accuracy - the pose model works at 256px internally
# - and costs memory linearly, which matters on the small boxes this is
# self-hosted on.
MAX_EDGE = 1600
# 12 MB, comfortably above the main server's own 10 MB upload limit so this is
# never the thing that rejects a photo the server accepted.
MAX_BYTES = 12 * 1024 * 1024


async def read_image(upload: UploadFile) -> np.ndarray:
    """Decode an upload to RGB, honouring EXIF rotation."""
    raw = await upload.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty_file")
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="file_too_large")
    try:
        image = Image.open(io.BytesIO(raw))
        # A phone writes the sensor's orientation into EXIF rather than
        # rotating the pixels. Skipping this would analyse a person lying on
        # their side, and then reject the pair for a pose that was never wrong.
        image = ImageOps.exif_transpose(image).convert("RGB")
    except Exception as error:  # noqa: BLE001 - any decode failure is one answer
        raise HTTPException(status_code=400, detail="unreadable_image") from error

    array = np.array(image)
    longest = max(array.shape[:2])
    if longest > MAX_EDGE:
        scale = MAX_EDGE / longest
        array = cv2.resize(
            array,
            (int(round(array.shape[1] * scale)), int(round(array.shape[0] * scale))),
            interpolation=cv2.INTER_AREA,
        )
    return array


def to_response(result: analysis.Analysis) -> AnalyzeResponse:
    return AnalyzeResponse(
        engine=result.engine,
        metrics=result.metrics,
        landmarks=result.landmarks.tolist(),
    )


def encode_jpeg(image_rgb: np.ndarray, quality: int = 85) -> str:
    ok, buffer = cv2.imencode(
        ".jpg", cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR),
        [int(cv2.IMWRITE_JPEG_QUALITY), quality],
    )
    if not ok:
        raise HTTPException(status_code=500, detail="encode_failed")
    return base64.b64encode(buffer.tobytes()).decode("ascii")


def run_analysis(image: np.ndarray) -> analysis.Analysis:
    try:
        return analysis.analyze(image)
    except analysis.PoseNotDetected as error:
        # 422, not 500: the request was fine, the photo just does not show a
        # whole body. The reason travels so the user can be told which.
        raise HTTPException(status_code=422, detail=error.reason) from error


@router.get("/health")
async def health() -> dict:
    """Readiness. Loads the model on the first call so a misconfigured model
    path fails here, in a health check, rather than on someone's first photo.
    """
    analysis.get_landmarker()
    return {"status": "ok", "engine": ENGINE}


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_photo(image: UploadFile = File(...)) -> AnalyzeResponse:
    return to_response(run_analysis(await read_image(image)))


@router.post("/compare", response_model=CompareResponse)
async def compare_photos(
    before: UploadFile = File(...),
    after: UploadFile = File(...),
    include_aligned: bool = Query(
        default=False,
        description="Return the aligned pair as base64 JPEG as well as the numbers.",
    ),
) -> CompareResponse:
    before_image = await read_image(before)
    after_image = await read_image(after)
    before_result = run_analysis(before_image)
    after_result = run_analysis(after_image)

    fit = alignment.similarity_from_height(
        before_result.landmarks, after_result.landmarks
    )

    corrected = alignment.match_background_exposure(
        after_image, after_result.mask, before_image, before_result.mask
    )
    was_corrected = corrected is not after_image

    def delta(key: str) -> float | None:
        first = before_result.metrics["background"][key]
        second = after_result.metrics["background"][key]
        if first is None or second is None:
            return None
        return float(second - first)

    response = CompareResponse(
        engine=ENGINE,
        before=to_response(before_result),
        after=to_response(after_result),
        alignment=AlignmentSummary(
            residual_px=fit.residual,
            residual_norm=fit.residual_norm,
            scale=fit.scale,
        ),
        exposure=ExposureSummary(
            luminance_delta=delta("luminance"),
            chroma_delta=delta("chroma"),
            corrected=was_corrected,
        ),
    )

    if include_aligned:
        frame = (before_image.shape[1], before_image.shape[0])
        response.aligned_before_jpeg = encode_jpeg(before_image)
        response.aligned_after_jpeg = encode_jpeg(
            alignment.warp(corrected, fit, frame)
        )
    return response
