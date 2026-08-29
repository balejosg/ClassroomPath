# Environment Variables Contract

> Status: maintained
> Applies to: ClassroomPath runtime config, Docker deploys, and local staging deploys
> Last verified: 2026-08-29
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

### Windows Offline Installer

ClassroomPath is a consumer of the canonical OpenPath capability. It does not
read OpenPath files or databases, hash templates, personalize artifacts, mint
download references, or stream installer bytes. The gateway calls OpenPath over
the documented HTTP/tRPC boundary and proxies the canonical download route.

The OpenPath API/provisioner owns these runtime variables:

- `OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION`: pinned OpenPath template version
- `OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT`: full 40-character OpenPath commit
- `OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG`: exact OpenPath release tag
- `OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256`: expected template SHA-256
- `OPENPATH_WINDOWS_OFFLINE_TEMPLATE_DIR`: `/app/var/windows-offline-installer/templates`
- `OPENPATH_WINDOWS_OFFLINE_ARTIFACTS_DIR`: `/app/var/windows-offline-installer/artifacts`
- `OPENPATH_WINDOWS_OFFLINE_TOKEN_TTL_HOURS`: enrollment credential TTL
- `OPENPATH_WINDOWS_OFFLINE_DOWNLOAD_TTL_MINUTES`: single-use download-reference TTL
- `OPENPATH_WINDOWS_OFFLINE_DOWNLOAD_MAX_ATTEMPTS`: maximum download attempts
- `OPENPATH_WINDOWS_OFFLINE_ARTIFACT_RETENTION_HOURS`: OpenPath artifact retention
- `OPENPATH_GITHUB_REPO`: OpenPath release source used by its provisioner

The release manifest carries the four neutral
`windows_offline_installer_template_*` pin fields. Deployment maps them to the
OpenPath runtime variables and stores the same values in release state, so a
rollback restores a coherent ClassroomPath/OpenPath pair. The one-shot
`windows-offline-installer-provision` Compose service and OpenPath API own the
template/artifact volumes; the ClassroomPath gateway has neither mount.

`/cp/ready` is ready for this feature only when the ClassroomPath gateway
dependencies and the OpenPath `healthcheck.ready` capability signal both pass.
The wrapper canary calls the ClassroomPath session/policy boundary, then the
canonical OpenPath generate/download flow. Its safe evidence may contain
status, attachment, length, filename, and SHA-256 results, but never a raw
reference, download URL containing a reference, token, JWT, cookie, or
authorization header.

The forward migration that retires the historical ClassroomPath download-ref
table is intentionally deferred by normal migration runs. Apply it only after
the deployed canonical path and legacy drain are evidenced, using the explicit
`--confirm-windows-offline-installer-legacy-retirement` migration command; this
confirmation is not a runtime feature switch. The old personalized-artifact
volume is retired separately, and only with the same explicit confirmation,
through the manual one-shot
`ops:retire-windows-offline-installer-legacy-storage` command documented in
[`docs/runbooks/windows-offline-installer-legacy-retirement.md`](../runbooks/windows-offline-installer-legacy-retirement.md).
That helper resolves the effective Compose volume through both Compose identity
labels and an exact name/driver check; it never selects the canonical OpenPath
`windows_offline_installer_artifacts` volume and is never invoked by a normal
deploy.

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
