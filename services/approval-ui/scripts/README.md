# scripts/seed-demo.ts

A one-shot seed script that builds a synthetic "Demo Workspace" tenant so every Mission Control surface, the inbox, the activity log, and the performance page render against real data instead of empty-state copy.

## What it creates

A single tenant rooted at the stable company UUID `00000000-0000-0000-0000-000000000001`, populated with:

| Table | Rows | Notes |
|---|---|---|
| `companies` | 1 | "Demo Workspace", `type=in_house`, `slug` + `website` stashed on `context_json`. |
| `users` | 1 | `demo@clipstack.app`, `workos_user_id=demo_user_v1` so dev auto-provision finds the same row. |
| `memberships` | 1 | The demo user as `owner` of the workspace. |
| `agents` | 6 | Mira (orchestrator, working), Atlas (strategist, idle), Saoirse (long_form_writer, idle), Kai (social_adapter, blocked), Juno (brand_qa, idle), Nova (claim_verifier, idle). |
| `drafts` | 12 | 4 `awaiting_approval` (mixed channels + predicted percentile spread + ages 12m/47m/92m/180m), 2 `in_review`, 1 `drafting`, 4 `published`, 1 `denied`. |
| `approvals` | 7 | One row per draft that needs human action — pending for the 4 awaiting + 2 in-review, denied with a populated `deny_rationale` + `deny_scope` for the denied draft. |
| `post_metrics` | 40 | ~10 snapshots over the last 7 days for each of the 4 published drafts. Realistic ratios: impressions 5k-50k, CTR 1-5%, reactions ~10% of clicks, percentiles 30-90. |
| `company_lessons` | 8 | Mix of `forever` / `this_topic` / `this_client` scopes; rationales are real editorial guidance ("Avoid 'simply' as a hedge", "Always lead with the user's problem", etc.). Spread across the last 14 days. |
| `audit_log` | 30 | Mixed `kind` (approval.approved, approval.denied, lessons.recalled, post_metrics.written, experiments.listed, anomalies.listed, metering.written) and `actor_kind` (user, agent, system). |
| `meter_events` | 20 | Spread across the current month, `total_cost_usd` in $0.01–$2.50, kinds publish / metered_asset_generation / voice_score_query. |

Skipped on purpose:

- **`content_embeddings`** — the column is `vector(384)`. Seeding random floats would surface noise in `recall_lessons` and `retrieve_high_performers`. Wire this in once the embedder service has a `/embed` endpoint.
- **`draft_revisions` + `content_claims`** — drift-checking against synthetic claims muddies the experiments dashboard; not needed for the empty-state fix.
- **bandit-orchestrator state** — the bandit persists at `BANDIT_DATA_DIR/{id}.json` inside its own container. Out of scope for the approval-ui seeder; run that service's own bootstrapper if you need it.

## Run it

From the `services/approval-ui/` directory:

```bash
pnpm exec tsx scripts/seed-demo.ts
```

## Required env

| Var | Why |
|---|---|
| `DATABASE_URL` | The Postgres connection string the Drizzle client reads in `lib/db/client.ts`. The script `process.exit(1)`s with a clear message if it's unset. |

The seed script connects directly via `getDb()` (not `withTenant`) — it's inserting *as* the seed and would otherwise be filtered by the RLS policies in `0002_enable_rls.sql`.

## Idempotency

Re-running the script produces the same final state. The strategy:

1. At the top, every demo-tenant row is wiped (`DELETE FROM ... WHERE company_id = '00000000-0000-0000-0000-000000000001'`).
2. The singleton rows (companies, users, memberships) use stable hardcoded UUIDs and `onConflictDoNothing()`.
3. The variable rows (agents, drafts, approvals, post_metrics, lessons, audit_log, meter_events) use deterministic counter-derived UUIDs so a second run lands on the same primary keys instead of piling up duplicates.

You can run it after every schema migration without leaking row counts.

## Cleanup

To drop the demo tenant entirely:

```sql
DELETE FROM companies WHERE id = '00000000-0000-0000-0000-000000000001';
```

`ON DELETE CASCADE` on every child FK does the rest. The `users` row at `00000000-0000-0000-0000-000000000002` survives because it's workspace-independent — drop it explicitly if you want a clean slate:

```sql
DELETE FROM users WHERE id = '00000000-0000-0000-0000-000000000002';
```

## After it runs

Login at `http://localhost:3000/login` as `demo@clipstack.app`. The dev auto-provision flow (sprint-close S.3) finds the seeded user by `workos_user_id` and drops you into the demo tenant.
