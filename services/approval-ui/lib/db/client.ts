// Drizzle client + tenant-scoped transaction wrapper.
//
// Read services/shared/db/middleware.md before using this. The contract:
// every query against a tenant-scoped table goes through `withTenant(...)`.
// Without it, RLS denies the read because `app.current_company_id` is unset.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

let _client: ReturnType<typeof postgres> | null = null;

function getClient() {
  if (_client) return _client;
  const url = process.env.DATABASE_URL;
  if (!url) {
    // Fail loudly — better than silently falling back to a different DB.
    // The API routes that need DB access guard against this in their handlers.
    throw new Error(
      "DATABASE_URL is not set. The API cannot serve tenant-scoped routes without it.",
    );
  }
  _client = postgres(url, {
    // postgres-js settings
    max: Number(process.env.DATABASE_POOL_MAX ?? "20"),
    idle_timeout: 30,
    // RLS-correctness depends on session settings — disable prepared statement
    // caching that could outlast a transaction.
    prepare: false,
  });
  return _client;
}

/**
 * Drizzle instance bound to the postgres-js pool. Use `withTenant` for
 * anything tenant-scoped; use `db` directly only for tenant-independent
 * reads (which don't exist in core/ today — every table is tenant-scoped).
 */
export const db = drizzle(getClient(), { schema });

export type DB = typeof db;

/**
 * Run `fn` inside a transaction with `app.current_company_id` set to
 * `companyId`. RLS policies in 0002_enable_rls.sql will filter every
 * tenant-scoped query against this value.
 *
 * Rules:
 *   1. The setting uses `set_config(name, value, true)` — `true` = LOCAL =
 *      transaction-scoped. This prevents pooled-connection leakage between
 *      requests.
 *   2. Membership verification happens BEFORE this call — never inside it
 *      (the membership row may itself be RLS-filtered).
 *   3. Errors roll back the transaction; the setting clears either way.
 *
 * @param companyId       The active workspace UUID (validated upstream).
 * @param fn              Transaction-bound work.
 * @param options.includeClientChildren
 *                        Set `app.include_client_children=true` so an agency
 *                        can read its child clients' rows in this txn.
 */
export async function withTenant<T>(
  companyId: string,
  fn: (tx: Parameters<Parameters<DB["transaction"]>[0]>[0]) => Promise<T>,
  options: { includeClientChildren?: boolean } = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    // Use parameterised set_config — it's a regular SQL function call,
    // safe against injection. Drizzle's `tx.execute` returns a postgres-js
    // result; we don't need the return value.
    await tx.execute(
      sqlSetConfig("app.current_company_id", companyId),
    );
    if (options.includeClientChildren) {
      await tx.execute(sqlSetConfig("app.include_client_children", "true"));
    }
    return fn(tx);
  });
}

// Helper that constructs the SET LOCAL via a parameterised set_config call.
// We avoid template-literal concatenation entirely; postgres-js binds the
// arguments through the standard prepared-statement path.
function sqlSetConfig(name: string, value: string) {
  // drizzle-orm exposes `sql` for raw queries; postgres-js binds params.
  // Import here to keep the top of the file clean.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { sql } = require("drizzle-orm") as typeof import("drizzle-orm");
  // The `true` third arg = LOCAL.
  return sql`select set_config(${name}, ${value}, true)`;
}
