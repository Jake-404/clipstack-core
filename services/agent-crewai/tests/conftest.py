"""Shared pytest fixtures for agent-crewai tests.

Tests run in offline-stub mode by default. Env vars pointing at backend
services are cleared at conftest *module-import* time (before any test
module imports the service code) so the module-level constants captured
inside `tools/*.py` and `main.py` see the absent values and the tools'
fallback-stub paths kick in.

A `tmp_state_dir` fixture creates a temp directory for any test that
needs filesystem state.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest

# Env vars the agent-crewai tools + main app inspect at import / call time.
# Clearing them up-front guarantees every tool falls back to its stub branch
# (no httpx call attempted) regardless of the developer's shell environment.
_ENV_VARS_TO_CLEAR: tuple[str, ...] = (
    "SERVICE_TOKEN",
    "APPROVAL_UI_BASE_URL",
    "PERFORMANCE_INGEST_BASE_URL",
    "BANDIT_ORCH_BASE_URL",
    "VOICE_SCORER_BASE_URL",
    "LITELLM_BASE_URL",
    "LITELLM_MASTER_KEY",
    "LANGFUSE_ENABLED",
    "LANGFUSE_HOST",
    "LANGFUSE_PUBLIC_KEY",
    "LANGFUSE_SECRET_KEY",
    "CREWAI_DRY_RUN",
    "ENVIRONMENT",
    "NODE_ENV",
)

# Module-import-time clear: pytest collects tests by importing test modules,
# which import the service code, which captures os.getenv() into module-level
# constants. Fixtures don't run until after collection — so the clear has to
# happen here, not in a fixture body.
_SAVED_ENV: dict[str, str | None] = {
    var: os.environ.get(var) for var in _ENV_VARS_TO_CLEAR
}
for _var in _ENV_VARS_TO_CLEAR:
    os.environ.pop(_var, None)


@pytest.fixture(scope="session", autouse=True)
def _stub_mode_env() -> Iterator[None]:
    """Session-scoped autouse: restore env on session teardown."""
    try:
        yield
    finally:
        for var, value in _SAVED_ENV.items():
            if value is None:
                os.environ.pop(var, None)
            else:
                os.environ[var] = value


@pytest.fixture
def tmp_state_dir(tmp_path: Path) -> Path:
    """Per-test temp directory for any filesystem state."""
    state_dir = tmp_path / "state"
    state_dir.mkdir(parents=True, exist_ok=True)
    return state_dir
