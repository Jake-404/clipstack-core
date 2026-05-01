// POST /api/auth/logout — clear the session cookie + audit + redirect /login.
// GET form is also accepted for ease of wiring a top-bar logout link.

import { type NextRequest, NextResponse } from "next/server";

import { withApi } from "@/lib/api/respond";
import { getSession } from "@/lib/api/session";
import { auditLog } from "@/lib/db/schema/audit";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function clearSessionAndAudit(req: NextRequest) {
  const session = await getSession();
  const userId = session.userId;
  const companyId = session.activeCompanyId;

  if (userId && companyId) {
    try {
      await getDb().insert(auditLog).values({
        companyId,
        kind: "auth.session.destroyed",
        actorKind: "user",
        actorId: userId,
        detailsJson: {},
      });
    } catch {
      // Audit-write failure shouldn't block logout. Surfaces in error logs.
    }
  }

  session.destroy();

  const url = new URL(req.url);
  return NextResponse.redirect(new URL("/login", url.origin));
}

export const GET = withApi(clearSessionAndAudit);
export const POST = withApi(clearSessionAndAudit);
