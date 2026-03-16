# Docker Deployment with Nginx Proxy Manager

ClassroomPath deploys as Docker Compose with three services:

- `gateway` (public entrypoint, multi-tenancy)
- `api` (upstream OpenPath API, internal-only)
- `spa` (static web UI)

## Architecture

```
classroompath.eu (or classroompath-staging.duckdns.org)
         │
         ▼
   ┌─────────────────┐
   │ Nginx Proxy Mgr │
   │     (NPM)       │
   └────────┬────────┘
            │  default forward host
            ▼
     classroompath-spa:80
            │
            ├─ /cp/*, /api/*, /trpc/*, /w/*, /health, /api/machines/events
            ▼
     classroompath-gateway:3001
            │
            ▼
     classroompath-api:3000   (Docker network only)
```

NPM routing rules live in `docker/npm-advanced-config.txt`.

## Quick Start

### 1. Configure environment

```bash
cp config/.env.example config/.env
${EDITOR:-nano} config/.env
```

### 2. Build and start containers

```bash
cd docker
docker compose up -d --build
```

### 3. Verify

```bash
docker compose ps
docker compose logs -f gateway
```

### 4. Configure Nginx Proxy Manager

1. Open NPM web UI (usually `http://your-server:81`)
2. Hosts → Proxy Hosts → Add Proxy Host

Details tab:

| Field                 | Value               |
| --------------------- | ------------------- |
| Domain Names          | `classroompath.eu`  |
| Scheme                | `http`              |
| Forward Hostname/IP   | `classroompath-spa` |
| Forward Port          | `80`                |
| Block Common Exploits | ✅                  |

SSL tab:

| Field           | Value                       |
| --------------- | --------------------------- |
| SSL Certificate | Request new SSL Certificate |
| Force SSL       | ✅                          |
| HTTP/2 Support  | ✅                          |

Advanced tab:

- Paste the contents of `docker/npm-advanced-config.txt`

## Container Networking Notes

The NPM container must be able to reach `classroompath-spa` and `classroompath-gateway` by container name.

If NPM runs in a different Docker network, either:

- attach the ClassroomPath services to the same external network, or
- use reachable IPs instead of container names.

## Updating

```bash
git pull --recurse-submodules
cd docker
docker compose up -d --build
```

## Logs

```bash
docker compose logs -f
docker compose logs -f gateway
docker compose logs -f api
docker compose logs -f spa
```
