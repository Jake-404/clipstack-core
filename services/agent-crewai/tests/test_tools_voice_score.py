"""voice_score — offline-stub fallback + input-schema validation."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from tools.voice_score import VoiceScoreInput, voice_score_tool


def test_voice_score_stub_fallback_returns_pass_with_score_one() -> None:
    """With VOICE_SCORER_BASE_URL unset, _run() fails open: score=1.0, passes=True."""
    result = voice_score_tool._run(  # type: ignore[attr-defined]
        company_id="c_test",
        draft="A draft of text to score against the workspace voice corpus.",
    )
    assert isinstance(result, dict)
    assert result["score"] == 1.0
    assert result["passes"] is True
    assert result["nearest"] == []
    assert result["farthest"] == []


def test_voice_score_input_defaults() -> None:
    schema = VoiceScoreInput(company_id="c_test", draft="hello")
    assert schema.threshold == 0.65
    assert schema.client_id is None


def test_voice_score_input_rejects_empty_draft() -> None:
    with pytest.raises(ValidationError):
        VoiceScoreInput(company_id="c_test", draft="")


def test_voice_score_input_rejects_threshold_above_one() -> None:
    with pytest.raises(ValidationError):
        VoiceScoreInput(company_id="c_test", draft="hi", threshold=1.5)


def test_voice_score_input_rejects_threshold_negative() -> None:
    with pytest.raises(ValidationError):
        VoiceScoreInput(company_id="c_test", draft="hi", threshold=-0.1)


def test_voice_score_input_accepts_threshold_at_bounds() -> None:
    assert VoiceScoreInput(company_id="c_test", draft="hi", threshold=0.0).threshold == 0.0
    assert VoiceScoreInput(company_id="c_test", draft="hi", threshold=1.0).threshold == 1.0


def test_voice_score_tool_metadata() -> None:
    assert voice_score_tool.name == "voice_score"
    assert "voice" in voice_score_tool.description.lower()
    assert voice_score_tool.args_schema is VoiceScoreInput
