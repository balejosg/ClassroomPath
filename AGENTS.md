# ClassroomPath AGENTS.md

SaaS distribution wrapper for OpenPath. Provides Docker deployment, multi-environment support, and production infrastructure.

Docs index: `docs/INDEX.md`
Workspace routing manifest: `../agent-manifest.json`

## 🚨 MANDATORY: LLM Agent Deployment Protocol

**After pushing changes to ClassroomPath, you MUST run local staging deployment.**

This is NON-NEGOTIABLE. Do NOT rely on GitHub Actions for staging feedback.

## ⛔ Trunk-Based Workflow (CRITICAL)

**LLM work in ClassroomPath is trunk-based: `main` is the only allowed working branch.**

- ❌ Do not create feature branches, integration branches, or PR branches
- ❌ Do not commit from detached HEAD
- ❌ Do not push to any remote branch other than `main`
- ✅ If you need a parallel clean checkout, use a detached worktree based on `main`
- ✅ If you discover a non-`main` branch, preserve any needed work with a stash/patch, switch back to `main`, and continue there

**Technical enforcement:** `.husky/pre-commit` and `.husky/pre-push` call `scripts/require-main-branch.sh`.

### Required Workflow

```bash
# 1. Commit and push your changes
git add .
git commit -m "your commit message"
git push origin main

# 2. IMMEDIATELY run local staging deploy + staging verification
npm run deploy:staging

# 3. Verify exit code and staging evidence
#    Exit 0 = SUCCESS (deployment verified, smoke/release gates passed)
#    Exit 1 = FAILURE (fix the issue before continuing)

# 4. Only then promote to production
git tag v1.2.3
git push origin v1.2.3
```

### Why This Is Mandatory

| GitHub Actions                            | Local Deploy                |
| ----------------------------------------- | --------------------------- |
| 3-8 minutes                               | **90 seconds**              |
| Unreliable smoke tests (network timeouts) | **Reliable** (runs locally) |
| Must poll GH API for status               | **Direct exit code**        |
| DNS resolution issues                     | **Direct SSH**              |

### What The Script Does

1. Verifies git state (warns if unpushed changes)
2. SSHs to CT 114 (staging container)
3. Pulls latest from origin/main
4. Runs database migrations
5. Rebuilds and restarts Docker containers
6. Runs health checks (gateway + API)
7. **Runs smoke + release-gate verification against staging and records reusable evidence**
8. Returns exit code 0 (success) or 1 (failure)

### If Smoke Tests Fail

```bash
# Debug commands
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "docker logs classroompath-gateway --tail 50"
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "docker logs classroompath-api --tail 50"
curl -v https://classroompath-staging.duckdns.org/health
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "cat /opt/classroompath/release-state/staging-verification.env"
```

---

## Architecture

```
ClassroomPath/
├── upstream/openpath/    ← Git submodule (DO NOT edit directly)
├── docker/
│   ├── docker-compose.yml
│   ├── Dockerfile.api
│   └── spa-nginx.conf
├── config/
│   ├── .env.example
│   └── nginx.conf
└── .github/workflows/
    ├── deploy.yml         ← Main deployment
    └── sync-openpath.yml  ← Auto-sync from OpenPath
```

## Key Difference from OpenPath

### Wrapper Boundary (Read Before SPA Changes)

For ClassroomPath wrapper work, read these first:

- `../agent-manifest.json`
- `react-spa/vite.config.ts`
- `react-spa/src/ClassroomPathApp.tsx`
- `react-spa/src/ClassroomPathShell.tsx`
- `../OpenPath/docs/adr/0010-public-spa-extension-surface.md`

Default rule:

- consume OpenPath SPA features through the public entrypoints only (`@openpath/public-ui`, `@openpath/public-shell`, `@openpath/public-auth`, `@openpath/public-google`, `@openpath/openpath.css`)
- do not deep-import upstream OpenPath internals during ordinary ClassroomPath wrapper work

### ⛔ Architectural Constraint

**OpenPath is agnostic of ClassroomPath.** The dependency is unidirectional:

