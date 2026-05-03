"""live_event_monitor — single-agent toolbelt crew.

Subscribes to a curated news feed (vertical-specific) plus social-spike
detection. Severity-scores events 0–10; relevance-scores 0–1. Above
threshold, emits `live_event.detected` and surfaces a tone-check prompt.
"""

from __future__ import annotations

from crewai import LLM, Agent, Crew, Process, Task

from models import JUDGE_MODEL, llm_kwargs
from tools.pay_and_fetch import pay_and_fetch_tool
from tools.recall_lessons import recall_lessons_tool


def _judge() -> LLM:
    return LLM(**llm_kwargs(JUDGE_MODEL))


def make_live_event_monitor() -> Agent:
    return Agent(
        role="LiveEventMonitor",
        goal=(
            "Consume the workspace's configured news + social-spike feeds. "
            "For each event: score severity 0–10 (0 = local-noise, 10 = "
            "industry-defining black swan) and relevance to active campaigns "
            "0–1. When severity × relevance clears workspace threshold, emit "
            "live_event.detected with the suggested action: pause-publishes / "
            "add-disclosure / draft-response / log."
        ),
        backstory=(
            "You're the platform's cultural and regulatory awareness layer. "
            "When a market-moving event lands during a campaign, the wrong "
            "response is ship-as-scheduled; the right response is pause-and-"
            "consider. You err on the side of pausing — false-positive pauses "
            "cost a few hours of cadence; false-negative ships during a crisis "
            "cost the brand. Workspaces tune the threshold; you don't."
        ),
        tools=[
            pay_and_fetch_tool,    # news APIs + social-spike feeds
            recall_lessons_tool,   # past events + their resolution
        ],
        llm=_judge(),
        allow_delegation=False,
        verbose=False,
    )


def task_scan_events(monitor: Agent) -> Task:
    return Task(
        description=(
            "Pull current events from the workspace's configured feeds via "
            "`pay_and_fetch`. For each:\n\n"
            "1. Classify event_kind (industry-news | crisis | cultural-moment "
            "   | regulatory).\n"
            "2. Score severity 0–10 grounded in observable facts (size of "
            "   affected audience, reversibility, regulatory weight).\n"
            "3. Score relevance 0–1 against active campaign keywords + "
            "   workspace's dismissedTrendKeywords.\n"
            "4. Recall lessons via `recall_lessons` for similar past events; "
            "   the team's history of how they handled this category should "
            "   shape the suggested action.\n"
            "5. For events above (severity × relevance) threshold, recommend: "
            "   pause-publishes (severity 7+) / add-disclosure (compliance) / "
            "   draft-response (opportunity) / log (above noise but below "
            "   action threshold)."
        ),
        agent=monitor,
        expected_output=(
            "Per-event record: event_kind, headline, severity, relevance, "
            "suggested_action, source_url. Sorted by severity × relevance desc."
        ),
    )


def build_live_event_monitor_crew(*, company_id: str) -> Crew:
    monitor = make_live_event_monitor()
    t_scan = task_scan_events(monitor)
    crew = Crew(
        agents=[monitor],
        tasks=[t_scan],
        process=Process.sequential,
        verbose=False,
        memory=False,
    )    # NOTE: Langfuse tag wiring removed — see content_factory/crew.py.
    return crew
