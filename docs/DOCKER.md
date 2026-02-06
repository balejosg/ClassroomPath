# Docker Deployment with Nginx Proxy Manager

## Architecture

```
classroompath.duckdns.org
         │
         ▼
   ┌─────────────────┐
   │ Nginx Proxy Mgr │
   │     (NPM)       │
   └────────┬────────┘
            │
   ┌────────┴────────┐
   │                 │
   ▼                 ▼
/api/*            /*
/trpc/*
/health
/w/*
   │                 │
   ▼                 ▼
┌─────────────┐ ┌─────────────┐
│ API         │ │ SPA         │
│ :3000       │ │ :8080       │
│ (Node.js)   │ │ (nginx)     │
└─────────────┘ └─────────────┘
```

## Quick Start

### 1. Configure environment

```bash
cp config/.env.example config/.env
nano config/.env
# Fill in your values
```

### 2. Build and start containers

```bash
cd docker
docker compose up -d --build
```

### 3. Verify containers are running

```bash
docker compose ps
docker compose logs -f
```

### 4. Configure Nginx Proxy Manager

1. Open NPM web UI (usually `http://your-server:81`)
2. **Hosts → Proxy Hosts → Add Proxy Host**

#### Details tab:

| Field                 | Value                       |
| --------------------- | --------------------------- |
| Domain Names          | `classroompath.duckdns.org` |
| Scheme                | `http`                      |
| Forward Hostname/IP   | `classroompath-spa`         |
| Forward Port          | `80`                        |
| Block Common Exploits | ✅                          |

#### SSL tab:

| Field           | Value                       |
| --------------- | --------------------------- |
| SSL Certificate | Request new SSL Certificate |
| Force SSL       | ✅                          |
| HTTP/2 Support  | ✅                          |

#### Advanced tab:

Copy contents of `docker/npm-advanced-config.txt`

5. **Save**

## Container Names

If NPM is in a different Docker network, use container IPs or add containers to same network:

```yaml
# In docker-compose.yml, add:
networks:
  default:
    external: true
    name: npm_network # Replace with your NPM network name
```

## Updating

```bash
cd ~/ClassroomPath
git pull --recurse-submodules
cd docker
docker compose up -d --build
```

## Logs

```bash
# All containers
docker compose logs -f

# API only
docker compose logs -f api

# SPA only
docker compose logs -f spa
```

## Troubleshooting

### Containers can't reach each other

Make sure all containers are on the same Docker network:

```bash
docker network ls
docker network inspect <network_name>
```

### API returns 502

Check API logs:

```bash
docker compose logs api
```

### SPA shows blank page

Check SPA logs and verify files are mounted:

```bash
docker compose logs spa
docker compose exec spa ls -la /usr/share/nginx/html
```
