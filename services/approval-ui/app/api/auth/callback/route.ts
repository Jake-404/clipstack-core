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
import { companies } from "@/lib/db/schema/companies";
import { memberships } from "@/lib/db/schema/memberships";
import { roles } from "@/lib/db/schema/roles";
import { users } from "@/lib/db/schema/users";

/** Default for WORKOS_AUTO_PROVISION env var.
 *  Dev/test: '1' (auto-create users + solo workspace on first login).
 *  Production: '0' (require explicit invite — the existing 403 path).
 *
 *  Lets local dev work without manually seeding users + memberships, while
 *  keeping production fail-closed. Operators can flip the prod default
 *  later by setting WORKOS_AUTO_PROVISION=1 explicitly when their
 *  onboarding flow takes over.
 */
function autoProvisionEnabled(): boolean {
  const explicit = process.env.WORKOS_AUTO_PROVISION;
  if (explicit !== undefined) return explicit === "1" || explicit === "true";
  return process.env.NODE_ENV !== "production";
}

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

  // No local users row OR no active membership → either auto-provision
  // (dev default) or fail closed (production default). Both branches result
  // in `userRow.id` + `companyId` being set so the session-write path is
  // shared.
  let companyId: string | undefined;

  if (!userRow) {
    if (!autoProvisionEnabled()) {
      return fail(
        new ApiError(
          "forbidden",
          "WorkOS user has no matching workspace. Contact your workspace owner for an invite.",
          { workosUserId: workosUser.id, email: workosUser.email },
        ),
      );
    }
    const provisioned = await provisionNewUser(workosUser);
    userRow = { id: provisioned.userId, email: workosUser.email ?? "" };
    companyId = provisioned.companyId;
  }

  if (!companyId) {
    // Existing user — pick newest non-revoked membership.
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
    companyId = membership.companyId;
  }
  const membership = { companyId };

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

// ─── Auto-provision helper ─────────────────────────────────────────────────
//
// First-time WorkOS user → create a local users row + a solo company with
// owner-role membership. Returns the new (userId, companyId) pair. The
// 0003_rbac_seed migration installs an AFTER INSERT trigger on companies
// that auto-creates the four default roles (owner / admin / member /
// client_guest) — this helper just looks up the owner role id and links
// the membership.

async function provisionNewUser(workosUser: {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}): Promise<{ userId: string; companyId: string }> {
  const db = getDb();

  if (!workosUser.email) {
    throw new ApiError(
      "bad_request",
      "WorkOS user has no email — cannot auto-provision",
    );
  }

  const displayName =
    [workosUser.firstName, workosUser.lastName].filter(Boolean).join(" ").trim() ||
    workosUser.email.split("@")[0];

  // 1. users row
  const [createdUser] = await db
    .insert(users)
    .values({
      email: workosUser.email,
      name: displayName,
      workosUserId: workosUser.id,
    })
    .returning({ id: users.id });

  // 2. solo company. The 0003_rbac_seed trigger creates the 4 default roles
  // for this company AFTER INSERT — so by the time the next query runs,
  // owner role exists.
  const workspaceName = `${displayName}'s workspace`.slice(0, 120);
  const [createdCompany] = await db
    .insert(companies)
    .values({
      name: workspaceName,
      type: "solo",
      uiMode: "web2",
    })
    .returning({ id: companies.id });

  // 3. resolve the owner role id for the new company.
  const [ownerRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.companyId, createdCompany.id), eq(roles.slug, "owner")))
    .limit(1);

  if (!ownerRole) {
    throw new ApiError(
      "internal",
      "default-role seed trigger missing — owner role not found on new company",
      { companyId: createdCompany.id },
    );
  }

  // 4. owner membership
  await db.insert(memberships).values({
    userId: createdUser.id,
    companyId: createdCompany.id,
    roleId: ownerRole.id,
  });

  // 5. audit (outside the auto-provision transaction; non-fatal on failure)
  try {
    await db.insert(auditLog).values({
      companyId: createdCompany.id,
      kind: "auth.user.provisioned",
      actorKind: "system",
      actorId: "auth.callback.auto-provision",
      detailsJson: {
        workosUserId: workosUser.id,
        emailLength: workosUser.email.length,
        workspaceType: "solo",
      },
    });
  } catch {
    // audit failures don't block sign-in
  }

  return { userId: createdUser.id, companyId: createdCompany.id };
}
