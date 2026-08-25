# Environment Variables Contract

> Status: maintained
> Applies to: ClassroomPath runtime config, Docker deploys, and local staging deploys
> Last verified: 2026-08-25
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
- `OPENPATH_URL`: canonical upstream URL embedded in Windows offline-installer payloads
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

Read by `api/src/lib/windows-offline-installer-config.ts` (`loadWindowsOfflineInstallerConfig`).
The template source is the exact public OpenPath release identified by
`CP_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG`; provisioning downloads only the
two release assets, verifies their sidecar and bytes, then publishes them
before the gateway starts. Runtime never resolves a branch, uses `latest`, or
downloads during an HTTP request.

Required:

- `CP_OFFLINE_INSTALLER_TEMPLATE_VERSION`: functional OpenPath release version, for example `4.1.0`
- `CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT`: full 40-character lowercase OpenPath source commit; never inferred from version
- `CP_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG`: exact OpenPath release tag, normally `scripts-v<version>-<short-sha>`; provisioning verifies version and commit prefix coherence
- `CP_OFFLINE_INSTALLER_TEMPLATE_SHA256`: lowercase 64-character SHA-256 of `OpenPath-Windows-Setup-Template.exe`
- `CP_OFFLINE_INSTALLER_TEMPLATE_DIR`: container template root, mounted read-only at `/app/var/windows-offline-installer/templates`
- `CP_OFFLINE_INSTALLER_ARTIFACTS_DIR`: container artifact root, writable and separate from the template root at `/app/var/windows-offline-installer/artifacts`
- `CP_OFFLINE_INSTALLER_TEMPLATE_HOST_DIR`: deploy-side host directory populated by provisioning and bind-mounted read-only into the gateway; the example path is relative to `docker/docker-compose.yml`
- `OPENPATH_URL`: upstream OpenPath base URL used to build embedded enrollment endpoints (also carried for other features)

Optional (defaults shown):

- `CP_OFFLINE_INSTALLER_TOKEN_TTL_HOURS`: `24` -- enrollment-token TTL requested from OpenPath when generating an offline installer
- `CP_OFFLINE_INSTALLER_DOWNLOAD_TTL_MINUTES`: `10` -- lifetime of a single-use download reference
- `CP_OFFLINE_INSTALLER_DOWNLOAD_MAX_ATTEMPTS`: `3` -- download attempts allowed per reference
- `CP_OFFLINE_INSTALLER_TEMPLATE_CACHE_DIR`: deprecated compatibility fallback only; when both new directory variables are absent it maps to `templateDir` and `templateDir/artifacts`. New Docker deployments must not use it.

The final template layout is `<templateDir>/<version>/<full-commit>/` with the
EXE and `.sha256` sidecar. Customized EXEs and staging files live only under
`artifactsDir`, which is a dedicated Docker named volume and is not served by
the SPA static root. `scripts/provision-windows-offline-installer-template.mjs
--verify-only` checks the existing template without network or mutation.

`/cp/ready` treats this installer capability as mandatory. It checks config,
template/sidecar hashes, and effective artifact-directory writeability locally;
it never provisions or calls GitHub. The dedicated
`scripts/windows-offline-installer-canary.mjs` can be run with a canary teacher
session cookie or access token; its evidence records status, filename, size,
and hashes but never the download URL, raw reference, authorization, JWT, or
enrollment token.

The release-candidate manifest carries the four pinned template values. The
deployment preflight exports those values before running provisioning, so a
host `.env` cannot silently select a different OpenPath release. For an
authorized post-deploy evidence run, use
`npm run canary:windows-offline-installer` with
`WINDOWS_OFFLINE_INSTALLER_CANARY_BASE_URL`,
`WINDOWS_OFFLINE_INSTALLER_CANARY_CLASSROOM_ID`, and either
`WINDOWS_OFFLINE_INSTALLER_CANARY_ACCESS_TOKEN` or
`WINDOWS_OFFLINE_INSTALLER_CANARY_COOKIE`. This command is prepared for gates
but is not run by the local implementation checks.

The preflight resolves `CP_OFFLINE_INSTALLER_TEMPLATE_HOST_DIR` from the same
Compose working directory used by `docker compose`; when no override exists,
both use `../var/windows-offline-installer/templates`. The gateway receives the
version, full commit, and SHA explicitly from the release environment, while
the release tag is used only by provisioning. Readiness performs a full byte
hash on the first healthy identity and repeats it only when the template or
sidecar stat identity changes; it still fails closed and never provisions.
The current release-state snapshot stores all four pin fields so rollback and
promotion evidence cannot combine an old runtime pin with a new template.

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
