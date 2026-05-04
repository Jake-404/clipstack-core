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

Real backend (sprint-close+): Layer 1 (cosine retrieval via Qdrant +
LiteLLM voice-embed) is wired here. Layer 2 (SetFit classifier) is gated
behind the optional `ml` extra so workspaces that haven't seeded enough
samples (~50 in-voice + ~20 off-voice) don't pay the import cost. When
SetFit lands, the blended score becomes 0.6 * cosine + 0.4 * classifier
(workspace-tunable).

Fail-soft semantics:
  - Workspace has no Qdrant collection (no /train ever called) → return
    score=1.0, passes=true, skipped=true. Same UX as stub mode, but the
    response carries skipped=true so callers can audit which workspaces
    are still bootstrapping.
  - LiteLLM unreachable → 503, never silently passes.
  - Qdrant unreachable → 503, never silently passes.

Stub mode (env-aware default):
  dev/test: VOICE_SCORER_STUB_MODE=1 → returns score=1.0 without touching
            LiteLLM or Qdrant.
  prod:     VOICE_SCORER_STUB_MODE=0 by default → calls real backend. A
            forgot-to-wire deploy fails loudly rather than passing every
            draft.

Mounted at port 8005. Health check consumed by docker-compose.
"""

from __future__ import annotations

import os
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import httpx
import structlog
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

log = structlog.get_logger()

QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
LITELLM_BASE_URL = os.getenv("LITELLM_BASE_URL", "http://litellm:4000")
LITELLM_API_KEY = os.getenv("LITELLM_API_KEY", "sk-clipstack-internal")
EMBED_PROFILE = os.getenv("VOICE_EMBED_MODEL", "voice-embed")
EMBED_DIM = int(os.getenv("VOICE_EMBED_DIM", "384"))
DEFAULT_TOP_K = int(os.getenv("VOICE_TOP_K", "3"))
LITELLM_TIMEOUT_S = float(os.getenv("LITELLM_TIMEOUT_S", "10.0"))
QDRANT_TIMEOUT_S = float(os.getenv("QDRANT_TIMEOUT_S", "10.0"))


def _is_production() -> bool:
    return (
        os.getenv("ENVIRONMENT", "").lower() == "production"
        or os.getenv("NODE_ENV", "").lower() == "production"
    )


def _stub_mode_default() -> str:
    """Dev/test: '1' (stub on — service runs without SetFit + Qdrant wired).
    Production: '0' (stub off — a forgotten-to-wire deployment fails loudly
    rather than silently passing every draft as score=1.0)."""
    return "0" if _is_production() else "1"


STUB_MODE: bool = os.getenv("VOICE_SCORER_STUB_MODE", _stub_mode_default()) == "1"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log.info(
        "startup",
        service="voice-scorer",
        stub_mode=STUB_MODE,
        qdrant=QDRANT_URL,
        embed_profile=EMBED_PROFILE,
        embed_dim=EMBED_DIM,
        environment=os.getenv("ENVIRONMENT") or os.getenv("NODE_ENV") or "development",
    )
    if STUB_MODE and _is_production():
        log.warning(
            "stub_mode_active_in_production",
            service="voice-scorer",
            message=(
                "VOICE_SCORER_STUB_MODE=1 in production. /score returns 1.0 "
                "(passes everything). Real voice-fingerprint enforcement is OFF. "
                "Wire SetFit + Qdrant or unset VOICE_SCORER_STUB_MODE."
            ),
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


class TrainSample(BaseModel):
    text: str = Field(..., min_length=1, max_length=200_000)
    tone_tags: list[str] = Field(default_factory=list)


class TrainRequest(BaseModel):
    company_id: str
    client_id: str | None = None
    in_voice_samples: list[TrainSample | str] = Field(default_factory=list)
    off_voice_samples: list[TrainSample | str] = Field(default_factory=list)
    # If true, drop the existing Qdrant collection and recreate. Useful after
    # a brand-kit voice rewrite. Defaults to false (additive upsert).
    replace: bool = False


class TrainResponse(BaseModel):
    request_id: str
    company_id: str
    in_voice_count: int
    off_voice_count: int
    trained_at: str | None = None
    skipped: bool = True


# ─── LiteLLM embed ─────────────────────────────────────────────────────────


def _collection_name(company_id: str) -> str:
    """One Qdrant collection per workspace, payload-filtered by client_id when
    a per-client corpus is requested. Avoids exploding collection count for
    agencies with hundreds of clients."""
    return f"voice-{company_id}"


async def _embed_one(text: str, http: httpx.AsyncClient) -> list[float]:
    """Embed a single text via LiteLLM /v1/embeddings.

    Asserts the result is EMBED_DIM-dimensional. Mismatch means somebody
    swapped the voice-embed profile to a non-384-d model without updating
    the Qdrant collection — fail loudly so the operator catches it before
    a corrupt collection ships.
    """
    try:
        resp = await http.post(
            f"{LITELLM_BASE_URL.rstrip('/')}/v1/embeddings",
            json={"model": EMBED_PROFILE, "input": text},
            headers={"Authorization": f"Bearer {LITELLM_API_KEY}"},
            timeout=LITELLM_TIMEOUT_S,
        )
    except httpx.HTTPError as e:
        log.error("litellm.unreachable", error=str(e), profile=EMBED_PROFILE)
        raise HTTPException(
            status_code=503,
            detail=f"LiteLLM unreachable at {LITELLM_BASE_URL}",
        ) from e

    if resp.status_code != 200:
        log.error(
            "litellm.bad_status",
            status=resp.status_code,
            body=resp.text[:300],
            profile=EMBED_PROFILE,
        )
        raise HTTPException(
            status_code=502,
            detail=f"LiteLLM returned {resp.status_code} for embedding",
        )

    data = resp.json()
    embeddings = data.get("data") or []
    if not embeddings or "embedding" not in embeddings[0]:
        raise HTTPException(status_code=502, detail="LiteLLM response missing embedding")
    vec = embeddings[0]["embedding"]
    if not isinstance(vec, list) or len(vec) != EMBED_DIM:
        log.error(
            "litellm.dim_mismatch",
            got=len(vec) if isinstance(vec, list) else "non-list",
            expected=EMBED_DIM,
        )
        raise HTTPException(
            status_code=500,
            detail=(
                f"Voice-embed profile returned dim={len(vec) if isinstance(vec, list) else 'n/a'}, "
                f"expected {EMBED_DIM}. Update VOICE_EMBED_DIM or the LiteLLM profile."
            ),
        )
    return vec


# ─── Qdrant ────────────────────────────────────────────────────────────────


def _qdrant_headers() -> dict[str, str]:
    h: dict[str, str] = {"Content-Type": "application/json"}
    if QDRANT_API_KEY:
        h["api-key"] = QDRANT_API_KEY
    return h


async def _qdrant_collection_exists(collection: str, http: httpx.AsyncClient) -> bool:
    """HEAD-style probe — Qdrant returns 200 with `result` for existing
    collections and 404 for missing ones."""
    try:
        resp = await http.get(
            f"{QDRANT_URL.rstrip('/')}/collections/{collection}",
            headers=_qdrant_headers(),
            timeout=QDRANT_TIMEOUT_S,
        )
    except httpx.HTTPError as e:
        log.error("qdrant.unreachable", error=str(e), url=QDRANT_URL)
        raise HTTPException(
            status_code=503, detail=f"Qdrant unreachable at {QDRANT_URL}"
        ) from e
    return resp.status_code == 200


async def _qdrant_create_collection(collection: str, http: httpx.AsyncClient) -> None:
    """Create a collection sized for voice-embed (cosine, 384-d).

    On_disk vector storage is left default (in-memory) — voice corpora are
    small (<5k samples per workspace at the high end) and we want fast cold
    queries. Workspaces that grow past that switch to on_disk via Qdrant
    config; the service code stays the same.
    """
    body = {
        "vectors": {"size": EMBED_DIM, "distance": "Cosine"},
    }
    resp = await http.put(
        f"{QDRANT_URL.rstrip('/')}/collections/{collection}",
        json=body,
        headers=_qdrant_headers(),
        timeout=QDRANT_TIMEOUT_S,
    )
    if resp.status_code not in (200, 201):
        log.error(
            "qdrant.create_failed",
            status=resp.status_code,
            body=resp.text[:300],
            collection=collection,
        )
        raise HTTPException(
            status_code=502,
            detail=f"Failed to create Qdrant collection {collection}: {resp.status_code}",
        )


async def _qdrant_delete_collection(collection: str, http: httpx.AsyncClient) -> None:
    resp = await http.delete(
        f"{QDRANT_URL.rstrip('/')}/collections/{collection}",
        headers=_qdrant_headers(),
        timeout=QDRANT_TIMEOUT_S,
    )
    # 200 = deleted, 404 = already gone — both acceptable.
    if resp.status_code not in (200, 404):
        log.error(
            "qdrant.delete_failed",
            status=resp.status_code,
            body=resp.text[:300],
        )


async def _qdrant_upsert(
    collection: str,
    points: list[dict[str, Any]],
    http: httpx.AsyncClient,
) -> None:
    """Bulk upsert. Caller assigns ids upstream."""
    if not points:
        return
    resp = await http.put(
        f"{QDRANT_URL.rstrip('/')}/collections/{collection}/points?wait=true",
        json={"points": points},
        headers=_qdrant_headers(),
        timeout=QDRANT_TIMEOUT_S * 3,  # bulk inserts can take longer
    )
    if resp.status_code != 200:
        log.error(
            "qdrant.upsert_failed",
            status=resp.status_code,
            body=resp.text[:300],
            collection=collection,
            point_count=len(points),
        )
        raise HTTPException(
            status_code=502,
            detail=f"Qdrant upsert failed: {resp.status_code}",
        )


async def _qdrant_search(
    collection: str,
    vec: list[float],
    *,
    label: str,
    client_id: str | None,
    k: int,
    http: httpx.AsyncClient,
) -> list[dict[str, Any]]:
    """Top-K nearest by cosine. Filtered by payload.label and optionally
    payload.client_id when the request is client-scoped."""
    must: list[dict[str, Any]] = [
        {"key": "label", "match": {"value": label}},
    ]
    if client_id:
        must.append({"key": "client_id", "match": {"value": client_id}})

    body: dict[str, Any] = {
        "vector": vec,
        "limit": k,
        "with_payload": True,
        "filter": {"must": must},
    }
    resp = await http.post(
        f"{QDRANT_URL.rstrip('/')}/collections/{collection}/points/search",
        json=body,
        headers=_qdrant_headers(),
        timeout=QDRANT_TIMEOUT_S,
    )
    if resp.status_code == 404:
        return []  # collection missing — caller treats as untrained workspace
    if resp.status_code != 200:
        log.error(
            "qdrant.search_failed",
            status=resp.status_code,
            body=resp.text[:300],
        )
        raise HTTPException(
            status_code=502, detail=f"Qdrant search failed: {resp.status_code}"
        )
    payload = resp.json()
    return list(payload.get("result") or [])


def _to_exemplar(hit: dict[str, Any]) -> Exemplar:
    payload = hit.get("payload") or {}
    text = payload.get("text") or ""
    return Exemplar(
        id=str(hit.get("id", "")),
        similarity=float(hit.get("score", 0.0)),
        text_excerpt=text[:240],
        tone_tags=list(payload.get("tone_tags") or []),
    )


# ─── Endpoints ─────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "voice-scorer", "version": "0.1.0"}


@app.post("/score", response_model=ScoreResponse)
async def score(req: ScoreRequest) -> ScoreResponse:
    """Score a draft against the workspace's voice corpus.

    Real backend: cosine retrieval of nearest-K in-voice + farthest-K = nearest-K
    off-voice exemplars from Qdrant; score = mean similarity of nearest. SetFit
    classifier blends in once the optional ml extra is installed and a workspace
    has trained.

    Fail-soft: untrained workspaces (no Qdrant collection) get score=1.0 +
    skipped=true. Same UX as stub, but downstream callers can audit which
    workspaces still need bootstrapping.
    """
    request_id = str(uuid4())
    log.info(
        "voice.score",
        request_id=request_id,
        company_id=req.company_id,
        draft_len=len(req.draft),
        threshold=req.threshold,
    )

    if STUB_MODE:
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

    collection = _collection_name(req.company_id)
    # Default timeout matches the per-call LITELLM/QDRANT timeouts so a
    # wedged sidecar can't tie up the FastAPI worker indefinitely. Without
    # this, httpx.AsyncClient() defaults to 5s for connect but UNLIMITED
    # read — a stuck Qdrant/LiteLLM hangs every /score request forever.
    async with httpx.AsyncClient(timeout=max(LITELLM_TIMEOUT_S, QDRANT_TIMEOUT_S)) as http:
        if not await _qdrant_collection_exists(collection, http):
            # Untrained workspace — fail-soft.
            log.info(
                "voice.score.untrained",
                request_id=request_id,
                company_id=req.company_id,
                collection=collection,
            )
            return ScoreResponse(
                request_id=request_id,
                score=1.0,
                passes=True,
                threshold=req.threshold,
                model_version=f"untrained-{EMBED_PROFILE}",
                skipped=True,
            )

        vec = await _embed_one(req.draft, http)
        nearest = await _qdrant_search(
            collection, vec,
            label="in_voice", client_id=req.client_id,
            k=DEFAULT_TOP_K, http=http,
        )
        farthest_off_voice = await _qdrant_search(
            collection, vec,
            label="off_voice", client_id=req.client_id,
            k=DEFAULT_TOP_K, http=http,
        )

    # Score = mean cosine similarity to top-K in-voice exemplars. Qdrant
    # returns cosine similarity (not distance) for Distance.COSINE collec-
    # tions, so values are already in [-1, 1]. Clamp to [0, 1] for the
    # public score — negative similarities mean the draft is anti-voice
    # which is a stronger fail than score=0 implies, but the threshold
    # gate handles that uniformly.
    if nearest:
        sims = [float(h.get("score", 0.0)) for h in nearest]
        raw_score = sum(sims) / len(sims)
        final_score = max(0.0, min(1.0, raw_score))
    else:
        # Collection exists but no in-voice samples — treat as untrained.
        log.warning(
            "voice.score.empty_in_voice",
            request_id=request_id,
            company_id=req.company_id,
        )
        return ScoreResponse(
            request_id=request_id,
            score=1.0,
            passes=True,
            threshold=req.threshold,
            model_version=f"untrained-{EMBED_PROFILE}",
            skipped=True,
        )

    nearest_exemplars = [_to_exemplar(h) for h in nearest] if req.return_exemplars else []
    farthest_exemplars = (
        [_to_exemplar(h) for h in farthest_off_voice] if req.return_exemplars else []
    )

    return ScoreResponse(
        request_id=request_id,
        score=final_score,
        passes=final_score >= req.threshold,
        threshold=req.threshold,
        nearest=nearest_exemplars,
        farthest=farthest_exemplars,
        model_version=f"cosine-{EMBED_PROFILE}",
        skipped=False,
    )


@app.post("/train", response_model=TrainResponse)
async def train(req: TrainRequest) -> TrainResponse:
    """Train (or retrain) the workspace's classifier from labelled samples.

    This slice handles cosine-retrieval bootstrap: embeds each sample and
    upserts into the workspace's Qdrant collection with payload {label,
    client_id, text, tone_tags}. SetFit classifier training lands behind
    the optional `ml` extra in a follow-up.

    Triggered after a brand-kit voice-corpus update or once a workspace has
    accumulated enough approved drafts to bootstrap from history.
    """
    request_id = str(uuid4())
    started_at = time.monotonic()
    log.info(
        "voice.train",
        request_id=request_id,
        company_id=req.company_id,
        in_voice=len(req.in_voice_samples),
        off_voice=len(req.off_voice_samples),
        replace=req.replace,
    )

    if STUB_MODE:
        return TrainResponse(
            request_id=request_id,
            company_id=req.company_id,
            in_voice_count=len(req.in_voice_samples),
            off_voice_count=len(req.off_voice_samples),
            trained_at=None,
            skipped=True,
        )

    def _to_sample(s: TrainSample | str) -> TrainSample:
        return s if isinstance(s, TrainSample) else TrainSample(text=s)

    in_samples = [_to_sample(s) for s in req.in_voice_samples]
    off_samples = [_to_sample(s) for s in req.off_voice_samples]

    if not in_samples and not off_samples:
        raise HTTPException(
            status_code=400,
            detail="At least one sample (in-voice or off-voice) is required",
        )

    collection = _collection_name(req.company_id)

    # Same timeout rationale as /score — without an explicit budget, a
    # wedged Qdrant or LiteLLM sidecar would hold the /train request open
    # indefinitely (httpx default has unlimited read timeout).
    async with httpx.AsyncClient(timeout=max(LITELLM_TIMEOUT_S, QDRANT_TIMEOUT_S)) as http:
        if req.replace:
            await _qdrant_delete_collection(collection, http)
        if not await _qdrant_collection_exists(collection, http):
            await _qdrant_create_collection(collection, http)

        # Embed serially — voice corpora are small (50–200 samples typical),
        # parallelism would saturate LiteLLM with no real wall-clock win.
        # Larger corpora can switch to httpx connection pooling + asyncio.gather
        # in a follow-up if it shows up in profiling.
        points: list[dict[str, Any]] = []
        for sample, label in [(s, "in_voice") for s in in_samples] + [
            (s, "off_voice") for s in off_samples
        ]:
            vec = await _embed_one(sample.text, http)
            point_id = uuid4().hex
            payload: dict[str, Any] = {
                "label": label,
                "text": sample.text,
                "tone_tags": sample.tone_tags,
            }
            if req.client_id:
                payload["client_id"] = req.client_id
            points.append({"id": point_id, "vector": vec, "payload": payload})

        await _qdrant_upsert(collection, points, http)

    trained_at = datetime.now(UTC).isoformat()
    log.info(
        "voice.trained",
        request_id=request_id,
        company_id=req.company_id,
        collection=collection,
        in_voice_count=len(in_samples),
        off_voice_count=len(off_samples),
        elapsed_ms=int((time.monotonic() - started_at) * 1000),
    )

    return TrainResponse(
        request_id=request_id,
        company_id=req.company_id,
        in_voice_count=len(in_samples),
        off_voice_count=len(off_samples),
        trained_at=trained_at,
        skipped=False,
    )
