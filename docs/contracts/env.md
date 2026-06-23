# Environment Variables Contract

> Status: maintained
> Applies to: ClassroomPath runtime config, Docker deploys, and local staging deploys
> Last verified: 2026-04-13
> Source of truth: `docs/contracts/env.md`

Source files:

- `config/.env.example`
- `.env.local.example`
- `api/src/config.ts`
- `api/src/lib/gateway-config.ts`
- `config/deploy-targets.json`

Notes:

- `config/.env.example` is the tracked variable inventory, not the canonical source for live hostnames.
- Canonical deployed public URLs live in `config/deploy-targets.json`.
- `config/.env` and `.env.local` are local/server files and must never be committed.

## Shared Runtime File (`config/.env`)

This file is consumed by the ClassroomPath gateway and the upstream OpenPath API when running the
Dockerized stack.

### Core Required Variables For Deployed Environments

- `DATABASE_URL`: PostgreSQL connection string
- `PUBLIC_URL`: absolute external URL; production rejects localhost values
- `JWT_SECRET`: JWT signing secret
- `JWT_ACCESS_EXPIRY`: access token lifetime; ClassroomPath defaults to `24h`
- `JWT_REFRESH_EXPIRY`: refresh token lifetime; ClassroomPath defaults to `30d` for installed app sessions
- `CORS_ORIGINS`: comma-separated browser origins; deployed environments must include the `PUBLIC_URL` origin

Staging uses the HTTPS public origin from `config/deploy-targets.json`
(`https://staging.classroompath.example.invalid`). Production remains HTTPS-only. Hosted verifiers reach
staging through that public HTTPS origin, with a direct-IP fallback (resolving the public host to its
address) when public DNS or TLS is not yet warm.

### Gateway And Routing

- `CP_PORT`: gateway listen port, defaults to `3001`
- `OPENPATH_API_URL`: upstream OpenPath API target, defaults to `http://api:3000`
- `OPENPATH_ACCESS_TOKEN_COOKIE_NAME`: optional cookie-auth bridge for selected upstream REST routes
- `CP_JSON_LIMIT`: optional JSON body size limit for gateway requests

### Org Access And Billing Policy

- `CP_ALLOW_SELF_SERVICE_ORGS`: defaults to `false`
- `CP_ALLOW_ORG_DIRECTORY`: defaults to `false`
- `CP_PLATFORM_ADMIN_EMAILS`: required when self-service org creation is disabled
- `CP_CLIENT_CANARY_ADMIN_TOKEN`: optional runtime secret used only by the post-release client canary to approve canary-scoped manual billing requests
- `CP_BILLING_MODE`: `manual_only` or `stripe`, defaults to `manual_only`

If `CP_BILLING_MODE=stripe` and self-service org creation is disabled, all Stripe credentials and
price IDs become mandatory. If `CP_BILLING_MODE=manual_only`, deploy-time sync removes stale
`STRIPE_*` values before runtime validation.

### Email Delivery

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `CP_FAKE_EMAIL_DELIVERY`
- `CP_EMAIL_PREFLIGHT_MODE`

Runtime mode summary:

- `CP_FAKE_EMAIL_DELIVERY=true` forces mock delivery
- otherwise, real delivery requires both `RESEND_API_KEY` and `RESEND_FROM_EMAIL`
- deploy scripts set `CP_EMAIL_PREFLIGHT_MODE=required` only for email/auth/onboarding/billing risk or forced checks; `skip` records low-risk evidence without consuming Resend quota

### Stripe Billing

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_ANNUAL_PRICE_1_10`
- `STRIPE_ANNUAL_PRICE_11_25`
- `STRIPE_ANNUAL_PRICE_26_50`
- `STRIPE_ANNUAL_PRICE_51_100`
- `STRIPE_ONBOARDING_PRICE_1_25`
- `STRIPE_ONBOARDING_PRICE_26_100`
- `STRIPE_PILOT_PRICE`

### Shared OpenPath Variables Still Carried In The Same File

- `PORT`
- `GOOGLE_CLIENT_ID`
- `OPENPATH_LINUX_AGENT_VERSION`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_CONTACT`
- `LOG_LEVEL`
- `SCHEDULE_TIMEZONE`
- `RATE_LIMIT_MAX`
- `RATE_LIMIT_WINDOW_MINUTES`

These remain documented in `config/.env.example` because the same runtime file is shared with the
upstream OpenPath service.

### Gateway Rate-Limit And Serving Controls

- `CP_AUTH_RATE_LIMIT_MAX`
- `CP_AUTH_RATE_LIMIT_WINDOW_MS`
- `CP_AGENT_DELIVERY_RATE_LIMIT_MAX`
- `CP_AGENT_DELIVERY_RATE_LIMIT_WINDOW_MS`
- `CP_ONBOARDING_RATE_LIMIT_MAX`
- `CP_ONBOARDING_RATE_LIMIT_WINDOW_MS`
- `CP_GLOBAL_RATE_LIMIT_MAX`
- `CP_GLOBAL_RATE_LIMIT_WINDOW_MS`
- `CP_ENABLE_RATE_LIMIT_IN_TEST`
- `CP_SERVE_SPA`

## Local Staging Deploy File (`.env.local`)

Source of truth: `.env.local.example`.

Required:

- `STAGING_HOST`
- `STAGING_USER`
- `STAGING_SSH_KEY`

Optional:

- `STAGING_PORT`
- `STAGING_SMOKE_URL`
- `STAGING_IMAGE_MODE`: `release-candidate` or `source-build`
- `STAGING_GHCR_USERNAME`
- `STAGING_GHCR_TOKEN`
- `CP_BILLING_MODE`
- `CP_PLATFORM_ADMIN_EMAILS`

Rules:

- `.env.local` is for the local staging deploy workflow only.
- normal staging deploys should stay on `STAGING_IMAGE_MODE=release-candidate`
- use `source-build` only as an explicit recovery/debug exception
