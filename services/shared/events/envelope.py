"""Event envelope — Python mirror of envelope.ts.

The envelope every event carries on the bus. Per-topic payload shapes live
in schemas.py.
"""

from __future__ import annotations

from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, Field

from .topics import TopicName

P = TypeVar("P", bound=BaseModel)


class EventEnvelopeBase(BaseModel):
    """Stable id for idempotency. ULID format recommended (e.g. evt_01HXYZ...)."""

    id: str = Field(..., min_length=8, max_length=64)
    topic: TopicName
    version: int = Field(1, ge=1)
    occurred_at: datetime
    company_id: str
    client_id: str | None = None
    trace_id: str | None = None


class EnvelopedEvent(EventEnvelopeBase, Generic[P]):
    """Concrete envelope with a typed payload.

    Use as: EnvelopedEvent[ContentPublishedPayload]
    """

    payload: P
