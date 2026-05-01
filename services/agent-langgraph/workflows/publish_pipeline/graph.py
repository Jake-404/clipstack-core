"""Assemble the publish pipeline state graph.

Phase A.0 shipped 6 nodes. A.3 added 2 real-time-tier nodes (percentile_gate,
bandit_allocate). Sprint-close (this revision) swaps the in-memory
checkpointer for PostgresSaver when POSTGRES_URL is set — so a 24h-old
paused awaiting_human_approval run survives a service restart.

Checkpointer selection:
  - POSTGRES_URL set + LANGGRAPH_PERSIST_STATE != "false" → PostgresSaver
  - otherwise                                            → MemorySaver

The PostgresSaver auto-creates its tables on first use (langgraph_*) so no
separate migration needed. The connection is lazy — graph compile doesn't
hit Postgres until a node first touches the checkpointer.
"""

from __future__ import annotations

import os
from typing import Any

import structlog
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from .nodes import (
    awaiting_human_approval,
    bandit_allocate,
    percentile_gate,
    publish_to_channel,
    record_block_lesson,
    record_deny_lesson,
    record_metering,
    review_cycle,
    route_approval,
    route_percentile_gate,
    should_revise,
)
from .state import PublishState

log = structlog.get_logger()


def _build_checkpointer() -> Any:
    """Return the checkpointer for this deployment.

    Tries Postgres first when POSTGRES_URL is set + persist not opted out;
    falls back to in-memory on any wiring failure (so dev runs without
    Postgres still work). The fallback emits a structured log warning.
    """
    persist = os.getenv("LANGGRAPH_PERSIST_STATE", "true").lower() != "false"
    pg_url = os.getenv("POSTGRES_URL")

    if not (persist and pg_url):
        log.info(
            "langgraph.checkpointer.memory",
            reason="POSTGRES_URL unset or LANGGRAPH_PERSIST_STATE=false",
        )
        return MemorySaver()

    try:
        # Lazy import — keeps the module importable when langgraph-checkpoint-
        # postgres isn't installed (e.g., a unit test that doesn't need it).
        from langgraph.checkpoint.postgres import PostgresSaver  # type: ignore[import-not-found]

        # PostgresSaver.from_conn_string uses a sync connection. For graph
        # compile we just need the saver instance; per-node checkpoint reads
        # happen on the connection LangGraph manages internally.
        saver = PostgresSaver.from_conn_string(pg_url)
        # First-time setup creates the langgraph_* tables. Idempotent — safe
        # to call on every service start. The setup() context manager pattern
        # in newer SDK versions returns the saver; we keep it simple here.
        if hasattr(saver, "setup"):
            try:
                saver.setup()
            except Exception as e:  # noqa: BLE001
                log.warning(
                    "langgraph.checkpointer.setup_failed",
                    error=str(e),
                    fallback="memory",
                )
                return MemorySaver()

        log.info("langgraph.checkpointer.postgres", url_host=_url_host(pg_url))
        return saver
    except ImportError:
        log.warning(
            "langgraph.checkpointer.postgres_unavailable",
            message="langgraph-checkpoint-postgres not installed; using memory",
        )
        return MemorySaver()
    except Exception as e:  # noqa: BLE001
        log.warning(
            "langgraph.checkpointer.postgres_failed",
            error=str(e),
            fallback="memory",
        )
        return MemorySaver()


def _url_host(url: str) -> str:
    """Extract just the host[:port] from a postgres URL for logging.
    Avoids leaking credentials into structured logs."""
    try:
        # postgresql://user:pass@host:port/db → host:port
        after_at = url.split("@", 1)[-1]
        return after_at.split("/", 1)[0]
    except Exception:  # noqa: BLE001
        return "unknown"


def build_publish_pipeline() -> object:
    """Compile the publish pipeline graph. Returns a runnable LangGraph.

    State machine (A.3):

        START
          │
          ▼
        review_cycle ──revise──▶ review_cycle (max 3)
          │            │
          │            block──▶ record_block_lesson ──▶ END
          │
          pass
          │
          ▼
        percentile_gate ──gate_blocked + revisions left──▶ review_cycle
          │              ──out of revisions──▶ record_block_lesson ──▶ END
          │
          ▼
        awaiting_human_approval ──deny──▶ record_deny_lesson ──▶ END
          │
          approve
          │
          ▼
        bandit_allocate (pass-through if no bandit_id or bus off)
          │
          ▼
        publish_to_channel
          │
          ▼
        record_metering ──▶ END
    """
    g: StateGraph = StateGraph(PublishState)

    g.add_node("review_cycle", review_cycle)
    g.add_node("percentile_gate", percentile_gate)
    g.add_node("awaiting_human_approval", awaiting_human_approval)
    g.add_node("bandit_allocate", bandit_allocate)
    g.add_node("record_block_lesson", record_block_lesson)
    g.add_node("record_deny_lesson", record_deny_lesson)
    g.add_node("publish_to_channel", publish_to_channel)
    g.add_node("record_metering", record_metering)

    g.add_edge(START, "review_cycle")

    g.add_conditional_edges(
        "review_cycle",
        should_revise,
        {
            "review_cycle": "review_cycle",
            "percentile_gate": "percentile_gate",
            "record_block_lesson": "record_block_lesson",
        },
    )

    g.add_conditional_edges(
        "percentile_gate",
        route_percentile_gate,
        {
            "review_cycle": "review_cycle",
            "awaiting_human_approval": "awaiting_human_approval",
            "record_block_lesson": "record_block_lesson",
        },
    )

    g.add_conditional_edges(
        "awaiting_human_approval",
        route_approval,
        {
            "awaiting_human_approval": "awaiting_human_approval",
            "bandit_allocate": "bandit_allocate",
            "record_deny_lesson": "record_deny_lesson",
        },
    )

    g.add_edge("bandit_allocate", "publish_to_channel")
    g.add_edge("publish_to_channel", "record_metering")
    g.add_edge("record_metering", END)
    g.add_edge("record_block_lesson", END)
    g.add_edge("record_deny_lesson", END)

    return g.compile(checkpointer=_build_checkpointer())
