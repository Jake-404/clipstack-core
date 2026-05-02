# Cross-tenant data leak

The worst-case event short of a full breach. A workspace's data was visible to an unauthorised party — another tenant, an unauthenticated client, or an internal user without the right scope. Time matters more here than in any other DR scenario: regulatory clocks (GDPR 72-hour) start at the moment of detection, and customer trust degrades by the hour.

This runbook is intentionally short. The structure is **detect → contain → investigate → notify**, and the containment step happens within an hour of detection regardless of investigation completeness.

## Detection

Any of the following triggers this runbook:

- **Customer report.** A user reports seeing data they should not have access to. Treat as credible until proven otherwise; never argue with a customer about whether a leak occurred.
- **Audit log review.** Routine review of `audit_log` finds reads or actions outside the expected tenant boundary — for example a `target_kind=draft` row whose `target_id` resolves to a different `company_id` than the actor's session.
- **Cross-tenant integration test failure.** The test in `tests/integration/cross-tenant-rls.sql` (run on every push by CI) detects a regression in the RLS-policy chain or `app_company_matches()`. A failure here means the next deploy would have leaked; treat as a near-miss and trace why the regression landed.

## Containment (within 1 hour)

Five steps. Run them in order; do not stop at "I think it's contained" — finish the list.

### Step 1 — Disable the impacted route or service

The fastest mitigation is removing the leak vector entirely. If the leak path is known (e.g. a specific approval-ui route), gate it behind a feature flag set to off, redeploy, and confirm the route returns 503. If the leak path is unknown, scope down: take the affected service offline at the load-balancer level rather than guess at the right gating point. Brief downtime is preferable to a continuing leak.

### Step 2 — Snapshot the audit_log for the suspected window

Before any further action that might touch the database, snapshot the audit log so the forensic record is preserved.

```bash
psql "$DATABASE_URL" -c "
  COPY (
    SELECT * FROM audit_log
    WHERE occurred_at BETWEEN '<window_start>' AND '<window_end>'
  ) TO '/tmp/audit_log_leak.csv' WITH CSV HEADER;
"
```

If the leak window is unknown, snapshot the last 7 days. The cost is one large CSV; the value is a complete forensic record. Keep this CSV in a separate, access-controlled location — it contains tenant-bounded data and is not safe to leave on a shared volume.

### Step 3 — Identify affected tenants

Query the snapshot to enumerate the tenants whose data appeared in unauthorised reads:

```sql
SELECT DISTINCT
  l.target_id,
  d.company_id AS owning_tenant,
  l.actor_id,
  l.company_id AS actor_tenant
FROM audit_log l
JOIN drafts d ON d.id::text = l.target_id
WHERE l.occurred_at BETWEEN '<window_start>' AND '<window_end>'
  AND l.target_kind = 'draft'
  AND d.company_id <> l.company_id;
```

The result set is the scope of notification. Treat any non-zero row count as a notifiable event. Repeat the query for every cross-tenant resource — `approvals`, `company_lessons`, `post_metrics`, `audit_log` itself, `meter_events`.

### Step 4 — Rotate `SERVICE_TOKEN`

The shared service-to-service token in `core/.env.example` is the credential that lets Python services call approval-ui without a user session. If the leak vector involved a service-token misuse (a leaked token, a token used outside its expected scope), rotation is mandatory. Even if it didn't, rotation is cheap and removes one class of follow-on risk.

```bash
# Generate a fresh token (32+ random chars).
openssl rand -hex 32

# Update the platform's secret store. On Vercel:
vercel env rm SERVICE_TOKEN production
vercel env add SERVICE_TOKEN production

# Update each Python service's deployment secret.
# Restart approval-ui + every Python service so they pick up the new value.
```

Until every service has restarted with the new token, expect inter-service calls to 401. This is intentional — the rotation invalidates any in-flight calls that might have been carrying a leaked token.

### Step 5 — Rotate `SESSION_COOKIE_SECRET`

