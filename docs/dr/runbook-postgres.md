# Postgres restore

Tier-1 procedure. RPO 15 min / RTO 1 hr per [README.md](./README.md). Postgres holds the workspace's revenue-bearing state — `drafts`, `approvals`, `audit_log`, `post_metrics`, `company_lessons`, `meter_events` — so loss inside the RPO window is the worst-case data event short of a cross-tenant leak.

The platform default assumes Neon (eu-west-2) for the hosted SaaS. Self-hosters running their own Postgres replace the Neon-specific steps with their provider's PITR equivalent; the contract is identical.

## Failure modes

### F1 — Single-region Postgres outage

**Cause.** The provider's primary region is unavailable — Neon eu-west-2 down, AWS RDS regional outage, or an upstream networking incident that severs the application's reach to the database without affecting the database itself.

**Detection.** API 500s on every workspace request. The `/api/health` route on `approval-ui` returns 503; the `/api/health/services` route reports `postgres: unhealthy`. Health checks across every Python service fail their startup probe.

**Mitigation (parked, see `clipstack/CLAUDE.md`).** A cross-region Postgres replica is on the roadmap pre-first-SLA-bearing-contract. Until it ships, single-region outage is a wait-and-comms event.

**Action.**

1. Acknowledge the page. Open the incident channel.
2. Confirm via the provider's status page that the outage is upstream, not local config. Don't promote anything until that's confirmed.
3. Post `[Investigating]` to the customer status page within the Sev-1 window.
4. If recovery ETA from the provider is under 1 hr: wait. The provider's recovery is faster than ours.
5. If recovery ETA exceeds 1 hr: restore to a different region per F2 PITR procedure below, point the application at the new branch, communicate.

**Expected RTO** in the wait case is bounded by the provider; in the restore-to-different-region case, ~45-60 min once the cross-region replica lands, longer until then.

### F2 — Data corruption / accidental drop / migration failure

**Cause.** A bad migration, a manual `DELETE` without a `WHERE` clause, an application bug that wrote malformed data, or a dependency upgrade that silently corrupted column values.

**Detection.** Queries return malformed or missing data; user-visible errors spike on specific routes; RLS-policy errors increase if a migration broke `app_company_matches()` or its dependencies; the cross-tenant integration test in `tests/integration/cross-tenant-rls.sql` fails in CI on the next push.

**Action.** Branch the database to a point in time before the suspected corruption — see PITR procedure below. Do not roll forward over the corruption; PITR creates a parallel branch so the original state is preserved for forensics.

### F3 — RLS-bypass leak (cross-tenant data exposed)

**Cause.** Application bug bypasses RLS — a service-role connection used where a user-role connection should have been, a missing `SET LOCAL app.current_company_id`, or a RLS-policy regression.

**Detection.** Customer report ("I saw another company's data"), audit-log review, or the cross-tenant integration test in `tests/integration/cross-tenant-rls.sql` failing in CI.

**Action.** Containment first: see [runbook-data-corruption.md](./runbook-data-corruption.md) for the dedicated procedure. The Postgres-side mechanic is exposure-window capture (audit `SELECT` log, time-bounded) and a secret rotation. PITR is not the right tool here — the data wasn't corrupted, it was over-read.

## Procedure: PITR (point-in-time recovery) on Neon

Neon's PITR creates a new branch at the chosen timestamp; it does not overwrite the production database. The production branch stays available throughout — if the restore goes wrong, you can revert by pointing the app back at the original branch.

