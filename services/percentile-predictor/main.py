"""Percentile predictor — Doc 4 §2.4.

Pre-publish, every draft gets a predicted percentile. The approver sees this
before deciding ("Predicted to land in the 73rd percentile, ±15"). Workspaces
can configure a hard gate: predicted < threshold → auto-deny.

Two layers, locked Phase A.3:
  1. LightGBM gradient-boosted model trained per workspace on
     (features, achieved_percentile) pairs. Features: draft embedding,
     time-of-day, day-of-week, hashtag set, length, has_media, voice_score,
     claim count, sentiment.
  2. Calibration tracker — actual-vs-predicted residuals stored per
     workspace; recalibration triggers retraining when error grows.

Acceptance (Doc 4): ±15 percentile points 80% of the time, visible on every
draft. Calibration is the load-bearing metric — if drift exceeds threshold,
workspace gets a retraining trigger.

Phase A.3 ships the FastAPI shell with stub mode — every prediction returns
50 ± 15 with low confidence. Real LightGBM training + inference lands when
a workspace has accumulated enough (~50) historical (draft, percentile) pairs.

Mounted at port 8007. Health check consumed by docker-compose.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal
from uuid import uuid4

import structlog
from fastapi import FastAPI
from pydantic import BaseModel, Field

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log.info("startup", service="percentile-predictor")
    yield
    log.info("shutdown", service="percentile-predictor")


app = FastAPI(
    title="clipstack/percentile-predictor",
    version="0.1.0",
    description="Pre-publish predicted-percentile gate. Doc 4 §2.4.",
    lifespan=lifespan,
)


# ─── Schemas ───────────────────────────────────────────────────────────────


Channel = Literal["x", "linkedin", "reddit", "tiktok", "instagram", "newsletter", "blog"]


class DraftFeatures(BaseModel):
    """Subset of features the model uses. The producer is responsible for
    populating fields the model expects; missing fields fall back to per-
    workspace defaults at training time."""

    text: str = Field(..., min_length=1, max_length=200_000)
    channel: Channel
    scheduled_for: str | None = None  # ISO-8601; affects time-of-day + day-of-week
    hashtags: list[str] = Field(default_factory=list)
    has_media: bool = False
    voice_score: float | None = Field(default=None, ge=0.0, le=1.0)
    claim_count: int = Field(0, ge=0)
    word_count: int | None = Field(default=None, ge=0)


class PredictRequest(BaseModel):
    company_id: str
    client_id: str | None = None
    features: DraftFeatures
    # Optional: predicted percentile is workspace-relative. Pass the KPI to
    # predict on; defaults to engagement_rate (matches USP 1's default).
    kpi: Literal["ctr", "engagement_rate", "conversion_rate"] = "engagement_rate"


class FeatureContribution(BaseModel):
    feature: str
    # SHAP or feature_importance value, signed (positive = pushed prediction up)
    contribution: float


class PredictResponse(BaseModel):
    request_id: str
    predicted_percentile: float = Field(..., ge=0.0, le=100.0)
    confidence_low: float = Field(..., ge=0.0, le=100.0)
    confidence_high: float = Field(..., ge=0.0, le=100.0)
    confidence_interval: float = Field(..., description="High - low")
    top_features: list[FeatureContribution] = Field(default_factory=list)
    model_version: str
    skipped: bool = True


class TrainSample(BaseModel):
    features: DraftFeatures
    achieved_percentile: float = Field(..., ge=0.0, le=100.0)
    achieved_at: str  # ISO-8601


class TrainRequest(BaseModel):
    company_id: str
    client_id: str | None = None
    kpi: Literal["ctr", "engagement_rate", "conversion_rate"] = "engagement_rate"
    samples: list[TrainSample] = Field(..., min_length=1)


class TrainResponse(BaseModel):
    request_id: str
    company_id: str
    sample_count: int
    trained_at: str | None = None
    model_version: str | None = None
    skipped: bool = True


class CalibrationResponse(BaseModel):
    company_id: str
    sample_count: int
    mean_absolute_error: float | None = None
    within_15_pct_rate: float | None = None
    last_retrained_at: str | None = None
    drift_detected: bool = False


# ─── Endpoints ─────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "percentile-predictor", "version": "0.1.0"}


@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest) -> PredictResponse:
    """Predict the percentile a draft would land at if published now.

    Phase A.3 stub: returns predicted_percentile=50 with ±15 confidence band
    and skipped=true. Mission Control should surface this as 'predictor not
    ready — workspace needs ~50 historical posts to train' rather than
    treating it as a confident 50.
    """
    request_id = str(uuid4())
    log.info(
        "predictor.predict",
        request_id=request_id,
        company_id=req.company_id,
        kpi=req.kpi,
        word_count=req.features.word_count or len(req.features.text.split()),
    )

    if os.getenv("PREDICTOR_STUB_MODE", "1") == "1":
        return PredictResponse(
            request_id=request_id,
            predicted_percentile=50.0,
            confidence_low=35.0,
            confidence_high=65.0,
            confidence_interval=30.0,
            top_features=[],
            model_version="stub-0.1.0",
            skipped=True,
        )

    # A.3 follow-up: load workspace-specific LightGBM model from
    # /data/predictors/{company_id}-{kpi}.lgb, run inference with engineered
    # features, return point estimate + 5th/95th percentile bands from the
    # quantile-regression model variants.
    raise NotImplementedError("LightGBM backend wired in a follow-up A.3 slice")


@app.post("/train", response_model=TrainResponse)
async def train(req: TrainRequest) -> TrainResponse:
    """Train (or retrain) a workspace's predictor from labelled samples.

    Triggered on:
      - Initial bootstrap when first ~50 historical posts exist
      - Weekly retrain (cron)
      - On-demand when calibration drift exceeds threshold
      - When the workspace's voice corpus changes materially
    """
    request_id = str(uuid4())
    log.info(
        "predictor.train",
        request_id=request_id,
        company_id=req.company_id,
        kpi=req.kpi,
        sample_count=len(req.samples),
    )
    return TrainResponse(
        request_id=request_id,
        company_id=req.company_id,
        sample_count=len(req.samples),
        trained_at=None,
        model_version=None,
        skipped=True,
    )


@app.get("/calibration/{company_id}", response_model=CalibrationResponse)
async def calibration(company_id: str) -> CalibrationResponse:
    """Return calibration stats for the workspace's current model."""
    return CalibrationResponse(
        company_id=company_id,
        sample_count=0,
        mean_absolute_error=None,
        within_15_pct_rate=None,
        last_retrained_at=None,
        drift_detected=False,
    )
