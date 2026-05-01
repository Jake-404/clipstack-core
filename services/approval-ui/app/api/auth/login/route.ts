// GET /api/auth/login
// Initiates the WorkOS Authkit-hosted login flow. Browser is redirected to
// the workos-hosted UI; on success, WorkOS calls back to /api/auth/callback
// with an authorization code we exchange for a session.
//
// Phase B.6 — when WORKOS isn't configured, this route returns a 503 with
// a structured error so the /login page can render a "WorkOS not configured
// for this deployment" hint rather than crashing.

import { type NextRequest, NextResponse } from "next/server";

import { ApiError, badRequest } from "@/lib/api/errors";
import { fail, withApi } from "@/lib/api/respond";
import { WORKOS_CLIENT_ID, WORKOS_CONFIGURED, WORKOS_REDIRECT_URI, getWorkOS } from "@/lib/api/workos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApi(async (req: NextRequest) => {
  if (!WORKOS_CONFIGURED) {
    return fail(
      new ApiError(
        "internal",
        "WorkOS not configured on this deployment. Set WORKOS_API_KEY + WORKOS_CLIENT_ID.",
      ),
    );
  }

  // Optional `next` param — where to send the user after a successful login.
  // Defaults to the home page. We bake it into the OAuth `state` param so
  // the callback can retrieve it without a separate cookie.
  const url = new URL(req.url);
  const nextPath = url.searchParams.get("next") ?? "/";
  if (!nextPath.startsWith("/")) {
    badRequest("`next` must be an absolute-path string");
  }

  const authorizationUrl = getWorkOS().userManagement.getAuthorizationUrl({
    provider: "authkit",
    redirectUri: WORKOS_REDIRECT_URI,
    clientId: WORKOS_CLIENT_ID!,
    state: encodeURIComponent(JSON.stringify({ next: nextPath })),
  });

  return NextResponse.redirect(authorizationUrl);
});
