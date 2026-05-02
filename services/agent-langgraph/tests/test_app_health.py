"""FastAPI shell — /health 200 + JSON shape, /workflows discovery."""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app


def test_health_returns_200_and_expected_shape() -> None:
    with TestClient(app) as client:
        resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"status": "ok", "service": "agent-langgraph", "version": "0.1.0"}


def test_workflows_discovery_lists_publish_pipeline() -> None:
    with TestClient(app) as client:
        resp = client.get("/workflows")
    assert resp.status_code == 200
    body = resp.json()
    assert "available" in body
    assert "planned" in body
    assert "publish_pipeline" in body["available"]


def test_producer_status_returns_disabled_shape() -> None:
    """In test env (EVENTBUS_ENABLED unset), producer reports disabled."""
    with TestClient(app) as client:
        resp = client.get("/producer/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is False
    assert body["started"] is False
    assert "emit_count" in body
    assert "emit_errors" in body
