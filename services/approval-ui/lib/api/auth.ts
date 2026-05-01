// Auth + tenant resolution stub.
//
// A.1 placeholder — every request returns a hardcoded user + workspace
// when a single env var is set. This is enough to wire route shapes and
// run integration tests; production WorkOS SSO + membership lookup land
// in a follow-up A.2 slice.
//
// The shape (resolveSession returns SessionContext or throws unauthorized)
// is final — only the implementation behind it changes when WorkOS lands.

import { ApiError } from "./errors";
import { isUuid } from "@/lib/validation/uuid";

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
 * A.1: stub mode. If `AUTH_STUB_USER_ID` + `AUTH_STUB_COMPANY_ID` are set,
 * return a fake session with role 'owner'. Used for local dev + the early
 * integration tests. Setting only one is a configuration error and throws.
 *
 * A.2 (next slice): WorkOS session cookie + memberships query.
 */
export async function resolveSession(): Promise<SessionContext> {
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

  throw new ApiError("unauthorized", "no session — auth stub not configured");
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
