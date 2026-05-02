"""retrieve_high_performers — offline-stub fallback + input-schema validation."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from tools.retrieve_high_performers import (
    RetrieveHighPerformersInput,
    retrieve_high_performers_tool,
)


def test_retrieve_high_performers_stub_fallback_returns_empty_list() -> None:
    result = retrieve_high_performers_tool._run(  # type: ignore[attr-defined]
        company_id="c_test",
        topic="growth marketing",
    )
    assert result == []


def test_retrieve_high_performers_input_defaults() -> None:
    schema = RetrieveHighPerformersInput(company_id="c_test", topic="x")
    assert schema.kpi == "engagement_rate"
    assert schema.percentile == 75
    assert schema.k == 3
    assert schema.platform is None


def test_retrieve_high_performers_input_rejects_percentile_below_50() -> None:
    with pytest.raises(ValidationError):
        RetrieveHighPerformersInput(company_id="c_test", topic="x", percentile=49)


def test_retrieve_high_performers_input_rejects_percentile_at_100() -> None:
    with pytest.raises(ValidationError):
        RetrieveHighPerformersInput(company_id="c_test", topic="x", percentile=100)


def test_retrieve_high_performers_input_rejects_k_below_1() -> None:
    with pytest.raises(ValidationError):
        RetrieveHighPerformersInput(company_id="c_test", topic="x", k=0)


def test_retrieve_high_performers_input_rejects_k_above_10() -> None:
    with pytest.raises(ValidationError):
        RetrieveHighPerformersInput(company_id="c_test", topic="x", k=11)


def test_retrieve_high_performers_input_accepts_valid_kpis() -> None:
    for kpi in ("ctr", "engagement_rate", "conversion_rate"):
        schema = RetrieveHighPerformersInput(
            company_id="c_test", topic="x", kpi=kpi  # type: ignore[arg-type]
        )
        assert schema.kpi == kpi


def test_retrieve_high_performers_input_rejects_invalid_kpi() -> None:
    with pytest.raises(ValidationError):
        RetrieveHighPerformersInput(
            company_id="c_test",
            topic="x",
            kpi="impressions",  # type: ignore[arg-type]
        )


def test_retrieve_high_performers_input_accepts_platform() -> None:
    schema = RetrieveHighPerformersInput(
        company_id="c_test", topic="x", platform="linkedin"
    )
    assert schema.platform == "linkedin"


def test_retrieve_high_performers_tool_metadata() -> None:
    assert retrieve_high_performers_tool.name == "retrieve_high_performers"
    assert (
        retrieve_high_performers_tool.args_schema is RetrieveHighPerformersInput
    )
