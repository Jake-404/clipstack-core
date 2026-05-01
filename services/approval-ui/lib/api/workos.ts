// WorkOS client singleton.
//
// Phase B.6 — replaces the AUTH_STUB path with real WorkOS Authkit.
// When WORKOS_API_KEY isn't set, the stub path remains active for local dev
// (and refuses NODE_ENV=production per lib/api/auth.ts gating).
//
// The WorkOS SDK is constructed lazily on first request — same pattern as
// lib/db/client.ts:getDb(). Module load is side-effect-free so Next.js's
// page-data collection at build time doesn't try to instantiate without keys.

import type { WorkOS as WorkOSClient } from "@workos-inc/node";

let _client: WorkOSClient | null = null;

export const WORKOS_API_KEY = process.env.WORKOS_API_KEY;
export const WORKOS_CLIENT_ID = process.env.WORKOS_CLIENT_ID;
export const WORKOS_REDIRECT_URI =
  process.env.WORKOS_REDIRECT_URI ?? "http://localhost:3000/api/auth/callback";

/** True when WORKOS_API_KEY + WORKOS_CLIENT_ID are both set. The auth resolver
 *  consults this to decide whether to take the real path or the AUTH_STUB. */
export const WORKOS_CONFIGURED: boolean = Boolean(WORKOS_API_KEY && WORKOS_CLIENT_ID);

/** Lazy WorkOS client accessor. Throws when WORKOS_API_KEY is unset — call
 *  sites should gate on `WORKOS_CONFIGURED` first. */
export function getWorkOS(): WorkOSClient {
  if (_client) return _client;
  if (!WORKOS_API_KEY) {
    throw new Error(
      "WORKOS_API_KEY is not set. Auth stub may be active; production requires WorkOS.",
    );
  }
  // Lazy import keeps the module importable in tests that mock WorkOS.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WorkOS } = require("@workos-inc/node") as typeof import("@workos-inc/node");
  _client = new WorkOS(WORKOS_API_KEY, {
    clientId: WORKOS_CLIENT_ID,
  });
  return _client;
}
