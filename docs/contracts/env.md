# Environment Variables Contract

> Status: maintained
> Applies to: ClassroomPath Docker deployment + staging deploy script
> Last verified: 2026-03-05
> Source of truth: `docs/contracts/env.md`

## Runtime Environment (`config/.env`)

Source of truth: `config/.env.example`.

Required:

- `DATABASE_URL` (PostgreSQL connection string)
- `PUBLIC_URL` (external URL used to generate download links)
- `JWT_SECRET` (JWT signing secret)
- `CORS_ORIGINS` (comma-separated allowed SPA origins)

Gateway:

- `CP_PORT` (default `3001`)
- `OPENPATH_API_URL` (default `http://api:3000`)
- `OPENPATH_ACCESS_TOKEN_COOKIE_NAME` (optional)

Billing:

- `CP_PLATFORM_ADMIN_EMAILS` (comma-separated platform admin allowlist)
- `CP_BILLING_MODE` (`manual_only` or `stripe`)
- `STRIPE_SECRET_KEY` (`stripe` mode only)
- `STRIPE_WEBHOOK_SECRET` (`stripe` mode only)
- `STRIPE_ANNUAL_PRICE_1_10` (`stripe` mode only)
- `STRIPE_ANNUAL_PRICE_11_25` (`stripe` mode only)
- `STRIPE_ANNUAL_PRICE_26_50` (`stripe` mode only)
- `STRIPE_ANNUAL_PRICE_51_100` (`stripe` mode only)
- `STRIPE_ONBOARDING_PRICE_1_25` (`stripe` mode only)
- `STRIPE_ONBOARDING_PRICE_26_100` (`stripe` mode only)
- `STRIPE_PILOT_PRICE` (`stripe` mode only)

Notes:

- Do not commit `config/.env`.
- Both the gateway and the upstream OpenPath API read from the same env file in Docker.
- If `CP_ALLOW_SELF_SERVICE_ORGS=false`, runtime validation always requires `CP_PLATFORM_ADMIN_EMAILS` and a `CORS_ORIGINS` list that includes the `PUBLIC_URL` origin.
- If `CP_ALLOW_SELF_SERVICE_ORGS=false` and `CP_BILLING_MODE=stripe`, runtime validation also requires `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and every `STRIPE_*_PRICE_*`.
- If `CP_BILLING_MODE=manual_only`, deploy sync removes stale `STRIPE_*` entries from the target env file before validation.

## Local Staging Deploy (`.env.local`)

Source of truth: `.env.local.example`.

Required:

- `STAGING_HOST`
- `STAGING_USER`
- `STAGING_SSH_KEY`

Notes:

- Do not commit `.env.local`.
