"""live_event_monitor crew — Doc 4 §2.8.

Severity-scored awareness of breaking events: industry news, regulatory
moves, cultural moments, crises. Emits `live_event.detected` with
relevance to active campaigns. Workspaces configure pause-publishes
threshold: e.g., halt all sends if a major industry event scores ≥ 7/10.

Acceptance per Doc 4: a test event triggers the configured response within
5 minutes; no publishes ship during a live black-swan event without
explicit human override.
"""

from .crew import build_live_event_monitor_crew

__all__ = ["build_live_event_monitor_crew"]
