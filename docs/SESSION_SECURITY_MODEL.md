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
- Server-side token invalidation remains tied to OpenPath logout flows and should be expanded in a follow-up hardening pass.
