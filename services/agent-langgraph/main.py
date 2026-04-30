"""FastAPI entry for the LangGraph service.

LangGraph holds the stateful production-critical workflows: publish pipeline,
paid-campaign review, crisis response, bandit orchestrator. CrewAI prototypes
new role-based pipelines; once a workflow needs durable state + human-in-the-
loop checkpoints, it gets promoted here (Doc 1 §3 + Doc 4 §2.3).

Phase A.0 deliverable: skeleton + /health + /workflows/publish_pipeline/start
returning a stub run_id. The graph itself is wired (research-cycle + publish
nodes) but doesn't execute live calls until A.2.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

import structlog
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from workflows.publish_pipeline.graph import build_publish_pipeline

log = structlog.get_logger()

LITELLM_BASE_URL = os.getenv("LITELLM_BASE_URL", "http://litellm:4000")
POSTGRES_URL = os.getenv(
    "POSTGRES_URL",
    "postgresql://clipstack:clipstack@postgres:5432/clipstack",
)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log.info("startup", litellm_base_url=LITELLM_BASE_URL)
    yield
    log.info("shutdown")


app = FastAPI(
    title="clipstack/agent-langgraph",
    version="0.1.0",
    description="Stateful workflows. Doc 1 §3.",
    lifespan=lifespan,
)


class PublishStartRequest(BaseModel):
    company_id: str
    draft_id: str
    channel: str = Field(..., pattern="^(x|linkedin|reddit|tiktok|instagram|newsletter)$")
    scheduled_at: str | None = None  # ISO-8601


class WorkflowStartResponse(BaseModel):
    run_id: str
    workflow: str
    status: str  # 'queued' | 'running' | 'awaiting_approval' | 'complete' | 'error'


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "agent-langgraph", "version": "0.1.0"}


@app.get("/workflows")
async def list_workflows() -> dict[str, list[str]]:
    """Roadmap of stateful workflows (Doc 1 §3 + Doc 4 §2.3).

    - publish_pipeline      [A.0] research-cycle → critic-review → human approve → publish
    - paid_campaign_review  [B]   ad-budget gate before paid spend lands
    - crisis_response       [D]   USP 6 — playbook lookup → draft → escalate
    - bandit_orchestrator   [A.3] Doc 4 §2.3 mabwiser arm allocation
    """
    return {
        "available": ["publish_pipeline"],
        "planned": ["paid_campaign_review", "crisis_response", "bandit_orchestrator"],
    }


@app.post("/workflows/publish_pipeline/start", response_model=WorkflowStartResponse)
async def start_publish(req: PublishStartRequest) -> WorkflowStartResponse:
    """Kick off the publish pipeline for a draft.

    Phase A.0: builds the graph (validates wiring), returns run_id, parks.
    Live execution lands in A.2 once the human-approval checkpoint UI ships.
    """
    run_id = str(uuid4())
    log.info(
        "publish_pipeline.start",
        run_id=run_id,
        company_id=req.company_id,
        draft_id=req.draft_id,
        channel=req.channel,
    )

    if os.getenv("LANGGRAPH_DRY_RUN", "1") == "1":
        try:
            _ = build_publish_pipeline()
        except Exception as e:  # noqa: BLE001
            log.error("publish_pipeline.build_failed", run_id=run_id, error=str(e))
            raise HTTPException(status_code=500, detail=f"graph build failed: {e}") from e
        return WorkflowStartResponse(
            run_id=run_id, workflow="publish_pipeline", status="queued"
        )

    raise HTTPException(status_code=501, detail="live execution lands in A.2")
