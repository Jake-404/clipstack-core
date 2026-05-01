"""PII detection + redaction service.

Per Doc 5 §1 P0 — inbound text scan before workspace artifacts land in
Postgres / Qdrant. Two endpoints:

  POST /scan    — return structured detections; do not modify the text
  POST /redact  — return text with PII replaced per the requested mode

Real backend (sprint-close+): Presidio Analyzer + Anonymizer with custom
CRYPTO_WALLET + API_KEY recognizers. Lazy engine init keeps cold start
fast for stub-mode dev runs and only loads spaCy + Presidio on the first
real request.

Stub mode (env-aware default):
  dev/test: PII_STUB_MODE=1 → returns empty detections without touching
            the engines.
  prod:     PII_STUB_MODE=0 by default → calls the real engines. Forgot-
            to-wire deploys fail loudly with a clear "spaCy model missing"
            error rather than silently returning fake "no PII detected".

Mounted at port 8003. Health check is consumed by docker-compose.
Other services (agent-crewai, agent-langgraph, approval-ui) call this
HTTP-internally, never the underlying library, so the implementation
can swap from Presidio to anything else without touching callers.
"""

from __future__ import annotations

import hashlib
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Literal
from uuid import uuid4

import structlog
from fastapi import FastAPI, HTTPException
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
    backend will fail loudly rather than silently serve fake responses
    on real customer data.)
    """
    return "0" if _is_production() else "1"


STUB_MODE: bool = os.getenv("PII_STUB_MODE", _stub_mode_default()) == "1"
SPACY_MODEL: str = os.getenv("SPACY_MODEL", "en_core_web_sm")

# Lazy-loaded engines. Built on first non-stub request so cold start
# stays fast in stub mode (and so import-time failures don't crash the
# service when STUB_MODE=1).
_analyzer: Any | None = None
_anonymizer: Any | None = None


def _build_analyzer() -> Any:
    """Construct the Presidio AnalyzerEngine + register custom recognizers.

    Imports are lazy: the presidio packages are heavy (~200MB cumulative)
    and we want stub-mode services to start instantly. Production deploys
    pay the import cost on the first /scan or /redact call.
    """
    from presidio_analyzer import AnalyzerEngine  # type: ignore[import-not-found]
    from presidio_analyzer.nlp_engine import NlpEngineProvider  # type: ignore[import-not-found]

    from recognizers import custom_recognizers

    # Configure spaCy via NlpEngineProvider so we can swap models per-env
    # without code changes (SPACY_MODEL=en_core_web_lg in prod for higher
    # accuracy; en_core_web_sm in dev for fast cold start).
    nlp_config = {
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": "en", "model_name": SPACY_MODEL}],
    }
    nlp_engine = NlpEngineProvider(nlp_configuration=nlp_config).create_engine()

    engine = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["en"])
    for r in custom_recognizers():
        engine.registry.add_recognizer(r)
    return engine


def _build_anonymizer() -> Any:
    from presidio_anonymizer import AnonymizerEngine  # type: ignore[import-not-found]

    return AnonymizerEngine()


def get_analyzer() -> Any:
    global _analyzer
    if _analyzer is None:
        _analyzer = _build_analyzer()
        log.info(
            "presidio.analyzer.loaded",
            spacy_model=SPACY_MODEL,
            recognizer_count=len(_analyzer.registry.recognizers),
        )
    return _analyzer


def get_anonymizer() -> Any:
    global _anonymizer
    if _anonymizer is None:
        _anonymizer = _build_anonymizer()
        log.info("presidio.anonymizer.loaded")
    return _anonymizer


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log.info(
        "startup",
        service="pii-detection",
        stub_mode=STUB_MODE,
        spacy_model=SPACY_MODEL,
        environment=os.getenv("ENVIRONMENT") or os.getenv("NODE_ENV") or "development",
    )
    if STUB_MODE and _is_production():
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

# Presidio's standard entity catalog plus the two Clipstack custom
# recognizers (CRYPTO_WALLET, API_KEY). Workspace can disable any of these
# via the `entities` filter on a per-call basis.
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
    "NRP",
    "CRYPTO_WALLET",
    "API_KEY",
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
    text: str  # the matched span, returned for caller convenience


class ScanResponse(BaseModel):
    request_id: str
    detections: list[Detection]
    detector_version: str = "stub-0.1.0"
    skipped: bool = True


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


# ─── Internals ─────────────────────────────────────────────────────────────


def _detector_version() -> str:
    """Best-effort version string: presidio-analyzer's __version__, with the
    spaCy model + custom-recognizer count appended. Returned to callers so
    a model bump is visible in logs / audit trails."""
    try:
        import presidio_analyzer  # type: ignore[import-not-found]

        return f"presidio-analyzer-{presidio_analyzer.__version__} ({SPACY_MODEL})"
    except Exception:  # noqa: BLE001
        return f"presidio (unknown version, {SPACY_MODEL})"


def _to_detection(text: str, result: Any) -> Detection:
    """Convert a Presidio RecognizerResult to our Detection shape."""
    return Detection(
        entity_type=result.entity_type,
        start=result.start,
        end=result.end,
        score=float(result.score),
        text=text[result.start : result.end],
    )


def _operator_for_mode(mode: RedactMode, entity_type: str, span: str) -> Any:
    """Map our RedactMode to a Presidio OperatorConfig per matched entity.

    `replace` builds a per-entity `<{entity_type}>` placeholder so the
    redacted text reads as documentation. `mask` replaces all chars with
    '*'. `remove` deletes the span entirely. `hash` swaps in a short
    SHA-256 prefix so callers can correlate the same value across documents
    without recovering it.
    """
    from presidio_anonymizer.entities import OperatorConfig  # type: ignore[import-not-found]

    if mode == "mask":
        return OperatorConfig(
            "mask",
            {"masking_char": "*", "chars_to_mask": -1, "from_end": False},
        )
    if mode == "replace":
        return OperatorConfig("replace", {"new_value": f"<{entity_type}>"})
    if mode == "remove":
        # Presidio's "redact" operator deletes the span; our "remove" maps
        # to it.
        return OperatorConfig("redact")
    if mode == "hash":
        digest = hashlib.sha256(span.encode("utf-8")).hexdigest()[:12]
        return OperatorConfig("replace", {"new_value": f"<#{digest}>"})
    raise ValueError(f"unknown redact mode: {mode}")


# ─── Endpoints ─────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "pii-detection", "version": "0.1.0"}


@app.post("/scan", response_model=ScanResponse)
async def scan(req: ScanRequest) -> ScanResponse:
    """Scan text for PII; return structured detections without modifying input."""
    request_id = str(uuid4())
    log.info(
        "pii.scan",
        request_id=request_id,
        text_len=len(req.text),
        language=req.language,
        score_threshold=req.score_threshold,
        # Never log req.text — Privacy.md §1 PII discipline.
    )

    if STUB_MODE:
        return ScanResponse(request_id=request_id, detections=[], skipped=True)

    try:
        analyzer = get_analyzer()
    except Exception as e:  # noqa: BLE001
        log.error("presidio.analyzer.load_failed", error=str(e))
        raise HTTPException(
            status_code=500,
            detail=(
                f"Presidio analyzer failed to load (model={SPACY_MODEL!r}): {e}. "
                "Install via `python -m spacy download <model>` in the service image."
            ),
        ) from e

    results = analyzer.analyze(
        text=req.text,
        language=req.language,
        entities=list(req.entities) if req.entities else None,
        score_threshold=req.score_threshold,
    )

    detections = [_to_detection(req.text, r) for r in results]
    log.info(
        "pii.scan.complete",
        request_id=request_id,
        detection_count=len(detections),
    )
    return ScanResponse(
        request_id=request_id,
        detections=detections,
        detector_version=_detector_version(),
        skipped=False,
    )


@app.post("/redact", response_model=RedactResponse)
async def redact(req: RedactRequest) -> RedactResponse:
    """Redact PII from text using the requested replacement mode."""
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

    try:
        analyzer = get_analyzer()
        anonymizer = get_anonymizer()
    except Exception as e:  # noqa: BLE001
        log.error("presidio.engines.load_failed", error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Presidio engines failed to load: {e}",
        ) from e

    analyzer_results = analyzer.analyze(
        text=req.text,
        language=req.language,
        entities=list(req.entities) if req.entities else None,
        score_threshold=req.score_threshold,
    )

    # Build per-entity operator config so each detection uses the right
    # placeholder shape.
    operators: dict[str, Any] = {}
    for r in analyzer_results:
        operators[r.entity_type] = _operator_for_mode(
            req.mode, r.entity_type, req.text[r.start : r.end]
        )
    if not operators:
        # No detections — return text unchanged.
        return RedactResponse(
            request_id=request_id,
            redacted_text=req.text,
            detections=[],
            skipped=False,
        )

    anonymized = anonymizer.anonymize(
        text=req.text,
        analyzer_results=analyzer_results,
        operators=operators,
    )

    detections = [_to_detection(req.text, r) for r in analyzer_results]
    log.info(
        "pii.redact.complete",
        request_id=request_id,
        detection_count=len(detections),
    )
    return RedactResponse(
        request_id=request_id,
        redacted_text=anonymized.text,
        detections=detections,
        skipped=False,
    )
