"""Pure-function node tests for the publish pipeline.

Each node returns a partial state dict; the conditional edge routers
inspect state and return a node name. These are unit tests — no
LangGraph runtime, no external HTTP.
"""

from __future__ import annotations

from typing import cast

from workflows.publish_pipeline.nodes import (
    bandit_allocate,
    review_cycle,
    route_approval,
    route_percentile_gate,
    should_revise,
)
from workflows.publish_pipeline.state import PublishState


def _state(**fields: object) -> PublishState:
    """Helper — build a PublishState. TypedDict so cast over a dict literal."""
    return cast(PublishState, dict(fields))


# ─── review_cycle ─────────────────────────────────────────────────────────────


def test_review_cycle_increments_revision_count_and_passes() -> None:
    out = review_cycle(_state(revision_count=0))
    assert out["revision_count"] == 1
    assert out["voice_score"] == 1.0
    assert out["voice_passes"] is True
    assert out["last_review_verdict"] == "pass"
    assert out["critic_notes"] is None


def test_review_cycle_handles_missing_revision_count() -> None:
    """Defaults to 0 when revision_count not present in state."""
    out = review_cycle(_state())
    assert out["revision_count"] == 1


def test_review_cycle_increments_existing_revision_count() -> None:
    out = review_cycle(_state(revision_count=2))
    assert out["revision_count"] == 3


# ─── should_revise (conditional edge) ─────────────────────────────────────────


def test_should_revise_returns_percentile_gate_on_pass() -> None:
    assert (
        should_revise(_state(last_review_verdict="pass", revision_count=1))
        == "percentile_gate"
    )


def test_should_revise_returns_record_block_lesson_on_block() -> None:
    assert (
        should_revise(_state(last_review_verdict="block", revision_count=1))
        == "record_block_lesson"
    )


def test_should_revise_returns_review_cycle_on_revise_under_max() -> None:
    assert (
        should_revise(
            _state(last_review_verdict="revise", revision_count=1, max_revisions=3)
        )
        == "review_cycle"
    )


def test_should_revise_breaks_loop_when_max_revisions_hit() -> None:
    """At max revisions, even a 'revise' verdict falls through to percentile_gate
    so the run can't loop forever on a stubborn critic."""
    assert (
        should_revise(
            _state(last_review_verdict="revise", revision_count=3, max_revisions=3)
        )
        == "percentile_gate"
    )


# ─── route_approval ───────────────────────────────────────────────────────────


def test_route_approval_returns_bandit_allocate_on_approve() -> None:
    assert route_approval(_state(approval_decision="approve")) == "bandit_allocate"


def test_route_approval_returns_record_deny_lesson_on_deny() -> None:
    assert route_approval(_state(approval_decision="deny")) == "record_deny_lesson"


def test_route_approval_loops_on_pending() -> None:
    assert (
        route_approval(_state(approval_decision="pending"))
        == "awaiting_human_approval"
    )


def test_route_approval_loops_when_decision_missing() -> None:
    """Missing approval_decision defaults to pending → still waiting."""
    assert route_approval(_state()) == "awaiting_human_approval"


# ─── route_percentile_gate ────────────────────────────────────────────────────


def test_route_percentile_gate_pass_through_when_not_blocked() -> None:
    assert (
        route_percentile_gate(_state(gate_blocked=False)) == "awaiting_human_approval"
    )


def test_route_percentile_gate_pass_through_when_unset() -> None:
    """Default = no gate → proceed to human approval."""
    assert route_percentile_gate(_state()) == "awaiting_human_approval"


def test_route_percentile_gate_loops_when_blocked_and_revisions_remain() -> None:
    assert (
        route_percentile_gate(
            _state(gate_blocked=True, revision_count=1, max_revisions=3)
        )
        == "review_cycle"
    )


def test_route_percentile_gate_records_block_when_revisions_exhausted() -> None:
    assert (
        route_percentile_gate(
            _state(gate_blocked=True, revision_count=3, max_revisions=3)
        )
        == "record_block_lesson"
    )


# ─── bandit_allocate (passthrough cases) ──────────────────────────────────────


def test_bandit_allocate_passthrough_when_no_bandit_id() -> None:
    """No bandit_id on state → no-op (return empty dict, graph proceeds)."""
    out = bandit_allocate(_state(bandit_id=None))
    assert out == {}


def test_bandit_allocate_passthrough_when_bandit_id_unset() -> None:
    """Same for completely missing bandit_id."""
    out = bandit_allocate(_state())
    assert out == {}


def test_bandit_allocate_passthrough_when_bus_off_with_bandit() -> None:
    """EVENTBUS_ENABLED=false (cleared in conftest) → passthrough even when
    a bandit_id is present. Module-level constant captured at import; this
    test reflects the production fail-safe contract."""
    out = bandit_allocate(_state(bandit_id="b_xyz"))
    assert out == {}
