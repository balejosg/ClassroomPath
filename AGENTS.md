# ClassroomPath AGENTS.md

SaaS distribution wrapper for OpenPath. Provides Docker deployment, multi-environment support, and production infrastructure.

## 🚨 MANDATORY: LLM Agent Deployment Protocol

**After pushing changes to ClassroomPath, you MUST run local staging deployment.**

This is NON-NEGOTIABLE. Do NOT rely on GitHub Actions for staging feedback.

### Required Workflow

```bash
# 1. Commit and push your changes
git add .
git commit -m "your commit message"
git push origin main

# 2. IMMEDIATELY run deploy + smoke tests
npm run deploy:staging

# 3. Verify exit code
#    Exit 0 = SUCCESS (deployment verified, smoke tests passed)
#    Exit 1 = FAILURE (fix the issue before continuing)
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
7. **Runs full smoke test suite against staging URL**
8. Returns exit code 0 (success) or 1 (failure)

### If Smoke Tests Fail

```bash
# Debug commands
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "docker logs classroompath-gateway --tail 50"
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "docker logs classroompath-api --tail 50"
curl -v https://classroompath-staging.duckdns.org/health
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

### Environments

| Environment    | URL                                         | Trigger                  | Method             |
| -------------- | ------------------------------------------- | ------------------------ | ------------------ |
| **Staging**    | `https://classroompath-staging.duckdns.org` | `npm run deploy:staging` | Local script (SSH) |
| **Production** | `https://classroompath.duckdns.org`         | Tag `v*`                 | GitHub Actions     |

### ⚠️ CRITICAL: Identifying Environments

**LLM Agents: Use these URLs to verify which environment you're working with:**

| Check                | Staging                                                | Production                                     |
| -------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| **URL**              | `classroompath-staging.duckdns.org`                    | `classroompath.duckdns.org`                    |
| **API Health**       | `https://classroompath-staging.duckdns.org/api/health` | `https://classroompath.duckdns.org/api/health` |
| **Proxmox CT (App)** | CT 114 (`classroompath-app-staging`)                   | CT 111 (`classroompath-app`)                   |
| **Proxmox CT (DB)**  | CT 113 (`classroompath-db-staging`)                    | CT 110 (`classroompath-db`)                    |
| **Database Name**    | `classroompath_staging`                                | `classroompath`                                |
| **Deploy Trigger**   | `npm run deploy:staging`                               | Git tag starting with `v`                      |

**When debugging issues:**

1. Always confirm which environment is affected by checking the URL
2. Staging issues → investigate CT 113/114
3. Production issues → investigate CT 110/111
4. Never apply staging fixes to production without explicit user confirmation

### Manual Sync + Deploy

```bash
# Via GitHub Actions (recommended)
gh workflow run sync-openpath.yml

# Local submodule update
npm run submodule:update
git add upstream/openpath
git commit -m "chore: update openpath submodule"
git push  # Triggers deploy
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

| Scenario             | Command / Action                                 |
| -------------------- | ------------------------------------------------ |
| Deploy to staging    | `npm run deploy:staging`                         |
| Deploy to production | `git tag v1.x.x && git push --tags` (GH Actions) |
| Debug staging issues | SSH to CT 114                                    |

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

| Service | Image            | Port | Purpose            |
| ------- | ---------------- | ---- | ------------------ |
| `api`   | `Dockerfile.api` | 3000 | tRPC API server    |
| `spa`   | nginx:alpine     | 80   | Static SPA serving |

Build: `docker compose build --no-cache`
Run: `docker compose up -d`

## Configuration

Environment variables in `config/.env` (copy from `.env.example`):

| Variable        | Required | Notes                           |
| --------------- | -------- | ------------------------------- |
| `DB_*`          | Yes      | PostgreSQL connection           |
| `JWT_SECRET`    | Yes      | Auth tokens                     |
| `APP_SECRET`    | Yes      | Server refuses to start without |
| `SHARED_SECRET` | Yes      | Machine-to-API auth             |

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

# Optional override for low-resource machines
PLAYWRIGHT_WORKERS=2 npm run verify:full
```

