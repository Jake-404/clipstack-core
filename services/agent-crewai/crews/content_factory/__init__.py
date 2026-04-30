"""Content Factory crew — Doc 1 §7.1.

Six roles: Researcher, Strategist, LongFormWriter, SocialAdapter,
NewsletterAdapter, BrandQA. Sequential pipeline (Doc 1 §3 locked).

Phase A.0: agent + task definitions complete; tools are stubs in
`services/agent-crewai/tools/` that return placeholder data so the crew
constructs without external calls. Real tool wiring lands in A.2.
"""

from .crew import build_content_factory_crew

__all__ = ["build_content_factory_crew"]
