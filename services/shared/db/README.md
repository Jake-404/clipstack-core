# shared/db

Tenant data model + multi-tenant Row-Level-Security policies + RBAC role/permission contract.

## Structure

```
db/
├── migrations/
│   ├── 0001_init.sql          # tenant tables (declarative DDL)
│   ├── 0002_enable_rls.sql    # row-level-security policies (the isolation gate)
│   └── 0003_rbac_seed.sql     # default roles + permission matrix
├── middleware.md              # how to set app.current_company_id per connection
└── README.md
```

## Core principle (locked Phase A.1)

**Tenant isolation is enforced at the database connection level, not the application layer.**

Every tenant-scoped table has Postgres Row-Level-Security enabled. Every query against a tenant-scoped table is filtered by:

```sql
company_id = current_setting('app.current_company_id')::uuid
```

Setting `app.current_company_id` is the responsibility of the request-scoped database connection middleware. If it's not set, RLS denies the read.

This means:
1. **No application-layer "WHERE company_id = ?" clauses exist anywhere** — the policy enforces it.
2. A bug in the application that forgets the filter cannot leak data — the database stops the query.
3. A forgotten index cannot become a cross-tenant scan — the policy turns it into an empty result.
4. The audit story to a procurement reviewer is concrete: "tenant isolation is structural, in the database itself, not policy." See [legal/IP-Ownership.md](../../../legal/IP-Ownership.md) §2.

## Tables (Phase A.1)

| Table | Tenant-scoped? | Notes |
|---|---|---|
| `companies` | self (id is the tenant root) | RLS via id, not company_id |
| `users` | no | global identity; SSO via `workos_user_id` |
| `memberships` | by `company_id` | user × company × role; nullable `client_id` for client-scoped grants |
| `agents` | by `company_id` | per-tenant agent personas |
| `company_lessons` | by `company_id` | USP 5; `client_id` nullable |
| `drafts` | by `company_id` | every artifact |
| `approvals` | by `company_id` | human-approval queue |
| `audit_log` | by `company_id` | append-only |
| `meter_events` | by `company_id` | USP 10 metering |
| `roles` | by `company_id` | workspace-scoped role definitions (defaults seed-loaded) |
| `permissions` | by `company_id` | role × resource × action × allow/deny |

## How to apply

Order matters — `0001` then `0002` then `0003`. Each is idempotent (uses `CREATE TABLE IF NOT EXISTS`, `CREATE POLICY IF NOT EXISTS` patterns).

```bash
psql -U clipstack -d clipstack -f migrations/0001_init.sql
psql -U clipstack -d clipstack -f migrations/0002_enable_rls.sql
psql -U clipstack -d clipstack -f migrations/0003_rbac_seed.sql
```

In production, a migration runner (Drizzle, Prisma, sqitch, plain `psql`) applies them sequentially. The contract is the SQL, not the runner — adopt whatever ORM your stack uses.

## Connection middleware

Setting `app.current_company_id` is the request lifecycle's responsibility. Pattern documented in [middleware.md](./middleware.md) with TypeScript (`pg`) and Python (`psycopg`) examples. The shape:

1. Authenticate the request, resolve the user.
2. Resolve the *active workspace* (which `company` the user is acting as — comes from URL param, header, or session).
3. Verify the user has a non-revoked membership in that company. If not, 403.
4. On the database connection bound to this request: `SET LOCAL app.current_company_id = '<uuid>'`. `LOCAL` scopes it to the current transaction; the next request gets a fresh setting from a clean connection.
5. Run the query.

The transaction-bound `SET LOCAL` is critical — without it, a connection in a pool could carry the previous request's `company_id` to the next request. With it, every transaction starts with a clean session.

## RBAC

Roles + permissions live in tenant-scoped tables. Defaults seed in `0003_rbac_seed.sql`:

| Role | Default permissions |
|---|---|
| `owner` | All actions on all resources within the workspace |
| `admin` | All actions except billing, member management, and org delete |
| `member` | Create/edit drafts, approve content (per per-channel toggle), read everything |
| `client_guest` | Read-only access to one client's drafts and approvals; can comment but not edit |

Workspaces can clone defaults and customise. Permission shape:

```
{ role_id, resource: 'draft' | 'approval' | 'agent' | ..., action: 'read'|'create'|'update'|'delete'|'approve'|'deny', allow: bool }
```

The permission check is application-layer — the database enforces tenant isolation; RBAC enforces *what within the tenant*. RLS is the floor; RBAC is the policy.

## What ships in A.1

- ✅ SQL migrations (declarative, runner-agnostic)
- ✅ Connection middleware doc with TS + Py examples
- ✅ Default-role seed
- ✅ Permission matrix shape

## What lands in A.2

- Drizzle ORM schema files (1:1 with these migrations) so the API service can use typed queries
- Pydantic mirrors for the agent services
- Migration-runner integration in CI (apply migrations against an ephemeral Postgres, run the test suite)
- Cross-tenant access tests (DoD A.1.1: workspace A user attempting to read workspace B's data denied at the row level)

## What lands in A.3+

- WorkOS SSO ↔ `users.workos_user_id` integration
- Membership-scoped client-guest invitations (currently UI-less)
- Per-resource permission inheritance (draft inherits from its parent campaign, etc.)
