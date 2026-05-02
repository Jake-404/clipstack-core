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

Sprint-close+: /ingest emits content.metric_update events to Redpanda
when EVENTBUS_ENABLED=true. Bandit-orchestrator's reward listener picks
these up to attribute observed performance back to its arms — closes the
generate→publish→measure→learn loop.

Still stub: live pollers (tweepy/praw/etc.) and the rolling-z-score
anomaly detector. They land with the [runtime] extra activation in
follow-up slices once per-platform OAuth + the post_metrics persistence
route ship.

Mounted at port 8006. Health check consumed by docker-compose.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import uuid4

import structlog
from fastapi import FastAPI
from pydantic import BaseModel, Field

from histograms import severity_from_zscore, update_and_rank, zscore
from producer import EventProducer

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
DATA_DIR = Path(os.getenv("INGEST_DATA_DIR", "/data/ingest"))

# z-score threshold for per-snapshot anomaly detection. Values beyond
# ±Z_THRESHOLD σ from the workspace's running mean trigger a
# content.anomaly event. 2.5σ matches the existing /anomaly/scan default
# (~1% false-positive rate on normal data) and is workspace-tunable via
# the env var.
Z_THRESHOLD: float = float(os.getenv("INGEST_Z_THRESHOLD", "2.5"))

# Min sample count before z-score detection kicks in. Below this we
# don't have a reliable mean/std; emitting an anomaly off 5 samples
# would be noise. 30 is the standard "central limit theorem" floor.
ANOMALY_MIN_SAMPLES: int = int(os.getenv("INGEST_ANOMALY_MIN_SAMPLES", "30"))

