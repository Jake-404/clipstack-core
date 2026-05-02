"""Shared pytest fixtures for agent-langgraph tests.

Tests run in offline-stub mode: env vars pointing at Postgres / Redpanda /
percentile-predictor / bandit-orchestrator / approval-ui are cleared at
conftest *module-import* time (before any test module imports the service
code) so the EVENTBUS_ENABLED / *_BASE_URL constants captured at module
top-level inside producer.py + nodes.py see the absent values.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest

# Env vars consulted by main.py + workflows/publish_pipeline/{graph,nodes}.py
# + producer.py at import / call time.
_ENV_VARS_TO_CLEAR: tuple[str, ...] = (
    "SERVICE_TOKEN",
    "APPROVAL_UI_BASE_URL",
    "PERCENTILE_PREDICTOR_BASE_URL",
    "BANDIT_ORCHESTRATOR_BASE_URL",
    "EVENTBUS_ENABLED",
    "REDPANDA_BROKERS",
    "PRODUCER_CLIENT_ID",
    "POSTGRES_URL",
    "LANGGRAPH_PERSIST_STATE",
    "LANGGRAPH_DRY_RUN",
    "LITELLM_BASE_URL",
    "LANGFUSE_ENABLED",
    "LANGFUSE_HOST",
    "LANGFUSE_PUBLIC_KEY",
    "LANGFUSE_SECRET_KEY",
)

# Module-import-time clear: same reasoning as agent-crewai's conftest.
# producer.py captures EVENTBUS_ENABLED at import; nodes.py likewise. The
# fixture function below only restores on teardown.
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
