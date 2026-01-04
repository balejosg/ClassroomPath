# ClassroomPath

DNS whitelist management SaaS for educational institutions.

Built on [OpenPath](https://github.com/balejosg/openpath) (OSS).

## Architecture

```
classroompath.duckdns.org
         │
         ├── /api/*     → Node.js API (port 3000)
         ├── /trpc/*    → tRPC endpoints
         ├── /w/*       → Tokenized whitelist downloads
         └── /*         → SPA (static files)
```

## Quick Start

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

Automatic deployment on push to `main`. See [docs/SECRETS.md](docs/SECRETS.md) for GitHub secrets configuration.

### Manual deployment

1. Configure GitHub secrets (see docs/SECRETS.md)
2. Push to main branch
3. Workflow deploys to your server automatically

## Server Setup

### Install Caddy

```bash
# Debian/Ubuntu
sudo apt install caddy

# Copy Caddyfile
sudo cp config/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### Create systemd service

See [docs/SECRETS.md](docs/SECRETS.md) for sample service file.

## Updating OpenPath

```bash
npm run submodule:update
git add upstream/openpath
git commit -m "chore: update openpath submodule"
git push
```

## License

AGPL-3.0-or-later
