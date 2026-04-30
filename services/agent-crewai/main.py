"""FastAPI entry for the CrewAI service.

Exposes the role-based pipelines from Doc 1 §7.1 over HTTP.
Mounted at port 8001. Health check is consumed by docker-compose.

Phase A.0 deliverable: skeleton + /health green. Crew kickoff returns
a stub trace_id today; concrete crew execution lands in A.2 (USP 1+3+5)
once `retrieve_high_performers` and `voice_score` tools are wired.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncIterator
from uuid import uuid4

import structlog
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from crews.content_factory.crew import build_content_factory_crew
from models import LITELLM_BASE_URL, ensure_litellm_reachable

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log.info("startup", litellm_base_url=LITELLM_BASE_URL)
    # Don't hard-fail on litellm unreachable in dev; warn loudly.
    await ensure_litellm_reachable(strict=False)
    yield
    log.info("shutdown")


app = FastAPI(
    title="clipstack/agent-crewai",
    version="0.1.0",
    description="CrewAI role-based pipelines. Doc 1 §7.1.",
    lifespan=lifespan,
)


class ContentFactoryRequest(BaseModel):
    source_type: str = Field(..., pattern="^(url|transcript|pdf|text)$")
    source_value: str = Field(..., min_length=1)
    platforms: list[str] = Field(default_factory=lambda: ["x", "linkedin"])
    company_id: str
    campaign_id: str | None = None
    tone_override: str | None = None


class CrewKickoffResponse(BaseModel):
    trace_id: str
    crew: str
    status: str  # 'queued' | 'running' | 'complete' | 'error'


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "agent-crewai", "version": "0.1.0"}


@app.get("/crews")
async def list_crews() -> dict[str, list[str]]:
    """Discoverable list. Phase A.0 ships content_factory only.

    Roadmap (Doc 1 §7.x + Doc 4 §2.6–§2.10):
    - content_factory     [A.0]  this skeleton
    - social_listener     [A.3]  single-agent toolbelt
    - weekly_report       [A.3]  data-puller + analyst-writer + editor
    - brand_qa            [A.2]  voice fingerprinting
    - devils_advocate_qa  [A.1]  Doc 5 §1.6
    - engagement          [A.3]  Doc 4 §2.9
    - lifecycle           [A.3]  Doc 4 §2.10
    - trend_detector      [A.3]  brand-safety gated
    - algorithm_probe     [A.3]  Doc 4 §2.6
    - live_event_monitor  [A.3]  Doc 4 §2.8
    """
    return {
        "available": ["content_factory"],
        "planned": [
            "social_listener",
            "weekly_report",
            "brand_qa",
            "devils_advocate_qa",
            "engagement",
            "lifecycle",
            "trend_detector",
            "algorithm_probe",
            "live_event_monitor",
        ],
    }


@app.post("/crews/content_factory/kickoff", response_model=CrewKickoffResponse)
async def kickoff_content_factory(req: ContentFactoryRequest) -> CrewKickoffResponse:
    """Trigger the Phase-1 Content Factory crew (Doc 1 §7.1).

    Phase A.0: returns trace_id with status='queued'. The crew is built but not
    executed in-process yet — execution lands when LiteLLM keys are populated and
    the tool stubs in `tools/` get real implementations (A.2).
    """
    trace_id = str(uuid4())
    log.info(
        "content_factory.kickoff",
        trace_id=trace_id,
        company_id=req.company_id,
        platforms=req.platforms,
    )

    if os.getenv("CREWAI_DRY_RUN", "1") == "1":
        # A.0 default: build the crew object to validate config, don't execute.
        try:
            _ = build_content_factory_crew(
                company_id=req.company_id,
                platforms=req.platforms,
            )
        except Exception as e:  # noqa: BLE001 — surface config errors to caller
            log.error("content_factory.build_failed", trace_id=trace_id, error=str(e))
            raise HTTPException(status_code=500, detail=f"crew build failed: {e}") from e
        return CrewKickoffResponse(trace_id=trace_id, crew="content_factory", status="queued")

    # A.2+: dispatch to a worker (Redpanda topic `crew.kickoff` per Doc 4 §2.2).
    raise HTTPException(status_code=501, detail="live crew execution lands in A.2")
