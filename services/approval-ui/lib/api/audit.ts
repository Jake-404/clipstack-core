// Audit-log writer. Every cross-tenant data access — by a user OR a service
// token — should land an `audit_log` row inside the same transaction as the
// read/write it audits.
//
// Why inside the transaction: if the audit write succeeds but the business
// write rolls back, you've recorded an action that didn't happen. Worse, if
// the business write succeeds but the audit write fails outside the txn,
// you've taken a privileged action with no record. Both directions matter;
// one transaction avoids both.

import type { Tx } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema/audit";

import type { ServiceContext, SessionContext } from "./auth";

interface AuditAccessArgs {
  /** Transaction-bound client from `withTenant(...)`. */
  tx: Tx;
  /** Either an authenticated user session or an authenticated service. */
  ctx: SessionContext | ServiceContext;
  /** Tenant scope. RLS enforces this matches the txn's app.current_company_id. */
  companyId: string;
  clientId?: string | null;
  /** Event kind — namespace it: `<resource>.<verb>` e.g. `drafts.read.high_performers`. */
  kind: string;
  /** Optional structured details. The DB column is JSONB so any shape works. */
  details?: Record<string, unknown>;
}

function isServiceContext(
  ctx: SessionContext | ServiceContext,
): ctx is ServiceContext {
  return "kind" in ctx && ctx.kind === "service";
}

/**
 * Insert an `audit_log` row for the current authenticated context.
 * Throws on insert failure — call sites can decide whether to swallow or
 * propagate. The high-performers route propagates, which rolls back the
 * surrounding transaction (read + audit are atomic by design).
 */
export async function auditAccess(args: AuditAccessArgs): Promise<void> {
  // Narrow ctx in each branch so TS picks the right field per discriminator.
  const ctx = args.ctx;
  const actorKind = isServiceContext(ctx) ? "system" : "user";
  const actorId = isServiceContext(ctx) ? ctx.service : ctx.userId;

  await args.tx.insert(auditLog).values({
    companyId: args.companyId,
    clientId: args.clientId ?? null,
    kind: args.kind,
    actorKind,
    actorId,
    detailsJson: args.details ?? {},
  });
}
