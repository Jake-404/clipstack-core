# Incident Response

How to handle a live incident. The detail you read on a normal day so you don't have to think on a bad one.

## Severity ladder

| Sev | Definition | Response | Examples |
|---|---|---|---|
| **Sev-1** | Production unavailable for all/most users; data integrity at risk | Page on-call within 15 min; status page within 30 min | Postgres primary unrecoverable; entire region down; mass data corruption |
| **Sev-2** | Major feature unavailable; subset of users affected | Page on-call within 30 min; status page within 60 min | LLM provider full outage with no fallback; bulk publish broken; single-tenant data corruption |
| **Sev-3** | Degraded performance or minor feature outage | Acknowledge in-hours; status page if customer-visible | Slow approvals queue; one channel adapter broken; voice score returning errors but content generation works |
| **Sev-4** | Cosmetic, internal-only, or single-user issue | Triage in normal sprint cadence | UI typo; one user's brand kit failed to import; admin tool quirk |

## On-call expectations (hosted SaaS)

Once paid customers exist:

- **Response SLA** — Sev-1: 15 min ack. Sev-2: 30 min ack. (Resolution is best-effort.)
- **Rotation** — weekly handoff. The on-call engineer is reachable via PagerDuty (or equivalent) for the duration of the rotation.
- **Escalation** — if the on-call doesn't ack within the SLA, the page escalates to a secondary, then to engineering management.
- **Compensation policy** — pre-revenue: no on-call comp. Post-revenue: per the eng-comp doc.

Pre-revenue: best-effort response during Jake's working hours; async issue tracking otherwise. Status page reflects this honestly; no false uptime promises.

## During the incident

### 1. Acknowledge

Click ack on the page. Open the incident channel (Slack `#incident-active` or equivalent). Time-stamp the start.

### 2. Triage

Three questions, in this order:

1. **Is data at risk?** If yes (Sev-1), get a second responder before doing anything destructive. The first action of a panicked solo responder is the source of half of all incident-amplification stories.
2. **Is it customer-visible?** If yes, post to the status page within the SLA (Sev-1: 30 min, Sev-2: 60 min). Use the templates below; never speculate on cause in a public update.
3. **What's the smallest change that would restore service?** Not the full fix; the smallest temporary patch. Sometimes that's a feature flag flip, sometimes a rollback, sometimes nothing (wait it out).

### 3. Communicate

**Internal (Slack `#incident-active`):**

- Time-stamp every action you take (decisions, commands run, observations).
- Tag people you need; don't broadcast.
- If you're stuck for >15 min on Sev-1, ping a second responder. Solo time on Sev-1 doesn't help.

**External (status page):**

Templates:

```
[Investigating] We are investigating reports of <user-visible symptom>.
Posted at <UTC time>.
```

```
[Identified] We have identified the issue: <one-sentence non-speculative description>.
Working on resolution.
```

```
[Resolved] The issue has been resolved. <One-sentence cause if confirmed; otherwise omit>.
A postmortem will be published within 5 business days.
```

Update every hour for Sev-1 even if there's nothing new. Silence reads as "they don't know." Cadence reads as "they're working on it."

### 4. Resolve

When service is back:

- Verify with a real user-shaped check — log in, run a representative action, confirm.
- Mark resolved on the status page.
- Mark the page resolved.
- Time-stamp the end.
- Schedule the postmortem (within 5 business days).

## Postmortem

Write within 5 business days. Format:

```markdown
# Postmortem: <date> — <one-line summary>

**Status:** Resolved / Mitigated / Ongoing
**Severity:** Sev-N
**Duration:** <start UTC> → <end UTC> = <N hours M minutes>
**Customer impact:** <one paragraph; how many tenants, what they saw>

## Timeline

| Time (UTC) | Event |
|---|---|
| 14:23 | <first observation> |
| 14:31 | <ack> |
| ... |

## Cause

What broke and why. Specific. Avoid "the system" or "an error" — name files, services, deployments.

## Resolution

What restored service. The actions taken in order.

## What worked

Things that helped.

## What didn't

Things that hurt or slowed us down.

## Action items

| ID | Action | Owner | Target | Done? |
|---|---|---|---|---|
| 1 | ... | <name> | <date> | [ ] |

## Followups

Adjacent work this surfaced (not action items — separate tickets).
```

The action-items section is the one with teeth. It goes into the sprint backlog with the date attached, and it gets reviewed in the next month's incident-review meeting. Items that don't land by their target date get re-discussed; we don't let them rot.

## What postmortems are NOT

- Not blame docs. The five whys ask "why did the system permit this," not "who screwed up."
- Not promises that "this will never happen again." That language reads as if you've solved the underlying class of problem; usually you've solved one instance.
- Not internal-only by default. Customer-affecting incidents publish a customer-version of the postmortem to the status page within 10 business days.

## Drills

Once a quarter we run a tabletop: pick a Sev-1 scenario from `runbook.md` §"Failure modes covered", walk through the response without actually doing it. Time the tabletop; surface gaps in the runbook from the discussion. The drill is part of the regular cadence, not a fire alarm.

## Pre-revenue note

This document describes the steady state. Pre-revenue (no paying customers, no SLAs) the response is "Jake handles it during business hours, queue it up otherwise." The doc exists now so the muscle memory is in place when paying customers exist.
