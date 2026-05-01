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

Real backend (sprint-close+): LightGBM + numpy under the optional `ml`
extra. Model artefacts persist to PREDICTOR_DATA_DIR (default /data/predictors)
keyed by company × kpi. Heavy imports are lazy so the lint/CI matrix stays
small (the [ml] extra is only installed in the Dockerfile, not by `uv sync
--extra dev`).

Fail-soft semantics:
  - Workspace has no trained model → return predicted=50, ±25 (wide band),
    skipped=true. Mission Control surfaces this as "predictor not ready"
    rather than a confident 50.
  - LightGBM not installed → 500 with a clear "rebuild image with [ml]
    extra" error. Distinguishes config bug from missing-data state.
  - Sample count < MIN_TRAIN → 400 with the threshold in the message.

Mounted at port 8007. Health check consumed by docker-compose.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

import structlog
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from features import FEATURE_NAMES, featurise

log = structlog.get_logger()


def _is_production() -> bool:
    return (
        os.getenv("ENVIRONMENT", "").lower() == "production"
        or os.getenv("NODE_ENV", "").lower() == "production"
    )


def _stub_mode_default() -> str:
    """Dev/test: '1' (stub on — service runs without LightGBM trained).
    Production: '0' (stub off — a forgotten-to-wire deployment fails loudly
    rather than silently returning predicted=50 ±15 on every request)."""
    return "0" if _is_production() else "1"


STUB_MODE: bool = os.getenv("PREDICTOR_STUB_MODE", _stub_mode_default()) == "1"
DATA_DIR = Path(os.getenv("PREDICTOR_DATA_DIR", "/data/predictors"))
MIN_TRAIN_SAMPLES = int(os.getenv("PREDICTOR_MIN_TRAIN_SAMPLES", "30"))
MODEL_VERSION_TAG = "lgbm-v1"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    log.info(
        "startup",
        service="percentile-predictor",
        stub_mode=STUB_MODE,
        data_dir=str(DATA_DIR),
        min_train_samples=MIN_TRAIN_SAMPLES,
        environment=os.getenv("ENVIRONMENT") or os.getenv("NODE_ENV") or "development",
    )
    if STUB_MODE and _is_production():
        log.warning(
            "stub_mode_active_in_production",
            service="percentile-predictor",
            message=(
                "PREDICTOR_STUB_MODE=1 in production. /predict returns 50 ±15 "
                "for every draft. Approval-UI should surface 'predictor not "
                "ready' rather than as confident 50. Wire LightGBM or unset "
                "PREDICTOR_STUB_MODE."
            ),
        )
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


# ─── Persistence ───────────────────────────────────────────────────────────


def _model_path(company_id: str, kpi: str) -> Path:
    """One model artefact per (company, kpi). Path is deterministic so a
    workspace's model can be hot-swapped by writing a new file + atomically
    renaming, without service restart."""
    return DATA_DIR / f"{company_id}-{kpi}.lgb"


def _meta_path(company_id: str, kpi: str) -> Path:
    return DATA_DIR / f"{company_id}-{kpi}.meta.json"


def _calib_path(company_id: str, kpi: str) -> Path:
    """Append-only JSONL of (predicted, actual, ts) tuples. /calibration
    walks this file to compute MAE + drift. Workspaces that hit volume
    can rotate this externally; the service tolerates rotation gracefully
    by treating a missing file as 'no calibration data yet'."""
    return DATA_DIR / f"{company_id}-{kpi}.calibration.jsonl"


def _save_meta(path: Path, meta: dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(meta, sort_keys=True, indent=2))
    tmp.replace(path)


