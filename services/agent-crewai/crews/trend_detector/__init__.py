"""trend_detector crew — Doc 4 §2.5.

A counterpart to crisis-monitor that surfaces *opportunities* rather than
threats. Continuously consumes streams from X / Reddit / Farcaster / Google
Trends / niche APIs; emits `trend.detected` events on rising signals scored
by relevance × velocity × competitive whitespace.

Output is brand-safety-gated: every reactive draft passes brand_safety_check
before the approval row is created — per the plan's hard rule that reactive
content NEVER auto-publishes (covers the "agent picks up a tragedy / off-brand
trend" failure mode).
"""

from .crew import build_trend_detector_crew

__all__ = ["build_trend_detector_crew"]
