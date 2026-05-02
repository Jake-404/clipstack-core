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
    client_id: str | None
    draft_id: str
    channel: str
    scheduled_at: str | None
    # Optional campaign scope — propagated to content.published so
    # campaign rollups + bandit reward attribution can group by campaign.
    campaign_id: str | None

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

    # ─── Percentile gate (Doc 4 §2.4) ──────────────────────────────────────
    # Pre-publish prediction. Set by `percentile_gate` node when EVENTBUS_ENABLED
    # = true; null when the bus tier is off and the gate passes through.
    predicted_percentile: float | None
    predicted_percentile_low: float | None
    predicted_percentile_high: float | None
    # Workspace's gate threshold; below → reroute to revise. Default null = no
    # gate (predict + display only, no auto-block).
    min_percentile_threshold: float | None
    # Set true when the gate decides this draft auto-fails on percentile.
    gate_blocked: bool | None

    # ─── Bandit allocation (Doc 4 §2.3) ────────────────────────────────────
    # Set by `bandit_allocate` node when the campaign has bandits enabled.
    # Carried through to publish so the channel adapter can tag the artefact
    # with variant_id on the content.published event for reward attribution.
    bandit_id: str | None
    bandit_variant_id: str | None
    bandit_arm_score: float | None

    # ─── Publish + metering ────────────────────────────────────────────────
    published_url: str | None
    published_at: str | None
    metering_event_id: str | None

    # ─── Trace ─────────────────────────────────────────────────────────────
    trace_id: str | None
    error: str | None
