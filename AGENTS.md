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

| Environment | Trigger | Host |
|-------------|---------|------|
| Staging | Push to `main` | `STAGING_DEPLOY_HOST` |
| Production | Tag `v*` | `DEPLOY_HOST` |

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

## Anti-Patterns

- Editing files in `upstream/openpath/` (changes lost on submodule update)
- Committing `.env` files
- Deploying without verifying submodule is updated
- Using staging secrets in production