def _load_meta(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        log.warning("meta.read_failed", path=str(path), error=str(e))
        return None


# ─── ML helpers (lazy imports) ─────────────────────────────────────────────


def _require_lightgbm() -> Any:
    """Lazy-import lightgbm. The [ml] extra is only installed in the Docker
    image; CI lint runs without it. Surface a clear error if a non-stub
    request lands without the dep installed."""
    try:
        import lightgbm  # type: ignore[import-not-found]
        return lightgbm
    except ImportError as e:
        raise HTTPException(
            status_code=500,
            detail=(
                "LightGBM not installed. Rebuild the percentile-predictor "
                "image with `uv pip install --system .[ml]` or set "
                "PREDICTOR_STUB_MODE=1 if you only need the stub."
            ),
        ) from e


def _require_numpy() -> Any:
    try:
        import numpy  # type: ignore[import-not-found]
        return numpy
    except ImportError as e:
        raise HTTPException(
            status_code=500,
            detail=(
                "NumPy not installed. Rebuild the percentile-predictor "
                "image with `uv pip install --system .[ml]`."
            ),
        ) from e


def _train_model(
    samples: list[dict[str, Any]],
) -> tuple[Any, dict[str, Any]]:
    """Fit a LightGBM regressor. Returns (booster, meta)."""
    lgb = _require_lightgbm()
    np = _require_numpy()

    if len(samples) < MIN_TRAIN_SAMPLES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Need at least {MIN_TRAIN_SAMPLES} samples to train; "
                f"got {len(samples)}. Use stub mode while bootstrapping "
                "or wait until more historical posts have landed."
            ),
        )

    # `X` is the standard sklearn-style name for a feature matrix; we keep
    # the convention rather than dropping to lowercase. Ruff N806 is the
    # only case-style rule that flags this — silence locally.
    X = np.array(  # noqa: N806
        [featurise(s["features"]) for s in samples],
        dtype=np.float64,
    )
    y = np.array([float(s["achieved_percentile"]) for s in samples], dtype=np.float64)

    # 80/20 split — chronological ordering would be ideal but the
    # scheduler doesn't guarantee it; random split is robust enough at
    # the small N we typically see here. As N grows, swap to a
    # time-based split via a follow-up.
    rng = np.random.default_rng(42)
    n = len(samples)
    val_n = max(1, n // 5)
    perm = rng.permutation(n)
    val_idx = perm[:val_n]
    train_idx = perm[val_n:]

    train_set = lgb.Dataset(X[train_idx], label=y[train_idx])
    val_set = lgb.Dataset(X[val_idx], label=y[val_idx], reference=train_set)

    # Hand-tuned starter hyperparameters. Doc 4 acceptance is ±15 pct
    # 80% of the time — these defaults clear that bar on synthetic data
    # at N≈50; a follow-up adds per-workspace hyperparameter search once
    # we see real workloads.
    params = {
        "objective": "regression",
        "metric": "mae",
        "learning_rate": 0.05,
        "num_leaves": 31,
        "min_data_in_leaf": max(1, len(train_idx) // 10),
        "feature_fraction": 0.9,
        "bagging_fraction": 0.9,
        "bagging_freq": 5,
        "verbose": -1,
    }

    booster = lgb.train(
        params,
        train_set,
        num_boost_round=200,
        valid_sets=[val_set],
        callbacks=[lgb.early_stopping(stopping_rounds=20, verbose=False)],
    )

    val_preds = booster.predict(X[val_idx])
    val_residuals = np.abs(val_preds - y[val_idx])
    val_mae = float(np.mean(val_residuals))
    within_15 = float(np.mean(val_residuals <= 15.0))

    meta: dict[str, Any] = {
        "model_version": MODEL_VERSION_TAG,
        "trained_at": datetime.now(UTC).isoformat(),
        "sample_count": n,
        "validation_mae": val_mae,
        "validation_within_15_pct_rate": within_15,
        "feature_names": list(FEATURE_NAMES),
        "best_iteration": booster.best_iteration,
    }
    return booster, meta


def _load_booster(path: Path) -> Any:
    """Load the LGBM booster. Raises HTTPException on failure so the route
    surfaces a clean 500 rather than crashing."""
    lgb = _require_lightgbm()
    try:
        return lgb.Booster(model_file=str(path))
    except (OSError, lgb.basic.LightGBMError) as e:
        log.error("model.load_failed", path=str(path), error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load model {path.name}; retrain may be needed.",
        ) from e


# ─── Endpoints ─────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "percentile-predictor", "version": "0.1.0"}


@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest) -> PredictResponse:
    """Predict the percentile a draft would land at if published now."""
    request_id = str(uuid4())
    log.info(
        "predictor.predict",
        request_id=request_id,
        company_id=req.company_id,
        kpi=req.kpi,
        word_count=req.features.word_count or len(req.features.text.split()),
    )

    if STUB_MODE:
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

    model_path = _model_path(req.company_id, req.kpi)
    meta_path = _meta_path(req.company_id, req.kpi)

    if not model_path.exists():
        # Untrained workspace — fail-soft with a wide band so the UI can
        # render "predictor not ready". Confidence interval is bumped to
        # ±25 so this state is visually distinct from a real prediction.
        log.info(
            "predict.untrained",
            request_id=request_id,
            company_id=req.company_id,
            kpi=req.kpi,
        )
        return PredictResponse(
            request_id=request_id,
            predicted_percentile=50.0,
            confidence_low=25.0,
            confidence_high=75.0,
            confidence_interval=50.0,
            top_features=[],
            model_version=f"untrained-{MODEL_VERSION_TAG}",
            skipped=True,
        )

    booster = _load_booster(model_path)
    meta = _load_meta(meta_path) or {}
    saved_features = meta.get("feature_names")
    if saved_features and saved_features != list(FEATURE_NAMES):
        # Feature schema drift — refuse to predict rather than emit
        # garbage from a misaligned vector. Operator must retrain.
        raise HTTPException(
            status_code=500,
            detail=(
                "Model feature schema is out of sync with current code. "
                "Retrain this workspace's model before serving predictions."
            ),
        )

    np = _require_numpy()
    feat_vec = np.array([featurise(req.features.model_dump())], dtype=np.float64)
    point = float(booster.predict(feat_vec)[0])
    point = max(0.0, min(100.0, point))

    # Confidence band = ±MAE_validation, clamped to [0, 100]. This is a
    # global symmetric band; per-prediction quantile bands land in a
    # follow-up via the quantile-regression model variant.
    val_mae = float(meta.get("validation_mae") or 15.0)
    low = max(0.0, point - val_mae)
    high = min(100.0, point + val_mae)

    # Top features by gain importance. Sign is implicit — gradient-boosted
    # trees don't have a global sign per feature; we report magnitude only
    # (the API's `contribution` field is signed but we leave it positive
    # here because the gain is monotonic in absolute model influence).
    importances = booster.feature_importance(importance_type="gain")
    feat_imp = sorted(
        zip(FEATURE_NAMES, importances, strict=False),
        key=lambda t: t[1],
        reverse=True,
    )[:5]
    top = [
        FeatureContribution(feature=name, contribution=float(score))
        for name, score in feat_imp
        if score > 0
    ]

    return PredictResponse(
        request_id=request_id,
        predicted_percentile=point,
        confidence_low=low,
        confidence_high=high,
        confidence_interval=high - low,
        top_features=top,
        model_version=str(meta.get("model_version", MODEL_VERSION_TAG)),
        skipped=False,
    )


@app.post("/train", response_model=TrainResponse)
async def train(req: TrainRequest) -> TrainResponse:
    """Train (or retrain) a workspace's predictor from labelled samples."""
    request_id = str(uuid4())
    log.info(
        "predictor.train",
        request_id=request_id,
        company_id=req.company_id,
        kpi=req.kpi,
        sample_count=len(req.samples),
    )

    if STUB_MODE:
        return TrainResponse(
            request_id=request_id,
            company_id=req.company_id,
            sample_count=len(req.samples),
            trained_at=None,
            model_version=None,
            skipped=True,
        )

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    samples = [
        {
            "features": s.features.model_dump(),
            "achieved_percentile": s.achieved_percentile,
        }
        for s in req.samples
    ]
    booster, meta = _train_model(samples)

    model_path = _model_path(req.company_id, req.kpi)
    meta_path = _meta_path(req.company_id, req.kpi)
    # Write to .tmp + atomic replace so /predict never sees a half-written
    # model file under concurrent train + predict.
    tmp_model = model_path.with_suffix(model_path.suffix + ".tmp")
    booster.save_model(str(tmp_model))
    tmp_model.replace(model_path)
    _save_meta(meta_path, meta)

    log.info(
        "predictor.trained",
        request_id=request_id,
        company_id=req.company_id,
        kpi=req.kpi,
        validation_mae=meta["validation_mae"],
        within_15_pct_rate=meta["validation_within_15_pct_rate"],
    )

    return TrainResponse(
        request_id=request_id,
        company_id=req.company_id,
        sample_count=len(req.samples),
        trained_at=meta["trained_at"],
        model_version=meta["model_version"],
        skipped=False,
    )


@app.get("/calibration/{company_id}", response_model=CalibrationResponse)
async def calibration(
    company_id: str,
    kpi: Literal["ctr", "engagement_rate", "conversion_rate"] = "engagement_rate",
) -> CalibrationResponse:
    """Return calibration stats for the workspace's current model.

    Walks the .calibration.jsonl sidecar (each row = predicted, actual, ts)
    and computes MAE + within-15% rate. Drift triggers when current MAE >
    2x training MAE — coarse but actionable for "is this model still good?"
    """
    meta = _load_meta(_meta_path(company_id, kpi)) or {}
    calib_path = _calib_path(company_id, kpi)

    if not calib_path.exists():
        return CalibrationResponse(
            company_id=company_id,
            sample_count=0,
            mean_absolute_error=None,
            within_15_pct_rate=None,
            last_retrained_at=meta.get("trained_at"),
            drift_detected=False,
        )

    residuals: list[float] = []
    try:
        with calib_path.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                pred = row.get("predicted")
                actual = row.get("actual")
                if pred is None or actual is None:
                    continue
                residuals.append(abs(float(pred) - float(actual)))
    except OSError as e:
        log.warning("calibration.read_failed", path=str(calib_path), error=str(e))

    if not residuals:
        return CalibrationResponse(
            company_id=company_id,
            sample_count=0,
            last_retrained_at=meta.get("trained_at"),
        )

    mae = sum(residuals) / len(residuals)
    within_15 = sum(1 for r in residuals if r <= 15.0) / len(residuals)
    training_mae = float(meta.get("validation_mae") or 15.0)
    drift = mae > (training_mae * 2.0)

    return CalibrationResponse(
        company_id=company_id,
        sample_count=len(residuals),
        mean_absolute_error=mae,
        within_15_pct_rate=within_15,
        last_retrained_at=meta.get("trained_at"),
        drift_detected=drift,
    )
