// GET /api/companies/:companyId/experiments
// Mission Control's experiments tile — surfaces the workspace's live
// bandits with leader posteriors and arm/reward counts. Doc 4 §2.3.
//
// Proxies bandit-orchestrator's GET /bandits, scoping by companyId from
// the URL param. Auth is session OR service-token; the workspace check
// (activeCompanyId === companyId) is the same defensive boundary every
// other company-scoped route enforces.
//
// Caching: short (15s) — the tile polls; bandit allocations + rewards
// flow continuously. Mission Control's bus-status tile shows live
// freshness; this is the warmer companion.

import { type NextRequest } from "next/server";
import { z } from "zod";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { auditAccess } from "@/lib/api/audit";
import { badRequest, validationFailed } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { withTenant } from "@/lib/db/client";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const QuerySchema = z.object({
  campaignId: z.string().uuid().optional(),
  // Forward-compat — orchestrator's `include_archived` flag. Today every
  // bandit is "live" so this is a no-op; surfaced here so a UI toggle
  // can wire without a route change.
  includeArchived: z.coerce.boolean().default(false),
});

interface RouteContext {
  params: Promise<{ companyId: string }>;
}

const BANDIT_ORCH_BASE_URL = process.env.BANDIT_ORCH_BASE_URL;
const SERVICE_TOKEN = process.env.SERVICE_TOKEN;
const SERVICE_NAME = "approval-ui";
const PROXY_TIMEOUT_MS = 5000;

export const GET = withApi(async (req: NextRequest, ctx: RouteContext) => {
  const ctxAuth = await resolveServiceOrSession(req.headers);
  const { companyId } = await ctx.params;

  if (!isUuid(companyId)) badRequest("invalid companyId");
  if (ctxAuth.activeCompanyId !== companyId) {
    badRequest("active workspace does not match URL param");
  }

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    campaignId: url.searchParams.get("campaignId") ?? undefined,
    includeArchived: url.searchParams.get("includeArchived") ?? undefined,
  });
  if (!parsed.success) {
    validationFailed("invalid experiments query", { issues: parsed.error.issues });
  }
  const { campaignId, includeArchived } = parsed.data;

  // Audit + tenant-scoped wrapping. The audit row is what makes this
  // route's read activity visible to workspace admins (matches every
  // other company-scoped read route's pattern).
  await withTenant(companyId, async (tx) => {
    await auditAccess({
      tx,
      ctx: ctxAuth,
      companyId,
      kind: "experiments.listed",
      details: { campaignId: campaignId ?? null, includeArchived },
    });
  });

  // Stub fallback: when the orchestrator URL/token aren't wired,
  // return an empty list so the UI renders cleanly in dev. Matches the
  // recall-lessons / register-bandit fail-soft pattern.
  if (!BANDIT_ORCH_BASE_URL || !SERVICE_TOKEN) {
    return ok({ companyId, bandits: [] });
  }

  const params = new URLSearchParams({ company_id: companyId });
  if (campaignId) params.set("campaign_id", campaignId);
  if (includeArchived) params.set("include_archived", "true");
  const orchUrl = `${BANDIT_ORCH_BASE_URL.replace(/\/$/, "")}/bandits?${params}`;

  let resp: Response;
  try {
    resp = await fetch(orchUrl, {
      method: "GET",
      headers: {
        "X-Clipstack-Service-Token": SERVICE_TOKEN,
        "X-Clipstack-Active-Company": companyId,
        "X-Clipstack-Service-Name": SERVICE_NAME,
      },
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
  } catch (err) {
    // Fail-soft on outage — empty list rather than 502 so the UI tile
    // can render "no experiments yet" gracefully. The /producer/status
    // tile is the right place to surface backend-down state. Cause is
    // logged so a wedged orchestrator doesn't hide as a quietly empty
    // tile (the silent-catch class fixed in this sweep).
    console.error("[api/experiments] orchestrator unreachable", {
      companyId,
      orchUrl,
      err,
    });
    return ok({ companyId, bandits: [] });
  }

  if (!resp.ok) {
    return ok({ companyId, bandits: [] });
  }

  const payload = (await resp.json()) as {
    company_id?: string;
    bandits?: Array<Record<string, unknown>>;
  };

  // Pass through the orchestrator's BanditSummary shape directly. The
  // tile component knows the field names (snake_case from FastAPI).
  return ok({
    companyId,
    bandits: payload.bandits ?? [],
  });
});
