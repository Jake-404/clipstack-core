"""algorithm_probe — single-agent toolbelt crew.

The probe runs on a *configured* low-sensitivity workspace (per Doc 4 — not
on a paying customer's primary brand). It posts known-pattern test artefacts,
measures the decay curve, compares to historical baselines per signal-pack
(`signals/algorithms/<platform>/current.yaml`), and bumps the version with
the new heuristic when confidence clears the workspace threshold.
"""

from __future__ import annotations

from crewai import LLM, Agent, Crew, Process, Task

from models import JUDGE_MODEL, llm_kwargs
from tools.pay_and_fetch import pay_and_fetch_tool
from tools.recall_lessons import recall_lessons_tool


def _judge() -> LLM:
    return LLM(**llm_kwargs(JUDGE_MODEL))


def make_algorithm_prober() -> Agent:
    return Agent(
        role="AlgorithmProber",
        goal=(
            "On the configured least-sensitive workspace, run known-pattern "
            "test posts on each tracked platform, measure the engagement "
            "decay curve, and compare to the historical baseline in "
            "signals/algorithms/<platform>/current.yaml. When confidence in a "
            "shift clears the workspace threshold (default 0.7), emit a "
            "platform.algorithm_shift event and propose an updated heuristic "
            "for the signal-pack maintainer to review."
        ),
        backstory=(
            "You're the platform's early-warning system for algorithm shifts. "
            "Most updates are noise — random fluctuation in engagement that "
            "regresses to mean within days. The few that aren't are regime "
            "changes, and catching them seven days early is the difference "
            "between a campaign that lands and one that mysteriously tanks. "
            "You err on the side of patience: confidence threshold matters "
            "more than speed."
        ),
        tools=[
            pay_and_fetch_tool,    # platform-native analytics fetches
            recall_lessons_tool,   # past detected shifts + their resolutions
        ],
        llm=_judge(),  # judgment-heavy task; cheap classifier insufficient
        allow_delegation=False,
        verbose=False,
    )


def task_probe_platform(prober: Agent, *, platform: str) -> Task:
    return Task(
        description=(
            f"Probe platform: {platform}.\n\n"
            "1. Fetch the current baseline heuristic from signals/algorithms/"
            f"{platform}/current.yaml (loader returns null if signals not "
            "mounted; treat null as 'no baseline yet — log only').\n"
            "2. Run the configured probe-post battery via `pay_and_fetch`. "
            "Record per-post: time-of-day, length, hashtag count, has_media, "
            "first-hour engagement velocity, t+24h cumulative engagement.\n"
            "3. Compute the decay curve. Compare to baseline.\n"
            "4. If divergence × confidence > workspace threshold, propose an "
            "updated heuristic (tiered: minor / moderate / regime-change). "
            "Output the diff vs current baseline.\n"
            "5. Recall lessons via `recall_lessons` to check for previous "
            "false-positive patterns this platform has produced."
        ),
        agent=prober,
        expected_output=(
            "Probe report: platform, baseline_version, observed_decay_curve, "
            "divergence, confidence, proposed_diff, recommendation "
            "(no_action | log_only | propose_update)."
        ),
    )


def build_algorithm_probe_crew(*, company_id: str, platform: str) -> Crew:
    prober = make_algorithm_prober()
    t_probe = task_probe_platform(prober, platform=platform)
    crew = Crew(
        agents=[prober],
        tasks=[t_probe],
        process=Process.sequential,
        verbose=False,
        memory=False,
    )    # NOTE: Langfuse tag wiring removed — see content_factory/crew.py.
    return crew
