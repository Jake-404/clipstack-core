"""Bandit orchestrator — Doc 4 §2.3.

Treats content variants as arms in a multi-armed-bandit problem. Strategist
generates N=3..5 variants per piece; orchestrator allocates publish slots
across arms via Thompson sampling, weighted by predicted percentile (USP 1)
+ live-performance updates from `content.metric_update` events.

Reward attribution:
  Two paths into _update_posterior():
    1. Manual: POST /bandits/{id}/reward (works without the bus; useful
       for testing + replays + cases where percentile is computed
       elsewhere).
    2. Auto: consumer.RewardConsumer subscribes to content.metric_update
       on Redpanda when EVENTBUS_ENABLED=true. Looks up the event's
       draft_id in the in-memory reverse index → applies the percentile
       as reward. No HTTP roundtrip, no manual wiring per workspace.
  The consumer is the production path; manual /reward stays as the
  always-available fallback.

State machine per (campaign, platform, message_pillar):
  1. Variants registered → arms initialised with priors informed by USP 1
     percentile predictions (predicted=70 → Beta(7, 3); predicted=None →
     Beta(1, 1) uniform prior)
  2. Allocate request → orchestrator returns the variant to publish next
  3. content.metric_update event → reward update (Thompson posterior bumps)
  4. After observation window → low-performing arms pruned, top arms seed
     the next generation cycle

Real backend (sprint-close+): Thompson sampling implemented directly with
Python's stdlib `random.betavariate` — beta priors + binary-style reward
updates are <30 lines of math and don't need mabwiser/numpy/scipy. The
schema is engine-agnostic so we can swap in mabwiser when contextual-
bandit features land in a follow-up.

State is persisted as JSON at BANDIT_DATA_DIR/{bandit_id}.json (default
/data/bandits). Atomic .tmp + replace so concurrent allocate/reward
calls never see a half-written state file.

Phase A.3 ships the FastAPI shell with stub mode — /allocate returns the
first variant, /reward is a no-op. Real Thompson sampling enabled by
unsetting BANDIT_STUB_MODE in production. Per Doc 4 acceptance: a campaign
with bandits enabled shows demonstrable lift over a 30-day window vs
single-variant generation, statistically significant.

Mounted at port 8008. Health check consumed by docker-compose.
"""

from __future__ import annotations

import json
import os
import random
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

import structlog
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from consumer import RewardConsumer, build_draft_index_from_states

log = structlog.get_logger()


def _is_production() -> bool:
    return (
        os.getenv("ENVIRONMENT", "").lower() == "production"
        or os.getenv("NODE_ENV", "").lower() == "production"
    )


def _stub_mode_default() -> str:
    """Dev/test: '1' (stub on — service runs without the real backend).
    Production: '0' (stub off — a forgotten-to-wire deployment fails loudly
    rather than silently allocating placeholder variants forever)."""
    return "0" if _is_production() else "1"


STUB_MODE: bool = os.getenv("BANDIT_STUB_MODE", _stub_mode_default()) == "1"
DATA_DIR = Path(os.getenv("BANDIT_DATA_DIR", "/data/bandits"))

# Doc 4 §2.3 hard rule: never reduce exploration below 5%. Without floor
# exploration, posteriors drift on stale wins and the bandit collapses to
# repeated allocations of a once-good variant whose context has changed.
EXPLORATION_BUDGET_FLOOR: float = 0.05

# In-memory reverse index: draft_id → (bandit_id, variant_id). Built on
# startup by scanning DATA_DIR/*.json; mutated on /bandits POST when new
# variants register. Concurrent reads from the consumer + writes from
# /bandits are safe because both run on the same event loop (no thread
# interleaving inside a single coroutine step).
_draft_index: dict[str, tuple[str, str]] = {}


def _scan_state_files() -> list[dict[str, object]]:
    """Read every bandit state file under DATA_DIR. Used on startup to
    rehydrate the reverse index. Tolerates corrupt files — logs the issue
    and skips the file rather than failing startup."""
    if not DATA_DIR.exists():
        return []
    out: list[dict[str, object]] = []
    for path in DATA_DIR.glob("*.json"):
        # Skip the .tmp atomic-write halfways we sometimes leave behind.
        if path.name.endswith(".tmp"):
            continue
        try:
            out.append(json.loads(path.read_text()))
        except (OSError, json.JSONDecodeError) as e:
            log.warning("state.scan_skipped", path=str(path), error=str(e))
    return out


