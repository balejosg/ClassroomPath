# Docker Deployment With Nginx Proxy Manager

> Status: maintained
> Applies to: local and server Docker Compose deployment shape
> Last verified: 2026-04-13
> Source of truth: `docs/DOCKER.md`

Source files:

- `docker/docker-compose.yml`
- `docker/spa-nginx.conf`
- `docker/npm-advanced-config.txt`

ClassroomPath deploys as Docker Compose with three services:

- `gateway`: public entrypoint, tenancy-aware API surface, SSR public pages
- `api`: upstream OpenPath API, internal-only on the Docker network
- `spa`: static SPA assets

## Runtime Topology

```text
public hostname
  -> Nginx Proxy Manager
     -> default forward host: classroompath-spa:8080
     -> advanced routes for /, /pricing, /cp/*, /api/*, /trpc/*, /w/*, /health
        point to classroompath-gateway:3001
     -> gateway proxies selected upstream traffic to classroompath-api:3000
```

## Compose Facts

- compose file: `docker/docker-compose.yml`
- default compose project name: `classroompath-production`
- gateway host ports: `3000` and `3001`
- API is not published publicly; it exposes `3000` on the internal Docker network
- SPA host port: `8081`

## Quick Start

```bash
cp config/.env.example config/.env
docker compose -f docker/docker-compose.yml up -d --build
docker compose -f docker/docker-compose.yml ps
```

## Nginx Proxy Manager Setup

Proxy Host details:

| Field                 | Value                                                   |
| --------------------- | ------------------------------------------------------- |
| Domain Names          | `classroompath.example.invalid` or the staging hostname |
| Scheme                | `http`                                                  |
| Forward Hostname/IP   | `classroompath-spa`                                     |
| Forward Port          | `8080`                                                  |
| Block Common Exploits | enabled                                                 |

SSL:

- request a real certificate
- force SSL
- enable HTTP/2

Advanced tab:

- paste `docker/npm-advanced-config.txt`

## Important Notes

- `docker/spa-nginx.conf` only serves static assets and SPA fallback inside the SPA container
- host-level routing for `/`, `/pricing`, `/cp/*`, `/api/*`, `/trpc/*`, `/w/*`, `/health`, and `/api/machines/events`
  is handled by Nginx Proxy Manager, not by the SPA container
- if Nginx Proxy Manager runs in a different Docker network, it must still be able to resolve
  `classroompath-spa` and `classroompath-gateway`
