// POST /api/approvals/:id/deny — USP 5 enforcement.
//
// Per Doc 5 + plan §"Open Qs" #3: rationale ≥20 chars + scope selector are
// REQUIRED on every deny. The deny:
//   1. Validates the request body (zod with min(20)).
//   2. Updates the approval row: status='denied', deny_rationale, deny_scope,
//      decided_by_user_id, decided_at.
//   3. Inserts a company_lessons row with the rationale + scope so the next
//      agent that touches a related topic sees it in `recall_lessons`.
//   4. Writes an audit_log row.
//
// All inside a single tenant-scoped transaction so partial state can't leak
// (the approval-update + lesson-insert + audit-write either all land or none).

import { type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { resolveSession } from "@/lib/api/auth";
import { badRequest, notFound, validationFailed } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import { approvals } from "@/lib/db/schema/approvals";
import { auditLog } from "@/lib/db/schema/audit";
import { companyLessons } from "@/lib/db/schema/lessons";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── Request schema ──────────────────────────────────────────────────────
//
// USP 5 hard rules:
//   - rationale: 20–2000 chars (matches `approvals.deny_rationale` CHECK)
//   - scope:     'forever' | 'this_topic' | 'this_client'
//
// The schema duplicates the DB CHECK so we fail fast at the HTTP boundary
// instead of waiting for Postgres to reject the INSERT.
const DenyBodySchema = z.object({
  rationale: z
    .string()
    .min(20, "rationale must be at least 20 characters")
    .max(2000, "rationale must be at most 2000 characters"),
  scope: z.enum(["forever", "this_topic", "this_client"], {
    errorMap: () => ({ message: "scope must be forever, this_topic, or this_client" }),
  }),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withApi(async (req: NextRequest, ctx: RouteContext) => {
  const session = await resolveSession();
  const { id: approvalId } = await ctx.params;

  if (!isUuid(approvalId)) {
    badRequest("invalid approval id");
  }

  // Parse body — typed so caller errors get specific messages.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    badRequest("body must be valid JSON");
  }

  const parsed = DenyBodySchema.safeParse(raw);
  if (!parsed.success) {
    validationFailed("invalid deny request", { issues: parsed.error.issues });
  }
  const { rationale, scope } = parsed.data;

  // Single tenant-scoped transaction — RLS enforces workspace isolation.
  const result = await withTenant(session.activeCompanyId, async (tx) => {
    // 1. Find the approval; bail if not found OR already decided.
    const [existing] = await tx
      .select({
        id: approvals.id,
        status: approvals.status,
        clientId: approvals.clientId,
        kind: approvals.kind,
      })
      .from(approvals)
      .where(eq(approvals.id, approvalId))
      .limit(1);

    if (!existing) {
      // Either the approval doesn't exist OR RLS hid it because it belongs to
      // a different tenant. Either way: not_found.
      notFound("approval not found");
    }
    if (existing.status !== "pending") {
      badRequest(`approval is already ${existing.status}`);
    }

    // 2. Mark the approval denied with rationale + scope.
    const [updated] = await tx
      .update(approvals)
      .set({
        status: "denied",
        denyRationale: rationale,
        denyScope: scope,
        decidedByUserId: session.userId,
        decidedAt: new Date(),
      })
      .where(eq(approvals.id, approvalId))
      .returning();

    // 3. Capture the rationale as a company_lessons row (USP 5 backbone).
    //    The next time an agent recalls lessons on a touching topic, this
    //    will surface in its system prompt.
    const [lesson] = await tx
      .insert(companyLessons)
      .values({
        companyId: session.activeCompanyId,
        clientId: existing.clientId,
        kind: "human_denied",
        scope,
        rationale,
        capturedByUserId: session.userId,
      })
      .returning({ id: companyLessons.id });

    // 4. Append to the audit log. The kind is `approval.denied`; details
    //    carry the lesson id + scope so the audit trail and the lesson
    //    can be cross-referenced without a join.
    await tx.insert(auditLog).values({
      companyId: session.activeCompanyId,
      clientId: existing.clientId,
      kind: "approval.denied",
      actorKind: "user",
      actorId: session.userId,
      detailsJson: {
        approvalId,
        approvalKind: existing.kind,
        lessonId: lesson.id,
        scope,
        // We store length not full text to avoid duplicating the rationale
        // across audit + lesson; the lesson row owns the canonical copy.
        rationaleLength: rationale.length,
      },
    });

    return { approval: updated, lessonId: lesson.id };
  });

  return ok(result);
});