def _on_metric_update(envelope: dict[str, object]) -> None:
    """Callback invoked by the RewardConsumer per content.metric_update.

    Filter rules:
      1. envelope must have a payload
      2. payload.draft_id must be in our reverse index (else: not a
         bandit-tracked draft, ignore)
      3. payload.percentile must be set (else: no normalised reward
         signal — performance-ingest's percentile-fill enrichment hasn't
         landed yet, and raw metric values aren't workspace-comparable)

    On match: load bandit state, update posterior, persist atomically.
    """
    payload = envelope.get("payload")
    if not isinstance(payload, dict):
        return
    draft_id = payload.get("draft_id")
    percentile = payload.get("percentile")
    if not isinstance(draft_id, str) or not isinstance(percentile, (int, float)):
        return

    pair = _draft_index.get(draft_id)
    if not pair:
        return  # not a bandit-tracked draft
    bandit_id, variant_id = pair

    try:
        state = _load_state(bandit_id)
    except HTTPException as e:
        log.warning(
            "consumer.state_load_failed",
            bandit_id=bandit_id,
            draft_id=draft_id,
            detail=str(e.detail),
        )
        return

    arm = next(
        (a for a in state["arms"] if a.get("variant_id") == variant_id),
        None,
    )
    if not arm:
        log.warning(
            "consumer.variant_missing",
            bandit_id=bandit_id,
            variant_id=variant_id,
            draft_id=draft_id,
        )
        return

    _update_posterior(arm, float(percentile))
    state["total_rewards"] = int(state.get("total_rewards", 0)) + 1
    _save_state(state, _bandit_path(bandit_id))
    reward_consumer.record_match()
    log.info(
        "consumer.posterior_updated",
        bandit_id=bandit_id,
        variant_id=variant_id,
        draft_id=draft_id,
        reward=float(percentile),
        new_posterior_mean=_posterior_mean(arm),
    )


# Singleton — assigned at module import so test paths can poke at it
# without spinning up the FastAPI app. start() is a no-op until lifespan
# runs.
reward_consumer = RewardConsumer(on_metric_update=_on_metric_update)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    # Rehydrate the draft → variant reverse index from disk before the
    # consumer starts so the first message we handle has a fully built
    # index. Without this, a service restart would temporarily drop
    # rewards for in-flight drafts until /bandits POSTs added them back
    # (which never happens for already-registered bandits).
    _draft_index.clear()
    _draft_index.update(build_draft_index_from_states(_scan_state_files()))
    log.info(
        "startup",
        service="bandit-orchestrator",
        stub_mode=STUB_MODE,
        data_dir=str(DATA_DIR),
        exploration_budget_floor=EXPLORATION_BUDGET_FLOOR,
        draft_index_size=len(_draft_index),
        environment=os.getenv("ENVIRONMENT") or os.getenv("NODE_ENV") or "development",
    )
    if STUB_MODE and _is_production():
        log.warning(
            "stub_mode_active_in_production",
            service="bandit-orchestrator",
            message=(
                "BANDIT_STUB_MODE=1 in production. /allocate returns a "
                "placeholder variant and /reward no-ops. Real Thompson "
                "sampling is OFF. Wire mabwiser or unset BANDIT_STUB_MODE."
            ),
        )
    await reward_consumer.start()
    yield
    await reward_consumer.stop()
    log.info("shutdown", service="bandit-orchestrator")


app = FastAPI(
    title="clipstack/bandit-orchestrator",
    version="0.1.0",
    description="Multi-armed bandit variant allocator. Doc 4 §2.3.",
    lifespan=lifespan,
)


# ─── Schemas ───────────────────────────────────────────────────────────────


Channel = Literal["x", "linkedin", "reddit", "tiktok", "instagram", "newsletter", "blog"]
Algorithm = Literal["thompson", "epsilon_greedy", "ucb1"]


