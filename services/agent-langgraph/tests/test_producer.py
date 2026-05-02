"""EventProducer — disabled-state contract.

The producer's contract: before start() and when EVENTBUS_ENABLED=false,
emit() returns False (a no-op) and stats reports the inactive snapshot.
This is the path every test + dev environment hits — nothing should
require Redpanda to be running.
"""

from __future__ import annotations

import pytest

from producer import EventProducer


def test_event_producer_initial_state_disabled() -> None:
    p = EventProducer()
    assert p.is_enabled is False


def test_event_producer_stats_initial_shape() -> None:
    p = EventProducer()
    s = p.stats
    assert isinstance(s, dict)
    assert s["enabled"] is False
    assert s["started"] is False
    assert s["emit_count"] == 0
    assert s["emit_errors"] == 0
    assert "brokers" in s


@pytest.mark.asyncio
async def test_event_producer_emit_returns_false_when_disabled() -> None:
    p = EventProducer()
    ok = await p.emit("content.published", "key", {})
    assert ok is False


@pytest.mark.asyncio
async def test_event_producer_emit_does_not_increment_count_when_disabled() -> None:
    p = EventProducer()
    for _ in range(3):
        await p.emit("content.published", "k", {"x": 1})
    assert p.stats["emit_count"] == 0
    assert p.stats["emit_errors"] == 0


@pytest.mark.asyncio
async def test_event_producer_start_with_eventbus_disabled_is_noop() -> None:
    """EVENTBUS_ENABLED=false in conftest → start() short-circuits, no broker
    connection attempted, producer remains disabled."""
    p = EventProducer()
    await p.start()
    assert p.is_enabled is False


@pytest.mark.asyncio
async def test_event_producer_stop_safe_on_unstarted() -> None:
    """stop() must be safe to call even if start() never succeeded."""
    p = EventProducer()
    # Should not raise.
    await p.stop()
    assert p.is_enabled is False