```
ClassroomPath ──depends on──▶ OpenPath
     │                           │
     │                           ├── Has NO knowledge of ClassroomPath
     │                           ├── Works standalone
     │                           └── Is the OSS core
     │
     ├── Consumes OpenPath as submodule
     ├── Adds SaaS-specific deployment
     └── Can be replaced by other distributions
```

**When adding features:**

- Generic features → Add to OpenPath (benefits all distributions)
- SaaS-specific features → Add to ClassroomPath only
- Never modify OpenPath to "know about" ClassroomPath

### Comparison Table

| Aspect    | OpenPath                | ClassroomPath                   |
| --------- | ----------------------- | ------------------------------- |
| Purpose   | Core library/agent code | Production deployment           |
| Ownership | OSS development         | SaaS operations                 |
| Docker    | Dev-only compose files  | Production-ready images         |
| Secrets   | Examples only           | Real credentials (never commit) |

## Deployment

Canonical production deployment instructions live in `docs/runbooks/deploy-production.md`.
Workspace-level routing and source-of-truth map live in `../agent-manifest.json`.

### Environments

| Environment    | URL                                         | Trigger                  | Method                                    |
| -------------- | ------------------------------------------- | ------------------------ | ----------------------------------------- |
| **Staging**    | `https://classroompath-staging.duckdns.org` | `npm run deploy:staging` | Local script (SSH)                        |
| **Production** | `https://classroompath.eu`                  | Tag `v*`                 | GitHub Actions after staging release gate |

### ⚠️ CRITICAL: Identifying Environments

**LLM Agents: Use these URLs to verify which environment you're working with:**

| Check              | Staging                                               | Production                                                      |
| ------------------ | ----------------------------------------------------- | --------------------------------------------------------------- |
| **URL**            | `classroompath-staging.duckdns.org`                   | `classroompath.eu`                                              |
| **Gateway Health** | `https://classroompath-staging.duckdns.org/cp/health` | `https://classroompath.eu/cp/health`                            |
| **Host**           | CT 114 (`classroompath-app-staging`)                  | Oracle VM (`classroompath.eu`, app at `/opt/classroompath/app`) |
| **Database**       | CT 113 PostgreSQL (`classroompath_staging`)           | PostgreSQL on production host (`classroompath`)                 |
| **Database Name**  | `classroompath_staging`                               | `classroompath`                                                 |
| **Deploy Trigger** | `npm run deploy:staging`                              | Git tag starting with `v` -> staging release gate -> deploy     |

### Production Policy

- Production is tag-only. Do not use `workflow_dispatch` or ad-hoc SSH code deploys as the canonical path.
- Required sequence: push `main` -> `npm run deploy:staging` -> verify staging evidence -> tag `v*` -> monitor `Deploy`.
- If server drift is discovered, backport the change into git and reconcile production with a new tag.

**When debugging issues:**

1. Always confirm which environment is affected by checking the URL
2. Staging issues → investigate CT 113/114
3. Production issues → investigate the Oracle host via `docs/runbooks/deploy-production.md`
4. Never apply staging fixes to production without explicit user confirmation

### Manual Sync + Promote

```bash
# Via GitHub Actions (recommended)
gh workflow run sync-openpath.yml

# Local submodule update
npm run submodule:update
git add upstream/openpath
git commit -m "chore: update openpath submodule"
git push origin main

# Mandatory local staging verification
npm run deploy:staging

# Verify reusable staging evidence before tagging
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 \
  "cat /opt/classroompath/release-state/staging-verification.env"

# Production deploy is triggered by tags v* and first consumes the staging release gate evidence
# git tag v1.2.3 && git push origin v1.2.3
```

### Staging Deployment

**Staging is deployed via local script only.** GitHub Actions does NOT deploy to staging.

#### One-Time Setup

