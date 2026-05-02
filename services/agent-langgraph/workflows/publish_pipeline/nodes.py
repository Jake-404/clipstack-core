"""Node implementations for the publish pipeline.

Phase A.0 shipped node functions with stub bodies. A.2 introduced the typed
shape; A.3 (this revision) adds the real-time tier nodes:
  - percentile_gate     : calls percentile-predictor before approval
  - bandit_allocate     : calls bandit-orchestrator before publish

Both gated by EVENTBUS_ENABLED — when the bus tier is off, both nodes
short-circuit (pass-through), so the pipeline still works without
Redpanda + percentile-predictor + bandit-orchestrator running.

Each node returns a *partial* state dict — LangGraph merges.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import structlog

from producer import event_producer

from .state import PublishState

log = structlog.get_logger()

EVENTBUS_ENABLED: bool = os.getenv("EVENTBUS_ENABLED", "false").lower() == "true"
PERCENTILE_PREDICTOR_BASE_URL = os.getenv("PERCENTILE_PREDICTOR_BASE_URL")
BANDIT_ORCHESTRATOR_BASE_URL = os.getenv("BANDIT_ORCHESTRATOR_BASE_URL")
APPROVAL_UI_BASE_URL = os.getenv("APPROVAL_UI_BASE_URL")
SERVICE_TOKEN = os.getenv("SERVICE_TOKEN")
SERVICE_NAME = "agent-langgraph"


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
    """Conditional edge: revise → review_cycle, pass → percentile_gate, block → END."""
    verdict = state.get("last_review_verdict")
    rev = state.get("revision_count", 0)
    max_rev = state.get("max_revisions", 3)

    if verdict == "revise" and rev < max_rev:
        return "review_cycle"
    if verdict == "block":
        return "record_block_lesson"
    return "percentile_gate"


# ─── Percentile gate (Doc 4 §2.4) ────────────────────────────────────────────


def percentile_gate(state: PublishState) -> dict:
    """Pre-publish prediction call. When EVENTBUS_ENABLED + the predictor URL
    are set, POST to the predictor's /predict endpoint and store the result
    on state. When the workspace has `min_percentile_threshold` configured
    AND the predicted percentile falls below it, the next conditional edge
    routes back to review_cycle for another revision pass.

    Fail-open: predictor outage / non-200 / network error returns
    predicted=None and the gate passes through. A real-time tier outage
    shouldn't block every draft on the agent side.
    """
    run_id = state.get("run_id")
    if not (EVENTBUS_ENABLED and PERCENTILE_PREDICTOR_BASE_URL):
        log.debug("percentile_gate.passthrough", run_id=run_id)
        return {
            "predicted_percentile": None,
            "predicted_percentile_low": None,
            "predicted_percentile_high": None,
            "gate_blocked": False,
        }

    url = f"{PERCENTILE_PREDICTOR_BASE_URL.rstrip('/')}/predict"
    body = {
        "company_id": state.get("company_id"),
        "kpi": "engagement_rate",
        "features": {
            "text": state.get("draft_text", ""),
            "channel": state.get("channel", "x"),
            "scheduled_for": state.get("scheduled_at"),
            "voice_score": state.get("voice_score"),
            # claim_count + word_count + has_media + hashtags would land here
            # in a future slice when content_factory hands off the structured
            # draft envelope rather than just text.
        },
    }
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.post(url, json=body)
    except (httpx.HTTPError, OSError) as e:
        log.warning("percentile_gate.http_error", run_id=run_id, error=str(e))
        return {
            "predicted_percentile": None,
            "predicted_percentile_low": None,
            "predicted_percentile_high": None,
            "gate_blocked": False,
        }

    if resp.status_code != 200:
        log.warning("percentile_gate.bad_status", run_id=run_id, status=resp.status_code)
        return {
            "predicted_percentile": None,
            "predicted_percentile_low": None,
            "predicted_percentile_high": None,
            "gate_blocked": False,
        }

    data = resp.json()
    predicted = data.get("predicted_percentile")
    low = data.get("confidence_low")
    high = data.get("confidence_high")

    threshold = state.get("min_percentile_threshold")
    blocked = (
        threshold is not None
        and predicted is not None
        and predicted < threshold
    )
    if blocked:
        log.info(
            "percentile_gate.blocked",
            run_id=run_id,
            predicted=predicted,
            threshold=threshold,
        )

    return {
        "predicted_percentile": predicted,
        "predicted_percentile_low": low,
        "predicted_percentile_high": high,
        "gate_blocked": bool(blocked),
    }


def route_percentile_gate(state: PublishState) -> str:
    """If gate_blocked, push the draft back to review_cycle for another pass.
    Otherwise proceed to awaiting_human_approval. Max-revisions cap on the
    review_cycle side prevents infinite loops."""
    if state.get("gate_blocked"):
        rev = state.get("revision_count", 0)
        max_rev = state.get("max_revisions", 3)
        if rev < max_rev:
            return "review_cycle"
        # Out of revision budget AND below threshold — record as block.
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
        return "bandit_allocate"
    if decision == "deny":
        return "record_deny_lesson"
    return "awaiting_human_approval"  # still waiting


# ─── Bandit allocation (Doc 4 §2.3) ──────────────────────────────────────────


def bandit_allocate(state: PublishState) -> dict:
    """Pre-publish bandit allocation. When EVENTBUS_ENABLED + the orchestrator
    URL are set AND state carries a bandit_id (the strategist registered arms
    upstream), call /bandits/:id/allocate to pick the variant. Tag the result
    onto state so publish_to_channel emits content.published with variant_id
    for reward attribution.

    Pass-through: when the bus is off OR no bandit_id was registered, this
    node is a no-op. The publish_to_channel node still works.

    Fail-open: outages don't block publish. A bandit-orchestrator outage
    means the draft publishes without bandit attribution; reward signals
    rejoin the system on the next allocation cycle.
    """
    run_id = state.get("run_id")
    bandit_id = state.get("bandit_id")

    if not bandit_id:
        log.debug("bandit_allocate.no_bandit_registered", run_id=run_id)
        return {}

    if not (EVENTBUS_ENABLED and BANDIT_ORCHESTRATOR_BASE_URL):
        log.debug("bandit_allocate.passthrough", run_id=run_id, bandit_id=bandit_id)
        return {}

    url = f"{BANDIT_ORCHESTRATOR_BASE_URL.rstrip('/')}/bandits/{bandit_id}/allocate"
    company_id = state.get("company_id")
    headers: dict[str, str] = {}
    if SERVICE_TOKEN:
        # Match the auth-header pattern used by record_metering +
        # tools/recall_lessons + tools/register_bandit. The bandit-
        # orchestrator doesn't currently enforce them, but sending them
        # keeps the call paths consistent so adding auth middleware is
        # a one-line change on the service side.
        headers["X-Clipstack-Service-Token"] = SERVICE_TOKEN
        if company_id:
            headers["X-Clipstack-Active-Company"] = company_id
        headers["X-Clipstack-Service-Name"] = SERVICE_NAME

    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.post(
                url,
                json={"company_id": company_id, "bandit_id": bandit_id},
                headers=headers,
            )
    except (httpx.HTTPError, OSError) as e:
        log.warning("bandit_allocate.http_error", run_id=run_id, error=str(e))
        return {}

    if resp.status_code != 200:
        log.warning(
            "bandit_allocate.bad_status",
            run_id=run_id,
            status=resp.status_code,
            body=resp.text[:200],
        )
        return {}

    data = resp.json()
    variant_id = data.get("variant_id")
    arm_score = data.get("arm_score")
    log.info(
        "bandit_allocate.allocated",
        run_id=run_id,
        bandit_id=bandit_id,
        variant_id=variant_id,
        arm_score=arm_score,
        rationale=data.get("rationale"),
    )
    return {
        "bandit_variant_id": variant_id,
        "bandit_arm_score": arm_score,
    }


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

async def publish_to_channel(state: PublishState) -> dict:
    """Hand the draft to the configured channel adapter, then emit a
    content.published event on Redpanda so downstream consumers (bandit
    auto-reward, performance-ingest seeding, mission-control feed) can
    react.

    Phase A.0 stub: the channel adapter call itself still pretends
    success (services/adapters/<channel-family>/<concrete>.publish
    lands when real platform OAuth flows ship). The bus emission is real
    when EVENTBUS_ENABLED + the [runtime] extra are wired — the
    bandit_variant_id from `bandit_allocate` flows through to the event
    so the reward listener can attribute observed performance back to
    the arm that drove it.

    Async because aiokafka's emit() is async. LangGraph supports both
    sync + async nodes natively; the rest of the graph stays sync.
    """
    run_id = state.get("run_id")
    channel = state.get("channel", "")
    draft_id = state.get("draft_id", "unknown")
    company_id = state.get("company_id")
    bandit_variant_id = state.get("bandit_variant_id")

    log.info(
        "publish_to_channel",
        run_id=run_id,
        channel=channel,
        draft_id=draft_id,
        bandit_variant_id=bandit_variant_id,
    )

    # Stub adapter result. When real platform adapters land, replace
    # this with services.adapters.<family>.<concrete>.publish(draft) →
    # returns the real published_url + published_at.
    published_url = f"https://stub.example.com/{draft_id}"
    published_at = datetime.now(UTC).isoformat()

    # Emit content.published. Envelope shape mirrors
    # services/shared/events/envelope.py + ContentPublishedPayload from
    # schemas.py. emit() is graceful: returns False on bus-disabled or
    # broker-unreachable; we log either way. Never blocks the run.
    if event_producer.is_enabled and company_id:
        envelope = {
            "id": f"evt_{uuid4().hex}",
            "topic": "content.published",
            "version": 1,
            "occurred_at": published_at,
            "company_id": company_id,
            "client_id": state.get("client_id"),
            "trace_id": state.get("trace_id"),
            "payload": {
                "draft_id": draft_id,
                "channel": channel,
                "published_url": published_url,
                "published_at": published_at,
                "campaign_id": state.get("campaign_id"),
                "bandit_variant_id": bandit_variant_id,
            },
        }
        ok = await event_producer.emit(
            "content.published",
            key=company_id,
            value=envelope,
        )
        if ok:
            log.info(
                "publish_to_channel.event_emitted",
                run_id=run_id,
                draft_id=draft_id,
                bandit_variant_id=bandit_variant_id,
            )
        else:
            log.warning(
                "publish_to_channel.event_emit_failed",
                run_id=run_id,
                draft_id=draft_id,
            )

    return {
        "published_url": published_url,
        "published_at": published_at,
    }


def record_metering(state: PublishState) -> dict:
    """USP 10 — emit a meter_events row for the publish.

    Phase B.3: when APPROVAL_UI_BASE_URL + SERVICE_TOKEN are set, POSTs to
    /api/companies/{cid}/meter-events with kind='publish' and ref_kind/ref_id
    pointing at the draft. Falls back to a stub event id when env not set
    so the graph still completes in dev without the API live.

    Fail-open on outage: a metering write failure logs the error but doesn't
    block the run from completing. The publish has already happened; a
    follow-up reconciler sweeps missing meter rows from `audit_log` where
    `kind='draft.published'` lacks a matching `kind='metering.written'`.
    """
    run_id = state.get("run_id")
    draft_id = state.get("draft_id", "unknown")
    company_id = state.get("company_id")

    # No real backend wired — return a stub id and let the graph complete.
    if not (APPROVAL_UI_BASE_URL and SERVICE_TOKEN and company_id):
        log.debug("record_metering.fallback_stub", run_id=run_id)
        return {"metering_event_id": f"meter_stub_{draft_id}"}

    url = f"{APPROVAL_UI_BASE_URL.rstrip('/')}/api/companies/{company_id}/meter-events"
    body = {
        "kind": "publish",
        "quantity": 1,
        "refKind": "draft",
        "refId": draft_id,
        "occurredAt": state.get("published_at"),
        "clientId": None,
    }
    headers = {
        "X-Clipstack-Service-Token": SERVICE_TOKEN,
        "X-Clipstack-Active-Company": company_id,
        "X-Clipstack-Service-Name": SERVICE_NAME,
    }

    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.post(url, json=body, headers=headers)
    except (httpx.HTTPError, OSError) as e:
        log.warning("record_metering.http_error", run_id=run_id, error=str(e))
        return {"metering_event_id": None}

    if resp.status_code != 200:
        log.warning(
            "record_metering.bad_status",
            run_id=run_id,
            status=resp.status_code,
            body=resp.text[:200],
        )
        return {"metering_event_id": None}

    data = resp.json()
    event_id = data.get("data", {}).get("eventId") if isinstance(data, dict) else None
    log.info("record_metering.written", run_id=run_id, event_id=event_id)
    return {"metering_event_id": event_id}
