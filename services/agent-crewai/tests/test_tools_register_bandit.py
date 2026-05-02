"""register_bandit — offline-stub fallback + input-schema validation."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from tools.register_bandit import (
    RegisterBanditInput,
    VariantInput,
    register_bandit_tool,
)


def _valid_variants() -> list[dict[str, object]]:
    return [
        {
            "variant_id": "v1",
            "draft_id": "d1",
            "body_excerpt": "first hook",
            "predicted_percentile": 60.0,
        },
        {
            "variant_id": "v2",
            "draft_id": "d2",
            "body_excerpt": "second hook",
            "predicted_percentile": 70.0,
        },
    ]


def test_register_bandit_stub_fallback_returns_stub_id() -> None:
    """With BANDIT_ORCH_BASE_URL + SERVICE_TOKEN unset, _run() returns the stub."""
    result = register_bandit_tool._run(  # type: ignore[attr-defined]
        company_id="c_test",
        campaign_id="cam_1",
        platform="x",
        message_pillar="launch announcement",
        variants=_valid_variants(),
    )
    assert isinstance(result, dict)
    assert result["bandit_id"] == "bandit_stub"
    assert result["arm_count"] == 2
    assert result["skipped"] is True


def test_variant_input_rejects_blank_variant_id() -> None:
    with pytest.raises(ValidationError):
        VariantInput(variant_id="", draft_id="d1", body_excerpt="x")


def test_variant_input_rejects_predicted_percentile_above_100() -> None:
    with pytest.raises(ValidationError):
        VariantInput(
            variant_id="v1", draft_id="d1", body_excerpt="x", predicted_percentile=150.0
        )


def test_variant_input_rejects_predicted_percentile_negative() -> None:
    with pytest.raises(ValidationError):
        VariantInput(
            variant_id="v1", draft_id="d1", body_excerpt="x", predicted_percentile=-1.0
        )


def test_register_bandit_input_rejects_too_few_variants() -> None:
    with pytest.raises(ValidationError):
        RegisterBanditInput(
            company_id="c_test",
            campaign_id="cam_1",
            platform="x",
            message_pillar="p",
            variants=[VariantInput(variant_id="only", draft_id="d", body_excerpt="x")],
        )


def test_register_bandit_input_rejects_too_many_variants() -> None:
    too_many = [
        VariantInput(variant_id=f"v{i}", draft_id=f"d{i}", body_excerpt="x")
        for i in range(11)
    ]
    with pytest.raises(ValidationError):
        RegisterBanditInput(
            company_id="c_test",
            campaign_id="cam_1",
            platform="x",
            message_pillar="p",
            variants=too_many,
        )


def test_register_bandit_input_rejects_invalid_platform() -> None:
    with pytest.raises(ValidationError):
        RegisterBanditInput(
            company_id="c_test",
            campaign_id="cam_1",
            platform="myspace",  # type: ignore[arg-type]
            message_pillar="p",
            variants=[
                VariantInput(variant_id="v1", draft_id="d1", body_excerpt="x"),
                VariantInput(variant_id="v2", draft_id="d2", body_excerpt="x"),
            ],
        )


def test_register_bandit_input_rejects_exploration_below_floor() -> None:
    with pytest.raises(ValidationError):
        RegisterBanditInput(
            company_id="c_test",
            campaign_id="cam_1",
            platform="x",
            message_pillar="p",
            variants=[
                VariantInput(variant_id="v1", draft_id="d1", body_excerpt="x"),
                VariantInput(variant_id="v2", draft_id="d2", body_excerpt="x"),
            ],
            exploration_budget=0.01,
        )


def test_register_bandit_input_defaults() -> None:
    schema = RegisterBanditInput(
        company_id="c_test",
        campaign_id="cam_1",
        platform="linkedin",
        message_pillar="p",
        variants=[
            VariantInput(variant_id="v1", draft_id="d1", body_excerpt="x"),
            VariantInput(variant_id="v2", draft_id="d2", body_excerpt="x"),
        ],
    )
    assert schema.algorithm == "thompson"
    assert schema.exploration_budget == 0.10
    assert schema.observation_window_hours == 72


def test_register_bandit_tool_metadata() -> None:
    assert register_bandit_tool.name == "register_bandit"
    assert "bandit" in register_bandit_tool.description.lower()
    assert register_bandit_tool.args_schema is RegisterBanditInput
