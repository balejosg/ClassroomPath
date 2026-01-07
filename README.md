# ClassroomPath

DNS whitelist management SaaS for educational institutions.

Built on [OpenPath](https://github.com/balejosg/openpath) (OSS).

## Live URLs

| Environment | URL | Deploy Trigger |
|-------------|-----|----------------|
| **Production** | https://classroompath.duckdns.org | Git tag `v*` |
| **Staging** | https://classroompath-staging.duckdns.org | Push to `main` |

## Architecture

```
                    Internet
                       │
                       ▼
              ┌────────────────┐
              │   DuckDNS      │
              │ *.duckdns.org  │
              └───────┬────────┘
                      │
         ┌────────────┴────────────┐
         ▼                         ▼
   Production                  Staging
         │                         │
         └──────────┬──────────────┘
                    ▼
         ┌─────────────────────┐
         │  Nginx Proxy Manager │
         │  SSL termination     │
         └──────────┬───────────┘
                    │
      ┌─────────────┴─────────────┐
      ▼                           ▼
┌───────────────┐         ┌───────────────┐
│ App Prod      │         │ App Staging   │
│ Docker        │         │ Docker        │
└──────┬────────┘         └──────┬────────┘
       │                         │
       ▼                         ▼
┌───────────────┐         ┌───────────────┐
│ PostgreSQL    │         │ PostgreSQL    │
│ Production    │         │ Staging       │
└───────────────┘         └───────────────┘
```

### API Routes

```
/cp/*      → ClassroomPath Gateway (port 3001) - multi-tenancy
/api/*     → OpenPath API (port 3000)
/trpc/*    → OpenPath tRPC endpoints
/w/*       → Tokenized whitelist downloads
/*         → SPA (static files)
```

## Multi-tenancy

ClassroomPath adds organization-based multi-tenancy on top of OpenPath:

### User Flow

1. User logs in with Google (via OpenPath auth)
2. ClassroomPath checks for organization membership
3. If no membership:
   - Option A: Create new organization (becomes admin)
   - Option B: Wait for invitation
4. Once in an organization, user sees the OpenPath dashboard

### Database Tables

ClassroomPath adds these tables (prefixed with `cp_`):

| Table | Purpose |
|-------|---------|
| `cp_organizations` | Organization records |
| `cp_memberships` | User-organization associations with roles |
| `cp_user_status` | Tracks users waiting for invitations |

### Gateway API Endpoints

Gateway API runs on port 3001 with prefix `/cp/`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/cp/health` | GET | Health check |
| `/cp/trpc/onboarding.status` | GET | Get user's org membership status |
| `/cp/trpc/onboarding.createOrganization` | POST | Create new org |
| `/cp/trpc/onboarding.waitForInvitation` | POST | Set waiting status |
| `/cp/trpc/onboarding.cancelWaiting` | POST | Clear waiting status |

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
npm run build:api
npm run start
```

## Deployment

### Automatic (CI/CD)

| Trigger | Target | Action |
|---------|--------|--------|
| Push to `main` | Staging | Auto-deploy |
| Tag `v*` | Production | Auto-deploy |
| `workflow_dispatch` | Choice | Manual trigger |

### GitHub Secrets Required

#### Production
| Secret | Description |
|--------|-------------|
| `DEPLOY_HOST` | Production server hostname |
| `DEPLOY_PORT` | SSH port |
| `DEPLOY_USER` | SSH username |
| `DEPLOY_SSH_KEY` | Private SSH key |

#### Staging
| Secret | Description |
|--------|-------------|
| `STAGING_DEPLOY_HOST` | Staging server hostname |
| `STAGING_DEPLOY_PORT` | SSH port |
| `STAGING_DEPLOY_USER` | SSH username |
| `STAGING_DEPLOY_SSH_KEY` | Private SSH key |

### Manual Deployment

```bash
# Deploy to staging
git push origin main

# Deploy to production
git tag v1.0.1
git push origin v1.0.1
```

## Server Management

### Docker Commands

```bash
# View logs
docker logs -f classroompath-api

# Restart app
docker compose down && docker compose up -d

# Rebuild
docker compose build --no-cache && docker compose up -d
```

### Nginx Proxy Manager

Used for SSL termination and reverse proxy with automatic Let's Encrypt certificates.

## Updating OpenPath

```bash
npm run submodule:update
git add upstream/openpath
git commit -m "chore: update openpath submodule"
git push
```

## License

AGPL-3.0-or-later
