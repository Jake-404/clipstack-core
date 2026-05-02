"""Approval-ui post_metrics persistence client.

Companion to producer.py: the producer emits real-time content.metric_update
events to Redpanda; this module persists the underlying snapshots to
Postgres via approval-ui's /api/companies/:cid/post-metrics route.

Two-write rationale:
  - Bus events are real-time but not durable (Redpanda retention is
    finite; consumers can fall behind and miss messages).
  - Postgres is durable but slow to query for trend detection at the
    event-stream cadence the bandit consumer needs.
  Writing to both lets each system serve its native query pattern.

Failure semantics: graceful — a persistence failure logs but doesn't
block /ingest. The bus emission is the load-bearing reward signal for
bandits; durability is for historical analysis. If approval-ui is down
or the route returns 5xx, we'd rather lose durability than fail the
ingest call.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
import structlog

log = structlog.get_logger()

APPROVAL_UI_BASE_URL = os.getenv("APPROVAL_UI_BASE_URL")
SERVICE_TOKEN = os.getenv("SERVICE_TOKEN")
SERVICE_NAME = "performance-ingest"
PERSIST_TIMEOUT_S = float(os.getenv("PERSIST_TIMEOUT_S", "10.0"))


def _snapshot_to_route_body(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Map MetricSnapshot.model_dump() → route's SnapshotSchema field names.

    Pydantic uses snake_case (draft_id); the TypeScript route uses
    camelCase (draftId). This is the single place that translation
    happens — keeps the rest of the Python service in snake_case.
    """
    return {
        "draftId": snapshot["draft_id"],
        "platform": snapshot["platform"],
        "snapshotAt": snapshot["snapshot_at"],
        "impressions": snapshot.get("impressions"),
        "reach": snapshot.get("reach"),
        "clicks": snapshot.get("clicks"),
        "reactions": snapshot.get("reactions"),
        "comments": snapshot.get("comments"),
        "shares": snapshot.get("shares"),
        "saves": snapshot.get("saves"),
        "conversions": snapshot.get("conversions"),
        "raw": snapshot.get("raw") or {},
    }


async def persist_batch(
    company_id: str,
    client_id: str | None,
    snapshots: list[dict[str, Any]],
) -> tuple[bool, int]:
    """POST a batch of snapshots to approval-ui's post_metrics route.

    Returns (success, inserted_count). On failure (env unset, 5xx, network
    error) returns (False, 0) — caller logs but doesn't block.

    Empty batches return (True, 0) — no-op success so the call site
    doesn't need to guard.
    """
    if not snapshots:
        return True, 0

    if not (APPROVAL_UI_BASE_URL and SERVICE_TOKEN):
        log.debug(
            "persist.disabled",
            reason="APPROVAL_UI_BASE_URL or SERVICE_TOKEN not set",
        )
        return False, 0

    url = (
        f"{APPROVAL_UI_BASE_URL.rstrip('/')}"
        f"/api/companies/{company_id}/post-metrics"
    )
    body = {
        "clientId": client_id,
        "snapshots": [_snapshot_to_route_body(s) for s in snapshots],
    }
    headers = {
        "X-Clipstack-Service-Token": SERVICE_TOKEN,
        "X-Clipstack-Active-Company": company_id,
        "X-Clipstack-Service-Name": SERVICE_NAME,
    }

    try:
        async with httpx.AsyncClient(timeout=PERSIST_TIMEOUT_S) as client:
            resp = await client.post(url, json=body, headers=headers)
    except httpx.HTTPError as e:
        log.warning("persist.http_error", error=str(e), url=url)
        return False, 0

    if resp.status_code != 200:
        log.warning(
            "persist.bad_status",
            status=resp.status_code,
            body=resp.text[:300],
            company_id=company_id,
            batch_size=len(snapshots),
        )
        return False, 0

    payload = resp.json()
    if not isinstance(payload, dict) or not payload.get("ok"):
        return False, 0
    data = payload.get("data") or {}
    return True, int(data.get("insertedCount", 0))