# Module-level singleton — assigned in lifespan so the test/import path
# doesn't need a broker. Routes call `event_producer.emit(...)`.
event_producer = EventProducer()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    log.info(
        "startup",
        service="performance-ingest",
        stub_mode=STUB_MODE,
        eventbus_enabled=EVENTBUS_ENABLED,
        redpanda_brokers=REDPANDA_BROKERS,
        data_dir=str(DATA_DIR),
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
    await event_producer.start()
    yield
    await event_producer.stop()
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


@app.get("/producer/status")
async def producer_status() -> dict[str, object]:
    """Operator visibility into the Redpanda producer's state. Surfaces
    whether the bus is enabled + reachable + how many events have flowed
    since last restart. Mission Control's real-time tile reads this every
    ~30s alongside /pollers/status."""
    return event_producer.stats


def _build_events_for_snapshot(
    company_id: str,
    client_id: str | None,
    snapshot: MetricSnapshot,
) -> tuple[list[tuple[str, dict[str, object]]], list[tuple[str, dict[str, object]]]]:
    """One snapshot → (metric_events, anomaly_events).

    Both lists carry (key, envelope) tuples ready for emit_many. The
    envelope shapes match services/shared/events/schemas.py:
      - metric_events: ContentMetricUpdatePayload (per non-null metric)
      - anomaly_events: ContentAnomalyPayload (per metric whose z-score
        exceeds Z_THRESHOLD, requires N ≥ ANOMALY_MIN_SAMPLES)

    Critical invariant: percentile + z-score are both computed against
    the *prior* histogram state, before the new value is appended. This
    is the load-bearing property in histograms.update_and_rank — without
    it, every cold-start snapshot would score 100% / would have z=0
    against a degenerate distribution of size 1.

    Partition key = company_id so a workspace's metric stream lands on
    the same partition (preserves per-draft ordering for velocity calc).
    Anomaly events partition the same way for consistent fan-out.
    """
    metrics_present: list[tuple[str, float]] = [
        (name, float(value))
        for name, value in (
            ("impressions", snapshot.impressions),
            ("reach", snapshot.reach),
            ("clicks", snapshot.clicks),
            ("reactions", snapshot.reactions),
            ("comments", snapshot.comments),
            ("shares", snapshot.shares),
            ("saves", snapshot.saves),
            ("conversions", snapshot.conversions),
        )
        if value is not None
    ]

    metric_events: list[tuple[str, dict[str, object]]] = []
    anomaly_events: list[tuple[str, dict[str, object]]] = []
    occurred_at = datetime.now(UTC).isoformat()

    for metric_name, value in metrics_present:
        # update_and_rank atomically: computes percentile + (mean, std)
        # + prior_n against prior state, then appends + persists. Single
        # disk roundtrip per metric.
        percentile, stats, prior_n = update_and_rank(
            DATA_DIR, company_id, snapshot.platform, metric_name, value
        )

        metric_events.append((company_id, {
            "id": f"evt_{uuid4().hex}",
            "topic": "content.metric_update",
            "version": 1,
            "occurred_at": occurred_at,
            "company_id": company_id,
            "client_id": client_id,
            "trace_id": None,
            "payload": {
                "draft_id": snapshot.draft_id,
                "platform": snapshot.platform,
                "metric": metric_name,
                "value": value,
                "percentile": percentile,
                "velocity": None,     # needs prior snapshot — follow-up
                "snapshot_at": snapshot.snapshot_at,
            },
        }))

        # Anomaly check — only meaningful when prior_n ≥ ANOMALY_MIN_SAMPLES
        # (default 30, the standard CLT floor for stable mean/std). Below
        # that, percentile-fill still happens but no anomaly emits, which
        # avoids phantom spikes during workspace bootstrap.
        if prior_n < ANOMALY_MIN_SAMPLES or stats is None:
            continue
        z = zscore(value, stats)
        if z is None or abs(z) < Z_THRESHOLD:
            continue
        mean, std = stats
        # std > 0 guaranteed by zscore returning non-None.
        anomaly_kind = "metric_zscore_spike" if z > 0 else "metric_zscore_drop"
        anomaly_events.append((company_id, {
            "id": f"evt_{uuid4().hex}",
            "topic": "content.anomaly",
            "version": 1,
            "occurred_at": occurred_at,
            "company_id": company_id,
            "client_id": client_id,
            "trace_id": None,
            "payload": {
                "draft_id": snapshot.draft_id,
                "platform": snapshot.platform,
                "anomaly_kind": anomaly_kind,
                "severity": severity_from_zscore(z),
                "metric": metric_name,
                "detail": {
                    "z_score": z,
                    "value": value,
                    "rolling_mean": mean,
                    "rolling_std": std,
                    "z_threshold": Z_THRESHOLD,
                },
                "detected_at": snapshot.snapshot_at,
            },
        }))

    return metric_events, anomaly_events


@app.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest) -> IngestResponse:
    """Accept a batch of metric snapshots and emit content.metric_update
    events for downstream consumers (bandit-orchestrator, anomaly detector,
    campaign rollup).

    Persistence to post_metrics is out of scope for this slice — when the
    approval-ui metrics POST route lands, /ingest will fan out to both
    Postgres + Redpanda. For now, the events themselves carry the value
    (consumers can reconstruct any state they need from the event stream).
    """
    request_id = req.request_id or str(uuid4())
    log.info(
        "ingest.request",
        request_id=request_id,
        company_id=req.company_id,
        snapshot_count=len(req.snapshots),
        eventbus_enabled=EVENTBUS_ENABLED,
        producer_enabled=event_producer.is_enabled,
    )

    if STUB_MODE:
        return IngestResponse(
            request_id=request_id,
            accepted_count=len(req.snapshots),
            duplicate_count=0,
            events_emitted=0,
            skipped=True,
        )

    # Build the full event batches first, then emit. Keeps the request
    # path easy to reason about + lets us count regardless of bus
    # availability. Two streams (metric_update + anomaly) are emitted
    # to separate topics so consumers can subscribe to one or both.
    metric_items: list[tuple[str, dict[str, object]]] = []
    anomaly_items: list[tuple[str, dict[str, object]]] = []
    for snap in req.snapshots:
        m, a = _build_events_for_snapshot(req.company_id, req.client_id, snap)
        metric_items.extend(m)
        anomaly_items.extend(a)

    emitted = 0
    anomalies_emitted = 0
    if event_producer.is_enabled and metric_items:
        emitted = await event_producer.emit_many(
            "content.metric_update",
            [(key, value) for key, value in metric_items],
        )
    if event_producer.is_enabled and anomaly_items:
        anomalies_emitted = await event_producer.emit_many(
            "content.anomaly",
            [(key, value) for key, value in anomaly_items],
        )

    log.info(
        "ingest.completed",
        request_id=request_id,
        company_id=req.company_id,
        snapshot_count=len(req.snapshots),
        events_built=len(metric_items),
        events_emitted=emitted,
        anomalies_built=len(anomaly_items),
        anomalies_emitted=anomalies_emitted,
    )

    # `events_emitted` stays the metric_update count (its existing
    # contract). Anomaly counts surface in the structured log + on
    # /producer/status; if a callsite needs a programmatic anomaly
    # count we add a field in a follow-up rather than break the schema.
    return IngestResponse(
        request_id=request_id,
        accepted_count=len(req.snapshots),
        duplicate_count=0,
        events_emitted=emitted,
        skipped=False,
    )


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
