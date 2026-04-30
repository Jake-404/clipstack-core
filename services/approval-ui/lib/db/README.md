# lib/db

Typed database access for the API routes. Drizzle ORM over the SQL migrations in [`services/shared/db/migrations/`](../../../shared/db/migrations/).

## Layout

```
lib/db/
├── schema/
│   ├── enums.ts           # pgEnum() for the 14 enums
│   ├── companies.ts       drafts.ts
│   ├── users.ts           approvals.ts
│   ├── memberships.ts     audit.ts
│   ├── roles.ts           metering.ts
│   ├── permissions.ts
│   ├── agents.ts
│   ├── lessons.ts
│   └── index.ts           # re-export all
├── client.ts              # postgres-js connection + Drizzle wrapper + withTenant()
└── README.md
```

## Schema-mirror discipline

The same shape is expressed four ways:

| Layer | Where | Used by |
|---|---|---|
| SQL DDL + RLS policies | `services/shared/db/migrations/*.sql` | the database itself (canonical) |
| Drizzle TypeScript schema | `services/approval-ui/lib/db/schema/*.ts` (this dir) | API routes for typed queries |
| zod runtime schemas | `services/shared/schemas/*.ts` | API request/response validation |
| pydantic mirrors | `services/shared/schemas/*.py` | agent-crewai + agent-langgraph services |

When you change one, change them all in the same PR. CI structural diff (planned A.3) blocks merge if they drift.

The SQL is canonical because it owns the parts the others don't (RLS policies, triggers, functions). Drizzle is ergonomic for typed query construction. zod is what HTTP boundaries validate against. pydantic is what Python services pass around.

## Tenant context (read this before querying)

Every query against a tenant-scoped table runs through `withTenant(companyId, fn)`. That helper:

1. Acquires a connection from the pool.
2. Begins a transaction.
3. Calls `set_config('app.current_company_id', companyId, true)` (the `true` flag = `LOCAL`, scoped to the transaction).
4. Runs your callback with a transaction-bound Drizzle instance.
5. Commits on resolve, rolls back on throw.
6. Releases the connection — the next checkout starts with a clean session.

Without `withTenant`, every query against a tenant-scoped table returns zero rows. Postgres RLS denies the read because `app.current_company_id` is unset. **This is by design.** See [services/shared/db/middleware.md](../../../shared/db/middleware.md) for the full contract.

## Usage

```ts
import { withTenant } from "@/lib/db/client";
import { drafts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const result = await withTenant(activeCompanyId, async (tx) => {
  return tx.select().from(drafts).where(eq(drafts.status, "awaiting_approval"));
  // No "and(eq(drafts.companyId, activeCompanyId))" — RLS handles it.
});
```

## Database role

The connection string at `DATABASE_URL` should resolve to a Postgres role with `NOBYPASSRLS` (the `clipstack_app` role created by `0002_enable_rls.sql`). Never expose the `clipstack_admin` role (which has `BYPASSRLS`) to application code — reserve it for migrations and explicitly authorised platform-admin tooling.

## A.2 status

- ✅ Drizzle schema definitions for the 11 tables + 14 enums
- ✅ `withTenant()` helper using `postgres-js` driver
- ✅ Type exports inferred from schema (`InferSelectModel`, `InferInsertModel`)
- ⏳ `drizzle-kit generate` against the SQL migrations as a structural-diff check (CI step lands later in A.2)
- ⏳ Cross-tenant access integration test (DoD A.1.1) — ephemeral Postgres in CI runs `withTenant(workspaceA, …)` and asserts a `SELECT FROM drafts WHERE company_id = workspaceB.id` returns zero
