// Auth + tenant resolution.
//
// Two paths:
//   1. WorkOS session cookie (B.6) — production path. Authkit issues the user;
//      /api/auth/callback writes the encrypted iron-session cookie; this
//      resolver reads + verifies it and looks up the active membership.
//   2. AUTH_STUB env-var pair — dev/test only. Refused at NODE_ENV=production.
//      Convenient for local route exercise without provisioning WorkOS.
//
// The cookie path is preferred. Stub is a fallback that activates ONLY when
// the cookie is absent. A request that carries a session cookie always uses
// the cookie path.

import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { memberships } from "@/lib/db/schema/memberships";
import { roles } from "@/lib/db/schema/roles";
import { isUuid } from "@/lib/validation/uuid";

import { ApiError } from "./errors";
import { getSession } from "./session";

export interface SessionContext {
  userId: string;
  activeCompanyId: string;
  /** Resolved role slug for this (user, company) pair. */
  roleSlug: "owner" | "admin" | "member" | "client_guest" | string;
  /** When the session was authenticated. Used by audit-log writers. */
  authenticatedAt: string;
}

const STUB_ENABLED_KEYS = ["AUTH_STUB_USER_ID", "AUTH_STUB_COMPANY_ID"] as const;

/**
 * Resolve the session for the current request.
 *
 * Tries the WorkOS-issued session cookie first; falls back to AUTH_STUB env
 * vars in dev/test. Throws ApiError on mis-config (partial stub, production
 * stub, missing membership).
 */
export async function resolveSession(): Promise<SessionContext> {
  // ─── 1. WorkOS session cookie ─────────────────────────────────────────
  const session = await getSession();
  if (session.userId && session.activeCompanyId && session.authenticatedAt) {
    // Resolve role on every request. Cheap (indexed lookup) and ensures a
    // revoked membership stops working immediately rather than waiting for
    // the cookie to expire.
    const roleSlug = await resolveRoleSlug(session.userId, session.activeCompanyId);
    if (!roleSlug) {
      // Membership revoked between login and now. Treat as logged-out.
      session.destroy();
      throw new ApiError(
        "unauthorized",
        "membership revoked — please sign in again",
      );
    }
    return {
      userId: session.userId,
      activeCompanyId: session.activeCompanyId,
      roleSlug,
      authenticatedAt: session.authenticatedAt,
    };
  }

  // ─── 2. AUTH_STUB fallback (dev/test only) ────────────────────────────
  const userId = process.env.AUTH_STUB_USER_ID;
  const companyId = process.env.AUTH_STUB_COMPANY_ID;

  const someSet = STUB_ENABLED_KEYS.some((k) => Boolean(process.env[k]));
  const allSet = STUB_ENABLED_KEYS.every((k) => Boolean(process.env[k]));
  if (someSet && !allSet) {
    throw new ApiError(
      "internal",
      "auth stub partially configured: set both AUTH_STUB_USER_ID and AUTH_STUB_COMPANY_ID, or neither",
    );
  }

  if (allSet) {
    // Hard rule: AUTH_STUB_* MUST NOT bypass auth in production. A deployment
    // that accidentally sets these would silently grant every request fake
    // owner-role access. Refuse loudly instead.
    if (process.env.NODE_ENV === "production") {
      throw new ApiError(
        "internal",
        "AUTH_STUB_USER_ID / AUTH_STUB_COMPANY_ID detected with NODE_ENV=production. " +
          "Stub auth is for dev/test only. Configure WorkOS or remove the stub vars.",
      );
    }
    return {
      userId: userId!,
      activeCompanyId: companyId!,
      roleSlug: "owner",
      authenticatedAt: new Date().toISOString(),
    };
  }

  throw new ApiError("unauthorized", "no session — sign in via /login");
}

/**
 * Look up the role slug for a (userId, companyId) pair via the active
 * membership. Returns null when no non-revoked membership exists — the
 * caller should treat that as "session no longer valid".
 */
async function resolveRoleSlug(
  userId: string,
  companyId: string,
): Promise<string | null> {
  const rows = await getDb()
    .select({ slug: roles.slug })
    .from(memberships)
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.companyId, companyId),
        isNull(memberships.revokedAt),
      ),
    )
    .limit(1);
  return rows[0]?.slug ?? null;
}

// ─── Service-token authentication ──────────────────────────────────────────
//
// Used by the agent-crewai + agent-langgraph services to call the API on a
// specific workspace's behalf. NOT available to user-facing surfaces.
//
// Headers:
//   X-Clipstack-Service-Token: <secret>     (must match SERVICE_TOKEN env var)
//   X-Clipstack-Active-Company: <uuid>      (the workspace this call serves)
//
// The token is shared between the API and the agent services. Rotate via env
// var update; A.3 introduces per-service token rotation tracked in audit_log.

export interface ServiceContext {
  kind: "service";
  service: string;            // e.g. "agent-crewai"
  activeCompanyId: string;
  authenticatedAt: string;
}

/**
 * Try to resolve a service-token context. Returns null when no service-token
 * header is present (caller should fall back to user-session resolution).
 * Throws on partial / invalid headers — never silently downgrade.
 */
export function resolveServiceContext(headers: Headers): ServiceContext | null {
  const presented = headers.get("x-clipstack-service-token");
  if (!presented) return null;

  const expected = process.env.SERVICE_TOKEN;
  if (!expected) {
    // Service token sent but server isn't configured — fail closed.
    throw new ApiError("forbidden", "service tokens are not enabled on this deployment");
  }
  if (!constantTimeEqual(presented, expected)) {
    throw new ApiError("forbidden", "invalid service token");
  }

  const companyHeader = headers.get("x-clipstack-active-company");
  if (!companyHeader) {
    throw new ApiError(
      "bad_request",
      "service-token requests must include X-Clipstack-Active-Company",
    );
  }
  if (!isUuid(companyHeader)) {
    throw new ApiError("bad_request", "X-Clipstack-Active-Company must be a UUID");
  }

  const service = headers.get("x-clipstack-service-name") ?? "unknown-service";

  return {
    kind: "service",
    service,
    activeCompanyId: companyHeader,
    authenticatedAt: new Date().toISOString(),
  };
}

/**
 * Resolve either a service-token context or a user session, in that order.
 * Use this on routes that the agent services need to call.
 */
export async function resolveServiceOrSession(
  headers: Headers,
): Promise<SessionContext | ServiceContext> {
  const service = resolveServiceContext(headers);
  if (service) return service;
  return resolveSession();
}

/** Constant-time string compare to prevent token-timing attacks. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return acc === 0;
}
