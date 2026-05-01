"""engagement crew — Doc 4 §2.9.

Per-platform reply triage. Subscribes to `content.published` for active
campaigns, watches reactions, triages incoming replies (respond / ignore /
escalate / moderate), and drafts replies through the same brand-voice +
brand-safety gates as outbound posts.

Acceptance per Doc 4: reply triage within 5 minutes of a comment landing;
reply drafts visible in the approval queue.
"""

from .crew import build_engagement_crew

__all__ = ["build_engagement_crew"]
