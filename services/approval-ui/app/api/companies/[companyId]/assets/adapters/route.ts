// GET /api/companies/:companyId/assets/adapters
// Returns the catalogue of every adapter wired in core/, with cost-class,
// kinds supported, approx cost per call, and api-key-configured status.
// Studio + the future agent-tool registry consume this to populate
// adapter selectors and the cost-policy router.

import { type NextRequest } from "next/server";

import { resolveServiceOrSession } from "@/lib/api/auth";
import { badRequest } from "@/lib/api/errors";
import { ok, withApi } from "@/lib/api/respond";
import { describeAdapters } from "@/lib/asset-adapters/registry";
import { isUuid } from "@/lib/validation/uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ companyId: string }>;
}

export const GET = withApi(async (req: NextRequest, ctx: RouteContext) => {
  const ctxAuth = await resolveServiceOrSession(req.headers);
  const { companyId } = await ctx.params;

  if (!isUuid(companyId)) badRequest("invalid companyId");
  if (ctxAuth.activeCompanyId !== companyId) {
    badRequest("active workspace does not match URL param");
  }

  return ok({ adapters: describeAdapters() });
});
