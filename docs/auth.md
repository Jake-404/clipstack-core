# Auth

Phase B.6 — WorkOS Authkit + iron-session cookies. Replaces the AUTH_STUB env-var path that A.1/A.2 used as a placeholder.

## Two paths

| Path | When it fires | Production-safe |
|---|---|---|
| **WorkOS session cookie** | A signed cookie is present and decrypts cleanly | ✅ Yes |
| **AUTH_STUB env vars** | No cookie + both env vars set + `NODE_ENV !== "production"` | 🚫 Refused at runtime when `NODE_ENV=production` |

The cookie path is preferred. Stub is a fallback for local dev when you don't want to provision WorkOS just to exercise a route.

## Session cookie

Encrypted + signed via [iron-session](https://github.com/vvo/iron-session). Payload is:

```ts
{
  workosUserId:    "user_01H...",
  userId:          "<users.id uuid>",
  activeCompanyId: "<companies.id uuid>",
  authenticatedAt: "2026-05-01T18:30:00Z",
}
```

Cookie attributes: `httpOnly` + `secure` (in production) + `sameSite=lax` + 30-day rolling expiry. Refreshed on every authenticated request.

`SESSION_COOKIE_SECRET` must be 32+ random chars. Generate with:

```bash
openssl rand -base64 48
```

## Flow

```
   Browser            /api/auth/login        WorkOS Authkit       /api/auth/callback        Mission Control
      │                       │                       │                       │                       │
      │── GET /api/auth/login ▶                       │                       │                       │
      │                       │── 302 to WorkOS authorize URL ────────────────▶                       │
      │                                                  │                       │                       │
      │── (browser auth on WorkOS-hosted page) ◀─────────│                       │                       │
      │                                                  │                       │                       │
      │── 302 back with ?code=…&state=… ───────────────────────▶                  │                       │
      │                                                                          │── exchange code        │
      │                                                                          │── lookup users row     │
      │                                                                          │── pick active membership
      │                                                                          │── write session cookie │
      │                                                                          │── audit               │
      │── 302 to `next` (default /) ────────────────────────────────────────────────────────────────────▶│
      │                                                                                                  │
      │── all subsequent requests carry the cookie; resolveSession() reads it ─────────────────────────▶│
```

## Local setup

### Option A — real WorkOS (production-shaped)

```bash
# 1. Create a WorkOS account at https://workos.com (free tier covers dev).
# 2. Configure Authkit:
#    - Redirect URI: http://localhost:3000/api/auth/callback
#    - At least one connection (Google / Microsoft / email-password)
# 3. Copy API Key + Client ID into .env:
WORKOS_API_KEY=sk_test_...
WORKOS_CLIENT_ID=client_...
WORKOS_REDIRECT_URI=http://localhost:3000/api/auth/callback

# 4. Generate a session secret:
echo "SESSION_COOKIE_SECRET=$(openssl rand -base64 48)" >> .env

# 5. (one-time) Seed a local users row matching the email you'll log in with.
#    Until the new-user provisioning slice ships, the login flow will fail
#    with "no matching workspace" if the users row + a non-revoked
#    membership don't already exist.

# 6. pnpm dev → visit /login → click "Continue with WorkOS"
```

### Option B — AUTH_STUB (skip WorkOS)

```bash
# Convenient for exercising routes without provisioning WorkOS.
AUTH_STUB_USER_ID=00000000-0000-0000-0000-000000000001
AUTH_STUB_COMPANY_ID=00000000-0000-0000-0000-000000000002
NODE_ENV=development
```

Routes resolve to the fake owner-role session. Production refuses.

## Production

When `NODE_ENV=production`:
- AUTH_STUB env vars throw a 500 if set.
- Missing `WORKOS_API_KEY` / `WORKOS_CLIENT_ID` / `SESSION_COOKIE_SECRET` causes the auth routes to return 500.
- Cookie `secure` flag flips on automatically.

## Auto-provisioning (sprint-close addition)

When `WORKOS_AUTO_PROVISION=1` and the WorkOS callback can't find a matching local `users` row, the platform auto-creates:

1. A `users` row with `workos_user_id` + `email` + `name` from the WorkOS user
2. A solo `companies` row with `type='solo'` and `name='<display>'s workspace'`
3. The owner role for that company (the `0003_rbac_seed` trigger creates all four default roles automatically on company insert)
4. A `memberships` row linking user → company → owner role
5. An `audit_log` row of kind `auth.user.provisioned`

**Default**: `WORKOS_AUTO_PROVISION` defaults to `'1'` when `NODE_ENV !== "production"` and `'0'` in production. Lets local dev work without manually seeding rows; keeps production fail-closed until an onboarding flow takes over the new-user path.

**To disable in dev**: set `WORKOS_AUTO_PROVISION=0` explicitly.

**To enable in production**: set `WORKOS_AUTO_PROVISION=1` (only when onboarding has been validated).

## What this slice does NOT include

- **Email-domain workspace mapping.** Auto-provision creates a *solo* workspace per user. Mapping `*@acme.com` to an existing acme workspace is a separate config table that lands when the first design partner needs it.
- **Multi-workspace switching.** Picks the latest non-revoked membership; the user can't currently choose between workspaces. UI for that lands when a user has >1 active membership in the wild.
- **MFA enforcement.** WorkOS handles MFA at the Authkit step. The local `users.mfa_enrolled_at` column is written-but-not-read; A.1 P0 enforcement (must-MFA-for-admin-roles) lands later.
- **Service-token rotation.** That's a separate path, already lives in `lib/api/auth.ts:resolveServiceContext`. WorkOS doesn't touch it.

## Audit events

Every login + logout writes an `audit_log` row:

| Kind | When | Details |
|---|---|---|
| `auth.session.created` | After cookie write in /callback | `workosUserId`, `emailLength` (never the email itself) |
| `auth.session.destroyed` | At /logout | empty `details_json` |

PII discipline matches Privacy.md §1: never log raw email / cookie values / WorkOS auth codes in audit details.
