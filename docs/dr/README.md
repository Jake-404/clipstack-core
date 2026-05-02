# Disaster Recovery

Operational baseline for any Clipstack-core deployment — hosted SaaS, design-partner self-host, or solo self-host. Per Doc 5 §1.7 and the targets locked in `clipstack/CLAUDE.md` § Deployment state.

The runbooks below assume you have read the platform's failure-mode catalogue in [runbook.md](./runbook.md) and the live-incident procedure in [incident-response.md](./incident-response.md). What's new in this directory is the per-resource recovery procedure: when a specific tier of state is lost, this is the document you open first.

## Targets

Two numbers govern everything else.

- **RPO (Recovery Point Objective)** — the maximum data loss the platform tolerates. Measured backwards from the moment of failure: anything written more than RPO ago is restorable; anything written inside the RPO window may be lost.
- **RTO (Recovery Time Objective)** — the maximum downtime the platform tolerates. Measured forward from the moment of failure: service must be back within RTO.

The published platform targets are **RPO 15 minutes / RTO 1 hour** for Tier-1 resources. Lower-tier resources have looser targets. Every resource the platform depends on is tagged below.

## Tiered resources

The matrix below is the source of truth. If a resource is missing from this table it has not been classified and its loss has no defined recovery procedure — flag that as a gap.

| Tier | RPO | RTO | Resources | Loss impact |
|---|---|---|---|---|
| **1** | 15 min | 1 hr | Postgres: `drafts`, `approvals`, `audit_log`, `post_metrics`, `company_lessons`, `meter_events` | Revenue impact + customer trust. Drafts mid-approval lost, audit gap, metering gap. |
| **2** | 1 hr | 4 hr | Bandit-orchestrator state (filesystem JSON per `BANDIT_DATA_DIR`) | Bandit posteriors reset to seeded priors; Strategist re-registers on next campaign cycle. |
| **3** | 24 hr | 8 hr | Qdrant collections (voice corpora, lesson embeddings) | Workspaces re-train when noticed; voice scoring fails-soft to "untrained" in the interim. Not user-blocking. |
| **4** | 24 hr | best-effort | Redpanda streams (9 named topics) | Real-time loop pauses; producers fail-soft, consumers re-subscribe at `latest` offset. Re-ingest from `post_metrics` if catastrophic. |
| **5** | none | best-effort | LiteLLM (stateless router), Langfuse traces (telemetry-only) | Telemetry gap; no user-facing impact. |

Tier-1 resources are the ones a paying customer notices on the same day. Everything else has a graceful-degradation path documented in `core/docs/closed-loop.md` § Fail-soft semantics.

## Index

| Runbook | Covers |
|---|---|
| [runbook-postgres.md](./runbook-postgres.md) | Postgres restore — single-region outage, data corruption, RLS-bypass leak. PITR procedure on Neon. |
| [runbook-bandit-state.md](./runbook-bandit-state.md) | Bandit state restore from S3 per the backup module shipped in `services/bandit-orchestrator/BACKUP.md`. |
| [runbook-services.md](./runbook-services.md) | Full service-mesh recovery — total deployment loss, bootstrap order, reconciler procedure. |
| [runbook-data-corruption.md](./runbook-data-corruption.md) | Cross-tenant data-leak procedure — containment, investigation, regulatory notification. |

The pre-existing runbooks (`runbook.md`, `incident-response.md`, `sla.md`, `status-page.md`) cover the platform-wide contract, severity ladder, and external commitments. The four files above cover the per-resource mechanics.

## Drill cadence

Quarterly minimum, plus before any major release. Per security best practice and the SOC 2 CC7.5 control. The cadence and outcomes are tracked in [drill-log.md](./drill-log.md) — that file is empty until the first drill ships.

Three drill types rotate through the year:

- **Postgres PITR drill** — simulate corruption, restore to a Neon branch, validate. ~30 min wall-clock.
- **Bandit state restore** — zero out the orchestrator volume, restore from S3, validate. ~10 min wall-clock.
- **Full mesh recovery** — provision a fresh deploy from scratch using `runbook-services.md`. ~3 hr wall-clock.

The first drill of any new resource class (e.g. when Qdrant snapshots become contractually load-bearing) gets logged separately and added to the rotation.

## On-call escalation

Once paid customers exist, escalation flows through the on-call rotation documented in [incident-response.md](./incident-response.md) § On-call expectations. Pre-revenue, the escalation policy is "Jake during business hours, async issue queue otherwise." The published status page should reflect this honestly — no false uptime promises.

**Update with your team's escalation policy** — if you're a self-hoster, replace this section with your own rotation, paging tool, and secondary-responder contact. The platform default assumes the runbook is the authority; teams that operate Clipstack at scale will need PagerDuty / OpsGenie / Grafana OnCall configured as the primary trigger.
