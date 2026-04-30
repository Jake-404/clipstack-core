"""Assemble the publish pipeline state graph.

Phase A.0: builds an in-memory checkpointer for dry-run validation. In A.2
the checkpointer swaps to PostgresSaver so paused runs survive restarts.
"""

from __future__ import annotations

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from .nodes import (
    awaiting_human_approval,
    publish_to_channel,
    record_block_lesson,
    record_deny_lesson,
    record_metering,
    review_cycle,
    route_approval,
    should_revise,
)
from .state import PublishState


def build_publish_pipeline() -> object:
    """Compile the publish pipeline graph. Returns a runnable LangGraph."""
    g: StateGraph = StateGraph(PublishState)

    g.add_node("review_cycle", review_cycle)
    g.add_node("awaiting_human_approval", awaiting_human_approval)
    g.add_node("record_block_lesson", record_block_lesson)
    g.add_node("record_deny_lesson", record_deny_lesson)
    g.add_node("publish_to_channel", publish_to_channel)
    g.add_node("record_metering", record_metering)

    g.add_edge(START, "review_cycle")

    g.add_conditional_edges(
        "review_cycle",
        should_revise,
        {
            "review_cycle": "review_cycle",  # max-rev cap enforced inside `should_revise`
            "awaiting_human_approval": "awaiting_human_approval",
            "record_block_lesson": "record_block_lesson",
        },
    )

    g.add_conditional_edges(
        "awaiting_human_approval",
        route_approval,
        {
            "awaiting_human_approval": "awaiting_human_approval",
            "publish_to_channel": "publish_to_channel",
            "record_deny_lesson": "record_deny_lesson",
        },
    )

    g.add_edge("publish_to_channel", "record_metering")
    g.add_edge("record_metering", END)
    g.add_edge("record_block_lesson", END)
    g.add_edge("record_deny_lesson", END)

    # A.0: in-memory checkpointer keeps the graph compilable without Postgres.
    # A.2: swap for PostgresSaver(POSTGRES_URL) so paused runs survive restarts.
    return g.compile(checkpointer=MemorySaver())