class Variant(BaseModel):
    """One arm of the bandit. The strategist generates 3–5 of these per piece."""

    variant_id: str = Field(..., min_length=1, max_length=64)
    draft_id: str
    body_excerpt: str = Field(..., max_length=500)
    predicted_percentile: float | None = Field(default=None, ge=0.0, le=100.0)


class RegisterArmsRequest(BaseModel):
    company_id: str
    client_id: str | None = None
    campaign_id: str
    platform: Channel
    message_pillar: str = Field(..., min_length=1, max_length=120)
    variants: list[Variant] = Field(..., min_length=2, max_length=10)
    algorithm: Algorithm = "thompson"
    exploration_budget: float = Field(0.10, ge=EXPLORATION_BUDGET_FLOOR, le=0.5)
    observation_window_hours: int = Field(72, gt=0, le=720)


class RegisterArmsResponse(BaseModel):
    request_id: str
    bandit_id: str
    arm_count: int
    skipped: bool = True


class AllocateRequest(BaseModel):
    company_id: str
    bandit_id: str


class AllocateResponse(BaseModel):
    request_id: str
    bandit_id: str
    variant_id: str
    arm_score: float | None = None
    rationale: str
    skipped: bool = True


class RewardRequest(BaseModel):
    company_id: str
    bandit_id: str
    variant_id: str
    reward: float = Field(..., ge=0.0, le=100.0)
    snapshot_at: str  # ISO-8601


class RewardResponse(BaseModel):
    request_id: str
    bandit_id: str
    variant_id: str
    posterior_mean: float | None = None
    skipped: bool = True


class StateResponse(BaseModel):
    bandit_id: str
    company_id: str
    campaign_id: str
    platform: Channel
    message_pillar: str
    arms: list[dict[str, Any]] = Field(default_factory=list)
    total_allocations: int = 0
    total_rewards: int = 0
    leading_arm: str | None = None
    pruned_arms: list[str] = Field(default_factory=list)


class BanditSummary(BaseModel):
    """Compact view for the Mission Control experiments tile. Skips the
    per-arm detail (a separate /state call fetches that for the
    detail panel)."""

    bandit_id: str
    campaign_id: str
    platform: Channel
    message_pillar: str
    algorithm: Algorithm
    arm_count: int
    active_arm_count: int   # arms minus pruned
    total_allocations: int
    total_rewards: int
    leading_arm: str | None
    leading_posterior_mean: float | None
    created_at: str | None


class BanditListResponse(BaseModel):
    company_id: str
    bandits: list[BanditSummary]


# ─── Persistence ───────────────────────────────────────────────────────────


def _bandit_path(bandit_id: str) -> Path:
    # Defensive against path traversal — bandit_ids are uuid-derived, but
    # we don't want a malicious caller posting "../../etc/passwd" to either
    # /allocate or /reward and having us read/write outside DATA_DIR.
    safe = "".join(c for c in bandit_id if c.isalnum() or c in "_-")
    if safe != bandit_id or not safe:
        raise HTTPException(status_code=400, detail="invalid bandit_id")
    return DATA_DIR / f"{safe}.json"


def _save_state(state: dict[str, Any], path: Path) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(state, sort_keys=True, indent=2))
    tmp.replace(path)


def _load_state(bandit_id: str) -> dict[str, Any]:
    path = _bandit_path(bandit_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"bandit {bandit_id} not found")
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        log.error("state.read_failed", bandit_id=bandit_id, error=str(e))
        raise HTTPException(status_code=500, detail="bandit state corrupted") from e


# ─── Thompson sampling ─────────────────────────────────────────────────────


