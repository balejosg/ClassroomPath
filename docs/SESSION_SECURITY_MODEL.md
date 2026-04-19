# Session Security Model (ClassroomPath)

> Status: maintained
> Applies to: ClassroomPath gateway auth/session behavior
> Last verified: 2026-04-13
> Source of truth: `docs/SESSION_SECURITY_MODEL.md`

Source files:

- `api/src/lib/session-cookies.ts`
- `api/src/lib/gateway-hardening.ts`
- `api/src/lib/openpath-auth-client.ts`
- `api/src/trpc/routers/auth-session-procedures.ts`
- `api/src/trpc/routers/auth-registration-procedures.ts`
- `api/src/trpc/routers/client-telemetry.ts`
- `react-spa/src/lib/auth-storage.ts`
- `react-spa/src/views/auth-helpers.ts`

## Current Model

ClassroomPath uses cookie-backed sessions for sensitive auth material.

- access cookie: `cp_access_token`
- refresh cookie: `cp_refresh_token`
- session mode cookie: `cp_session_mode`
- session cookies are `HttpOnly`
- session cookies are `SameSite=Lax`
- session cookies become `Secure` in production
- `cp_access_token` is a persistent cookie, currently 24 hours
- `cp_refresh_token` is a persistent cookie, currently 24 hours for browser sessions and 30 days for installed app sessions
- `cp_session_mode` records whether the session was issued for browser (`web`) or installed app (`app`) refresh behavior
- logout always clears the local session cookies

The SPA keeps only a non-sensitive marker in `localStorage`:

- `openpath_access_token=cookie-session`
- user payload for UI state
- `requests_api_url` for request routing

Sensitive JWT values are not intentionally persisted in browser storage by the ClassroomPath SPA.

## CSRF And Browser Boundary

Cookie-authenticated mutation requests are protected by origin checks:

- applies to `POST`, `PATCH`, `PUT`, and `DELETE`
- bearer-token requests are excluded from this CSRF check
- `Origin` or `Referer` must match an allowed origin or the current request origin
- invalid cookie-authenticated origins are rejected with `403`

Gateway hardening also applies:

- Content Security Policy
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- strict referrer policy
- rate limiting for auth, onboarding, and global traffic buckets

## Login, Refresh, And Logout

- `/cp/trpc/auth.login`, `/cp/trpc/auth.refresh`, and Google auth session mutations forward to upstream OpenPath and store session cookies through the gateway
- the SPA uses `/cp/trpc/auth.refresh` to recover from an expired access token while the refresh cookie remains valid
- installed app sessions pass `clientMode=app` so refresh persistence remains 30 days
- `/cp/trpc/auth.logout` always clears local cookies
- if upstream logout revocation fails, the gateway returns `SERVICE_UNAVAILABLE` instead of silently claiming success

## Verification And Recovery Links

Email verification links are generated server-side and delivered through the email-delivery flow.

Current behavior:

- the backend always returns a `verificationUrl` in the delivery payload
- the frontend only exposes the manual verification link when email delivery could not be confirmed or when running on localhost-style development hosts

That means the current implementation reduces casual exposure of secret-bearing links in the normal path,
but it does not claim that verification URLs are never exposed under any condition.

## Frontend Telemetry

Frontend error events are sent to a real backend telemetry sink via `clientTelemetry.report`.
The payload includes:

- route
- action
- user role
- structured error details
- timestamp

## Residual Constraints

- cookie sessions still depend on correct `CORS_ORIGINS` and `PUBLIC_URL` configuration
- application-level rollback does not imply rollback of email or auth side effects already triggered
- the current UI still conditionally exposes manual verification links in delivery-failure or localhost scenarios
