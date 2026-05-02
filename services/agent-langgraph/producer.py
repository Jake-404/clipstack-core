"""Redpanda/Kafka producer — singleton wrapper around aiokafka.

Mirrors services/performance-ingest/producer.py — same shape, same
defaults, same graceful-degradation contract. Kept duplicated rather
than promoted to a shared module because (1) the file is small + cheap
to maintain in two places and (2) services/shared currently only holds
schema mirrors (zod ↔ pydantic), not runtime modules with their own
deps. When a third service needs Kafka emit, refactor to
services/shared/kafka/.

Used by publish_pipeline's `publish_to_channel` node to emit
content.published events with bandit_variant_id tagged through, so the
downstream bandit consumer can attribute observed performance back to
the arm that drove it.

Failure semantics:
  - Broker unreachable at startup → log + emit() falls back to no-op
    (the service still serves graph runs; events just don't flow)
  - Single emit() failure → logged + counted, never raises (one failed
    Kafka roundtrip should not block the publish from completing)
  - Producer disabled by absent EVENTBUS_ENABLED or missing aiokafka:
    emit() returns False, downstream code treats it as a no-op

Topic + partition policy comes from services/shared/events/topics.py.
"""

from __future__ import annotations

import json
import os
from typing import Any

import structlog

log = structlog.get_logger()

REDPANDA_BROKERS = os.getenv("REDPANDA_BROKERS", "redpanda:9092")
EVENTBUS_ENABLED = os.getenv("EVENTBUS_ENABLED", "false").lower() == "true"
PRODUCER_CLIENT_ID = os.getenv("PRODUCER_CLIENT_ID", "agent-langgraph")


class EventProducer:
    """Thin wrapper around aiokafka.AIOKafkaProducer.

    State machine:
      INIT   → start() →  STARTED
      STARTED → stop()  →  STOPPED
      <any>  → start() error  →  DISABLED (emit() becomes a no-op)

    DISABLED degradation matches performance-ingest's pattern.
    """

    def __init__(self) -> None:
        self._producer: Any | None = None
        self._enabled: bool = False
        self._started: bool = False
        self._emit_count: int = 0
        self._emit_errors: int = 0

    async def start(self) -> None:
        if not EVENTBUS_ENABLED:
            log.info("eventbus.disabled", reason="EVENTBUS_ENABLED=false")
            return

        try:
            from aiokafka import AIOKafkaProducer  # type: ignore[import-not-found]
        except ImportError as e:
            log.warning(
                "eventbus.aiokafka_missing",
                error=str(e),
                hint="Install with `uv pip install --system .[runtime]`",
            )
            return

        try:
            producer = AIOKafkaProducer(
                bootstrap_servers=REDPANDA_BROKERS,
                client_id=PRODUCER_CLIENT_ID,
                value_serializer=lambda v: json.dumps(v).encode("utf-8"),
                # Stable hashing on company_id keeps related events on the
                # same partition (preserves order for a workspace's
                # publish-then-metric-update stream so the bandit
                # consumer's per-draft attribution is consistent).
                key_serializer=lambda k: k.encode("utf-8") if k else None,
                acks="all",
                enable_idempotence=True,
                compression_type="lz4",
                linger_ms=50,
            )
            await producer.start()
            self._producer = producer
            self._enabled = True
            self._started = True
            log.info(
                "eventbus.producer_started",
                brokers=REDPANDA_BROKERS,
                client_id=PRODUCER_CLIENT_ID,
            )
        except Exception as e:
            log.error(
                "eventbus.start_failed",
                brokers=REDPANDA_BROKERS,
                error=str(e),
                hint="Service runs degraded; events will not flow until broker reachable.",
            )

    async def stop(self) -> None:
        if not self._started or not self._producer:
            return
        try:
            await self._producer.stop()
        except Exception as e:
            log.warning("eventbus.stop_failed", error=str(e))
        finally:
            self._producer = None
            self._enabled = False
            self._started = False

    @property
    def is_enabled(self) -> bool:
        return self._enabled

    async def emit(self, topic: str, key: str | None, value: dict[str, Any]) -> bool:
        """Send one event. Returns True on success, False on no-op or failure.

        Never raises — caller can complete the run even if the bus is
        wedged. Counts surface on /producer/status for ops visibility.
        """
        if not self._enabled or not self._producer:
            return False
        try:
            await self._producer.send_and_wait(topic, value=value, key=key)
            self._emit_count += 1
            return True
        except Exception as e:
            self._emit_errors += 1
            log.warning(
                "eventbus.emit_failed",
                topic=topic,
                key=key,
                error=str(e),
                emit_errors_total=self._emit_errors,
            )
            return False

    @property
    def stats(self) -> dict[str, Any]:
        return {
            "enabled": self._enabled,
            "started": self._started,
            "brokers": REDPANDA_BROKERS,
            "emit_count": self._emit_count,
            "emit_errors": self._emit_errors,
        }


# Module-level singleton. Lifespan starts/stops it; nodes call
# `event_producer.emit(...)` directly.
event_producer = EventProducer()
