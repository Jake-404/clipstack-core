"""Langfuse observability — Phase B.5.

Self-hosted Langfuse instance lives at $LANGFUSE_HOST (docker-compose port
3030 by default). When LANGFUSE_ENABLED=true and the public+secret key pair
is set, every CrewAI tool call + LiteLLM request emits a span; every crew
kickoff opens a trace.

When LANGFUSE_ENABLED=false (default in dev), the helpers are no-ops — the
SDK isn't initialised and no network calls happen. Lets the service run in
local dev without a Langfuse instance.

Trace conventions (locked B.5):
  - trace.name        = f"{service}.{endpoint}"  e.g. "agent-crewai.content_factory.kickoff"
  - trace.metadata    = {company_id, client_id, request_id}
  - span per tool call = name = tool name; input/output preserved
  - span per LLM call = auto-emitted by LiteLLM's langfuse callback
  - tags             = [crew_id, agent_role, environment]

Reference: services/shared/observability/README.md (cross-service contract).
"""

from __future__ import annotations

import os
from typing import Any

import structlog

log = structlog.get_logger()

LANGFUSE_ENABLED: bool = os.getenv("LANGFUSE_ENABLED", "false").lower() == "true"
LANGFUSE_HOST = os.getenv("LANGFUSE_HOST", "http://langfuse:3000")
LANGFUSE_PUBLIC_KEY = os.getenv("LANGFUSE_PUBLIC_KEY")
LANGFUSE_SECRET_KEY = os.getenv("LANGFUSE_SECRET_KEY")
SERVICE_NAME = "agent-crewai"
ENVIRONMENT = (
    os.getenv("ENVIRONMENT") or os.getenv("NODE_ENV") or "development"
)

_client: Any | None = None


def init_langfuse() -> Any | None:
    """Initialise the Langfuse client. Idempotent — second call returns the
    cached instance. Returns None when LANGFUSE_ENABLED=false or the key
    pair is missing (so call sites can `if client := get_langfuse()` cheaply).
    """
    global _client
    if _client is not None:
        return _client

    if not LANGFUSE_ENABLED:
        log.debug("langfuse.disabled", service=SERVICE_NAME)
        return None

    if not (LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY):
        log.warning(
            "langfuse.missing_keys",
            service=SERVICE_NAME,
            message=(
                "LANGFUSE_ENABLED=true but LANGFUSE_PUBLIC_KEY / "
                "LANGFUSE_SECRET_KEY not set. Tracing disabled. "
                "Set both keys or unset LANGFUSE_ENABLED."
            ),
        )
        return None

    try:
        # Lazy import — keeps the module importable even when the langfuse
        # package isn't installed (e.g., a test that mocks observability).
        from langfuse import Langfuse  # type: ignore[import-not-found]

        _client = Langfuse(
            public_key=LANGFUSE_PUBLIC_KEY,
            secret_key=LANGFUSE_SECRET_KEY,
            host=LANGFUSE_HOST,
            release=os.getenv("CLIPSTACK_RELEASE", "dev"),
        )
        log.info(
            "langfuse.initialised",
            service=SERVICE_NAME,
            host=LANGFUSE_HOST,
            environment=ENVIRONMENT,
        )
    except ImportError:
        log.warning("langfuse.import_failed", service=SERVICE_NAME)
        return None
    except Exception as e:  # noqa: BLE001
        # Connection / auth failures shouldn't crash the service. Tracing is
        # advisory — if Langfuse is down, agents still need to run.
        log.warning("langfuse.init_failed", service=SERVICE_NAME, error=str(e))
        return None

    return _client


def get_langfuse() -> Any | None:
    """Accessor — returns the cached client if initialised, else None.
    Call sites use the walrus pattern: `if client := get_langfuse(): ...`
    """
    return _client


def flush_langfuse() -> None:
    """Drain pending events. Call on service shutdown so in-flight traces
    aren't lost when the container restarts.
    """
    if _client is not None:
        try:
            _client.flush()
            log.info("langfuse.flushed", service=SERVICE_NAME)
        except Exception as e:  # noqa: BLE001
            log.warning("langfuse.flush_failed", service=SERVICE_NAME, error=str(e))
