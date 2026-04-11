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
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_ANNUAL_PRICE_1_10`
- `STRIPE_ANNUAL_PRICE_11_25`
- `STRIPE_ANNUAL_PRICE_26_50`
- `STRIPE_ANNUAL_PRICE_51_100`
- `STRIPE_ONBOARDING_PRICE_1_25`
- `STRIPE_ONBOARDING_PRICE_26_100`
- `STRIPE_PILOT_PRICE`

Notes:

- Do not commit `config/.env`.
- Both the gateway and the upstream OpenPath API read from the same env file in Docker.
- If `CP_ALLOW_SELF_SERVICE_ORGS=false`, runtime validation requires `CP_PLATFORM_ADMIN_EMAILS`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, every `STRIPE_*_PRICE_*`, and a `CORS_ORIGINS` list that includes the `PUBLIC_URL` origin.

## Local Staging Deploy (`.env.local`)

Source of truth: `.env.local.example`.

Required:

- `STAGING_HOST`
- `STAGING_USER`
- `STAGING_SSH_KEY`

Notes:

- Do not commit `.env.local`.