```bash
# 1. Copy environment template
cp .env.local.example .env.local

# 2. Edit .env.local with your values:
#    STAGING_HOST=192.168.1.114
#    STAGING_USER=deploy
#    STAGING_SSH_KEY=~/.ssh/classroompath_staging

# 3. Generate SSH key (if not exists)
ssh-keygen -t ed25519 -C "agent-staging-deploy" -f ~/.ssh/classroompath_staging

# 4. Add public key to CT 114
ssh root@192.168.1.150 "pct exec 114 -- sh -c 'cat >> /home/deploy/.ssh/authorized_keys'" < ~/.ssh/classroompath_staging.pub
```

#### Usage

```bash
# After making changes, commit and push
git add .
git commit -m "fix: your change"
git push origin main

# Deploy to staging (30-90 seconds)
npm run deploy:staging

# Exit code 0 = success, 1 = failure (check stdout)
```

#### Staging vs Production Deployment

| Scenario             | Command / Action                                                                       |
| -------------------- | -------------------------------------------------------------------------------------- |
| Deploy to staging    | `npm run deploy:staging`                                                               |
| Deploy to production | `git tag v1.x.x && git push origin v1.x.x` (staging release gate -> GH Actions deploy) |
| Debug staging issues | SSH to CT 114                                                                          |

#### Troubleshooting

```bash
# Test SSH connectivity
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "echo OK"

# Check container logs
ssh deploy@192.168.1.114 "docker logs classroompath-gateway --tail 30"
ssh deploy@192.168.1.114 "docker logs classroompath-api --tail 30"

# Manual health check
curl -sf http://192.168.1.114:3001/cp/health
curl -sf http://192.168.1.114:3000/health
```

## Docker Services

| Service   | Container               | Ports (host)    | Purpose                                      |
| --------- | ----------------------- | --------------- | -------------------------------------------- |
| `gateway` | `classroompath-gateway` | `3000`, `3001`  | Public entrypoint (`/cp`, `/api`, `/trpc`)   |
| `api`     | `classroompath-api`     | (internal only) | Upstream OpenPath API (reachable by gateway) |
| `spa`     | `classroompath-spa`     | `8081`          | Static SPA serving                           |

Build: `cd docker && docker compose build --no-cache`
Run: `cd docker && docker compose up -d`

## Configuration

Environment variables in `config/.env` (copy from `.env.example`):

| Variable           | Required | Notes                                                   |
| ------------------ | -------- | ------------------------------------------------------- |
| `DATABASE_URL`     | Yes      | PostgreSQL connection (shared by gateway + OpenPath)    |
| `PUBLIC_URL`       | Yes      | Used to generate external download URLs                 |
| `JWT_SECRET`       | Yes      | JWT signing secret (OpenPath)                           |
| `CORS_ORIGINS`     | Yes      | Allowed SPA origins                                     |
| `CP_PORT`          | Yes      | Gateway port (default `3001`)                           |
| `OPENPATH_API_URL` | Yes      | Gateway -> OpenPath API URL (default `http://api:3000`) |

See `config/.env.example` for the canonical list.

## Testing

| Test Type        | Command                   | Purpose                                |
| ---------------- | ------------------------- | -------------------------------------- |
| OpenPath tests   | `npm test`                | Delegates to OpenPath (business logic) |
| Deployment tests | `npm run test:deployment` | SaaS-specific infrastructure           |

Deployment tests verify Docker, nginx, and env configurations only. They do NOT test OpenPath logic.

### E2E Verify Modes

`npm run verify:full` runs Playwright in the default fast lane: excludes `@slow-network` and `@repro`.

```bash
# Full stress lane (includes slow-network and repro suites)
VERIFY_ALL=1 npm run verify:full

# Explicit fast lane (Playwright only, skips full verify pipeline)
npm run test:e2e:verify-fast

# Mobile/responsive tagged lane
npm run test:e2e:mobile

# Optional override for low-resource machines
PLAYWRIGHT_WORKERS=2 npm run verify:full
```

## Secrets (GitHub Actions)

| Secret     | Environment | Purpose                  |
| ---------- | ----------- | ------------------------ |
| `DEPLOY_*` | Production  | SSH access to production |

> **Note:** Staging deploys still run locally via `npm run deploy:staging`, but GitHub Actions uses `STAGING_DEPLOY_*` secrets for staging-state verification, the Windows/Firefox canary, and staging cleanup workflows.