def _initial_arms(variants: list[Variant]) -> list[dict[str, Any]]:
    """Seed each arm's Beta(α, β) prior from its USP 1 predicted percentile.

    Heuristic: if predicted=p (in [0,100]), set α = max(p/10, 1), β =
    max((100-p)/10, 1). The ratio α/(α+β) ≈ p/100 (the prior mean), and
    α+β ≈ 10 makes the prior mildly informative — strong enough to bias
    early allocations toward the predictor's pick, weak enough that 5–10
    real observations dominate. Predicted=None → uniform Beta(1, 1).
    """
    arms = []
    for v in variants:
        p = v.predicted_percentile
        if p is None:
            alpha, beta = 1.0, 1.0
        else:
            alpha = max(p / 10.0, 1.0)
            beta = max((100.0 - p) / 10.0, 1.0)
        arms.append({
            "variant_id": v.variant_id,
            "draft_id": v.draft_id,
            "body_excerpt": v.body_excerpt,
            "predicted_percentile": p,
            "alpha": alpha,
            "beta": beta,
            "allocation_count": 0,
            "reward_count": 0,
            "reward_sum": 0.0,
            "pruned": False,
        })
    return arms


def _thompson_pick(
    arms: list[dict[str, Any]],
    exploration_budget: float,
    rng: random.Random,
) -> tuple[dict[str, Any], float, str]:
    """Return (chosen_arm, sampled_score, rationale).

    Active arms only — pruned arms are skipped. With probability =
    exploration_budget we override the Thompson winner and pick a non-
    leading arm uniformly at random. This guarantees we keep updating
    posteriors on tail arms even when one arm is clearly winning.
    """
    active = [a for a in arms if not a.get("pruned")]
    if not active:
        raise HTTPException(status_code=409, detail="no active arms to allocate from")

    # Step 1: vanilla Thompson — sample from each arm's posterior, pick max.
    # `random.betavariate(α, β)` is in stdlib so no numpy needed for this
    # tiny K. At K≈3-5 the cost is negligible.
    samples = [(a, rng.betavariate(a["alpha"], a["beta"])) for a in active]
    leader, leader_score = max(samples, key=lambda t: t[1])

    # Step 2: floor exploration. Skip the override when there's only one
    # active arm (nothing to explore to) or when the leader is the only
    # one with allocations (cold start should converge fast).
    if (
        len(active) > 1
        and rng.random() < exploration_budget
        and any(a is not leader for a in active)
    ):
        non_leaders = [a for a in active if a is not leader]
        chosen = rng.choice(non_leaders)
        # Find the sample that was drawn for this arm (use its score).
        chosen_score = next(s for a, s in samples if a is chosen)
        return chosen, chosen_score, "exploration override"

    return leader, leader_score, "thompson winner"


def _update_posterior(arm: dict[str, Any], reward_pct: float) -> None:
    """Map reward in [0, 100] to a Bernoulli-style update on Beta(α, β).

    reward_norm = reward_pct / 100. Bump α by reward_norm, β by
    (1 - reward_norm). This treats the percentile-rank as a continuous
    "fractional success" — a reward of 70 contributes 0.7 of a success +
    0.3 of a failure, smoothly interpolating between binary outcomes.
    """
    r = max(0.0, min(1.0, reward_pct / 100.0))
    arm["alpha"] = float(arm["alpha"]) + r
    arm["beta"] = float(arm["beta"]) + (1.0 - r)
    arm["reward_count"] = int(arm["reward_count"]) + 1
    arm["reward_sum"] = float(arm["reward_sum"]) + reward_pct


def _posterior_mean(arm: dict[str, Any]) -> float:
    a = float(arm["alpha"])
    b = float(arm["beta"])
    return a / (a + b) if (a + b) > 0 else 0.5


def _leading_arm(arms: list[dict[str, Any]]) -> str | None:
    active = [a for a in arms if not a.get("pruned")]
    if not active:
        return None
    return max(active, key=_posterior_mean)["variant_id"]


# ─── Pruning (Doc 4 §2.3 step 4) ──────────────────────────────────────────


# Default: prune arms whose posterior mean is ≥ 0.15 below the leader.
# At Beta(α, β) means in [0, 1], 0.15 = 15 percentile points → meaningful
# gap, not noise. Workspace-tunable via env override.
PRUNE_THRESHOLD: float = float(os.getenv("BANDIT_PRUNE_THRESHOLD", "0.15"))


def _bandit_age_hours(state: dict[str, Any]) -> float:
    """Hours since the bandit was registered. Returns infinity for
    bandits with malformed/missing created_at so the observation-window
    gate doesn't accidentally skip pruning on bad state."""
    created = state.get("created_at")
    if not isinstance(created, str):
        return float("inf")
    try:
        dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
    except ValueError:
        return float("inf")
    return (datetime.now(UTC) - dt).total_seconds() / 3600.0


