"""recall_lessons — offline-stub fallback + input-schema validation."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from tools.recall_lessons import RecallLessonsInput, recall_lessons_tool


def test_recall_lessons_stub_fallback_returns_empty_list() -> None:
    """With APPROVAL_UI_BASE_URL + SERVICE_TOKEN unset, _run() must return []."""
    result = recall_lessons_tool._run(  # type: ignore[attr-defined]
        company_id="c_test",
        topic="launching a product on linkedin",
    )
    assert result == []


def test_recall_lessons_input_accepts_scope_none() -> None:
    """scope is optional; default None must validate."""
    schema = RecallLessonsInput(company_id="c_test", topic="x", scope=None)
    assert schema.scope is None
    assert schema.k == 5  # default


def test_recall_lessons_input_accepts_valid_scopes() -> None:
    for scope in ("forever", "this_topic", "this_client"):
        schema = RecallLessonsInput(
            company_id="c_test", topic="x", scope=scope  # type: ignore[arg-type]
        )
        assert schema.scope == scope


def test_recall_lessons_input_rejects_k_above_20() -> None:
    with pytest.raises(ValidationError):
        RecallLessonsInput(company_id="c_test", topic="x", k=21)


def test_recall_lessons_input_rejects_k_below_1() -> None:
    with pytest.raises(ValidationError):
        RecallLessonsInput(company_id="c_test", topic="x", k=0)


def test_recall_lessons_input_accepts_k_at_bounds() -> None:
    assert RecallLessonsInput(company_id="c_test", topic="x", k=1).k == 1
    assert RecallLessonsInput(company_id="c_test", topic="x", k=20).k == 20


def test_recall_lessons_input_rejects_invalid_scope() -> None:
    with pytest.raises(ValidationError):
        RecallLessonsInput(
            company_id="c_test",
            topic="x",
            scope="invalid_scope",  # type: ignore[arg-type]
        )


def test_recall_lessons_tool_metadata() -> None:
    assert recall_lessons_tool.name == "recall_lessons"
    assert "lessons" in recall_lessons_tool.description.lower()
    assert recall_lessons_tool.args_schema is RecallLessonsInput
