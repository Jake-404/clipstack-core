// GET /api/auth/callback
// WorkOS Authkit calls back here with an authorization code. We:
//   1. Exchange the code for a WorkOS user object (server-to-server).
//   2. Look up the local `users` row by workos_user_id (creating one when
//      the user has at least one membership tied to their email — workspace
//      provisioning is out of scope for this slice).
//   3. Pick the active company (latest non-revoked membership).
//   4. Write the encrypted session cookie.
//   5. Audit `auth.session.created`.
//   6. Redirect to the `next` path the /login route encoded in `state`.

import { type NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { ApiError } from "@/lib/api/errors";
import { fail, withApi } from "@/lib/api/respond";
import { getSession } from "@/lib/api/session";
import { WORKOS_CLIENT_ID, WORKOS_CONFIGURED, getWorkOS } from "@/lib/api/workos";
import { auditLog } from "@/lib/db/schema/audit";
import { getDb } from "@/lib/db/client";
import { memberships } from "@/lib/db/schema/memberships";
import { users } from "@/lib/db/schema/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApi(async (req: NextRequest) => {
  if (!WORKOS_CONFIGURED) {
    return fail(
      new ApiError(
        "internal",
        "WorkOS not configured on this deployment.",
      ),
    );
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  if (!code) {
    return fail(new ApiError("bad_request", "missing authorization code"));
  }

  // Exchange the code for the WorkOS user.
  let workosUser;
  try {
    const result = await getWorkOS().userManagement.authenticateWithCode({
      code,
      clientId: WORKOS_CLIENT_ID!,
    });
    workosUser = result.user;
  } catch (e: unknown) {
    return fail(
      new ApiError(
        "unauthorized",
        "WorkOS code exchange failed",
        { error: e instanceof Error ? e.message : String(e) },
      ),
    );
  }

  // Local user lookup (or first-time link).
  // Look up by workos_user_id first; if not found, fall back to email match
  // (the local user may have been created out-of-band by an invite flow
  // that hadn't yet rolled to WorkOS).
  const db = getDb();
  let userRow = (
    await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.workosUserId, workosUser.id))
      .limit(1)
  )[0];

  if (!userRow && workosUser.email) {
    const byEmail = (
      await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.email, workosUser.email))
        .limit(1)
    )[0];
    if (byEmail) {
      // Backfill the workos_user_id link.
      await db
        .update(users)
        .set({ workosUserId: workosUser.id })
        .where(eq(users.id, byEmail.id));
      userRow = byEmail;
    }
  }

  if (!userRow) {
    // No matching local user. New-user provisioning is the onboarding
    // flow's responsibility — for now, fail closed.
    return fail(
      new ApiError(
        "forbidden",
        "WorkOS user has no matching workspace. Contact your workspace owner for an invite.",
        { workosUserId: workosUser.id, email: workosUser.email },
      ),
    );
  }

  // Pick the user's active membership. Newest non-revoked wins; multi-
  // workspace switching is its own slice.
  const membership = (
    await db
      .select({ companyId: memberships.companyId })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userRow.id),
          isNull(memberships.revokedAt),
        ),
      )
      .orderBy(memberships.grantedAt)
      .limit(1)
  )[0];

  if (!membership) {
    return fail(
      new ApiError(
        "forbidden",
        "User has no active workspace membership.",
        { userId: userRow.id },
      ),
    );
  }

  // Write the session cookie.
  const session = await getSession();
  session.workosUserId = workosUser.id;
  session.userId = userRow.id;
  session.activeCompanyId = membership.companyId;
  session.authenticatedAt = new Date().toISOString();
  await session.save();

  // Audit. Use the raw db (not withTenant) — the session-create event isn't
  // a tenant-scoped read; we tag the company_id on the row but the row is
  // written outside an RLS-bound transaction. RLS still enforces that the
  // company_id matches an existing row (audit_log has FK to companies).
  await db.insert(auditLog).values({
    companyId: membership.companyId,
    kind: "auth.session.created",
    actorKind: "user",
    actorId: userRow.id,
    detailsJson: {
      workosUserId: workosUser.id,
      // Email length only — actual email lives in users.email and only
      // staff-impersonation views surface it.
      emailLength: workosUser.email?.length ?? 0,
    },
  });

  // Redirect to the original `next` destination.
  let nextPath = "/";
  if (stateRaw) {
    try {
      const parsed = JSON.parse(decodeURIComponent(stateRaw));
      if (typeof parsed?.next === "string" && parsed.next.startsWith("/")) {
        nextPath = parsed.next;
      }
    } catch {
      // Malformed state — fall back to /. Don't leak parsing errors.
    }
  }

  return NextResponse.redirect(new URL(nextPath, url.origin));
});
