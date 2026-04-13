# Routes and Ports Contract

> Status: maintained
> Applies to: ClassroomPath gateway, OpenPath upstream, and public host routing
> Last verified: 2026-04-13
> Source of truth: `docs/contracts/routes-ports.md`

Source files:

- `docker/docker-compose.yml`
- `docker/npm-advanced-config.txt`
- `docker/spa-nginx.conf`
- `api/src/lib/gateway/health-routes.ts`
- `api/src/lib/gateway/proxy-routes.ts`
- `api/src/lib/gateway/spa-routes.ts`
- `api/src/lib/openpath-proxy-policy.ts`
- `config/deploy-targets.json`

## Containers And Ports

From `docker/docker-compose.yml`:

- `classroompath-gateway`
  - container port: `3001`
  - host ports: `3000:3001` and `3001:3001`
- `classroompath-api`
  - internal Docker-network exposure: `3000`
- `classroompath-spa`
  - container port: `8080`
  - host port: `8081:8080`

## Public Host Routing

Nginx Proxy Manager is expected to front the public hostname and route selected paths to the
gateway. The SPA container serves static assets; the gateway serves the public shell and all
policy/API entrypoints.

- `/` -> gateway public page handler
- `/pricing` and `/pricing/` -> gateway public page handler
- static assets -> served by the built SPA artifacts
- `/cp/*` -> ClassroomPath gateway
- `/api/*` -> gateway passthrough policy
- `/trpc/*` -> gateway passthrough policy
- `/w/*` -> gateway passthrough policy
- `/health` -> upstream OpenPath health passthrough

## First-Party Gateway Routes

- `GET /cp/health` -> lightweight gateway health JSON
- `GET /cp/ready` -> readiness check that can return `503`
- `POST /cp/stripe/webhook` -> raw-body Stripe webhook entrypoint
- `/cp/trpc/*` -> tenant-scoped ClassroomPath tRPC surface
- `/`, `/pricing`, `/pricing/` -> SSR or SPA-shell public routes

## Allowed Upstream Passthroughs

- `GET /health`
- `GET /api/config`
- `GET /api/extensions/firefox/openpath.xpi`
- `/api/extensions/chromium/*`
- `/api/enroll/*`
- `/api/requests/auto`
- `/api/requests/submit`
- `/api/agent/windows/*`
- `/api/agent/linux/*`
- `/api/machines/*`
- `/w/*`
- `/trpc/healthReports.submit`

## Explicit Rejections

- `/v2` -> `404`
- `/export` -> `404`
- raw `/trpc/*` is blocked except `healthReports.submit`
- unknown raw `/api/*` passthroughs are rejected by gateway policy

## SSE

- `GET /api/machines/events` is Server-Sent Events
- reverse proxies must disable buffering, caching, and gzip for this path

## Operational Notes

- canonical public URLs and health endpoints live in `config/deploy-targets.json`
- the SPA container nginx config is intentionally simple because the host-level proxy handles
  API/gateway routing before requests reach the SPA container
