# Status Page Contract

What we publish, when. The status page is the customer-side surface of incident response — every Sev-1/Sev-2 incident updates it, and uptime numbers publish there with no massaging.

## Hosting

The status page lives on a **different provider** than the platform itself. This is intentional: when the platform is down, the status page must still be reachable. Common choices:

- Atlassian Statuspage (paid, mature)
- Statuspage.io (paid, mature)
- Self-hosted Upptime (free, GitHub-based, sufficient for pre-revenue)
- Cachet (open-source self-host)

Hosted SaaS deployment picks one before the first paying customer. Pre-revenue we recommend Upptime — it deploys to GitHub Pages, runs the synthetic probes from GitHub Actions, and is free.

## Components published

| Component | What's included |
|---|---|
| Platform — Mission Control | The approval-ui surface |
| Platform — Agent services | agent-crewai + agent-langgraph health |
| Platform — Channel publishing | All channel adapters as one rolled-up status |
| Platform — LLM router (LiteLLM) | Routing + fallback availability |
| Platform — Vector store (Qdrant) | recall_lessons + voice_score availability |
| Platform — Database (Postgres) | RLS-protected tenant DB |
| Platform — Workflow engine (n8n) | Scheduled tasks + heartbeats |
| Platform — Real-time (Redpanda) | A.3+ event bus |
| Platform — Object storage | Brand-kit + generated assets |
| Third-party — LLM providers | Per-provider rolled-up (Anthropic, OpenAI, Ollama) |
| Third-party — Channel APIs | Per-channel rolled-up (X, LinkedIn, Reddit, Instagram, TikTok) |

Each component publishes one of: **Operational** / **Degraded performance** / **Partial outage** / **Major outage**. Severity bumps based on the percentage of probes failing in the last 5 minutes (1-19% = degraded, 20-79% = partial, 80%+ = major).

## What gets posted

Per the incident-response guide:

| Event | Status-page action | Latency |
|---|---|---|
| Sev-1 detected | Post "Investigating" with one-line description | 30 min from detection |
| Sev-2 detected | Post "Investigating" | 60 min from detection |
| Sev-3 detected (customer-visible) | Mark affected component "Degraded" | Best-effort |
| Cause identified | Update to "Identified" | Best-effort, ≥1h between updates |
| Resolution underway | Update to "In progress" | Best-effort |
| Service restored | Mark "Resolved" | 5 min from restoration |
| Postmortem published | Link from the incident card | 5 business days from resolution |

## What doesn't get posted

- **Internal-only issues.** A staging-environment failure isn't a status-page event.
- **Pre-emptive maintenance windows.** Those go on the maintenance page (separate tab on the same status page) with 48h notice. They don't count as incidents.
- **Speculation on cause.** "We think it's a database issue" never goes on the page until confirmed. "We are investigating reports of slow approvals" is fine — that's user-visible, not speculative.

## Tone

Status-page text is **factual**, not apologetic in voice. The apology is in the postmortem; the page is for users who need to know whether their thing is working.

Bad: "We're so sorry, we're working as hard as we can to fix this critical issue!!"
Good: "Investigating reports of slow draft generation. Update in 1 hour."

## Subscription

Customers can subscribe to status updates via email, RSS, or webhook. Hosted-SaaS workspaces auto-subscribe their primary admin contact at signup; opt-out is one click.

## Uptime publication

Last-30-day, last-90-day, and last-365-day uptime numbers publish at the bottom of the page, refreshed daily. Numbers come straight from the synthetic probes — same data feeding the SLA credit calculation.

We don't filter "scheduled maintenance" out of the headline number. Maintenance windows are visible as separate striped bars in the daily-uptime chart, and the SLA section explicitly excludes them. The headline shows what users actually experienced.

## What ships in A.1

- ✅ This contract document
- ✅ Component list locked

## What lands in A.3

- Status-page provider chosen + deployed
- Synthetic probes configured (us-east, eu-west, ap-southeast)
- Webhook from incident-response tooling auto-posts updates
- Uptime backfill from probe history

## Pre-revenue note

Until the first paying customer, the status page is best-effort. We commit to standing it up before the first SLA-bearing contract is signed.
