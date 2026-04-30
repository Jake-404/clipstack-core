// Drizzle client + tenant-scoped transaction wrapper.
//
// Read services/shared/db/middleware.md before using this. The contract:
// every query against a tenant-scoped table goes through `withTenant(...)`.
// Without it, RLS denies the read because `app.current_company_id` is unset.
//
// The connection is constructed lazily on first request — important for
// Next.js production builds where page-data collection invokes route modules
// at build time when DATABASE_URL is typically unset. Module load is
// side-effect-free; the first call to `getDb()` creates the pool.

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "./schema";

type DrizzleDB = PostgresJsDatabase<typeof schema>;

let _client: ReturnType<typeof postgres> | null = null;
let _db: DrizzleDB | null = null;

function getClient() {
  if (_client) return _client;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The API cannot serve tenant-scoped routes without it.",
    );
  }
  _client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? "20"),
    idle_timeout: 30,
    // RLS-correctness depends on session settings — disable prepared statement
    // caching that could outlast a transaction.
    prepare: false,
  });
  return _client;
}

/**
 * Lazy Drizzle instance accessor. Use `withTenant` for tenant-scoped queries;
 * call `getDb()` directly only for tenant-independent reads (rare — every
 * table in core/ today is tenant-scoped).
 */
export function getDb(): DrizzleDB {
  if (_db) return _db;
  _db = drizzle(getClient(), { schema });
  return _db;
}

export type DB = DrizzleDB;

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
  return getDb().transaction(async (tx) => {
    await tx.execute(sqlSetConfig("app.current_company_id", companyId));
    if (options.includeClientChildren) {
      await tx.execute(sqlSetConfig("app.include_client_children", "true"));
    }
    return fn(tx);
  });
}

// drizzle-orm's sql tag parameterises both args through postgres-js's
// standard prepared-statement path — never use template-literal concat
// for values that touch user input. The third arg `true` = LOCAL = txn-scoped.
function sqlSetConfig(name: string, value: string) {
  return sql`select set_config(${name}, ${value}, true)`;
}
