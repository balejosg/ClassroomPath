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

Notes:

- Do not commit `config/.env`.
- Both the gateway and the upstream OpenPath API read from the same env file in Docker.

## Local Staging Deploy (`.env.local`)

Source of truth: `.env.local.example`.

Required:

- `STAGING_HOST`
- `STAGING_USER`
- `STAGING_SSH_KEY`

Notes:

- Do not commit `.env.local`.
