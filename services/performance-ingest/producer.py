"""Redpanda/Kafka producer — singleton wrapper around aiokafka.

Wraps the producer lifecycle so callers don't have to. The pattern:

    from producer import EventProducer

    producer = EventProducer()
    await producer.start()   # in lifespan
    await producer.emit(envelope)   # any time
    await producer.stop()    # in lifespan teardown

`emit()` is a no-op when EVENTBUS_ENABLED is false or aiokafka isn't
installed (the [runtime] extra) — matches the rest of the codebase's
"opt-in real backends, stub by default" discipline.

Failure semantics:
  - Broker unreachable at startup → log + emit() falls back to no-op
    (the service still serves /ingest snapshots; events just don't flow)
  - Single emit() failure → logged + counted, never raises (one failed
    Kafka roundtrip should not break the inbound HTTP request)
  - Bulk emission tolerates partial failures and reports the count

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
PRODUCER_CLIENT_ID = os.getenv("PRODUCER_CLIENT_ID", "performance-ingest")


class EventProducer:
    """Thin wrapper around aiokafka.AIOKafkaProducer.

    State machine:
      INIT   → start() →  STARTED
      STARTED → stop()  →  STOPPED
      <any>  → start() error  →  DISABLED (emit() becomes a no-op)

    The DISABLED state lets the service keep serving requests when the
    bus is down — graceful degradation matches the rest of the stub-mode
    fallback pattern (LiteLLM, Qdrant, etc.).
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
                # JSON-serialised events. Producers + consumers share the
                # services/shared/events/* schemas which guarantee the
                # shape; we don't need a registry yet.
                value_serializer=lambda v: json.dumps(v).encode("utf-8"),
                # Stable hashing on company_id keeps related events on the
                # same partition (preserves order for a workspace's
                # metric_update stream).
                key_serializer=lambda k: k.encode("utf-8") if k else None,
                # Conservative defaults — favour delivery over throughput
                # for the producer side. metric_update is high-volume but
                # not latency-critical (already async; consumers tolerate
                # batched arrival).
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
            # Graceful — producer init failures (broker down, DNS error,
            # etc.) shouldn't crash the service. emit() degrades to no-op.
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

        Never raises — caller can keep going on the inbound request even
        if the bus is wedged. The metric counts let /pollers/status (or
        a future /producer/status route) surface the health of the bus
        without a separate health probe.
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

    async def emit_many(
        self,
        topic: str,
        items: list[tuple[str | None, dict[str, Any]]],
    ) -> int:
        """Bulk emission convenience. Returns count of successful sends.

        We send sequentially rather than via gather() — aiokafka batches
        internally based on linger_ms, so the wall-clock cost is the
        same and we get a clean per-message error count.
        """
        if not self._enabled or not self._producer:
            return 0
        ok_count = 0
        for key, value in items:
            if await self.emit(topic, key, value):
                ok_count += 1
        return ok_count

    @property
    def stats(self) -> dict[str, Any]:
        return {
            "enabled": self._enabled,
            "started": self._started,
            "brokers": REDPANDA_BROKERS,
            "emit_count": self._emit_count,
            "emit_errors": self._emit_errors,
        }
