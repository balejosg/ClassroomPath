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
classroompath.duckdns.org   classroompath-staging.duckdns.org
         │                         │
         └──────────┬──────────────┘
                    ▼
         ┌─────────────────────┐
         │  Nginx Proxy Manager │
         │    (CT 112)          │
         │  192.168.1.112       │
         │  SSL termination     │
         └──────────┬───────────┘
                    │
      ┌─────────────┴─────────────┐
      ▼                           ▼
┌───────────────┐         ┌───────────────┐
│ App Prod      │         │ App Staging   │
│ (CT 111)      │         │ (CT 114)      │
│ 192.168.1.111 │         │ 192.168.1.114 │
│ :3000         │         │ :3000         │
└──────┬────────┘         └──────┬────────┘
       │                         │
       ▼                         ▼
┌───────────────┐         ┌───────────────┐
│ PostgreSQL    │         │ PostgreSQL    │
│ Prod (CT 110) │         │ Staging (CT113│
│ 192.168.1.110 │         │ 192.168.1.113 │
└───────────────┘         └───────────────┘
```

### API Routes

```
/api/*     → Node.js API (port 3000)
/trpc/*    → tRPC endpoints
/w/*       → Tokenized whitelist downloads
/*         → SPA (static files)
```

## Infrastructure

### Proxmox Containers (LXC)

| CT | IP | Service | RAM | Disk |
|----|-----|----------|-----|------|
| 110 | 192.168.1.110 | PostgreSQL Production | 1GB | 10GB |
| 111 | 192.168.1.111 | ClassroomPath App Prod | 2GB | 15GB |
| 112 | 192.168.1.112 | Nginx Proxy Manager | 512MB | 5GB |
| 113 | 192.168.1.113 | PostgreSQL Staging | 512MB | 8GB |
| 114 | 192.168.1.114 | ClassroomPath App Staging | 1.5GB | 12GB |

### Port Forwarding (Router)

| External Port | Internal IP | Internal Port | Purpose |
|---------------|-------------|---------------|---------|
| 80 | 192.168.1.112 | 80 | HTTP (redirect to HTTPS) |
| 443 | 192.168.1.112 | 443 | HTTPS |
| 2211 | 192.168.1.111 | 22 | SSH Deploy Production |
| 2214 | 192.168.1.114 | 22 | SSH Deploy Staging |

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
| Secret | Value |
|--------|-------|
| `DEPLOY_HOST` | `classroompath.duckdns.org` |
| `DEPLOY_PORT` | `2211` |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | Private SSH key |

#### Staging
| Secret | Value |
|--------|-------|
| `STAGING_DEPLOY_HOST` | `classroompath.duckdns.org` |
| `STAGING_DEPLOY_PORT` | `2214` |
| `STAGING_DEPLOY_USER` | `deploy` |
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

### SSH Access

```bash
# Via Proxmox
ssh root@192.168.1.150
pct exec 111 -- bash   # Production app
pct exec 114 -- bash   # Staging app

# Direct (from internet)
ssh -p 2211 deploy@classroompath.duckdns.org  # Production
ssh -p 2214 deploy@classroompath.duckdns.org  # Staging
```

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

- **URL**: http://192.168.1.112:81
- **Purpose**: SSL termination, reverse proxy, Let's Encrypt certificates

## Database

### PostgreSQL Access

```bash
# Production
psql -h 192.168.1.110 -U classroompath -d classroompath

# Staging  
psql -h 192.168.1.113 -U classroompath -d classroompath_staging
```

### Backups

Automated daily backups at 3:00 AM to `/opt/backups/`.

```bash
# Manual backup
/opt/classroompath-backup-all.sh
```

## Updating OpenPath

```bash
npm run submodule:update
git add upstream/openpath
git commit -m "chore: update openpath submodule"
git push
```

## License

AGPL-3.0-or-later
