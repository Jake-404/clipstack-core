# Connection middleware

How to set `app.current_company_id` on every database connection so RLS works. **Read this before any service that touches the tenant database lands in core/.**

## The contract

Per [README.md](./README.md), tenant isolation is enforced by Postgres Row-Level-Security policies that filter on `app.current_company_id`. Setting that variable is the request lifecycle's responsibility:

1. Authenticate the request → resolve `user_id`.
2. Resolve the *active workspace* — which `company_id` the user is acting as. Sources, in priority order:
   1. URL path param (`/c/:companyId/...`)
   2. Header (`X-Clipstack-Company-Id`)
   3. Default workspace from session
3. Verify a non-revoked membership exists: `(user_id, company_id, revoked_at IS NULL)`. If not, return 403 — never query first.
4. Begin a transaction. Set `app.current_company_id` with `SET LOCAL`. The `LOCAL` is critical — it scopes the setting to the current transaction so a pooled connection cannot leak the previous request's setting to the next request.
5. Run application queries inside the transaction.
6. Commit or rollback. The setting clears on transaction end.

If step 4 is skipped, every query against a tenant-scoped table returns zero rows. RLS fails closed, not open.

## TypeScript example (with `pg`)

```ts
import { Pool, PoolClient } from "pg";

const pool = new Pool({
  // connectionString points at clipstack_app role (NOBYPASSRLS).
  // Never expose clipstack_admin (BYPASSRLS) to application code.
  connectionString: process.env.DATABASE_URL,
  max: 20,
});

export async function withTenant<T>(
  companyId: string,
  fn: (client: PoolClient) => Promise<T>,
  opts: { includeClientChildren?: boolean } = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Use parameterized SET LOCAL — set_config takes a parameterized value.
    await client.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
    if (opts.includeClientChildren) {
      await client.query("SELECT set_config('app.include_client_children', 'true', true)");
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Express middleware example
export function tenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const companyId = req.params.companyId
    ?? req.header("X-Clipstack-Company-Id")
    ?? req.session.defaultCompanyId;

  if (!companyId) return res.status(400).json({ error: "no active workspace" });
  if (!isValidUUID(companyId)) return res.status(400).json({ error: "bad workspace id" });

  // Verify membership BEFORE issuing any query.
  // (Use a separate connection without RLS bypass; clipstack_app's RLS
  // already lets users see their own memberships when the
  // user-self-only policy ships in A.2. For now, do this check via a
  // service helper that uses clipstack_admin scoped to this single read.)
  verifyMembership(req.user.id, companyId)
    .then((ok) => {
      if (!ok) return res.status(403).json({ error: "no membership" });
      req.activeCompanyId = companyId;
      next();
    })
    .catch(next);
}

// Route handler
app.get("/c/:companyId/drafts",
  tenantMiddleware,
  async (req, res) => {
    const drafts = await withTenant(req.activeCompanyId, async (client) => {
      // No "WHERE company_id = ?" here — RLS handles it.
      const r = await client.query("SELECT * FROM drafts WHERE status = 'awaiting_approval'");
      return r.rows;
    });
    res.json(drafts);
  },
);
```

## Python example (with `psycopg`)

```python
from contextlib import asynccontextmanager
from typing import AsyncIterator

import psycopg
from psycopg import AsyncConnection, sql
from psycopg_pool import AsyncConnectionPool

pool = AsyncConnectionPool(
    conninfo=os.environ["DATABASE_URL"],
    max_size=20,
    open=False,
)


@asynccontextmanager
async def with_tenant(
    company_id: str,
    *,
    include_client_children: bool = False,
) -> AsyncIterator[AsyncConnection]:
    """Yield a connection with app.current_company_id set for the lifetime of a transaction."""
    async with pool.connection() as conn:
        async with conn.transaction():
            # set_config(name, value, is_local=true) — scoped to the txn
            await conn.execute(
                "SELECT set_config('app.current_company_id', %s, true)",
                (company_id,),
            )
            if include_client_children:
                await conn.execute(
                    "SELECT set_config('app.include_client_children', 'true', true)"
                )
            yield conn
        # transaction commits/rolls back; settings clear automatically.


# FastAPI dependency
from fastapi import Depends, HTTPException, Request


async def active_workspace(request: Request) -> str:
    company_id = (
        request.path_params.get("company_id")
        or request.headers.get("X-Clipstack-Company-Id")
        or request.state.session.get("default_company_id")
    )
    if not company_id:
        raise HTTPException(400, "no active workspace")
    # Membership check via separate admin-role read; replace with
    # RLS-respecting check once user-self policy ships in A.2.
    if not await verify_membership(request.state.user_id, company_id):
        raise HTTPException(403, "no membership")
    return company_id


@app.get("/c/{company_id}/drafts")
async def list_drafts(company_id: str = Depends(active_workspace)):
    async with with_tenant(company_id) as conn:
        rows = await conn.execute(
            "SELECT * FROM drafts WHERE status = 'awaiting_approval'"
        )
        return [dict(row) async for row in rows]
```

## Common mistakes

❌ **Using `SET` instead of `SET LOCAL`.** `SET` lasts the session; if the connection returns to the pool, it carries the setting to the next checkout. Cross-tenant leak.

❌ **Using `clipstack_admin` for application queries.** That role has `BYPASSRLS` — it sees everything. Reserve it for migrations and explicitly authorised platform-admin tooling, with audit-log rows on every cross-tenant action.

❌ **Putting `WHERE company_id = ?` in application queries.** RLS already does this. Adding the clause makes the policy redundant *and* obscures what's enforcing isolation. If RLS is later removed by mistake, the application clauses look like they protect the data, but a missed query leaks. Trust the policy; remove the clause.

❌ **Verifying membership inside the same transaction that runs the query.** RLS will hide the membership row from `clipstack_app` if the membership policy is strict. Verify membership using a dedicated service helper that knows how to read it (either via `clipstack_admin` for now, or via the user-self policy in A.2).

❌ **Forgetting the include_client_children flag for agency reads.** An agency owner browsing a child client's calendar needs `include_client_children=true` *or* a separate `with_tenant(child_company_id)` call. The default is strict — the active company sees only itself.

## Verification (DoD A.1.1)

A workspace-A user who tries to read workspace-B's data is denied at the row level:

```sql
-- As workspace-B owner, create test data:
SELECT set_config('app.current_company_id', '<workspace-B-id>', false);
INSERT INTO company_lessons (company_id, kind, scope, rationale)
  VALUES ('<workspace-B-id>', 'human_denied', 'forever',
          'sufficient rationale that meets the 20-char minimum hi');

-- As workspace-A user (different company_id):
SELECT set_config('app.current_company_id', '<workspace-A-id>', false);
SELECT count(*) FROM company_lessons;  -- returns 0, not 1.
```

This test lands in CI in A.2 against an ephemeral Postgres.
