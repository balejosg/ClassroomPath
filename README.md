# ClassroomPath

Multi-tenant digital access management for educational institutions.

Built on [OpenPath](https://github.com/balejosg/openpath) (OSS), ClassroomPath adds the
organizational workflows, delegated administration, and production-ready operations that schools need
to run intentional internet access policies at institution scale with a more transparent technical
foundation.

> WARNING: ClassroomPath is distributed under Business Source License 1.1 (`BUSL-1.1`).
> Use is restricted by the terms in `LICENSE` (including non-production limits before the change date).
> Deploy and operate this software only in systems and networks where you have explicit authorization.

## Why ClassroomPath?

Schools do not just need blocking rules. They need an operating model that can:

- keep institution-managed devices aligned with teaching goals,
- separate organizations, admins, and data boundaries,
- handle invites, approvals, and recovery flows without ad-hoc work,
- give IT teams and school leaders a workflow they can explain and sustain,
- combine operational control with stronger transparency signals for institutions.

ClassroomPath is the SaaS and operational wrapper around OpenPath for that job. It helps educational
institutions turn digital policy into day-to-day operations across organizations, classrooms, and
support flows while reducing digital noise on institution-managed devices.

## OpenPath vs. ClassroomPath

| Product           | Role                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenPath**      | OSS core for default-deny internet access control, endpoint enforcement, and dashboard-driven approval workflows                                   |
| **ClassroomPath** | Multi-tenant distribution for educational institutions that adds onboarding, delegated administration, and deployment workflows on top of OpenPath |

## What institutions get

- A clearer way to apply digital access policy on institution-managed devices.
- Separate organizations with independent users, roles, and approval queues.
- Lower operational overhead for onboarding, invitations, and account recovery.
- A production path that wraps OpenPath in a deployable SaaS workflow.
- An open-source core in OpenPath for stronger transparency and lower vendor opacity.
- A production deployment at `https://classroompath.eu`, hosted on EU servers.

## Transparency and trust

- **Open-source core**: ClassroomPath is built on OpenPath, the OSS core of the stack.
- **Auditable operations**: policy changes and approval workflows are designed to be explainable and traceable.
- **EU-hosted production**: ClassroomPath is hosted on EU servers and served from `https://classroompath.eu`.

## Live URLs

Machine-readable source of truth: `config/deploy-targets.json`

| Environment    | URL                                       | Deploy Trigger           |
| -------------- | ----------------------------------------- | ------------------------ |
| **Production** | https://classroompath.eu                  | Git tag `v*`             |
| **Staging**    | https://classroompath-staging.duckdns.org | `npm run deploy:staging` |

## Docs

- `docs/INDEX.md`

## Architecture

```
                    Internet
                       │
         ┌─────────────┴─────────────┐
         ▼                           ▼
  classroompath.eu         classroompath-staging.duckdns.org
   (Oracle production)              (local staging)
         │                           │
         ▼                           ▼
┌──────────────────────┐     ┌──────────────────────┐
│ Nginx Proxy Manager  │     │ Staging app host     │
│ + Docker Compose     │     │ + Docker Compose     │
└──────────┬───────────┘     └──────────┬───────────┘
           │                            │
           ▼                            ▼
   PostgreSQL on host            PostgreSQL on staging
```

### API Routes

```
/cp/*      → ClassroomPath Gateway (port 3001) - multi-tenancy
/api/*     → Gateway (proxies to OpenPath API)
/trpc/*    → Gateway (proxies to OpenPath tRPC)
/w/*       → Gateway (proxies tokenized whitelist downloads)
/*         → SPA (static files)
```

## Multi-tenancy

ClassroomPath adds organization-based multi-tenancy on top of OpenPath so multiple institutions or
organizational units can operate independently while sharing one managed deployment. This keeps access
boundaries clear, supports delegated administration, and reduces manual coordination.

### User Flow

1. User signs in with email/password or Google (Google is optional and only works for existing/preapproved accounts)
2. ClassroomPath checks for organization membership
3. If no membership:
   - Option A: Create new organization (becomes admin)
   - Option B: Wait for invitation
4. Once in an organization, user sees the OpenPath dashboard

### Database Tables

ClassroomPath adds these tables (prefixed with `cp_`):

| Table              | Purpose                                   |
| ------------------ | ----------------------------------------- |
| `cp_organizations` | Organization records                      |
| `cp_memberships`   | User-organization associations with roles |
| `cp_user_status`   | Tracks users waiting for invitations      |

### Gateway API Endpoints

Gateway API runs on port 3001 with prefix `/cp/`:

| Endpoint                                 | Method | Description                      |
| ---------------------------------------- | ------ | -------------------------------- |
| `/cp/health`                             | GET    | Health check                     |
| `/cp/trpc/onboarding.status`             | GET    | Get user's org membership status |
| `/cp/trpc/onboarding.createOrganization` | POST   | Create new org                   |
| `/cp/trpc/onboarding.waitForInvitation`  | POST   | Set waiting status               |
| `/cp/trpc/onboarding.cancelWaiting`      | POST   | Clear waiting status             |

## Operational outcomes

- Consistent digital access policy across organizations and classrooms.
- Clear user lifecycle flows for self-service onboarding, invitations, and waiting-room approvals.
- Delegated administration without sharing a single global operator account.
- Safer support workflows for recovery, revocation, and tenant-scoped user management.
- A reproducible promotion path from local verification to staging and production.

## Quick Start (Development)

### 1. Clone with submodules

```bash
git clone --recurse-submodules https://github.com/balejosg/ClassroomPath.git
cd ClassroomPath
```

### 2. Install dependencies

```bash
npm run install:all
```

### 3. Configure environment

```bash
cp config/.env.example config/.env
# Edit config/.env with your values
```

### 4. Build and run

```bash
# Recommended: run the full stack via Docker Compose
cd docker
docker compose up -d --build
```

## Verification

```bash
# Default verification lane (faster): excludes @slow-network and @repro E2E suites
npm run verify:full

# Full stress lane: includes all E2E suites
VERIFY_ALL=1 npm run verify:full

# Playwright-only fast lane (without full pipeline)
npm run test:e2e:verify-fast

# Mobile/responsive tagged lane
npm run test:e2e:mobile

# Optional for low-resource machines
PLAYWRIGHT_WORKERS=2 npm run verify:full
```

## Release-Ready Definition

- Local `verify:full` is green before push.
- `npm run deploy:staging` exits `0` and reports `PASS` or `PASS_WITH_FALLBACK`.
- `npm run test:release-gate:staging` is green before tagging.
- The production tag workflow finishes green and publishes `release-evidence-<tag>`.

If staging reports `PASS_WITH_FALLBACK`, the smoke run used direct-IP fallback and should be rerun in strict public-URL mode before the production tag whenever possible.

## Deployment

Canonical runbooks:

- Staging: `docs/runbooks/deploy-staging.md`
- Production: `docs/runbooks/deploy-production.md`

### Staging (Local SSH)

Staging is deployed from a developer machine via `npm run deploy:staging` (SSH to the staging host). It always deploys `origin/main`.

```bash
git push origin main
npm run deploy:staging
```

Staging deploy configuration is local-only via `.env.local` (see `.env.local.example`).
Canonical public targets stay in `config/deploy-targets.json`.

Before promoting to production, staging should pass the automated release gate:

```bash
npm run test:release-gate:staging
```

### Production (GitHub Actions)

Production deploys are triggered by git tags `v*` only. The workflow runs a staging release gate first and only then rolls out to `https://classroompath.eu`.
Each successful or failed tagged release now publishes a `release-evidence-<tag>` artifact plus a job summary showing the exact SHA, OpenPath SHA, immutable images, and deploy/smoke results.

Required GitHub Secrets (production only):

| Secret           | Description                |
| ---------------- | -------------------------- |
| `DEPLOY_HOST`    | Production server hostname |
| `DEPLOY_PORT`    | SSH port                   |
| `DEPLOY_USER`    | SSH username               |
| `DEPLOY_SSH_KEY` | Private SSH key            |

```bash
git tag v1.0.1
git push origin v1.0.1
```

Do not use manual SSH deploys as the normal production path; use the production runbook and tags.

## Server Management

### Docker Commands

```bash
# View logs
docker logs -f classroompath-api
docker logs -f classroompath-gateway

# Restart app
cd docker && docker compose down && docker compose up -d

# Rebuild
cd docker && docker compose build --no-cache && docker compose up -d
```

### Nginx Proxy Manager

Used for SSL termination and reverse proxy with automatic Let's Encrypt certificates.

## Updating OpenPath

```bash
npm run submodule:update
git add upstream/openpath
git commit -m "chore: update openpath submodule"
git push

# Deploy the updated origin/main to staging
npm run deploy:staging
```

## License

Business Source License 1.1 (`BUSL-1.1`).

See `LICENSE` for full terms, including:

- non-production-only use by default before the Change Date,
- conditions for production/commercial usage,
- Additional Use Grant: `None` (no production grant),
- Change Date: `2031-02-18`,
- Change License: `AGPL-3.0-or-later`.
