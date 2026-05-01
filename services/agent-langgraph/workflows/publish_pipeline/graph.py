"""Assemble the publish pipeline state graph.

Phase A.0 shipped 6 nodes. A.3 (this revision) adds 2 real-time-tier nodes:
  - percentile_gate  : pre-approval prediction; below threshold reroutes
                       to review_cycle (Doc 4 §2.4)
  - bandit_allocate  : pre-publish variant selection; tags state with
                       variant_id for content.published attribution (§2.3)

Both nodes pass through when EVENTBUS_ENABLED=false, so the graph still
works in dev without Redpanda + percentile-predictor + bandit-orchestrator
running.

In-memory checkpointer remains; A.2 follow-up swaps for PostgresSaver so
paused runs survive restarts.
"""

from __future__ import annotations

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

    return g.compile(checkpointer=MemorySaver())
