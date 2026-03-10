# Session Security Model (ClassroomPath)

## Overview

ClassroomPath now uses a mixed model:

- Sensitive tokens are set as HttpOnly cookies by `/cp/trpc/auth.*` and onboarding token refresh.
- Frontend `localStorage` keeps only a non-sensitive auth marker (`openpath_access_token=cookie-session`).

This removes direct token persistence from `localStorage` while preserving current SPA compatibility.

## XSS and CSRF Notes

- **XSS:** JWTs are no longer read from `localStorage`, reducing token exfiltration risk from storage reads.
- **CSRF:** Cookies are configured with `SameSite=Lax` and credentialed CORS remains origin-restricted.

## Logout Behavior

- SPA logout clears local marker/user data, removing authenticated UI state.
- Launch policy requires upstream revocation failures to be explicit and observable; silent success is not acceptable.
- When upstream revocation fails, ClassroomPath now clears local session cookies but returns an explicit degraded `SERVICE_UNAVAILABLE` logout result instead of reporting success.

## Launch Decisions That Affect Session Flows

- Invitation and password-reset flows must keep secret-bearing links server-side even when email delivery fails.
- Frontend auth and approval failures must be sent to a real backend telemetry sink before launch.
- Privileged tenant actions must create durable audit events before launch.
