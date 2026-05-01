"""Performance-ingest — Doc 4 §2.2.

Replaces the nightly performance refresh with a streaming pipeline:

  1. Pollers per platform fetch engagement metrics on a tiered cadence:
       first 24h of artefact's life: every 60-300s (rate-limit aware)
       days 1-7:                     every 30 minutes
       day 7+:                       daily
  2. Diff detector computes metric_velocity (rate of change). Spikes flag.
  3. Anomaly detector runs rolling z-score per metric per platform; emits
     content.anomaly events at threshold.
  4. Campaign rollup materialises per-campaign live stats; strategist agent
     reads on every generation.

Acceptance (Doc 4): metric updates land in agent context within 5 minutes
of platform availability.

Phase A.3 ships:
  - FastAPI shell on :8006
  - /ingest endpoint (manual snapshot upload — works without live pollers)
  - /pollers/{platform}/{start,stop} placeholders + /pollers/status
  - /anomaly/scan placeholder
  - /campaigns/{id}/rollup placeholder

Stub mode (env-aware default, same pattern as the other A.3 services):
  dev/test: STUB_MODE on; /ingest logs + no-ops; pollers report inactive.
  prod:     STUB_MODE off by default; calls hit NotImplementedError so a
            forgotten-to-wire deployment fails loudly rather than silently
            dropping every metric snapshot.

Real backend (follow-up slice):
  - aiokafka producer publishes content.metric_update + content.anomaly
  - per-platform pollers (tweepy / praw / linkedin sdk / etc.) emit on cadence
  - rolling z-score anomaly detector with workspace-tunable threshold
  - campaign rollup either reads directly from Postgres post_metrics or
    proxies to approval-ui's read API.

Mounted at port 8006. Health check consumed by docker-compose.
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


def _is_production() -> bool:
    return (
        os.getenv("ENVIRONMENT", "").lower() == "production"
        or os.getenv("NODE_ENV", "").lower() == "production"
    )


def _stub_mode_default() -> str:
    """Dev/test: '1' (stub on — service runs without live pollers + Redpanda).
    Production: '0' (stub off — a forgotten-to-wire deployment fails loudly
    rather than silently dropping every metric snapshot to the floor)."""
    return "0" if _is_production() else "1"


STUB_MODE: bool = os.getenv("INGEST_STUB_MODE", _stub_mode_default()) == "1"

REDPANDA_BROKERS = os.getenv("REDPANDA_BROKERS", "redpanda:9092")
EVENTBUS_ENABLED = os.getenv("EVENTBUS_ENABLED", "false").lower() == "true"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log.info(
        "startup",
        service="performance-ingest",
        stub_mode=STUB_MODE,
        eventbus_enabled=EVENTBUS_ENABLED,
        redpanda_brokers=REDPANDA_BROKERS,
        environment=os.getenv("ENVIRONMENT") or os.getenv("NODE_ENV") or "development",
    )
    if STUB_MODE and _is_production():
        log.warning(
            "stub_mode_active_in_production",
            service="performance-ingest",
            message=(
                "INGEST_STUB_MODE=1 in production. /ingest accepts snapshots "
                "but emits no content.metric_update events; pollers are "
                "inactive. Real-time tier is OFF. Wire pollers + Redpanda "
                "producer or unset INGEST_STUB_MODE."
            ),
        )
    yield
    log.info("shutdown", service="performance-ingest")


app = FastAPI(
    title="clipstack/performance-ingest",
    version="0.1.0",
    description="Per-platform pollers + anomaly detector + campaign rollup. Doc 4 §2.2.",
    lifespan=lifespan,
)


# ─── Schemas ───────────────────────────────────────────────────────────────


Platform = Literal["x", "linkedin", "reddit", "tiktok", "instagram"]
PollerState = Literal["inactive", "running", "rate_limited", "error"]


class MetricSnapshot(BaseModel):
    """One row that lands in post_metrics. Mirrors the SQL columns from
    services/shared/db/migrations/0004_post_metrics.sql so the API consumer
    can write directly without remapping."""

    draft_id: str
    platform: Platform
    snapshot_at: str  # ISO-8601
    impressions: int | None = Field(default=None, ge=0)
    reach: int | None = Field(default=None, ge=0)
    clicks: int | None = Field(default=None, ge=0)
    reactions: int | None = Field(default=None, ge=0)
    comments: int | None = Field(default=None, ge=0)
    shares: int | None = Field(default=None, ge=0)
    saves: int | None = Field(default=None, ge=0)
    conversions: int | None = Field(default=None, ge=0)
    # Pass-through for platform-native fields not modelled above.
    raw: dict[str, object] = Field(default_factory=dict)


class IngestRequest(BaseModel):
    company_id: str
    client_id: str | None = None
    snapshots: list[MetricSnapshot] = Field(..., min_length=1, max_length=1000)
    # Idempotency hint: if the caller passes a stable id and the same id has
    # been seen recently, the service deduplicates rather than re-emitting.
    request_id: str | None = None


class IngestResponse(BaseModel):
    request_id: str
    accepted_count: int
    duplicate_count: int = 0
    # Number of content.metric_update events emitted to Redpanda.
    # 0 in stub mode or when EVENTBUS_ENABLED=false.
    events_emitted: int = 0
    skipped: bool = True


class PollerStatus(BaseModel):
    platform: Platform
    state: PollerState
    last_polled_at: str | None = None
    next_poll_at: str | None = None
    drafts_in_active_window: int = 0  # < 24h old
    drafts_in_warm_window: int = 0    # 24h..7d
    drafts_in_archive_window: int = 0 # > 7d
    rate_limit_reset_at: str | None = None
    last_error: str | None = None


class PollersStatusResponse(BaseModel):
    pollers: list[PollerStatus]
    skipped: bool = True


class AnomalyScanRequest(BaseModel):
    company_id: str
    client_id: str | None = None
    lookback_hours: int = Field(24, gt=0, le=168)
    # Workspace-tunable threshold; default 2.5 standard deviations.
    z_threshold: float = Field(2.5, gt=0)


class AnomalyDetection(BaseModel):
    draft_id: str
    platform: Platform
    metric: str
    z_score: float
    value: float
    rolling_mean: float
    rolling_std: float
    detected_at: str


class AnomalyScanResponse(BaseModel):
    request_id: str
    company_id: str
    lookback_hours: int
    z_threshold: float
    detections: list[AnomalyDetection] = Field(default_factory=list)
    events_emitted: int = 0
    skipped: bool = True


class CampaignRollup(BaseModel):
    campaign_id: str
    snapshot_at: str | None = None
    total_drafts: int = 0
    total_impressions: int = 0
    total_clicks: int = 0
    avg_engagement_rate: float | None = None
    # Per-platform breakdown.
    by_platform: dict[str, dict[str, float]] = Field(default_factory=dict)


# ─── Endpoints ─────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "performance-ingest", "version": "0.1.0"}


@app.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest) -> IngestResponse:
    """Accept a batch of metric snapshots. Real path:
      1. Validate against per-workspace draft_id existence (RLS-safe via API)
      2. Deduplicate against (draft_id, platform, snapshot_at)
      3. Compute velocity vs. previous snapshot
      4. Write to post_metrics
      5. Emit content.metric_update event per accepted snapshot
    """
    request_id = req.request_id or str(uuid4())
    log.info(
        "ingest.request",
        request_id=request_id,
        company_id=req.company_id,
        snapshot_count=len(req.snapshots),
    )

    if STUB_MODE:
        return IngestResponse(
            request_id=request_id,
            accepted_count=len(req.snapshots),
            duplicate_count=0,
            events_emitted=0,
            skipped=True,
        )

    raise NotImplementedError("Pollers + Redpanda producer wired in a follow-up A.3 slice")


@app.get("/pollers/status", response_model=PollersStatusResponse)
async def pollers_status() -> PollersStatusResponse:
    """Read-only view of every platform poller's current state. Mission
    Control's real-time tile reads this every ~30s."""
    if STUB_MODE:
        # Stub: report all pollers inactive — no real cadence is running.
        return PollersStatusResponse(
            pollers=[
                PollerStatus(platform=p, state="inactive")
                for p in ("x", "linkedin", "reddit", "tiktok", "instagram")
            ],
            skipped=True,
        )
    raise NotImplementedError("Live poller wiring lands with the runtime extra")


