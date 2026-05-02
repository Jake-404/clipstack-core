"""FastAPI shell — /health 200 + JSON shape, /crews discovery."""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app


def test_health_returns_200_and_expected_shape() -> None:
    with TestClient(app) as client:
        resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"status": "ok", "service": "agent-crewai", "version": "0.1.0"}


def test_crews_discovery_lists_available_and_planned() -> None:
    with TestClient(app) as client:
        resp = client.get("/crews")
    assert resp.status_code == 200
    body = resp.json()
    assert "available" in body
    assert "planned" in body
    assert isinstance(body["available"], list)
    assert isinstance(body["planned"], list)
    # content_factory is the foundational crew — must always be available.
    assert "content_factory" in body["available"]
