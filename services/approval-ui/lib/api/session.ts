// Encrypted session cookie via iron-session.
//
// Phase B.6 — replaces the AUTH_STUB env-var pair with a signed cookie that
// carries the WorkOS-issued user identity through subsequent requests.
//
// Iron-session encrypts + signs (AES-256-GCM under the hood) so the cookie
// payload is opaque to the browser and tamper-evident on the server. We
// store ONLY the load-bearing fields — the WorkOS user id and the active
// company id — never the email, name, or anything we'd have to redact later.

import { type SessionOptions, getIronSession } from "iron-session";
import { cookies } from "next/headers";

import { ApiError } from "./errors";

export interface SessionData {
  /** WorkOS user id — used to look up the local users.id row. */
  workosUserId?: string;
  /** Local users.id once the WorkOS-id ↔ user mapping is resolved. */
  userId?: string;
  /** The workspace this session is currently scoped to (selectable later). */
  activeCompanyId?: string;
  /** When the WorkOS auth completed — populated by the /callback handler. */
  authenticatedAt?: string;
}

const COOKIE_NAME = "clipstack_session";

function getSessionOptions(): SessionOptions {
  const password = process.env.SESSION_COOKIE_SECRET;
  if (!password || password.length < 32) {
    throw new ApiError(
      "internal",
      "SESSION_COOKIE_SECRET must be set to a 32+ char random string. " +
        "Generate one with: openssl rand -base64 48",
    );
  }
  return {
    cookieName: COOKIE_NAME,
    password,
    cookieOptions: {
      // Production-shaped defaults. Override per-environment via env vars
      // when the deploy lands.
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      // 30-day rolling session. Refreshed on every authenticated request
      // by the resolveSession path.
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    },
  };
}

/**
 * Read the current session from the request cookie.
 * Returns an empty SessionData object when no cookie is present — the route
 * boundary distinguishes "logged out" from "logged in" by checking the
 * presence of `workosUserId` + `activeCompanyId`.
 *
 * Dev/test fallback: when the cookie is empty AND AUTH_STUB_USER_ID +
 * AUTH_STUB_COMPANY_ID are both set AND NODE_ENV !== "production", we
 * populate the in-memory session with the stub values. This mirrors
 * the resolveSession() behavior in lib/api/auth.ts so server-component
 * pages (which call getSession() directly) and API routes (which call
 * resolveSession()) both honour AUTH_STUB. The stub-mode populated
 * fields are NOT persisted — calling session.save() on a stub-populated
 * session is a no-op (iron-session writes back the cookie regardless,
 * but the next request still hits the empty-cookie path and re-stubs).
 */
export async function getSession() {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(
    cookieStore,
    getSessionOptions(),
  );

  if (!session.activeCompanyId && process.env.NODE_ENV !== "production") {
    const stubUserId = process.env.AUTH_STUB_USER_ID;
    const stubCompanyId = process.env.AUTH_STUB_COMPANY_ID;
    if (stubUserId && stubCompanyId) {
      session.userId = stubUserId;
      session.activeCompanyId = stubCompanyId;
      session.authenticatedAt = session.authenticatedAt ?? new Date().toISOString();
    }
  }

  return session;
}