@app.post("/pollers/{platform}/start")
async def poller_start(platform: Platform) -> dict[str, object]:
    """Start the poller for a platform. Idempotent — calling on a running
    poller is a no-op."""
    log.info("poller.start", platform=platform, stub_mode=STUB_MODE)
    if STUB_MODE:
        return {"platform": platform, "state": "inactive", "skipped": True}
    raise NotImplementedError("Live poller wiring lands with the runtime extra")


@app.post("/pollers/{platform}/stop")
async def poller_stop(platform: Platform) -> dict[str, object]:
    """Stop the poller for a platform. Drafts in flight are allowed to finish
    their current poll window before the service stops scheduling new polls."""
    log.info("poller.stop", platform=platform, stub_mode=STUB_MODE)
    if STUB_MODE:
        return {"platform": platform, "state": "inactive", "skipped": True}
    raise NotImplementedError("Live poller wiring lands with the runtime extra")


@app.post("/anomaly/scan", response_model=AnomalyScanResponse)
async def anomaly_scan(req: AnomalyScanRequest) -> AnomalyScanResponse:
    """Run rolling z-score anomaly detection over recent metric snapshots
    for the workspace. Real path emits content.anomaly events for each
    detection above z_threshold. Phase A.3 stub returns empty.
    """
    request_id = str(uuid4())
    log.info(
        "anomaly.scan",
        request_id=request_id,
        company_id=req.company_id,
        lookback_hours=req.lookback_hours,
        z_threshold=req.z_threshold,
    )
    if STUB_MODE:
        return AnomalyScanResponse(
            request_id=request_id,
            company_id=req.company_id,
            lookback_hours=req.lookback_hours,
            z_threshold=req.z_threshold,
            detections=[],
            events_emitted=0,
            skipped=True,
        )
    raise NotImplementedError("Anomaly detector lands with the runtime extra")


@app.get("/campaigns/{campaign_id}/rollup", response_model=CampaignRollup)
async def campaign_rollup(campaign_id: str) -> CampaignRollup:
    """Read-only campaign-wide aggregation of post_metrics. Strategist
    agents read this on every generation cycle (Doc 4 §2.2 step 4)."""
    if STUB_MODE:
        return CampaignRollup(campaign_id=campaign_id)
    raise NotImplementedError("Campaign rollup wired in a follow-up A.3 slice")
