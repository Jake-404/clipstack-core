"""Bandit reward listener — auto-attribution from content.metric_update.

Subscribes to the `content.metric_update` Redpanda topic and applies
posteriors in-process so a workspace's bandits learn from observed
performance without a manual /reward HTTP roundtrip per snapshot.

Reverse-index design:
  - `draft_id → (bandit_id, variant_id)` lookup is built lazily by
    scanning DATA_DIR/*.json on consumer startup, then kept in sync
    by /bandits POST adding new mappings as variants register.
  - We don't subscribe to content.published — the draft_id is already
    on each Variant at registration time (Strategist generates variants
    keyed to the same draft_id the publish pipeline will use), so the
    bandit state file is the canonical mapping.

Reward signal:
  - Only events with `payload.percentile` set drive a posterior update.
  - The raw value is workspace-relative — without percentile context
    we can't normalise to the Beta-distribution's [0, 1] range.
  - Performance-ingest's percentile-fill enrichment lands in a follow-up
    slice; until it ships, this consumer is a no-op for events without
    percentile, which is the right default (better silent than wrong).

Failure semantics (matches performance-ingest/producer.py):
  - Broker unreachable at startup → log + consumer never starts; the
    /reward HTTP route still works as the manual fallback.
  - Single message-handle failure → logged + counted; consumer keeps
    consuming so one bad message doesn't wedge the listener.
  - Consumer task failure → logged; lifespan tears down cleanly.
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Callable
from typing import Any

import structlog

log = structlog.get_logger()

REDPANDA_BROKERS = os.getenv("REDPANDA_BROKERS", "redpanda:9092")
EVENTBUS_ENABLED = os.getenv("EVENTBUS_ENABLED", "false").lower() == "true"
CONSUMER_GROUP_ID = os.getenv(
    "CONSUMER_GROUP_ID", "bandit-orchestrator.reward-listener"
)
CONSUMER_CLIENT_ID = os.getenv("CONSUMER_CLIENT_ID", "bandit-orchestrator")
CONSUMED_TOPIC = "content.metric_update"


# Index entry: draft_id → (bandit_id, variant_id). In-memory only —
# rebuilt from filesystem state on consumer startup. Concurrent
# /bandits POST + consumer reads serialised by the GIL; mutations
# happen on the event loop thread so no lock needed.
DraftIndex = dict[str, tuple[str, str]]


def build_draft_index_from_states(state_files: list[dict[str, Any]]) -> DraftIndex:
    """Walk a list of bandit-state dicts and return the draft_id reverse
    index. Pure function — given the same inputs, same output. Easy to test
    without filesystem.

    Variants without a draft_id are skipped (defensive — registration
    enforces it, but bandit state is hand-editable on disk during
    operations work and we shouldn't crash on a malformed entry).

    If two bandits claim the same draft_id (which shouldn't happen but
    can during a partial cleanup), the last one wins. We log the conflict
    so operations can clean up; we don't fail-closed because we'd rather
    reward one bandit than reward none.
    """
    index: DraftIndex = {}
    for state in state_files:
        bandit_id = state.get("bandit_id")
        if not bandit_id or not isinstance(state.get("arms"), list):
            continue
        for arm in state["arms"]:
            draft_id = arm.get("draft_id")
            variant_id = arm.get("variant_id")
            if not draft_id or not variant_id:
                continue
            if draft_id in index and index[draft_id] != (bandit_id, variant_id):
                log.warning(
                    "draft_index.conflict",
                    draft_id=draft_id,
                    existing=index[draft_id],
                    new=(bandit_id, variant_id),
                )
            index[draft_id] = (bandit_id, variant_id)
    return index


class RewardConsumer:
    """Singleton wrapper around aiokafka.AIOKafkaConsumer.

    State machine:
      INIT          → start() →  STARTED
      STARTED       → background task running consume loop
      STARTED       → stop()  →  STOPPED
      <any> + start error    →  DISABLED (consume loop never runs)

    The DISABLED path matches the producer's graceful degradation —
    /reward stays available as the manual fallback when the bus is down.
    """

    def __init__(
        self,
        on_metric_update: Callable[[dict[str, Any]], None],
    ) -> None:
        self._consumer: Any | None = None
        self._task: asyncio.Task[None] | None = None
        self._enabled: bool = False
        self._handler = on_metric_update
        self._consumed_count: int = 0
        self._handle_errors: int = 0
        self._matched_count: int = 0   # events that matched a draft in our index

    async def start(self) -> None:
        if not EVENTBUS_ENABLED:
            log.info("consumer.disabled", reason="EVENTBUS_ENABLED=false")
            return

        try:
            from aiokafka import AIOKafkaConsumer  # type: ignore[import-not-found]
        except ImportError as e:
            log.warning(
                "consumer.aiokafka_missing",
                error=str(e),
                hint="Install with `uv pip install --system .[runtime]`",
            )
            return

        try:
            consumer = AIOKafkaConsumer(
                CONSUMED_TOPIC,
                bootstrap_servers=REDPANDA_BROKERS,
                client_id=CONSUMER_CLIENT_ID,
                group_id=CONSUMER_GROUP_ID,
                value_deserializer=lambda v: json.loads(v.decode("utf-8")),
                # Resume from committed offset on restart — never replay
                # already-rewarded events (would double-count).
                auto_offset_reset="latest",
                # Manual commit so we can ack only after handler succeeds.
                enable_auto_commit=False,
            )
            await consumer.start()
            self._consumer = consumer
            self._enabled = True
            self._task = asyncio.create_task(self._consume_loop())
            log.info(
                "consumer.started",
                topic=CONSUMED_TOPIC,
                group_id=CONSUMER_GROUP_ID,
                brokers=REDPANDA_BROKERS,
            )
        except Exception as e:
            log.error(
                "consumer.start_failed",
                brokers=REDPANDA_BROKERS,
                error=str(e),
                hint="Service runs degraded; /reward HTTP route still works.",
            )

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            except Exception as e:
                log.warning("consumer.task_join_failed", error=str(e))
            self._task = None
        if self._consumer:
            try:
                await self._consumer.stop()
            except Exception as e:
                log.warning("consumer.stop_failed", error=str(e))
            self._consumer = None
        self._enabled = False

    async def _consume_loop(self) -> None:
        """Drain messages forever until cancelled. One message at a time —
        the workload is light (look up draft_id, update Beta(α, β), persist
        bandit state) so we don't need parallelism here."""
        assert self._consumer is not None
        try:
            async for msg in self._consumer:
                self._consumed_count += 1
                try:
                    self._handler(msg.value)
                    # Commit only on success so a crash mid-handle replays
                    # this exact message on restart (at-least-once
                    # delivery; the Beta posterior update is not idempotent
                    # but at-least-once is the right tradeoff for a learn-
                    # ing loop where occasional double-rewards are noise).
                    await self._consumer.commit()
                except Exception as e:
                    self._handle_errors += 1
                    log.warning(
                        "consumer.handle_failed",
                        error=str(e),
                        offset=msg.offset,
                        partition=msg.partition,
                        handle_errors_total=self._handle_errors,
                    )
                    # Don't commit — message replays. If it's a poison
                    # message we'll log forever; that's the right alert
                    # signal for ops.
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.error("consumer.loop_failed", error=str(e))

    @property
    def is_enabled(self) -> bool:
        return self._enabled

    def record_match(self) -> None:
        """Called by the handler after a successful in-index lookup. Lets
        /producer-style status reflect actual bandit-relevant attribution
        rate (if matched << consumed, the index is stale and a rebuild
        might be due)."""
        self._matched_count += 1

    @property
    def stats(self) -> dict[str, Any]:
        return {
            "enabled": self._enabled,
            "topic": CONSUMED_TOPIC,
            "group_id": CONSUMER_GROUP_ID,
            "consumed_count": self._consumed_count,
            "matched_count": self._matched_count,
            "handle_errors": self._handle_errors,
        }