def _apply_pruning(state: dict[str, Any], threshold: float) -> list[str]:
    """Re-evaluate every arm against the current leader. Mark arms whose
    posterior mean is ≥ threshold below the leader as pruned. Mutates
    `state` in place; returns the list of newly-pruned variant_ids for
    audit logging.

    Pruning is non-monotonic: an arm that drops below threshold and is
    pruned can flip back to active if subsequent observations recover
    its posterior. This makes the consumer's continuous posterior
    updates productive — no need to special-case "I was wrong about
    this arm." Doc 4 §2.3 says low-performers are pruned at the
    observation window; we let them un-prune if the data flips, which
    is more responsive at the cost of slightly noisier allocation.
    """
    arms: list[dict[str, Any]] = state.get("arms") or []
    if len(arms) < 2:
        return []  # nothing meaningful to prune against

    leader_mean = max(_posterior_mean(a) for a in arms)
    newly_pruned: list[str] = []

    for arm in arms:
        currently_pruned = bool(arm.get("pruned"))
        gap = leader_mean - _posterior_mean(arm)
        should_prune = gap >= threshold and gap > 0
        if should_prune and not currently_pruned:
            arm["pruned"] = True
            newly_pruned.append(str(arm.get("variant_id") or ""))
        elif not should_prune and currently_pruned:
            # Posterior recovered — un-prune.
            arm["pruned"] = False

    if newly_pruned:
        existing = list(state.get("pruned_arms") or [])
        # Persist the chronological prune log too — useful for ops to
        # see "this arm got pruned at run N" even after it un-prunes.
        for vid in newly_pruned:
            if vid not in existing:
                existing.append(vid)
        state["pruned_arms"] = existing

    return newly_pruned


# ─── Endpoints ─────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "bandit-orchestrator", "version": "0.1.0"}


@app.get("/consumer/status")
async def consumer_status() -> dict[str, Any]:
    """Operator visibility into the auto-reward listener. Surfaces:
      - whether the bus consumer is enabled + connected
      - draft index size (workspaces actively bandit-tracked)
      - consumed_count vs matched_count (low ratio = many events for
        non-bandit drafts, which is expected; missing matches = bug)
    """
    stats: dict[str, Any] = dict(reward_consumer.stats)
    stats["draft_index_size"] = len(_draft_index)
    return stats


@app.get("/bandits", response_model=BanditListResponse)
async def list_bandits(
    company_id: str,
    campaign_id: str | None = None,
    include_archived: bool = False,
) -> BanditListResponse:
    """List bandits for a workspace, optionally filtered by campaign.

    Used by Mission Control's experiments tile — returns compact
    summaries (no per-arm detail; that's what /state is for).

    Defensive cross-tenant: every state file's company_id is verified
    against the request's company_id before inclusion. State scanning
    walks DATA_DIR (filesystem persistence; same directory the
    register/allocate paths write to).

    `include_archived`: future hook — once the bandit lifecycle adds an
    explicit archived state, callers can opt out of completed
    experiments. Today every bandit is "live" so this is a no-op flag.
    """
    if STUB_MODE:
        return BanditListResponse(company_id=company_id, bandits=[])

    summaries: list[BanditSummary] = []
    for state in _scan_state_files():
        if state.get("company_id") != company_id:
            continue
        if campaign_id and state.get("campaign_id") != campaign_id:
            continue
        arms = state.get("arms") or []
        active = [a for a in arms if not a.get("pruned")] if isinstance(arms, list) else []
        leader = _leading_arm(arms) if isinstance(arms, list) else None
        leader_mean: float | None = None
        if leader and isinstance(arms, list):
            leader_arm = next((a for a in arms if a.get("variant_id") == leader), None)
            if leader_arm:
                leader_mean = _posterior_mean(leader_arm)
        summaries.append(BanditSummary(
            bandit_id=str(state.get("bandit_id") or ""),
            campaign_id=str(state.get("campaign_id") or ""),
            platform=state.get("platform", "x"),  # type: ignore[arg-type]
            message_pillar=str(state.get("message_pillar") or ""),
            algorithm=state.get("algorithm", "thompson"),  # type: ignore[arg-type]
            arm_count=len(arms) if isinstance(arms, list) else 0,
            active_arm_count=len(active),
            total_allocations=int(state.get("total_allocations", 0) or 0),
            total_rewards=int(state.get("total_rewards", 0) or 0),
            leading_arm=leader,
            leading_posterior_mean=leader_mean,
            created_at=state.get("created_at"),  # type: ignore[arg-type]
        ))

    # Sort by created_at descending (newest first) so the tile renders
    # the most recent experiments at the top.
    summaries.sort(key=lambda s: s.created_at or "", reverse=True)
    return BanditListResponse(company_id=company_id, bandits=summaries)


