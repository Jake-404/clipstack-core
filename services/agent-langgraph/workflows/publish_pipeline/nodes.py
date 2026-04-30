"""Node implementations for the publish pipeline.

Phase A.0 ships node functions with stub bodies — they update state correctly
but don't make external calls. Real wiring (LiteLLM critic call, voice-scorer
HTTP, channel publisher adapter, USP 5 record_lesson, USP 10 meter_events
insert) lands in A.2.

Each node returns a *partial* state dict — LangGraph merges.
"""

from __future__ import annotations

import structlog

from .state import PublishState

log = structlog.get_logger()


# ─── Review-cycle nodes ──────────────────────────────────────────────────────

def review_cycle(state: PublishState) -> dict:
    """Run the critic + reviser pass. Bumps revision_count.

    Phase A.0: marks the cycle as 'pass' so the graph proceeds to approval.
    """
    rev = state.get("revision_count", 0)
    log.info("review_cycle", run_id=state.get("run_id"), revision=rev)

    return {
        "revision_count": rev + 1,
        "voice_score": 1.0,
        "voice_passes": True,
        "last_review_verdict": "pass",
        "critic_notes": None,
    }


def should_revise(state: PublishState) -> str:
    """Conditional edge: revise → review_cycle, pass → awaiting_human_approval, block → END."""
    verdict = state.get("last_review_verdict")
    rev = state.get("revision_count", 0)
    max_rev = state.get("max_revisions", 3)

    if verdict == "revise" and rev < max_rev:
        return "review_cycle"
    if verdict == "block":
        return "record_block_lesson"
    return "awaiting_human_approval"


# ─── Approval gate ───────────────────────────────────────────────────────────

def awaiting_human_approval(state: PublishState) -> dict:
    """Park the run until a human acts on the approval row.

    LangGraph's `interrupt` mechanism pauses here. The run resumes via
    POST /approvals/:id/{approve,deny} from the approval-ui (Doc 7 §2.3).
    """
    log.info("awaiting_human_approval", run_id=state.get("run_id"))
    return {"approval_decision": "pending"}


def route_approval(state: PublishState) -> str:
    decision = state.get("approval_decision", "pending")
    if decision == "approve":
        return "publish_to_channel"
    if decision == "deny":
        return "record_deny_lesson"
    return "awaiting_human_approval"  # still waiting


# ─── Lesson capture (USP 5) ──────────────────────────────────────────────────

def record_block_lesson(state: PublishState) -> dict:
    """Critic blocked the draft. Capture as a `kind=critic_blocked` lesson."""
    log.info("record_block_lesson", run_id=state.get("run_id"))
    # TODO(A.2): POST to services/shared lessons.record with rationale = critic_notes.
    return {}


def record_deny_lesson(state: PublishState) -> dict:
    """Human denied. Capture as a `kind=human_denied` lesson — USP 5."""
    rationale = state.get("approval_rationale")
    if not rationale or len(rationale) < 20:
        # USP 5 enforcement (A.2): rationale must be ≥ 20 chars on deny.
        log.warning(
            "deny_lesson.short_rationale",
            run_id=state.get("run_id"),
            length=len(rationale or ""),
        )
    return {}


# ─── Publish + metering ──────────────────────────────────────────────────────

def publish_to_channel(state: PublishState) -> dict:
    """Hand the draft to the configured channel adapter.

    Phase A.0 stub: pretends success. Real impl calls
    services/adapters/<channel-family>/<concrete>.publish(draft).
    """
    log.info(
        "publish_to_channel",
        run_id=state.get("run_id"),
        channel=state.get("channel"),
    )
    return {
        "published_url": f"https://stub.example.com/{state.get('draft_id', 'unknown')}",
        "published_at": "1970-01-01T00:00:00Z",
    }


def record_metering(state: PublishState) -> dict:
    """USP 10 — emit a meter_events row in the same transaction as the publish.

    Phase A.0 stub: returns a fake metering id. Real impl writes to Postgres.
    """
    log.info("record_metering", run_id=state.get("run_id"))
    return {"metering_event_id": f"meter_{state.get('draft_id', 'unknown')}"}
