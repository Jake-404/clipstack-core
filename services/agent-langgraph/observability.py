"""Langfuse observability — Phase B.5.

Mirror of services/agent-crewai/observability.py with SERVICE_NAME flipped.
Inlined per service rather than shared as a package because the python
services have separate pyproject.tomls — keeps each service self-contained
at the cost of ~80 lines of duplication.

Trace conventions documented in services/shared/observability/README.md.
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
SERVICE_NAME = "agent-langgraph"
ENVIRONMENT = (
    os.getenv("ENVIRONMENT") or os.getenv("NODE_ENV") or "development"
)

_client: Any | None = None


def init_langfuse() -> Any | None:
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
                "LANGFUSE_SECRET_KEY not set. Tracing disabled."
            ),
        )
        return None

    try:
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
        log.warning("langfuse.init_failed", service=SERVICE_NAME, error=str(e))
        return None

    return _client


def get_langfuse() -> Any | None:
    return _client


def flush_langfuse() -> None:
    if _client is not None:
        try:
            _client.flush()
            log.info("langfuse.flushed", service=SERVICE_NAME)
        except Exception as e:  # noqa: BLE001
            log.warning("langfuse.flush_failed", service=SERVICE_NAME, error=str(e))