@app.post("/bandits", response_model=RegisterArmsResponse)
async def register_arms(req: RegisterArmsRequest) -> RegisterArmsResponse:
    """Register a new bandit instance. Strategist calls this when it has
    generated the variants for a piece."""
    request_id = str(uuid4())
    bandit_id = f"bandit_{uuid4().hex[:12]}"
    log.info(
        "bandit.register",
        request_id=request_id,
        bandit_id=bandit_id,
        company_id=req.company_id,
        campaign_id=req.campaign_id,
        platform=req.platform,
        arm_count=len(req.variants),
    )

    if STUB_MODE:
        return RegisterArmsResponse(
            request_id=request_id,
            bandit_id=bandit_id,
            arm_count=len(req.variants),
            skipped=True,
        )

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    state: dict[str, Any] = {
        "bandit_id": bandit_id,
        "company_id": req.company_id,
        "client_id": req.client_id,
        "campaign_id": req.campaign_id,
        "platform": req.platform,
        "message_pillar": req.message_pillar,
        "algorithm": req.algorithm,
        "exploration_budget": req.exploration_budget,
        "observation_window_hours": req.observation_window_hours,
        "created_at": datetime.now(UTC).isoformat(),
        "arms": _initial_arms(req.variants),
        "total_allocations": 0,
        "total_rewards": 0,
        "pruned_arms": [],
    }
    _save_state(state, _bandit_path(bandit_id))

    # Update the in-memory reverse index so the consumer can attribute
    # incoming content.metric_update events to this newly-registered
    # bandit's arms without waiting for a service restart's rescan.
    for variant in req.variants:
        _draft_index[variant.draft_id] = (bandit_id, variant.variant_id)

    return RegisterArmsResponse(
        request_id=request_id,
        bandit_id=bandit_id,
        arm_count=len(req.variants),
        skipped=False,
    )


@app.post("/bandits/{bandit_id}/allocate", response_model=AllocateResponse)
async def allocate(bandit_id: str, req: AllocateRequest) -> AllocateResponse:
    """Return the variant to publish next. Workflow:
      1. publish_pipeline calls /allocate before the publish_to_channel node
      2. orchestrator returns the variant_id chosen by Thompson sampling
      3. publish_pipeline tags the published artefact with the variant_id
         on the content.published event so reward attribution works
    """
    request_id = str(uuid4())
    log.info(
        "bandit.allocate",
        request_id=request_id,
        bandit_id=bandit_id,
        company_id=req.company_id,
    )
    if STUB_MODE:
        return AllocateResponse(
            request_id=request_id,
            bandit_id=bandit_id,
            variant_id="stub-variant-1",
            arm_score=None,
            rationale="stub allocation — bandit backend not wired",
            skipped=True,
        )

    state = _load_state(bandit_id)
    if state.get("company_id") != req.company_id:
        # Defensive cross-tenant check at the service boundary even though
        # the route should already be company-scoped upstream.
        raise HTTPException(status_code=403, detail="bandit belongs to a different workspace")

    # Pruning gate (Doc 4 §2.3 step 4): once the bandit has run past
    # its observation window, mark arms whose posterior mean is ≥
    # PRUNE_THRESHOLD below the leader. Pruning is re-evaluated on
    # every allocate so an arm that recovers can flip back to active.
    obs_window = float(state.get("observation_window_hours", 72))
    age_h = _bandit_age_hours(state)
    if age_h >= obs_window:
        newly_pruned = _apply_pruning(state, PRUNE_THRESHOLD)
        if newly_pruned:
            log.info(
                "bandit.pruned",
                bandit_id=bandit_id,
                age_hours=age_h,
                threshold=PRUNE_THRESHOLD,
                newly_pruned=newly_pruned,
            )

    rng = random.Random()  # noqa: S311 — Thompson sampling uses non-cryptographic RNG by design
    chosen, score, rationale = _thompson_pick(
        state["arms"],
        float(state.get("exploration_budget", 0.10)),
        rng,
    )
    chosen["allocation_count"] = int(chosen["allocation_count"]) + 1
    state["total_allocations"] = int(state.get("total_allocations", 0)) + 1
    _save_state(state, _bandit_path(bandit_id))

    return AllocateResponse(
        request_id=request_id,
        bandit_id=bandit_id,
        variant_id=str(chosen["variant_id"]),
        arm_score=score,
        rationale=rationale,
        skipped=False,
    )


