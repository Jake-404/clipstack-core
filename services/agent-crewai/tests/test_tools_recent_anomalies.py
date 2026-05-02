"""recent_anomalies — offline-stub fallback + input-schema validation."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from tools.recent_anomalies import RecentAnomaliesInput, recent_anomalies_tool


def test_recent_anomalies_stub_fallback_returns_empty_list() -> None:
    """With PERFORMANCE_INGEST_BASE_URL + SERVICE_TOKEN unset, _run() returns []."""
    result = recent_anomalies_tool._run(  # type: ignore[attr-defined]
        company_id="c_test",
    )
    assert result == []


def test_recent_anomalies_input_defaults() -> None:
    schema = RecentAnomaliesInput(company_id="c_test")
    assert schema.lookback_hours == 24
    assert schema.z_threshold == 2.5
    assert schema.client_id is None


def test_recent_anomalies_input_rejects_lookback_zero() -> None:
    with pytest.raises(ValidationError):
        RecentAnomaliesInput(company_id="c_test", lookback_hours=0)


def test_recent_anomalies_input_rejects_lookback_above_168() -> None:
    with pytest.raises(ValidationError):
        RecentAnomaliesInput(company_id="c_test", lookback_hours=169)


def test_recent_anomalies_input_accepts_lookback_at_bounds() -> None:
    assert (
        RecentAnomaliesInput(company_id="c_test", lookback_hours=1).lookback_hours == 1
    )
    assert (
        RecentAnomaliesInput(company_id="c_test", lookback_hours=168).lookback_hours
        == 168
    )


def test_recent_anomalies_input_rejects_z_threshold_zero() -> None:
    with pytest.raises(ValidationError):
        RecentAnomaliesInput(company_id="c_test", z_threshold=0.0)


def test_recent_anomalies_input_rejects_z_threshold_negative() -> None:
    with pytest.raises(ValidationError):
        RecentAnomaliesInput(company_id="c_test", z_threshold=-1.0)


def test_recent_anomalies_input_accepts_positive_z_threshold() -> None:
    assert (
        RecentAnomaliesInput(company_id="c_test", z_threshold=0.5).z_threshold == 0.5
    )
    assert (
        RecentAnomaliesInput(company_id="c_test", z_threshold=4.0).z_threshold == 4.0
    )


def test_recent_anomalies_tool_metadata() -> None:
    assert recent_anomalies_tool.name == "recent_anomalies"
    assert "anomal" in recent_anomalies_tool.description.lower()
    assert recent_anomalies_tool.args_schema is RecentAnomaliesInput
