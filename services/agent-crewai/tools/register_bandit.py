"""register_bandit — Strategist → bandit-orchestrator handoff.

Doc 4 §2.3: Strategist generates N=3..5 variants per piece, then registers
them as arms of a multi-armed bandit so the publish_pipeline can allocate
publish slots via Thompson sampling. This tool is the registration call.

Bandit allocation closes the generate→publish→measure→learn loop:

  Strategist creates 3 variants  ──> register_bandit
                                       │
                                       └─> POST {orch}/bandits → bandit_id
  publish_pipeline picks variant ──>  POST {orch}/bandits/:id/allocate
  ingestion observes performance ──>  performance-ingest emits
                                      content.metric_update with percentile
  bandit consumer attributes     ──>  posterior updates (auto, no HTTP)
  next allocate prefers winner   ──>  loop tightens

Without env wiring, the tool falls back to returning a stub bandit_id of
"bandit_stub". This matches the pattern on recall_lessons /
retrieve_high_performers / voice_score so the crew constructs cleanly in
dev without all backends live.

Counterpart tools (planned, not built here):
  - allocate_variant — POST /bandits/:id/allocate. Used by
    publish_pipeline's `bandit_allocate` LangGraph node.
  - reward_variant   — POST /bandits/:id/reward. Manual fallback only;
    the auto-attribution consumer in bandit-orchestrator covers the
    production path via Redpanda content.metric_update.
"""

from __future__ import annotations

import os
from typing import Literal

import httpx
import structlog
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

log = structlog.get_logger()

API_BASE_URL = os.getenv("BANDIT_ORCH_BASE_URL")
SERVICE_TOKEN = os.getenv("SERVICE_TOKEN")
SERVICE_NAME = "agent-crewai"

Channel = Literal["x", "linkedin", "reddit", "tiktok", "instagram", "newsletter", "blog"]
Algorithm = Literal["thompson", "epsilon_greedy", "ucb1"]


class VariantInput(BaseModel):
    """One arm. The strategist supplies these; the bandit-orchestrator
    seeds a Beta prior from `predicted_percentile` (USP 1)."""

    variant_id: str = Field(..., min_length=1, max_length=64)
    draft_id: str
    body_excerpt: str = Field(..., max_length=500)
    predicted_percentile: float | None = Field(default=None, ge=0.0, le=100.0)


class RegisterBanditInput(BaseModel):
    company_id: str
    client_id: str | None = None
    campaign_id: str
    platform: Channel
    message_pillar: str = Field(..., min_length=1, max_length=120)
    variants: list[VariantInput] = Field(..., min_length=2, max_length=10)
    algorithm: Algorithm = "thompson"
    # 0.10 = 10% of allocations always go to non-leading arm. Hard floor
    # 0.05 enforced by the orchestrator (never reduce below per Doc 4 §2.3).
    exploration_budget: float = Field(0.10, ge=0.05, le=0.5)
    observation_window_hours: int = Field(72, gt=0, le=720)


class _RegisterBanditTool(BaseTool):
    name: str = "register_bandit"
    description: str = (
        "Register N (2..10) content variants as arms of a multi-armed "
        "bandit so the publish pipeline can Thompson-sample which variant "
        "to ship next. Call this once per (campaign, platform, "
        "message_pillar) after generating variants. Returns bandit_id."
    )
    args_schema: type[BaseModel] = RegisterBanditInput

    def _run(  # type: ignore[override]
        self,
        company_id: str,
        campaign_id: str,
        platform: Channel,
        message_pillar: str,
        variants: list[dict],
        client_id: str | None = None,
        algorithm: Algorithm = "thompson",
        exploration_budget: float = 0.10,
        observation_window_hours: int = 72,
    ) -> dict:
        if not (API_BASE_URL and SERVICE_TOKEN):
            log.debug(
                "register_bandit.fallback_stub",
                reason="BANDIT_ORCH_BASE_URL or SERVICE_TOKEN not set",
            )
            return {
                "bandit_id": "bandit_stub",
                "arm_count": len(variants),
                "skipped": True,
            }

        url = f"{API_BASE_URL.rstrip('/')}/bandits"
        body: dict[str, object] = {
            "company_id": company_id,
            "client_id": client_id,
            "campaign_id": campaign_id,
            "platform": platform,
            "message_pillar": message_pillar,
            "variants": variants,
            "algorithm": algorithm,
            "exploration_budget": exploration_budget,
            "observation_window_hours": observation_window_hours,
        }

        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(
                    url,
                    json=body,
                    headers={
                        "X-Clipstack-Service-Token": SERVICE_TOKEN,
                        "X-Clipstack-Active-Company": company_id,
                        "X-Clipstack-Service-Name": SERVICE_NAME,
                    },
                )
        except (httpx.HTTPError, OSError) as e:
            log.warning("register_bandit.http_error", error=str(e), url=url)
            return {
                "bandit_id": "bandit_stub",
                "arm_count": len(variants),
                "skipped": True,
                "error": str(e),
            }

        if resp.status_code not in (200, 201):
            log.warning(
                "register_bandit.bad_status",
                status=resp.status_code,
                body=resp.text[:300],
            )
            return {
                "bandit_id": "bandit_stub",
                "arm_count": len(variants),
                "skipped": True,
                "error": f"HTTP {resp.status_code}",
            }

        data = resp.json()
        # bandit-orchestrator returns the response as the body directly
        # (no envelope), matching the existing service's contract.
        if not isinstance(data, dict):
            return {
                "bandit_id": "bandit_stub",
                "arm_count": len(variants),
                "skipped": True,
                "error": "unexpected response shape",
            }
        return {
            "bandit_id": str(data.get("bandit_id", "")),
            "arm_count": int(data.get("arm_count", len(variants))),
            "skipped": bool(data.get("skipped", False)),
        }


register_bandit_tool = _RegisterBanditTool()
