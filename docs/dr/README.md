# Disaster Recovery + Incident Response

Operational baseline for any Clipstack-core deployment — hosted SaaS, design-partner self-host, or solo self-host. Per Doc 5 §1.7.

## What's in here

| File | Purpose |
|---|---|
| [runbook.md](./runbook.md) | The DR runbook itself — RPO/RTO targets, replication topology, restore procedure, model fallback chains |
| [incident-response.md](./incident-response.md) | Severity ladder, on-call expectations, communication template, postmortem format |
| [sla.md](./sla.md) | What service availability we commit to, exclusions, credit policy |
| [status-page.md](./status-page.md) | Status page contract — what statuses we publish, latency to publication, components covered |

## The shape of the commitment (Phase A.1)

| Metric | Target | What it means |
|---|---|---|
| **RPO** | 15 minutes | Maximum data loss in a regional failure |
| **RTO** | 1 hour | Maximum time to restore service in a regional failure |
| **Uptime SLA** | 99.5% / month | Excluding scheduled maintenance announced 48h ahead |
| **Incident Sev-1 first response** | 15 minutes | Acknowledgement, not resolution |
| **Sev-1 resolution target** | 4 hours | Or status update every 1 hour until resolved |
| **Postmortem publication** | 5 business days | After Sev-1 / Sev-2 incident closes |

These are **targets**, not contractual SLAs by default. SLAs above 99.5% are an Enterprise-tier add-on per the ToS. Self-hosters set their own targets — the runbooks ship as defaults you can adopt.

## What ships in A.1

- ✅ Runbook documenting the contract + operational steps (no live infra yet)
- ✅ Incident-response procedure
- ✅ SLA template with exclusions and credit policy
- ✅ Status-page contract — what we'd publish, when

## What lands in A.2 / A.3

- Cross-region Postgres replica + failover procedure (cloud infra)
- Object-storage replication
- Status page deployment (Statuspage.io / Atlassian / self-hosted upptime)
- On-call rotation tooling (PagerDuty / OpsGenie / similar)
- Quarterly DR drill — restore from snapshot to a fresh region; measure RTO
