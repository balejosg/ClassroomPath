# Routes and Ports Contract

> Status: maintained
> Applies to: ClassroomPath gateway + OpenPath upstream + SPA
> Last verified: 2026-03-05
> Source of truth: `docs/contracts/routes-ports.md`

Source of truth:

- `docker/docker-compose.yml`
- `docker/npm-advanced-config.txt`

## Containers and Ports

From `docker/docker-compose.yml`:

- `classroompath-gateway`
  - Listens on: `3001` (container)
  - Exposes host ports: `3000:3001` and `3001:3001`
- `classroompath-api` (upstream OpenPath)
  - Internal-only on Docker network: `3000`
- `classroompath-spa`
  - Exposes host port: `8081:80`

## Public HTTP Routes (via Nginx Proxy Manager)

NPM forwards the base domain to the SPA by default, and then uses advanced rules to route API paths to the gateway.

- `/` and all static assets -> SPA
- `/cp/*` -> gateway (multi-tenancy tRPC and health)
- `/api/*` -> gateway (proxies to upstream OpenPath API)
- `/trpc/*` -> gateway (proxies to upstream OpenPath tRPC)
- `/w/*` -> gateway (proxies tokenized whitelist downloads)
- `/health` -> upstream health (via gateway/proxy)

## Health Endpoints

- Gateway: `GET /cp/health`
- Upstream OpenPath API: `GET /health`

## SSE

- `GET /api/machines/events` is Server-Sent Events.
- Reverse proxies MUST disable buffering for this path.
