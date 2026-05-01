"""FastAPI entry for the CrewAI service.

Exposes the role-based pipelines from Doc 1 §7.1 over HTTP.
Mounted at port 8001. Health check is consumed by docker-compose.

Phase A.0 deliverable: skeleton + /health green. A.1 added DevilsAdvocateQA
to content_factory; A.3 (this file's revision) adds 5 real-time crews per
Doc 4 §2.5–§2.10. Crew kickoff returns a stub trace_id today; concrete
execution lands when CREWAI_DRY_RUN=0 + LiteLLM keys populated.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal
from uuid import uuid4

import structlog
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from crews.algorithm_probe.crew import build_algorithm_probe_crew
from crews.content_factory.crew import build_content_factory_crew
from crews.engagement.crew import build_engagement_crew
from crews.lifecycle.crew import build_lifecycle_crew
from crews.live_event_monitor.crew import build_live_event_monitor_crew
from crews.trend_detector.crew import build_trend_detector_crew
from models import LITELLM_BASE_URL, ensure_litellm_reachable

log = structlog.get_logger()

DRY_RUN: bool = os.getenv("CREWAI_DRY_RUN", "1") == "1"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log.info("startup", litellm_base_url=LITELLM_BASE_URL, dry_run=DRY_RUN)
    # Don't hard-fail on litellm unreachable in dev; warn loudly.
    await ensure_litellm_reachable(strict=False)
    yield
    log.info("shutdown")


app = FastAPI(
    title="clipstack/agent-crewai",
    version="0.1.0",
    description="CrewAI role-based pipelines. Doc 1 §7.1 + Doc 4 §2.5-§2.10.",
    lifespan=lifespan,
)


# ─── Common response shape ─────────────────────────────────────────────────


class CrewKickoffResponse(BaseModel):
    trace_id: str
    crew: str
    status: str  # 'queued' | 'running' | 'complete' | 'error'


def _kickoff(crew_name: str, builder, **kwargs) -> CrewKickoffResponse:  # noqa: ANN001
    """Shared dry-run validator. Builds the crew to surface config errors;
    real execution dispatches to a worker once Redpanda is wired."""
    trace_id = str(uuid4())
    log.info(f"{crew_name}.kickoff", trace_id=trace_id, **kwargs)
    if DRY_RUN:
        try:
            _ = builder(**kwargs)
        except Exception as e:  # noqa: BLE001
            log.error(f"{crew_name}.build_failed", trace_id=trace_id, error=str(e))
            raise HTTPException(status_code=500, detail=f"crew build failed: {e}") from e
        return CrewKickoffResponse(trace_id=trace_id, crew=crew_name, status="queued")
    raise HTTPException(status_code=501, detail="live crew execution lands when CREWAI_DRY_RUN=0")


# ─── content_factory ───────────────────────────────────────────────────────


class ContentFactoryRequest(BaseModel):
    source_type: str = Field(..., pattern="^(url|transcript|pdf|text)$")
    source_value: str = Field(..., min_length=1)
    platforms: list[str] = Field(default_factory=lambda: ["x", "linkedin"])
    company_id: str
    campaign_id: str | None = None
    tone_override: str | None = None


@app.post("/crews/content_factory/kickoff", response_model=CrewKickoffResponse)
async def kickoff_content_factory(req: ContentFactoryRequest) -> CrewKickoffResponse:
    """Trigger the Content Factory crew (Doc 1 §7.1)."""
    return _kickoff(
        "content_factory",
        build_content_factory_crew,
        company_id=req.company_id,
        platforms=req.platforms,
    )


# ─── trend_detector (Doc 4 §2.5) ───────────────────────────────────────────


class TrendDetectorRequest(BaseModel):
    company_id: str
    topic_keywords: list[str] = Field(default_factory=list, max_length=50)


@app.post("/crews/trend_detector/kickoff", response_model=CrewKickoffResponse)
async def kickoff_trend_detector(req: TrendDetectorRequest) -> CrewKickoffResponse:
    return _kickoff(
        "trend_detector",
        build_trend_detector_crew,
        company_id=req.company_id,
        topic_keywords=req.topic_keywords,
    )


# ─── algorithm_probe (Doc 4 §2.6) ──────────────────────────────────────────


Platform = Literal["x", "linkedin", "reddit", "tiktok", "instagram"]


class AlgorithmProbeRequest(BaseModel):
    company_id: str
    platform: Platform


@app.post("/crews/algorithm_probe/kickoff", response_model=CrewKickoffResponse)
async def kickoff_algorithm_probe(req: AlgorithmProbeRequest) -> CrewKickoffResponse:
    return _kickoff(
        "algorithm_probe",
        build_algorithm_probe_crew,
        company_id=req.company_id,
        platform=req.platform,
    )


# ─── live_event_monitor (Doc 4 §2.8) ───────────────────────────────────────


class LiveEventMonitorRequest(BaseModel):
    company_id: str


@app.post("/crews/live_event_monitor/kickoff", response_model=CrewKickoffResponse)
async def kickoff_live_event_monitor(req: LiveEventMonitorRequest) -> CrewKickoffResponse:
    return _kickoff(
        "live_event_monitor",
        build_live_event_monitor_crew,
        company_id=req.company_id,
    )


# ─── engagement (Doc 4 §2.9) ───────────────────────────────────────────────


class EngagementRequest(BaseModel):
    company_id: str
    platform: Platform


@app.post("/crews/engagement/kickoff", response_model=CrewKickoffResponse)
async def kickoff_engagement(req: EngagementRequest) -> CrewKickoffResponse:
    return _kickoff(
        "engagement",
        build_engagement_crew,
        company_id=req.company_id,
        platform=req.platform,
    )


# ─── lifecycle (Doc 4 §2.10) ───────────────────────────────────────────────


class LifecycleRequest(BaseModel):
    company_id: str


@app.post("/crews/lifecycle/kickoff", response_model=CrewKickoffResponse)
async def kickoff_lifecycle(req: LifecycleRequest) -> CrewKickoffResponse:
    return _kickoff(
        "lifecycle",
        build_lifecycle_crew,
        company_id=req.company_id,
    )


# ─── Health + discovery ────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "agent-crewai", "version": "0.1.0"}


@app.get("/crews")
async def list_crews() -> dict[str, list[str]]:
    """Discoverable list. A.3 ships 6 of the 10 planned crews live.

    Doc reference matrix:
    - content_factory     [A.0]  Researcher → Strategist → LongFormWriter →
                                  SocialAdapter → NewsletterAdapter →
                                  DevilsAdvocateQA (A.1) → BrandQA
    - trend_detector      [A.3]  Doc 4 §2.5 — brand-safety pre-gated
    - algorithm_probe     [A.3]  Doc 4 §2.6 — least-sensitive workspace probe
    - live_event_monitor  [A.3]  Doc 4 §2.8 — severity × relevance scoring
    - engagement          [A.3]  Doc 4 §2.9 — per-platform reply triage
    - lifecycle           [A.3]  Doc 4 §2.10 — weekly portfolio evaluator
    - social_listener     [A.3+] Doc 1 §7.2 — single-agent feed monitor
    - weekly_report       [A.3+] Doc 1 §7.3 — data-puller + analyst + editor
    - brand_qa (standalone) [A.3+]  separates from content_factory composite
    - competitor_intel    [A.3+] Doc 4 §2.7 — competitor.signal producer
    """
    return {
        "available": [
            "content_factory",
            "trend_detector",
            "algorithm_probe",
            "live_event_monitor",
            "engagement",
            "lifecycle",
        ],
        "planned": [
            "social_listener",
            "weekly_report",
            "brand_qa",
            "competitor_intel",
        ],
    }
