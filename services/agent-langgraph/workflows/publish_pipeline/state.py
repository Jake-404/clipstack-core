"""State shape for the publish pipeline.

LangGraph passes a single TypedDict through every node. Mutations are
returned, not in-place — LangGraph diffs and persists per node.
"""

from __future__ import annotations

from typing import Literal, TypedDict

ReviewVerdict = Literal["pass", "block", "revise"]
ApprovalDecision = Literal["pending", "approve", "deny"]


class PublishState(TypedDict, total=False):
    # ─── Inputs (immutable through the run) ────────────────────────────────
    run_id: str
    company_id: str
    draft_id: str
    channel: str
    scheduled_at: str | None

    # ─── Draft + revision state ───────────────────────────────────────────
    draft_text: str
    revision_count: int
    max_revisions: int  # default 3, configurable per workspace

    # ─── Review-cycle outputs ──────────────────────────────────────────────
    voice_score: float | None
    voice_passes: bool | None
    claim_verdicts: list[dict]  # from claim_verifier (USP 8)
    critic_notes: str | None
    last_review_verdict: ReviewVerdict | None

    # ─── Human approval ────────────────────────────────────────────────────
    approval_id: str | None
    approval_decision: ApprovalDecision
    approval_rationale: str | None  # required if decision == 'deny' (USP 5)
    approval_scope: Literal["forever", "this_topic", "this_client"] | None

    # ─── Publish + metering ────────────────────────────────────────────────
    published_url: str | None
    published_at: str | None
    metering_event_id: str | None

    # ─── Trace ─────────────────────────────────────────────────────────────
    trace_id: str | None
    error: str | None
