"""publish_pipeline — drafts to live posts, with human-approval checkpoint.

State machine:

    draft_received
        │
        ▼
    review_cycle (critic + reviser, max N rounds)
        │
        ▼
    awaiting_human_approval ──── DENY ──→ record_lesson (USP 5) ─→ END
        │
        APPROVE
        │
        ▼
    publish_to_channel
        │
        ▼
    record_metering (USP 10)
        │
        ▼
    END (post lands in post_metrics ingest)

Doc 1 §3 — LangGraph holds workflows that need durable state + HITL.
Doc 4 §2.3 — checkpointer is Postgres so a 24h-old paused run resumes cleanly.
"""

from .graph import build_publish_pipeline

__all__ = ["build_publish_pipeline"]