## Production Runtime Notes

- Production app path: `/opt/classroompath/app`
- Production compose path: `/opt/classroompath/app/docker`
- Production env path: `/opt/classroompath/app/config/.env`
- `config/.env` and Nginx Proxy Manager remain server-local and are not committed
- `docker/docker-compose.yml` is authoritative for production code deploys; do not rely on a local-only override for normal releases

## Nginx Integration

Optimized for Nginx Proxy Manager. See `docker/npm-advanced-config.txt` for:

- SSL termination
- WebSocket support for tRPC
- `/cp/*`, `/api/*`, `/trpc/*`, `/w/*`, `/health` routing
- SSE handling for `/api/machines/events` (no buffering)

## Database Architecture (CRITICAL)

### PostgreSQL Required

ClassroomPath requires PostgreSQL via `DATABASE_URL`. Both the gateway and the upstream OpenPath API use the same connection string from `config/.env`.

| Environment                  | Database       | Location                            |
| ---------------------------- | -------------- | ----------------------------------- |
| **ClassroomPath Staging**    | **PostgreSQL** | CT 113 (`classroompath-db-staging`) |
| **ClassroomPath Production** | **PostgreSQL** | Oracle host (`classroompath.eu`)    |

### Database Connection

`DATABASE_URL` must be set in `config/.env` (used by both services).

```bash
# Staging API container has:
DATABASE_URL=postgresql://classroompath:<PASSWORD>@<DB_HOST>:5432/classroompath_staging
```

### Proxmox Container Layout

| CT ID | Name                        | Purpose                   |
| ----- | --------------------------- | ------------------------- |
| 113   | `classroompath-db-staging`  | **Staging PostgreSQL**    |
| 114   | `classroompath-app-staging` | Staging Docker (API, SPA) |

Production is no longer on Proxmox. It runs on the Oracle host behind `classroompath.eu` with the app repo at `/opt/classroompath/app` and PostgreSQL on the same host.

### Database Operations

```bash
# Connect to Proxmox
ssh root@192.168.1.150

# Query STAGING database
pct exec 113 -- docker exec classroompath-postgres-staging \
  psql -U classroompath -d classroompath_staging -c "SELECT * FROM users;"

# Query PRODUCTION database
ssh deploy@classroompath.eu "docker exec classroompath-postgres \
  psql -U classroompath -d classroompath -c 'SELECT * FROM users;'"

# Clear staging database (CAREFUL!)
pct exec 113 -- docker exec classroompath-postgres-staging \
  psql -U classroompath -d classroompath_staging -c "TRUNCATE users, roles CASCADE;"
```

### Common Mistakes to Avoid

| ❌ Wrong                                  | ✅ Correct                              |
| ----------------------------------------- | --------------------------------------- |
| Looking for `.db` files in containers     | Use PostgreSQL on the staging/prod host |
| Assuming the wrong host/DB                | Verify URL + host + db name             |
| Debugging without checking `DATABASE_URL` | Inspect `config/.env`                   |
| Hotfixing prod code only on the server    | Backport to git, redeploy by `v*` tag   |

## Anti-Patterns

- Editing files in `upstream/openpath/` (changes lost on submodule update)
- Committing `.env` files
- Deploying without verifying submodule is updated
- Using staging secrets in production
- **Assuming the wrong DB/config** (always verify `DATABASE_URL` and the target host)
- **Confusing staging and production environments** (always verify URL first)

## Quick Reference: Environment Identification

```
┌─────────────────────────────────────────────────────────────────────┐
│ STAGING                          │ PRODUCTION                       │
├──────────────────────────────────┼──────────────────────────────────┤
│ classroompath-staging.duckdns.org│ classroompath.eu                 │
│ CT 114 (app) + CT 113 (db)       │ Oracle VM + local PostgreSQL     │
│ DB: classroompath_staging        │ DB: classroompath                │
│ Deploy: npm run deploy:staging   │ Deploy: git tag v* (GH Actions)  │
└──────────────────────────────────┴──────────────────────────────────┘
```
