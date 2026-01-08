# ClassroomPath AGENTS.md

SaaS distribution wrapper for OpenPath. Provides Docker deployment, multi-environment support, and production infrastructure.

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

| Aspect | OpenPath | ClassroomPath |
|--------|----------|---------------|
| Purpose | Core library/agent code | Production deployment |
| Ownership | OSS development | SaaS operations |
| Docker | Dev-only compose files | Production-ready images |
| Secrets | Examples only | Real credentials (never commit) |

## Deployment

### Environments

| Environment | URL | Trigger | Host Secret |
|-------------|-----|---------|-------------|
| **Staging** | `https://classroompath-staging.duckdns.org` | Push to `main` | `STAGING_DEPLOY_HOST` |
| **Production** | `https://classroompath.duckdns.org` | Tag `v*` | `DEPLOY_HOST` |

### ⚠️ CRITICAL: Identifying Environments

**LLM Agents: Use these URLs to verify which environment you're working with:**

| Check | Staging | Production |
|-------|---------|------------|
| **URL** | `classroompath-staging.duckdns.org` | `classroompath.duckdns.org` |
| **API Health** | `https://classroompath-staging.duckdns.org/api/health` | `https://classroompath.duckdns.org/api/health` |
| **Proxmox CT (App)** | CT 114 (`classroompath-app-staging`) | CT 111 (`classroompath-app`) |
| **Proxmox CT (DB)** | CT 113 (`classroompath-db-staging`) | CT 110 (`classroompath-db`) |
| **Database Name** | `classroompath_staging` | `classroompath` |
| **Deploy Trigger** | Any push to `main` | Git tag starting with `v` |

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

## Docker Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `api` | `Dockerfile.api` | 3000 | tRPC API server |
| `spa` | nginx:alpine | 80 | Static SPA serving |

Build: `docker compose build --no-cache`
Run: `docker compose up -d`

## Configuration

Environment variables in `config/.env` (copy from `.env.example`):

| Variable | Required | Notes |
|----------|----------|-------|
| `DB_*` | Yes | PostgreSQL connection |
| `JWT_SECRET` | Yes | Auth tokens |
| `APP_SECRET` | Yes | Server refuses to start without |
| `SHARED_SECRET` | Yes | Machine-to-API auth |

## Testing

| Test Type | Command | Purpose |
|-----------|---------|---------|
| OpenPath tests | `npm test` | Delegates to OpenPath (business logic) |
| Deployment tests | `npm run test:deployment` | SaaS-specific infrastructure |

Deployment tests verify Docker, nginx, and env configurations only. They do NOT test OpenPath logic.

## Secrets (GitHub Actions)

| Secret | Environment | Purpose |
|--------|-------------|---------|
| `STAGING_DEPLOY_*` | Staging | SSH access to staging server |
| `DEPLOY_*` | Production | SSH access to production |

## Nginx Integration

Optimized for Nginx Proxy Manager. See `docker/npm-advanced-config.txt` for:
- SSL termination
- WebSocket support for tRPC
- `/api/*`, `/trpc/*`, `/w/*` routing

## Database Architecture (CRITICAL)

### ⚠️ ClassroomPath uses PostgreSQL, NOT SQLite

OpenPath supports both SQLite (default) and PostgreSQL. **ClassroomPath deployments use PostgreSQL exclusively.**

| Environment | Database | Location |
|-------------|----------|----------|
| OpenPath standalone | SQLite | `/app/data/openpath.db` (inside container) |
| **ClassroomPath Staging** | **PostgreSQL** | CT 113 (`classroompath-db-staging`) |
| **ClassroomPath Production** | **PostgreSQL** | CT 110 (`classroompath-db`) |

### Database Connection

The `DATABASE_URL` environment variable determines which database is used:
- If `DATABASE_URL` is set → PostgreSQL
- If `DATABASE_URL` is NOT set → SQLite (default)

```bash
# Staging API container has:
DATABASE_URL=postgresql://classroompath:<PASSWORD>@<DB_HOST>:5432/classroompath_staging
```

### Proxmox Container Layout

| CT ID | Name | Purpose |
|-------|------|---------|
| 110 | `classroompath-db` | Production PostgreSQL |
| 111 | `classroompath-app` | Production Docker (API, SPA) |
| 113 | `classroompath-db-staging` | **Staging PostgreSQL** |
| 114 | `classroompath-app-staging` | Staging Docker (API, SPA) |

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

| ❌ Wrong | ✅ Correct |
|----------|-----------|
| `rm /app/data/openpath.db` | Query PostgreSQL in CT 113/110 |
| Looking for `.db` files | Check `DATABASE_URL` env var |
| Using SQLite commands | Use `psql` via docker exec |
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
│ Trigger: push to main            │ Trigger: tag v*                  │
└──────────────────────────────────┴──────────────────────────────────┘
```
