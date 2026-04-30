"""Voice fingerprinting service — USP 3.

Two layers compose the score:
  1. Cosine similarity between the draft embedding and the workspace's voice
     corpus exemplars (Qdrant nearest-neighbours).
  2. SetFit classifier head trained on the workspace's labelled samples
     (in-voice / off-voice) — captures style patterns the cosine layer alone
     misses (cadence, hedging density, jargon-specific phrasing).

The blended score is in [0, 1]. Above the workspace threshold (default 0.65),
the draft "passes" voice. Below, BrandQA blocks the draft and surfaces the
top-3 most-similar + top-3 least-similar exemplars so the writer can see why.

Phase A.2 ships the FastAPI shell with stub mode — every draft scores 1.0
and passes. The real backend (SetFit + Qdrant + per-workspace classifier
training) lands when the first workspace seeds enough samples (~50 in-voice
+ ~20 off-voice anti-exemplars).

Mounted at port 8005. Health check consumed by docker-compose.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

import structlog
from fastapi import FastAPI
from pydantic import BaseModel, Field

log = structlog.get_logger()

QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
LITELLM_BASE_URL = os.getenv("LITELLM_BASE_URL", "http://litellm:4000")
EMBED_PROFILE = os.getenv("VOICE_EMBED_MODEL", "VOICE_EMBED_MODEL")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log.info(
        "startup",
        service="voice-scorer",
        qdrant=QDRANT_URL,
        embed_profile=EMBED_PROFILE,
    )
    yield
    log.info("shutdown", service="voice-scorer")


app = FastAPI(
    title="clipstack/voice-scorer",
    version="0.1.0",
    description="Brand-voice fingerprinting. USP 3.",
    lifespan=lifespan,
)


# ─── Schemas ───────────────────────────────────────────────────────────────


class ScoreRequest(BaseModel):
    company_id: str
    draft: str = Field(..., min_length=1, max_length=200_000)
    client_id: str | None = Field(
        None,
        description="Optional client scope; per-client voice corpora override per-agency",
    )
    threshold: float = Field(0.65, ge=0.0, le=1.0)
    # Caller can request the exemplars even if the draft passes; useful for
    # Mission Control's "why did this score this way" detail panel.
    return_exemplars: bool = True


class Exemplar(BaseModel):
    id: str
    similarity: float = Field(..., ge=-1.0, le=1.0)
    text_excerpt: str
    tone_tags: list[str] = Field(default_factory=list)


class ScoreResponse(BaseModel):
    request_id: str
    score: float = Field(..., ge=0.0, le=1.0)
    passes: bool
    threshold: float
    nearest: list[Exemplar] = Field(default_factory=list)
    farthest: list[Exemplar] = Field(default_factory=list)
    model_version: str = "stub-0.1.0"
    skipped: bool = True


class TrainRequest(BaseModel):
    company_id: str
    client_id: str | None = None
    in_voice_samples: list[str] = Field(default_factory=list)
    off_voice_samples: list[str] = Field(default_factory=list)


class TrainResponse(BaseModel):
    request_id: str
    company_id: str
    in_voice_count: int
    off_voice_count: int
    trained_at: str | None = None
    skipped: bool = True


# ─── Endpoints ─────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "voice-scorer", "version": "0.1.0"}


@app.post("/score", response_model=ScoreResponse)
async def score(req: ScoreRequest) -> ScoreResponse:
    """Score a draft against the workspace's voice corpus.

    Phase A.2 stub: returns score=1.0 with passes=true and empty exemplar
    lists. The shape is final; only the body fills in when SetFit + Qdrant
    are wired.
    """
    request_id = str(uuid4())
    log.info(
        "voice.score",
        request_id=request_id,
        company_id=req.company_id,
        draft_len=len(req.draft),
        threshold=req.threshold,
    )

    if os.getenv("VOICE_SCORER_STUB_MODE", "1") == "1":
        return ScoreResponse(
            request_id=request_id,
            score=1.0,
            passes=True,
            threshold=req.threshold,
            nearest=[],
            farthest=[],
            model_version="stub-0.1.0",
            skipped=True,
        )

    # Real impl (next slice):
    #   1. Embed the draft via LiteLLM VOICE_EMBED_MODEL profile.
    #   2. Qdrant collection f"voice-{company_id}" — top-K nearest, top-K farthest.
    #   3. SetFit classifier head on the workspace's labelled samples.
    #   4. Blend cosine + classifier into the final score (workspace-tunable
    #      blend weight; default 0.6 cosine + 0.4 classifier).
    raise NotImplementedError("SetFit + Qdrant backend wired in a follow-up A.2 slice")


@app.post("/train", response_model=TrainResponse)
async def train(req: TrainRequest) -> TrainResponse:
    """Train (or retrain) the workspace's classifier from labelled samples.

    Triggered after a brand-kit voice-corpus update or once a workspace has
    accumulated enough approved drafts to bootstrap from history.

    Phase A.2 stub: records the request and returns immediately. Real training
    lands in a follow-up slice.
    """
    request_id = str(uuid4())
    log.info(
        "voice.train",
        request_id=request_id,
        company_id=req.company_id,
        in_voice=len(req.in_voice_samples),
        off_voice=len(req.off_voice_samples),
    )

    return TrainResponse(
        request_id=request_id,
        company_id=req.company_id,
        in_voice_count=len(req.in_voice_samples),
        off_voice_count=len(req.off_voice_samples),
        trained_at=None,
        skipped=True,
    )