The iron-session cookie secret signs every user session. Rotating it forces every session to re-login, which is the cleanest way to invalidate any session that might have been used by an unauthorised party.

```bash
openssl rand -hex 32

# Update SESSION_COOKIE_SECRET in the platform's secret store.
# Redeploy approval-ui so the new secret is in effect.
```

After redeploy, every existing session cookie will fail to verify, every user will be redirected to the WorkOS login flow on their next request, and the leak vector — if it depended on a stolen or reused session — is closed.

## Investigation

With containment done, the investigation begins. The aim is a complete root-cause description before re-enabling the affected route.

### Step 1 — Reproduce in a non-production branch

Branch the database (Neon PITR) at the moment of detection or just before. Stand up a fresh deploy of approval-ui pointing at the branch. Reproduce the leak path against the branch — same input, same observed output. If the leak does not reproduce, your understanding of the trigger is incomplete; do not move on until reproduction is reliable.

### Step 2 — Identify root cause

Categorise the cause. The four common shapes:

- **RLS bypass.** Application code used a service-role connection (BYPASSRLS) where a user-role connection should have been. Look for direct `clipstack_admin` use outside migrations.
- **Missing tenant context.** Application code opened a connection without `SET LOCAL app.current_company_id = ...`. RLS treats null as deny, so this should fail closed; if it returned data, the connection was using `clipstack_admin` (above) or RLS was disabled on the table.
- **Application-level filter wrong.** Application code applied a manual `WHERE company_id = ?` filter instead of relying on RLS, and the manual filter was wrong. Per `clipstack/CLAUDE.md` § Security & code-quality standards, this pattern is forbidden — RLS is the database-level enforcement and application-side filters are advisory at best.
- **RLS policy regression.** A migration changed `app_company_matches()` or the per-table policy in a way that allowed cross-tenant reads. The cross-tenant integration test should have caught this in CI; if it didn't, the test itself is incomplete.

### Step 3 — Patch, ship, and add a regression test

The regression test goes in `tests/integration/` alongside `cross-tenant-rls.sql`. It must fail on the unpatched code and pass on the patched code. Ship the patch, the test, and the postmortem in the same change set so the review captures all three.

Re-enable the affected route only after the patched build has passed CI (including the new regression test) and is live in production.

## Notification

The notification clock starts at the moment of detection, not the moment of containment.

### Internal

- **Engineering channel.** Post the incident summary, severity, and affected-tenant count immediately. Do not wait for investigation completeness.
- **Leadership.** Page leadership on any cross-tenant leak regardless of size. The blast radius is unknown until investigation completes; leadership needs to be in the loop for regulatory and customer-comms decisions.

### External (regulatory)

Per applicable privacy law. The thresholds:

- **GDPR (EU/UK).** 72 hours from awareness to supervisory authority notification when a breach is "likely to result in a risk to the rights and freedoms of natural persons." Cross-tenant leaks of personal data clear this threshold by default.
- **CCPA (California).** Notification is required when "unencrypted and unredacted personal information was, or is reasonably believed to have been, acquired by an unauthorised person." Timing is "in the most expedient time possible and without unreasonable delay."
- **Other jurisdictions.** Brazil (LGPD), Canada (PIPEDA), Australia (Privacy Act), India (DPDP) — each has its own threshold and timing. The legal team owns the matrix; the technical team owns the data scoping that feeds it.

### External (affected customers)

ASAP, with three components in the notification:

1. **Discovery** — what was leaked, when it was discovered, what the scope was.
2. **Containment** — what was done immediately to stop the leak.
3. **Remediation timeline** — what's being done to prevent recurrence and when the affected customer will see those changes in production.

The notification template lives alongside the existing legal documents — [`core/legal/Privacy.md`](../../legal/Privacy.md) § Breach Response (or wherever the breach-response stub lands as the legal pack matures). Adapt per incident — generic templates are starting points, not finished comms.

A customer-version of the postmortem (per `incident-response.md` § What postmortems are NOT) is published to the status page within 10 business days.
