// POST /api/approvals/:id/approve
//
// Counterpart to /deny. Mirrors its shape + transaction model:
//   1. Validate the approval id (uuid).
//   2. Find the approval; bail if it doesn't exist (RLS hides cross-
//      tenant rows so the same NotFound covers both cases).
//   3. Bail if it's already decided (idempotency: a double-click
//      shouldn't double-fire side effects).
//   4. Update status='approved' + decided_by_user_id + decided_at.
//   5. Append an audit_log row (kind='approval.approved').
//
// Asymmetric vs. deny: there's no rationale or scope on approve. Doc 5
// USP 5 captures lessons specifically from negative signals (denies,
// revisions). An approve is the default/expected outcome and doesn't
// surface as a learning event. If we ever want approve-time notes,
// that's a schema-bearing follow-up (no `approve_note` column today).
//
// Auth is session-only (resolveSession, not resolveServiceOrSession) —
// agents shouldn't be able to approve their own work; only humans
// can flip the gate. Service tokens are explicitly NOT honored here.

import { type NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { resolveSession } from "@/lib/api/auth";
import { badRequest, notFound } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import { approvals } from "@/lib/db/schema/approvals";
import { auditLog } from "@/lib/db/schema/audit";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withApi(async (_req: NextRequest, ctx: RouteContext) => {
  const session = await resolveSession();
  const { id: approvalId } = await ctx.params;

  if (!isUuid(approvalId)) {
    badRequest("invalid approval id");
  }

  // No body parsing — approve takes no fields. We don't even read
  // the body, so a misshapen JSON payload still succeeds (forgiving
  // for clients that pass `{}` defensively).

  const result = await withTenant(session.activeCompanyId, async (tx) => {
    const [existing] = await tx
      .select({
        id: approvals.id,
        status: approvals.status,
        kind: approvals.kind,
        clientId: approvals.clientId,
      })
      .from(approvals)
      .where(eq(approvals.id, approvalId))
      .limit(1);

    if (!existing) {
      notFound("approval not found");
    }
    if (existing.status !== "pending") {
      // Idempotent: same error shape as deny so callers can branch
      // on the message OR just refresh the surface and re-read state.
      badRequest(`approval is already ${existing.status}`);
    }

    const [updated] = await tx
      .update(approvals)
      .set({
        status: "approved",
        decidedByUserId: session.userId,
        decidedAt: new Date(),
      })
      .where(eq(approvals.id, approvalId))
      .returning();

    await tx.insert(auditLog).values({
      companyId: session.activeCompanyId,
      clientId: existing.clientId,
      kind: "approval.approved",
      actorKind: "user",
      actorId: session.userId,
      detailsJson: {
        approvalId,
        approvalKind: existing.kind,
      },
    });

    return { approval: updated };
  });

  return ok(result);
});