1. **Open the Neon dashboard** → project → "Branches" → "Recovery" tab.
2. **Choose target timestamp.** The most recent timestamp before the suspected corruption. Neon supports point-in-time selection at 1-second granularity within the 7-day WAL retention window.
3. **Branch to a new database.** Name it `recovery-YYYYMMDD-HHMM` so it's obvious in the UI. Neon generates a connection string for the branch.
4. **Verify the branch.** Connect via `psql` and run a known-good probe query that should resolve at that timestamp:
   ```bash
   psql "$NEON_RECOVERY_URL" -c "SELECT count(*) FROM drafts;"
   psql "$NEON_RECOVERY_URL" -c "SELECT max(occurred_at) FROM audit_log;"
   psql "$NEON_RECOVERY_URL" -c "SELECT count(*) FROM companies;"
   ```
   The `audit_log` max should match the recovery timestamp within seconds. The `companies` count should match the pre-incident expected value — if it's lower, you over-rewound; pick a later timestamp and re-branch.
5. **Cut over.** Update `DATABASE_URL` in every consumer:
   - Vercel: `vercel env rm DATABASE_URL production && vercel env add DATABASE_URL production` (paste the recovery connection string), then redeploy.
   - Each Python service deployment: update the platform's secret store (Railway / Fly / Kubernetes Secret), restart the service.
   - Approval-ui: redeploy after the env var update.
6. **Roll forward.** Any writes between the recovery timestamp and the cut-over moment need manual reconciliation. Use `audit_log` on the **production** branch (not the recovery branch — the production branch still holds the post-recovery writes) to identify what got written:
   ```sql
   SELECT actor_kind, actor_id, action, target_kind, target_id, occurred_at
   FROM audit_log
   WHERE occurred_at > '<recovery_timestamp>'
   ORDER BY occurred_at;
   ```
   Each row is a candidate for replay. For revenue-bearing rows (`approvals`, `meter_events`), replay by walking the audit row's `details_json` and re-running the originating action via the API. For `post_metrics`, the metric snapshot can be re-ingested from the platform poller's source-of-truth.
7. **Promote.** Once the recovery branch is stable and traffic has shifted, in the Neon dashboard: Branches → recovery branch → "Promote to primary." Archive the old primary (don't delete — it holds the forensic record of the corruption).

## Smoke tests post-restore

Run all of these. Fail to verify any one of them and you have not completed the restore.

1. **Liveness.** `curl https://<approval-ui-host>/api/health` returns `200` with `{"status":"ok"}`.
2. **Service mesh.** `curl https://<approval-ui-host>/api/health/services` returns `200` with `overall: "healthy"` and every service's individual status `healthy`.
3. **Authenticated read.** Log in via WorkOS, land on Mission Control, confirm the workspace's drafts + approvals tiles populate. The page should render without console errors.
4. **Authenticated write.** From Mission Control → a `awaiting_approval` draft → click Approve. Verify the draft transitions and the action lands in `audit_log`.
5. **RLS isolation.** Run the cross-tenant integration test against the recovered database:
   ```bash
   cd /path/to/core
   DATABASE_URL="$NEON_RECOVERY_URL" bash tests/integration/run-rls-test.sh
   ```
   All 6 assertions must pass. Any failure means the recovery branch's RLS state is incomplete and you must investigate before promoting.
6. **Audit-log baseline.** Run:
   ```sql
   SELECT count(*) FROM audit_log WHERE occurred_at > NOW() - INTERVAL '1 hour';
   ```
   The result should be in the same order of magnitude as a pre-incident hour. Zero rows means audit writes are not landing — investigate before declaring the restore complete.

## Comms

Status-page templates that match `incident-response.md` § During the incident.

```
[Investigating]
We are investigating reports of database errors affecting workspace data.
Posted at <UTC time>.
```

```
[Identified]
We have identified the issue and are restoring the database from a recent backup.
Affected workspace data may not reflect changes from the last <N> minutes; we are reconciling these as we restore.
```

```
[Resolved]
The database has been restored and service is fully operational.
A small number of changes from the affected window required manual reconciliation; we have applied these and notified the affected workspaces directly.
A postmortem will be published within 5 business days.
```

If the restore window resulted in a customer-visible data gap (e.g. a draft that was approved but the approval did not survive), the customer-facing notification follows the procedure in [runbook-data-corruption.md](./runbook-data-corruption.md) § Notification — the threshold is "did a paying customer's record change without their consent."