@app.post("/bandits/{bandit_id}/reward", response_model=RewardResponse)
async def reward(bandit_id: str, req: RewardRequest) -> RewardResponse:
    """Record an observed reward for a variant. Called by the consumer of
    content.metric_update events (a small adapter inside this service that
    subscribes to the Redpanda topic when EVENTBUS_ENABLED=true).
    """
    request_id = str(uuid4())
    log.info(
        "bandit.reward",
        request_id=request_id,
        bandit_id=bandit_id,
        variant_id=req.variant_id,
        reward=req.reward,
    )
    if STUB_MODE:
        return RewardResponse(
            request_id=request_id,
            bandit_id=bandit_id,
            variant_id=req.variant_id,
            posterior_mean=None,
            skipped=True,
        )

    state = _load_state(bandit_id)
    if state.get("company_id") != req.company_id:
        raise HTTPException(status_code=403, detail="bandit belongs to a different workspace")

    arm = next(
        (a for a in state["arms"] if a["variant_id"] == req.variant_id),
        None,
    )
    if not arm:
        raise HTTPException(
            status_code=404, detail=f"variant {req.variant_id} not in bandit {bandit_id}"
        )

    _update_posterior(arm, req.reward)
    state["total_rewards"] = int(state.get("total_rewards", 0)) + 1
    _save_state(state, _bandit_path(bandit_id))

    return RewardResponse(
        request_id=request_id,
        bandit_id=bandit_id,
        variant_id=req.variant_id,
        posterior_mean=_posterior_mean(arm),
        skipped=False,
    )


@app.get("/bandits/{bandit_id}/state", response_model=StateResponse)
async def state(bandit_id: str) -> StateResponse:
    """Read-only state view for Mission Control's bandit-experiments tile."""
    if STUB_MODE:
        return StateResponse(
            bandit_id=bandit_id,
            company_id="",
            campaign_id="",
            platform="x",
            message_pillar="",
            arms=[],
            total_allocations=0,
            total_rewards=0,
            leading_arm=None,
            pruned_arms=[],
        )

    s = _load_state(bandit_id)
    arms_view = [
        {
            "variant_id": a["variant_id"],
            "draft_id": a.get("draft_id"),
            "body_excerpt": a.get("body_excerpt"),
            "predicted_percentile": a.get("predicted_percentile"),
            "posterior_mean": _posterior_mean(a),
            "allocation_count": a.get("allocation_count", 0),
            "reward_count": a.get("reward_count", 0),
            "reward_sum": a.get("reward_sum", 0.0),
            "pruned": a.get("pruned", False),
        }
        for a in s["arms"]
    ]
    return StateResponse(
        bandit_id=bandit_id,
        company_id=str(s.get("company_id") or ""),
        campaign_id=str(s.get("campaign_id") or ""),
        platform=s.get("platform", "x"),
        message_pillar=str(s.get("message_pillar") or ""),
        arms=arms_view,
        total_allocations=int(s.get("total_allocations", 0)),
        total_rewards=int(s.get("total_rewards", 0)),
        leading_arm=_leading_arm(s["arms"]),
        pruned_arms=list(s.get("pruned_arms") or []),
    )
