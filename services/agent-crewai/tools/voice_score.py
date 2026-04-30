"""voice_score — USP 3 brand voice fingerprinting.

Calls services/voice-scorer (SetFit classifier + cosine-similarity to a
per-workspace voice corpus stored in Qdrant). Returns a blended score in
[0, 1] plus the top-3 most-similar and top-3 least-similar corpus exemplars
so the writer can see *why* a draft scored where it did.

Phase A.0 stub: returns score=1.0 (passes everything) and empty exemplars.
"""

from __future__ import annotations

from crewai.tools import BaseTool
from pydantic import BaseModel, Field


class VoiceScoreInput(BaseModel):
    company_id: str
    draft: str = Field(..., min_length=1)
    client_id: str | None = None
    threshold: float = Field(0.65, ge=0.0, le=1.0)


class VoiceScoreResult(BaseModel):
    score: float = Field(..., ge=0.0, le=1.0)
    passes: bool
    nearest: list[str]
    farthest: list[str]


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
        # Phase A.0 stub — every draft passes. Real call lives at
        # POST {VOICE_SCORER_URL}/score in A.2.
        return VoiceScoreResult(
            score=1.0,
            passes=True,
            nearest=[],
            farthest=[],
        ).model_dump()


voice_score_tool = _VoiceScoreTool()
