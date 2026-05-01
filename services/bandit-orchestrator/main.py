"""Bandit orchestrator — Doc 4 §2.3.

Treats content variants as arms in a multi-armed-bandit problem. Strategist
generates N=3..5 variants per piece; orchestrator allocates publish slots
across arms via Thompson sampling, weighted by predicted percentile (USP 1)
+ live-performance updates from `content.metric_update` events.

State machine per (campaign, platform, message_pillar):
  1. Variants registered → arms initialised with uninformed priors
  2. Allocate request → orchestrator returns the variant to publish next
  3. content.metric_update event → reward update (Thompson posterior bumps)
  4. After observation window → low-performing arms pruned, top arms seed
     the next generation cycle

Library: `mabwiser` Python (Thompson sampling, contextual bandits when needed).

Phase A.3 ships the FastAPI shell with stub mode — /allocate returns the
first variant, /reward is a no-op. mabwiser wiring lands when the first
campaign opts into bandit allocation. Per Doc 4 acceptance: a campaign with
bandits enabled shows demonstrable lift over a 30-day window vs single-
variant generation, statistically significant.

Mounted at port 8008. Health check consumed by docker-compose.
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
    """Dev/test: '1' (stub on — service runs without mabwiser wired).
    Production: '0' (stub off — a forgotten-to-wire deployment fails loudly
    rather than silently allocating placeholder variants forever)."""
    return "0" if _is_production() else "1"


STUB_MODE: bool = os.getenv("BANDIT_STUB_MODE", _stub_mode_default()) == "1"

# Doc 4 §2.3 hard rule: never reduce exploration below 5%. Without floor
# exploration, posteriors drift on stale wins and the bandit collapses to
# repeated allocations of a once-good variant whose context has changed.
EXPLORATION_BUDGET_FLOOR: float = 0.05


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log.info(
        "startup",
        service="bandit-orchestrator",
        stub_mode=STUB_MODE,
        exploration_budget_floor=EXPLORATION_BUDGET_FLOOR,
        environment=os.getenv("ENVIRONMENT") or os.getenv("NODE_ENV") or "development",
    )
    if STUB_MODE and _is_production():
        log.warning(
            "stub_mode_active_in_production",
            service="bandit-orchestrator",
            message=(
                "BANDIT_STUB_MODE=1 in production. /allocate returns a "
                "placeholder variant and /reward no-ops. Real Thompson "
                "sampling is OFF. Wire mabwiser or unset BANDIT_STUB_MODE."
            ),
        )
    yield
    log.info("shutdown", service="bandit-orchestrator")


app = FastAPI(
    title="clipstack/bandit-orchestrator",
    version="0.1.0",
    description="Multi-armed bandit variant allocator. Doc 4 §2.3.",
    lifespan=lifespan,
)


# ─── Schemas ───────────────────────────────────────────────────────────────


Channel = Literal["x", "linkedin", "reddit", "tiktok", "instagram", "newsletter", "blog"]
Algorithm = Literal["thompson", "epsilon_greedy", "ucb1"]


class Variant(BaseModel):
    """One arm of the bandit. The strategist generates 3–5 of these per piece."""

    variant_id: str = Field(..., min_length=1, max_length=64)
    draft_id: str
    body_excerpt: str = Field(..., max_length=500)
    predicted_percentile: float | None = Field(default=None, ge=0.0, le=100.0)


class RegisterArmsRequest(BaseModel):
    company_id: str
    client_id: str | None = None
    campaign_id: str
    platform: Channel
    message_pillar: str = Field(..., min_length=1, max_length=120)
    variants: list[Variant] = Field(..., min_length=2, max_length=10)
    # Strategy choice. Default Thompson per Doc 4.
    algorithm: Algorithm = "thompson"
    # Per Doc 4 §2.3: explicit exploration budget. 0.10 = 10% of allocations
    # always go to non-leading arm to keep prior up to date.
    # Hard floor 0.05 enforced at the schema layer — see EXPLORATION_BUDGET_FLOOR.
    exploration_budget: float = Field(0.10, ge=EXPLORATION_BUDGET_FLOOR, le=0.5)
    observation_window_hours: int = Field(72, gt=0, le=720)


class RegisterArmsResponse(BaseModel):
    request_id: str
    bandit_id: str
    arm_count: int
    skipped: bool = True


class AllocateRequest(BaseModel):
    company_id: str
    bandit_id: str


class AllocateResponse(BaseModel):
    request_id: str
    bandit_id: str
    variant_id: str
    arm_score: float | None = None
    rationale: str
    skipped: bool = True


class RewardRequest(BaseModel):
    company_id: str
    bandit_id: str
    variant_id: str
    # Reward signal — workspace-relative percentile within the arm's KPI.
    # Comes from content.metric_update events filtered to this draft.
    reward: float = Field(..., ge=0.0, le=100.0)
    snapshot_at: str  # ISO-8601


class RewardResponse(BaseModel):
    request_id: str
    bandit_id: str
    variant_id: str
    posterior_mean: float | None = None
    skipped: bool = True


class StateResponse(BaseModel):
    bandit_id: str
    company_id: str
    campaign_id: str
    platform: Channel
    message_pillar: str
    arms: list[dict] = Field(default_factory=list)
    total_allocations: int = 0
    total_rewards: int = 0
    leading_arm: str | None = None
    pruned_arms: list[str] = Field(default_factory=list)


# ─── Endpoints ─────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "bandit-orchestrator", "version": "0.1.0"}


@app.post("/bandits", response_model=RegisterArmsResponse)
async def register_arms(req: RegisterArmsRequest) -> RegisterArmsResponse:
    """Register a new bandit instance. Strategist calls this when it has
    generated the variants for a piece."""
    request_id = str(uuid4())
    bandit_id = f"bandit_{uuid4().hex[:12]}"
    log.info(
        "bandit.register",
        request_id=request_id,
        bandit_id=bandit_id,
        company_id=req.company_id,
        campaign_id=req.campaign_id,
        platform=req.platform,
        arm_count=len(req.variants),
    )
    if STUB_MODE:
        return RegisterArmsResponse(
            request_id=request_id,
            bandit_id=bandit_id,
            arm_count=len(req.variants),
            skipped=True,
        )
    raise NotImplementedError("mabwiser backend wired in a follow-up A.3 slice")


@app.post("/bandits/{bandit_id}/allocate", response_model=AllocateResponse)
async def allocate(bandit_id: str, req: AllocateRequest) -> AllocateResponse:
    """Return the variant to publish next. Workflow:
      1. publish_pipeline calls /allocate before the publish_to_channel node
      2. orchestrator returns the variant_id chosen by Thompson sampling
      3. publish_pipeline tags the published artefact with the variant_id
         on the content.published event so reward attribution works
    """
    request_id = str(uuid4())
    log.info(
        "bandit.allocate",
        request_id=request_id,
        bandit_id=bandit_id,
        company_id=req.company_id,
    )
    if STUB_MODE:
        # Stub: deterministic — always return a placeholder variant id.
        # Real path samples from each arm's posterior beta distribution.
        return AllocateResponse(
            request_id=request_id,
            bandit_id=bandit_id,
            variant_id="stub-variant-1",
            arm_score=None,
            rationale="stub allocation — bandit backend not wired",
            skipped=True,
        )
    raise NotImplementedError("Thompson sampling wired in a follow-up A.3 slice")


@app.post("/bandits/{bandit_id}/reward", response_model=RewardResponse)
async def reward(bandit_id: str, req: RewardRequest) -> RewardResponse:
    """Record an observed reward for a variant. Called by the consumer of
    content.metric_update events (a small adapter inside this service that
    subscribes to the Redpanda topic when EVENTBUS_ENABLED=true).
    """
    request_id = str(uuid4())
    log.info(
        "bandit.reward",
        request_id=request_id,
        bandit_id=bandit_id,
        variant_id=req.variant_id,
        reward=req.reward,
    )
    return RewardResponse(
        request_id=request_id,
        bandit_id=bandit_id,
        variant_id=req.variant_id,
        posterior_mean=None,
        skipped=True,
    )


@app.get("/bandits/{bandit_id}/state", response_model=StateResponse)
async def state(bandit_id: str) -> StateResponse:
    """Read-only state view for Mission Control's bandit-experiments tile."""
    return StateResponse(
        bandit_id=bandit_id,
        company_id="",
        campaign_id="",
        platform="x",
        message_pillar="",
        arms=[],
        total_allocations=0,
        total_rewards=0,
        leading_arm=None,
        pruned_arms=[],
    )
