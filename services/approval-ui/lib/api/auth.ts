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
    return {
      userId: userId!,
      activeCompanyId: companyId!,
      roleSlug: "owner",
      authenticatedAt: new Date().toISOString(),
    };
  }

  throw new ApiError("unauthorized", "no session — auth stub not configured");
}
