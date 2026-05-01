// POST /api/companies/:companyId/meter-events
// USP 10 — per-output metering counter. Every publish event lands one row.
//
// Called by:
//   - LangGraph publish_pipeline `record_metering` node (after publish_to_channel)
//   - agent-crewai metered tool calls (asset.generate cost-policy enforcement)
//   - manual workspace-admin entries (bulk imports, corrections)
//
// Service-token auth required (LangGraph + agent-crewai both use service tokens).

import { type NextRequest } from "next/server";
import { z } from "zod";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { auditAccess } from "@/lib/api/audit";
import { badRequest, validationFailed } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import { meterEvents } from "@/lib/db/schema/metering";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Mirrors meter_events SQL columns + meter_event_kind enum from 0001_init.sql.
const MeterEventBodySchema = z.object({
  kind: z.enum([
    "publish",
    "metered_asset_generation",
    "x402_outbound_call",
    "x402_inbound_call",
    "voice_score_query",
    "compliance_check",
  ]),
  quantity: z.number().nonnegative(),
  unitCostUsd: z.number().nonnegative().optional(),
  totalCostUsd: z.number().nonnegative().optional(),
  refKind: z.string().min(1).max(40).optional(),
  refId: z.string().min(1).max(120).optional(),
  // ISO-8601; defaults to server `now()` when null. Caller-supplied values
  // are accepted but cannot be in the future > 5 minutes (clock-skew tol).
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

  const parsed = MeterEventBodySchema.safeParse(raw);
  if (!parsed.success) {
    validationFailed("invalid meter-event payload", { issues: parsed.error.issues });
  }

  const body = parsed.data;

  // Reject claimed-future occurredAt to prevent backdating attacks against
  // billing rollups. 5-minute tolerance covers clock skew.
  if (body.occurredAt) {
    const at = Date.parse(body.occurredAt);
    if (!Number.isFinite(at) || at > Date.now() + 5 * 60 * 1000) {
      badRequest("occurredAt must not be > 5 minutes in the future");
    }
  }

  const result = await withTenant(companyId, async (tx) => {
    const [inserted] = await tx
      .insert(meterEvents)
      .values({
        companyId,
        clientId: body.clientId ?? null,
        kind: body.kind,
        quantity: body.quantity,
        unitCostUsd: body.unitCostUsd ?? null,
        totalCostUsd: body.totalCostUsd ?? null,
        refKind: body.refKind ?? null,
        refId: body.refId ?? null,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
      })
      .returning({ id: meterEvents.id });

    // USP 10 surfaces: this audit row lets the workspace admin see WHO
    // wrote each meter row (service vs user) and the kind+ref details
    // without sweeping the meter_events table directly.
    await auditAccess({
      tx,
      ctx: ctxAuth,
      companyId,
      kind: "metering.written",
      details: {
        meterEventId: inserted.id,
        kind: body.kind,
        quantity: body.quantity,
        refKind: body.refKind ?? null,
        refId: body.refId ?? null,
      },
    });

    return { eventId: inserted.id };
  });

  return ok(result);
});
