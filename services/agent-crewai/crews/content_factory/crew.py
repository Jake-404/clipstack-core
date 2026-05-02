"""Content Factory crew assembly. Doc 1 §7.1 + Doc 5 §1.6 + USP 8 (Phase B).

Sequential process:
  research → strategise → long-form → adapt-per-platform + newsletter
  → DevilsAdvocateQA → ClaimVerifier → BrandQA

Returns a `Crew` object the caller can `kickoff(inputs=...)` once
LiteLLM keys + tool backends are wired.
"""

from __future__ import annotations

from crewai import Crew, Process

from .agents import (
    make_brand_qa,
    make_claim_verifier,
    make_devils_advocate_qa,
    make_long_form_writer,
    make_newsletter_adapter,
    make_researcher,
    make_social_adapter,
    make_strategist,
)
from .tasks import (
    task_brand_qa,
    task_claim_verifier,
    task_devils_advocate,
    task_long_form,
    task_newsletter_adapt,
    task_research,
    task_social_adapt,
    task_strategise,
)

_VALID_PLATFORMS = {"x", "linkedin", "reddit", "tiktok", "instagram"}


def build_content_factory_crew(
    *,
    company_id: str,
    platforms: list[str],
    source_type: str = "url",
    source_value: str = "",
    campaign_id: str = "",
    variants_per_platform: int = 1,
) -> Crew:
    """Assemble the crew. Phase A.0: builds without kicking off.

    Pass the assembled crew to `crew.kickoff(inputs={...})` once you're ready
    for live execution. Inputs are read by the Researcher's task description
    via the templated source_type/source_value already baked at build time.

    Bandit allocation (Doc 4 §2.3): pass variants_per_platform > 1 to have
    the Strategist generate N hook variants per platform and register them
    with the bandit-orchestrator. Default 1 = single-variant (legacy
    behaviour; no bandit handoff). Requires a campaign_id to scope the
    bandits — falls back to "" which the orchestrator persists as-is.
    """
    unknown = set(platforms) - _VALID_PLATFORMS
    if unknown:
        raise ValueError(
            f"unknown platforms: {sorted(unknown)} (valid: {sorted(_VALID_PLATFORMS)})"
        )
    if variants_per_platform < 1 or variants_per_platform > 5:
        raise ValueError(
            "variants_per_platform must be in [1, 5] (Doc 4 §2.3 caps at 5 arms "
            "per bandit per platform; the orchestrator's hard cap is 10)"
        )

    researcher = make_researcher()
    strategist = make_strategist()
    writer = make_long_form_writer()
    newsletter = make_newsletter_adapter()
    devils = make_devils_advocate_qa()
    claim_verifier = make_claim_verifier()
    qa = make_brand_qa()

    social_agents = {p: make_social_adapter(p) for p in platforms}

    t_research = task_research(researcher, source_type, source_value)
    t_strat = task_strategise(
        strategist,
        platforms,
        context=[t_research],
        company_id=company_id,
        campaign_id=campaign_id,
        variants_per_platform=variants_per_platform,
    )
    t_long = task_long_form(writer, context=[t_strat])
    t_socials = [
        task_social_adapt(social_agents[p], p, context=[t_long]) for p in platforms
    ]
    t_news = task_newsletter_adapt(newsletter, context=[t_long])
    # Three independent critic dimensions — each runs on the full draft set.
    # DevilsAdvocate (framing/implication) → ClaimVerifier (citation correctness)
    # → BrandQA (voice + brand safety). BrandQA reads both prior verdicts.
    t_devils = task_devils_advocate(devils, context=[t_long, *t_socials, t_news])
    t_claims = task_claim_verifier(
        claim_verifier, context=[t_long, *t_socials, t_news]
    )
    t_qa = task_brand_qa(
        qa, context=[t_long, *t_socials, t_news, t_devils, t_claims]
    )

    crew = Crew(
        agents=[
            researcher,
            strategist,
            writer,
            *social_agents.values(),
            newsletter,
            devils,
            claim_verifier,
            qa,
        ],
        tasks=[
            t_research,
            t_strat,
            t_long,
            *t_socials,
            t_news,
            t_devils,
            t_claims,
            t_qa,
        ],
        process=Process.sequential,
        verbose=False,
        memory=False,  # Persistent memory is `company_lessons` + Qdrant — not CrewAI-native.
    )
    # Tag for Langfuse traces (Phase B). company_id flows through inputs at kickoff.
    crew.metadata = {"crew_id": "content_factory", "company_id": company_id}  # type: ignore[attr-defined]
    return crew
