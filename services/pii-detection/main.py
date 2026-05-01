"""PII detection + redaction service.

Per Doc 5 §1 P0 — inbound text scan before workspace artifacts land in
Postgres / Qdrant. Two endpoints:

  POST /scan    — return structured detections; do not modify the text
  POST /redact  — return text with PII replaced per the requested mode

Phase A.1 ships the FastAPI shell with stubbed scanner — every request
returns "no detections found, no redaction needed." A.2 wires Presidio
Analyzer + Anonymizer with the workspace's configured language and any
custom recognizers (crypto-wallet addresses, regime-specific identifiers).

Mounted at port 8003. Health check is consumed by docker-compose.
Other services (agent-crewai, agent-langgraph, approval-ui) call this
HTTP-internally, never the underlying library, so the implementation
can swap from Presidio to anything else without touching callers.
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
    """True when the deployment self-identifies as production via env vars."""
    return (
        os.getenv("ENVIRONMENT", "").lower() == "production"
        or os.getenv("NODE_ENV", "").lower() == "production"
    )


def _stub_mode_default() -> str:
    """Default for PII_STUB_MODE.

    Dev/test: '1' (stub on — service runs without Presidio wired).
    Production: '0' (stub off — a deployment that forgot to wire the real
    backend will fail loudly with NotImplementedError rather than silently
    serve fake 'no PII detected' responses on real customer data.)
    """
    return "0" if _is_production() else "1"


STUB_MODE: bool = os.getenv("PII_STUB_MODE", _stub_mode_default()) == "1"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log.info(
        "startup",
        service="pii-detection",
        stub_mode=STUB_MODE,
        environment=os.getenv("ENVIRONMENT") or os.getenv("NODE_ENV") or "development",
    )
    if STUB_MODE and _is_production():
        # Allowed (operator opted in via explicit PII_STUB_MODE=1) but loud.
        log.warning(
            "stub_mode_active_in_production",
            service="pii-detection",
            message=(
                "PII_STUB_MODE=1 in a production environment. /scan and /redact "
                "will return empty detections. Real customer data will pass "
                "through unscanned. Wire Presidio or unset PII_STUB_MODE."
            ),
        )
    yield
    log.info("shutdown", service="pii-detection")


app = FastAPI(
    title="clipstack/pii-detection",
    version="0.1.0",
    description="PII detection + redaction. Doc 5 §1 P0.",
    lifespan=lifespan,
)


# ─── Schemas ───────────────────────────────────────────────────────────────

# Presidio's standard entity catalog plus a handful Clipstack adds for
# crypto / regulated-industry use. Workspace can disable any of these
# via configuration in A.2.
EntityType = Literal[
    "PERSON",
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "CREDIT_CARD",
    "IBAN_CODE",
    "IP_ADDRESS",
    "US_SSN",
    "US_BANK_NUMBER",
    "US_DRIVER_LICENSE",
    "US_PASSPORT",
    "UK_NHS",
    "LOCATION",
    "DATE_TIME",
    "URL",
    "MEDICAL_LICENSE",
    "NRP",                  # nationality / religion / political affiliation
    "CRYPTO_WALLET",        # custom recognizer — Phase A.2
    "API_KEY",              # custom recognizer — Phase A.2
]

RedactMode = Literal["mask", "replace", "remove", "hash"]


class ScanRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=200_000)
    language: str = Field("en", description="ISO-639-1 code; Presidio supports multilingual")
    entities: list[EntityType] | None = Field(
        None,
        description="Restrict to a subset; null = scan for all configured entity types.",
    )
    score_threshold: float = Field(0.4, ge=0.0, le=1.0)


class Detection(BaseModel):
    entity_type: EntityType
    start: int
    end: int
    score: float = Field(..., ge=0.0, le=1.0)
    text: str            # the matched span, returned for caller convenience


class ScanResponse(BaseModel):
    request_id: str
    detections: list[Detection]
    detector_version: str = "stub-0.1.0"
    skipped: bool = True   # true while running the A.1 stub


class RedactRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=200_000)
    language: str = Field("en")
    entities: list[EntityType] | None = None
    score_threshold: float = Field(0.4, ge=0.0, le=1.0)
    mode: RedactMode = Field(
        "replace",
        description=(
            "mask=replace each char with '*'; replace=swap with '<ENTITY_TYPE>'; "
            "remove=delete the span; hash=swap with sha256 prefix"
        ),
    )


class RedactResponse(BaseModel):
    request_id: str
    redacted_text: str
    detections: list[Detection]
    skipped: bool = True


# ─── Endpoints ─────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "pii-detection", "version": "0.1.0"}


@app.post("/scan", response_model=ScanResponse)
async def scan(req: ScanRequest) -> ScanResponse:
    """Scan text for PII; return structured detections without modifying input.

    Phase A.1 stub: returns empty detections. A.2 swaps in Presidio Analyzer
    with the workspace's configured language + custom recognizers.
    """
    request_id = str(uuid4())
    log.info(
        "pii.scan",
        request_id=request_id,
        text_len=len(req.text),
        language=req.language,
        score_threshold=req.score_threshold,
    )

    if STUB_MODE:
        return ScanResponse(request_id=request_id, detections=[], skipped=True)

    # A.2: Presidio analyzer call lands here.
    raise NotImplementedError("Presidio backend wired in A.2")


@app.post("/redact", response_model=RedactResponse)
async def redact(req: RedactRequest) -> RedactResponse:
    """Redact PII from text using the requested replacement mode.

    Phase A.1 stub: returns the input unchanged with no detections. A.2 swaps
    in Presidio Analyzer + Anonymizer; configurable replacement strategies map
    to Anonymizer operators (mask, replace, redact, hash).
    """
    request_id = str(uuid4())
    log.info(
        "pii.redact",
        request_id=request_id,
        text_len=len(req.text),
        language=req.language,
        mode=req.mode,
    )

    if STUB_MODE:
        return RedactResponse(
            request_id=request_id,
            redacted_text=req.text,
            detections=[],
            skipped=True,
        )

    raise NotImplementedError("Presidio backend wired in A.2")
