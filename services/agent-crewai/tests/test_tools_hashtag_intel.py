"""hashtag_intel — pure A.0 stub + input-schema validation.

The tool is a pure stub (no env-driven branch — returns []). Tests still
assert the offline behaviour matches the contract crews depend on, plus
the input schema rejects malformed platform / k values."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from tools.hashtag_intel import HashtagIntelInput, hashtag_intel_tool


def test_hashtag_intel_stub_returns_empty_list() -> None:
    result = hashtag_intel_tool._run(  # type: ignore[attr-defined]
        platform="x",
        topic="growth",
        company_id="c_test",
    )
    assert result == []


def test_hashtag_intel_input_defaults() -> None:
    schema = HashtagIntelInput(platform="linkedin", topic="x", company_id="c_test")
    assert schema.k == 5


def test_hashtag_intel_input_accepts_valid_platforms() -> None:
    for platform in ("x", "linkedin", "reddit", "tiktok", "instagram"):
        schema = HashtagIntelInput(platform=platform, topic="x", company_id="c_test")
        assert schema.platform == platform


def test_hashtag_intel_input_rejects_unknown_platform() -> None:
    with pytest.raises(ValidationError):
        HashtagIntelInput(platform="myspace", topic="x", company_id="c_test")


def test_hashtag_intel_input_rejects_k_below_1() -> None:
    with pytest.raises(ValidationError):
        HashtagIntelInput(platform="x", topic="x", company_id="c_test", k=0)


def test_hashtag_intel_input_rejects_k_above_15() -> None:
    with pytest.raises(ValidationError):
        HashtagIntelInput(platform="x", topic="x", company_id="c_test", k=16)


def test_hashtag_intel_input_accepts_k_at_bounds() -> None:
    assert (
        HashtagIntelInput(platform="x", topic="t", company_id="c", k=1).k == 1
    )
    assert (
        HashtagIntelInput(platform="x", topic="t", company_id="c", k=15).k == 15
    )


def test_hashtag_intel_tool_metadata() -> None:
    assert hashtag_intel_tool.name == "hashtag_intel"
    assert "hashtag" in hashtag_intel_tool.description.lower()
    assert hashtag_intel_tool.args_schema is HashtagIntelInput
