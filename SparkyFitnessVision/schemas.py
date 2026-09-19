"""The wire contract. Mirrored on the server in
`shared/src/schemas/api/ProgressPhotoComparison.api.zod.ts`.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class BackgroundSummary(BaseModel):
    """Null when the body fills the frame and there is no room to measure."""

    luminance: float | None = None
    chroma: float | None = None


class PhotoMetrics(BaseModel):
    height_px: float
    image_size: list[int]
    widths_px: dict[str, float]
    # Per width stop: whether an arm was inside the row that was measured. A
    # waist measured with the arms hanging against it tracks how the person
    # stood, not their waist, so the consumer decides what to do with it -
    # nothing here silently corrects it.
    arms_overlap: dict[str, bool]
    ratios: dict[str, float | None]
    background: BackgroundSummary
    visibility: dict[str, float]


class AnalyzeResponse(BaseModel):
    engine: str
    metrics: PhotoMetrics
    # (33, 3): x, y in pixels of the analysed frame, then visibility. Returned
    # so the server can cache them and re-run a comparison without re-running
    # the model on photos it has already seen.
    landmarks: list[list[float]]


class AlignmentSummary(BaseModel):
    residual_px: float
    # The residual as a fraction of the before photo's body height. This is the
    # number the comparability verdict is built on; the pixel figure alone
    # means nothing without knowing how big the person was in frame.
    residual_norm: float
    scale: float


class ExposureSummary(BaseModel):
    luminance_delta: float | None = None
    chroma_delta: float | None = None
    # False when the backgrounds were too small or too flat to fit on. The
    # deltas are still reported; only the correction declined.
    corrected: bool


class CompareResponse(BaseModel):
    engine: str
    before: AnalyzeResponse
    after: AnalyzeResponse
    alignment: AlignmentSummary
    exposure: ExposureSummary
    # Base64 JPEG of the after photo warped into the before photo's frame, and
    # of the before photo at the same size, so the two can be cross-faded
    # without the client doing any geometry. Omitted unless asked for: they are
    # by far the largest thing here.
    aligned_before_jpeg: str | None = None
    aligned_after_jpeg: str | None = None


class ErrorResponse(BaseModel):
    """Every failure names itself.

    `reason` is a stable machine token (`pose_not_detected`,
    `landmark_not_visible:ankles`) so the server can map it to a specific piece
    of advice instead of showing the user a stack trace or, worse, a plausible
    number computed from a body it never actually found.
    """

    reason: str
    detail: str = Field(default="")