## Secrets (GitHub Actions)

| Secret     | Environment | Purpose                  |
| ---------- | ----------- | ------------------------ |
| `DEPLOY_*` | Production  | SSH access to production |

> **Note:** `STAGING_DEPLOY_*` secrets are no longer used. Staging deploys via local script.

## Nginx Integration

Optimized for Nginx Proxy Manager. See `docker/npm-advanced-config.txt` for:

- SSL termination
- WebSocket support for tRPC
- `/api/*`, `/trpc/*`, `/w/*` routing

## Database Architecture (CRITICAL)

### ⚠️ ClassroomPath uses PostgreSQL, NOT SQLite

OpenPath supports both SQLite (default) and PostgreSQL. **ClassroomPath deployments use PostgreSQL exclusively.**

| Environment                  | Database       | Location                                   |
| ---------------------------- | -------------- | ------------------------------------------ |
| OpenPath standalone          | SQLite         | `/app/data/openpath.db` (inside container) |
| **ClassroomPath Staging**    | **PostgreSQL** | CT 113 (`classroompath-db-staging`)        |
| **ClassroomPath Production** | **PostgreSQL** | CT 110 (`classroompath-db`)                |

### Database Connection

The `DATABASE_URL` environment variable determines which database is used:

- If `DATABASE_URL` is set → PostgreSQL
- If `DATABASE_URL` is NOT set → SQLite (default)

```bash
# Staging API container has:
DATABASE_URL=postgresql://classroompath:<PASSWORD>@<DB_HOST>:5432/classroompath_staging
```

### Proxmox Container Layout

| CT ID | Name                        | Purpose                      |
| ----- | --------------------------- | ---------------------------- |
| 110   | `classroompath-db`          | Production PostgreSQL        |
| 111   | `classroompath-app`         | Production Docker (API, SPA) |
| 113   | `classroompath-db-staging`  | **Staging PostgreSQL**       |
| 114   | `classroompath-app-staging` | Staging Docker (API, SPA)    |

### Database Operations

```bash
# Connect to Proxmox
ssh root@192.168.1.150

# Query STAGING database
pct exec 113 -- docker exec classroompath-postgres-staging \
  psql -U classroompath -d classroompath_staging -c "SELECT * FROM users;"

# Query PRODUCTION database
pct exec 110 -- docker exec classroompath-postgres \
  psql -U classroompath -d classroompath -c "SELECT * FROM users;"

# Clear staging database (CAREFUL!)
pct exec 113 -- docker exec classroompath-postgres-staging \
  psql -U classroompath -d classroompath_staging -c "TRUNCATE users, roles CASCADE;"
```

### Common Mistakes to Avoid

| ❌ Wrong                   | ✅ Correct                          |
| -------------------------- | ----------------------------------- |
| `rm /app/data/openpath.db` | Query PostgreSQL in CT 113/110      |
| Looking for `.db` files    | Check `DATABASE_URL` env var        |
| Using SQLite commands      | Use `psql` via docker exec          |
| Assuming SQLite in staging | Always check which DB is configured |

## Anti-Patterns

- Editing files in `upstream/openpath/` (changes lost on submodule update)
- Committing `.env` files
- Deploying without verifying submodule is updated
- Using staging secrets in production
- **Assuming SQLite when PostgreSQL is configured** (check `DATABASE_URL`)
- **Confusing staging and production environments** (always verify URL first)

## Quick Reference: Environment Identification

```
┌─────────────────────────────────────────────────────────────────────┐
│ STAGING                          │ PRODUCTION                       │
├──────────────────────────────────┼──────────────────────────────────┤
│ classroompath-staging.duckdns.org│ classroompath.duckdns.org        │
│ CT 114 (app) + CT 113 (db)       │ CT 111 (app) + CT 110 (db)       │
│ DB: classroompath_staging        │ DB: classroompath                │
│ Deploy: npm run deploy:staging   │ Deploy: git tag v* (GH Actions)  │
└──────────────────────────────────┴──────────────────────────────────┘
```
