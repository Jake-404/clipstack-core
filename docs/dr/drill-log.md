# DR drill log

The runbooks under [README.md](./README.md) are theoretical until they have been exercised against a real environment. This file is the running log of those exercises — when they ran, who ran them, how long the recovery took, and what the drill surfaced that the runbook missed.

A runbook that has never been drilled is not a runbook; it's an aspiration.

## Cadence

Quarterly minimum, plus before any major release. Per security best practice and the SOC 2 CC7.5 control. Drills are scheduled, not surprise — surprise drills cost more in operator stress than they pay back in realism, and the muscle-memory benefit comes from running the drill carefully not from running it cold.

## Drill types

Three drill types rotate through the year. Each maps to one of the per-resource runbooks under [README.md](./README.md).

| Drill type | Maps to | Scope | Wall-clock target |
|---|---|---|---|
| **Postgres PITR drill** | [runbook-postgres.md](./runbook-postgres.md) | Simulate corruption against a non-production branch, restore to a Neon recovery branch, validate the cut-over and smoke-test set, then archive the recovery branch. | ~30 min |
| **Bandit state restore** | [runbook-bandit-state.md](./runbook-bandit-state.md) | Zero out the orchestrator's `BANDIT_DATA_DIR`, restore from S3 using the canonical 5-step procedure, verify the reverse index rebuilds and a known workspace's bandits return non-uniform allocations. | ~10 min |
| **Full mesh recovery** | [runbook-services.md](./runbook-services.md) | Provision a fresh deploy from scratch using the 8-step bootstrap order against a non-production cloud account. End-to-end smoke against `/api/health/services`. | ~3 hr |

The data-corruption runbook ([runbook-data-corruption.md](./runbook-data-corruption.md)) is exercised as a tabletop, not a destructive drill — the procedure includes regulatory notification timing that is harder to simulate without false alarms. Schedule a tabletop on the same quarterly cadence.

## Log

Empty until the first drill ships. Populate one row per completed drill. Do not delete rows from this table; an old failed drill is a more useful artefact than a clean log.

| Date (UTC) | Drill type | Operator | Wall-clock to recovery | Findings | Action items |
|---|---|---|---|---|---|
| (none yet) | | | | | |

### How to populate a row

- **Date.** ISO 8601 date the drill ran. If a drill spans days, use the start date.
- **Drill type.** One of the three above, or "Tabletop — data corruption" for the data-corruption runbook.
- **Operator.** Who ran the drill. Pre-revenue: Jake. Post-revenue: the on-call engineer plus a secondary observer.
- **Wall-clock to recovery.** From the simulated failure trigger to a green `/api/health/services` response. If the drill missed its target, this is still the number you log; the gap-vs-target is the action item.
- **Findings.** One sentence per surprise. The bias is towards documenting things the runbook didn't anticipate, not re-summarising the runbook itself.
- **Action items.** Link to a tracked ticket per finding. Findings without a tracked ticket rot; tracked tickets get closed.

## Cross-references

The drill log is one of three paired artefacts that together form the operational evidence of DR readiness:

1. **This file** — proof the drills happened, dated and logged.
2. **`core/docs/dr/runbook-*.md`** — the procedures the drills exercise.
3. **The postmortem set per `incident-response.md`** — the live-fire equivalent. Real incidents always reveal more than drills; a drill log paired with a postmortem set covers both halves of the readiness picture.

A drill that surfaces a runbook gap should result in an edit to the runbook in the same change set as the drill-log entry. The drill log answers "did we exercise this?"; the runbook answers "what is the procedure?". Neither one is complete without the other.
