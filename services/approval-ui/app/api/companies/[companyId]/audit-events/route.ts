// POST /api/companies/:companyId/audit-events
// Generic audit-log ingest. The bandit-orchestrator (and other Python
// services that don't talk to Postgres directly) post structured events
// here so Mission Control's `/activity` page can surface them.
//
// `kind` is intentionally unrestricted text at this boundary — the
// audit_log table column is text (not enum), and new producers ship new
// kinds without an SQL migration. The `/activity` page knows how to
// render `bandit.arm_pruned`, `metering.written`, etc. by namespace.
//
// Service-token auth (the bandit-orchestrator path) AND user-session auth
// (manual entries by a workspace owner) are both allowed.

import { type NextRequest } from "next/server";
import { z } from "zod";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { badRequest, validationFailed } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema/audit";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// `kind` matches the audit_log.kind text column. We don't enum-validate
// here because new producers (bandit-orchestrator's `bandit.arm_pruned`
// is the first) ship kinds that aren't yet in any TS enum — the boundary
// is `<resource>.<verb>` shape and length only.
const AuditEventBodySchema = z.object({
  kind: z.string().min(1).max(120),
  actorKind: z.enum(["user", "agent", "system"]),
  actorId: z.string().max(64).nullable(),
  detailsJson: z.record(z.string(), z.unknown()).optional(),
  // ISO-8601; defaults to server `now()` when absent. Caller-supplied
  // values are accepted but cannot be > 5 minutes in the future
  // (clock-skew tol) — same defense as meter-events.
  occurredAt: z.string().datetime().optional(),
  clientId: z.string().uuid().nullable().optional(),
});

interface RouteContext {
  params: Promise<{ companyId: string }>;
}

export const POST = withApi(async (req: NextRequest, ctx: RouteContext) => {
  const ctxAuth = await resolveServiceOrSession(req.headers);
  const { companyId } = await ctx.params;

  if (!isUuid(companyId)) badRequest("invalid companyId");
  if (ctxAuth.activeCompanyId !== companyId) {
    badRequest("active workspace does not match URL param");
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    badRequest("body must be valid JSON");
  }

  const parsed = AuditEventBodySchema.safeParse(raw);
  if (!parsed.success) {
    validationFailed("invalid audit-event payload", { issues: parsed.error.issues });
  }

  const body = parsed.data;

  if (body.occurredAt) {
    const at = Date.parse(body.occurredAt);
    if (!Number.isFinite(at) || at > Date.now() + 5 * 60 * 1000) {
      badRequest("occurredAt must not be > 5 minutes in the future");
    }
  }

  const result = await withTenant(companyId, async (tx) => {
    // Single insert — deliberately no `auditAccess()` META row about the
    // audit-write itself (would recurse into infinite META-of-META rows).
    const [inserted] = await tx
      .insert(auditLog)
      .values({
        companyId,
        clientId: body.clientId ?? null,
        kind: body.kind,
        actorKind: body.actorKind,
        actorId: body.actorId,
        detailsJson: body.detailsJson ?? {},
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
      })
      .returning({ id: auditLog.id });

    return { id: inserted.id };
  });

  return ok(result);
});
