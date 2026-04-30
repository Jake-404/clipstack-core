# lib/api

Shared helpers for Next.js API routes under `app/api/`.

## Layout

```
lib/api/
├── errors.ts    # ApiError class + typed throwers (badRequest, unauthorized, ...)
├── respond.ts   # ok() / fail() / withApi() wrapper for uniform envelope
├── auth.ts      # resolveSession() — stub mode A.1, WorkOS A.2
└── README.md
```

## The envelope

Every API response follows the same shape so the UI client never has to branch on response format:

```ts
// success
{ "ok": true, "data": <payload> }

// failure
{ "ok": false, "error": { "code": "<code>", "message": "...", "details": <optional> } }
```

The status code distinguishes failure types — `400` bad_request, `401` unauthorized, `403` forbidden, `404` not_found, `409` conflict, `422` validation_failed, `429` rate_limited, `500` internal. Codes are typed (`ApiErrorCode`) and map to status one-to-one.

## Usage

```ts
// app/api/<resource>/route.ts
import { withApi, ok } from "@/lib/api/respond";
import { badRequest } from "@/lib/api/errors";
import { resolveSession } from "@/lib/api/auth";
import { withTenant } from "@/lib/db/client";

export const POST = withApi(async (req: Request) => {
  const session = await resolveSession();          // 401 if not authed
  const body = await req.json();
  if (!body.foo) badRequest("foo is required");

  const result = await withTenant(session.activeCompanyId, async (tx) => {
    return tx.insert(...).values(...).returning();
  });

  return ok({ result });
});
```

`withApi(...)` catches any thrown `ApiError` and converts to the matching envelope + status. Anything else falls through to a sanitised 500 — no stack traces leak.

## Auth in A.1

Stub mode: set `AUTH_STUB_USER_ID` + `AUTH_STUB_COMPANY_ID` env vars and every request returns a fake owner-role session. Lets routes wire end-to-end without a session cookie or WorkOS account.

A.2 slice swaps `resolveSession()` to read a signed session cookie + look up the active workspace from the URL path / header / session default per `services/shared/db/middleware.md`. The function signature stays identical.

## What this is NOT

Not a full framework. Things this intentionally doesn't ship:

- Rate limiting — Next.js middleware or edge config handles it; not a per-route concern
- Request validation beyond zod — caller owns the schema and calls `safeParse` then `validationFailed(...)` on the issues
- CORS — Next.js config or middleware handles it
- Logging — `console.error` for now; structured logging adds in A.2 alongside Langfuse trace correlation
