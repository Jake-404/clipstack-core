"""recent_anomalies — Strategist context.

Doc 4 §2.2 step 4: "Campaign rollup materialises per-campaign live
stats; strategist agent reads on every generation." This tool is the
read-side companion: when generating a new piece, the Strategist polls
performance-ingest's /anomaly/scan to surface drafts that just spiked
or dropped — those are signal-rich moments to lean into (replicate the
spike's framing) or steer away from (kill what's collapsing).

Calls performance-ingest directly via PERFORMANCE_INGEST_BASE_URL.
Falls back to an empty list when env unset, matching the rest of the
tool family's offline-dev contract.

Counterpart tools:
  - retrieve_high_performers — Postgres-backed, slower, longer view
    (top-quartile drafts in a topic over the last 30 days)
  - recent_anomalies (this tool) — in-memory rolling-stats backed,
    faster, narrower view (drafts whose latest snapshot deviates >
    2.5σ from the workspace's running mean)

Both are read-only; they don't mutate workspace state.
"""

from __future__ import annotations

import os
from typing import Literal

import httpx
import structlog
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

log = structlog.get_logger()

API_BASE_URL = os.getenv("PERFORMANCE_INGEST_BASE_URL")
SERVICE_TOKEN = os.getenv("SERVICE_TOKEN")
SERVICE_NAME = "agent-crewai"

KPI = Literal["ctr", "engagement_rate", "conversion_rate"]


class RecentAnomaliesInput(BaseModel):
    company_id: str
    client_id: str | None = None
    # Default 24h matches the bus-emission per-snapshot detector's
    # mental model ("what's anomalous in the last day"). Lookback up
    # to 7d (168h) for retrospective analysis on slow-moving channels.
    lookback_hours: int = Field(24, gt=0, le=168)
    # Workspace-tunable z-threshold; default 2.5σ matches /ingest's
    # default so the on-demand surface agrees with the bus events.
    z_threshold: float = Field(2.5, gt=0)


class _RecentAnomaliesTool(BaseTool):
    name: str = "recent_anomalies"
    description: str = (
        "List drafts whose latest performance snapshot deviates from "
        "the workspace's running mean by ≥ z_threshold standard "
        "deviations within the lookback window. Returns one record per "
        "anomaly with z_score, value, rolling_mean, rolling_std. Use "
        "before drafting to surface signal-rich moments to lean into "
        "(spikes) or steer away from (drops)."
    )
    args_schema: type[BaseModel] = RecentAnomaliesInput

    def _run(  # type: ignore[override]
        self,
        company_id: str,
        client_id: str | None = None,
        lookback_hours: int = 24,
        z_threshold: float = 2.5,
    ) -> list[dict]:
        if not (API_BASE_URL and SERVICE_TOKEN):
            log.debug(
                "recent_anomalies.fallback_stub",
                reason="PERFORMANCE_INGEST_BASE_URL or SERVICE_TOKEN not set",
            )
            return []

        url = f"{API_BASE_URL.rstrip('/')}/anomaly/scan"
        body: dict[str, object] = {
            "company_id": company_id,
            "lookback_hours": lookback_hours,
            "z_threshold": z_threshold,
        }
        if client_id:
            body["client_id"] = client_id

        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(
                    url,
                    json=body,
                    headers={
                        "X-Clipstack-Service-Token": SERVICE_TOKEN,
                        "X-Clipstack-Active-Company": company_id,
                        "X-Clipstack-Service-Name": SERVICE_NAME,
                    },
                )
        except (httpx.HTTPError, OSError) as e:
            log.warning("recent_anomalies.http_error", error=str(e), url=url)
            return []

        if resp.status_code != 200:
            log.warning(
                "recent_anomalies.bad_status",
                status=resp.status_code,
                body=resp.text[:200],
            )
            return []

        data = resp.json()
        # performance-ingest returns AnomalyScanResponse directly (no
        # envelope wrapper, matching the service's existing contract).
        if not isinstance(data, dict):
            return []
        detections = data.get("detections") or []
        return list(detections) if isinstance(detections, list) else []


recent_anomalies_tool = _RecentAnomaliesTool()
