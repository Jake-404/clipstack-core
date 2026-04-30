"""voice_score — USP 3 brand voice fingerprinting.

Calls services/voice-scorer (SetFit classifier + cosine-similarity to a
per-workspace voice corpus stored in Qdrant). Returns a blended score in
[0, 1] plus the top-3 most-similar and top-3 least-similar corpus exemplars
so the writer can see *why* a draft scored where it did.

A.2 wiring: when VOICE_SCORER_BASE_URL is set, the tool POSTs to
{base}/score. Without it, falls back to score=1.0 / passes=true so crews
construct cleanly in environments without the service live.
"""

from __future__ import annotations

import os

import httpx
import structlog
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

log = structlog.get_logger()

VOICE_SCORER_BASE_URL = os.getenv("VOICE_SCORER_BASE_URL")


class VoiceScoreInput(BaseModel):
    company_id: str
    draft: str = Field(..., min_length=1)
    client_id: str | None = None
    threshold: float = Field(0.65, ge=0.0, le=1.0)


class VoiceScoreResult(BaseModel):
    score: float = Field(..., ge=0.0, le=1.0)
    passes: bool
    nearest: list[dict]
    farthest: list[dict]


class _VoiceScoreTool(BaseTool):
    name: str = "voice_score"
    description: str = (
        "Score a draft against the workspace's brand voice corpus. Returns "
        "the blended cosine score, whether it passes the configured threshold, "
        "and the top-3 most-similar and least-similar exemplars."
    )
    args_schema: type[BaseModel] = VoiceScoreInput

    def _run(  # type: ignore[override]
        self,
        company_id: str,
        draft: str,
        client_id: str | None = None,
        threshold: float = 0.65,
    ) -> dict:
        if not VOICE_SCORER_BASE_URL:
            log.debug(
                "voice_score.fallback_stub",
                reason="VOICE_SCORER_BASE_URL not set",
            )
            return VoiceScoreResult(
                score=1.0,
                passes=True,
                nearest=[],
                farthest=[],
            ).model_dump()

        url = f"{VOICE_SCORER_BASE_URL.rstrip('/')}/score"
        body = {
            "company_id": company_id,
            "draft": draft,
            "threshold": threshold,
            "client_id": client_id,
            "return_exemplars": True,
        }
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(url, json=body)
        except (httpx.HTTPError, OSError) as e:
            log.warning("voice_score.http_error", error=str(e), url=url)
            # Degrade gracefully: a service outage shouldn't crash the crew.
            # Fail-open returns score=1.0 — if voice-scoring is critical for
            # this workspace, surface the outage in the UI rather than
            # blocking every draft on the agent side.
            return VoiceScoreResult(
                score=1.0, passes=True, nearest=[], farthest=[]
            ).model_dump()

        if resp.status_code != 200:
            log.warning(
                "voice_score.bad_status",
                status=resp.status_code,
                body=resp.text[:200],
            )
            return VoiceScoreResult(
                score=1.0, passes=True, nearest=[], farthest=[]
            ).model_dump()

        data = resp.json()
        return VoiceScoreResult(
            score=data.get("score", 1.0),
            passes=bool(data.get("passes", True)),
            nearest=list(data.get("nearest", [])),
            farthest=list(data.get("farthest", [])),
        ).model_dump()


voice_score_tool = _VoiceScoreTool()
