# GitHub Secrets Configuration

Configure these secrets in your GitHub repository settings:
**Settings → Secrets and variables → Actions → New repository secret**

## Required Secrets

| Secret | Description | Example |
|--------|-------------|---------|
| `DEPLOY_HOST` | Hostname or IP of your server | `classroompath.duckdns.org` |
| `DEPLOY_USER` | SSH username on the server | `deploy` or `pi` |
| `DEPLOY_SSH_KEY` | Private SSH key for authentication | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `DEPLOY_PORT` | SSH port (optional, defaults to 22) | `22` |

## Generating SSH Keys

```bash
# Generate a new SSH key pair for deployment
ssh-keygen -t ed25519 -C "classroompath-deploy" -f ~/.ssh/classroompath_deploy

# Copy the public key to your server
ssh-copy-id -i ~/.ssh/classroompath_deploy.pub user@your-server

# The private key (~/.ssh/classroompath_deploy) goes into DEPLOY_SSH_KEY secret
cat ~/.ssh/classroompath_deploy
```

## Server Prerequisites

Your server needs:
1. Node.js >= 20 installed
2. PostgreSQL running
3. Git installed
4. Caddy or nginx for HTTPS (optional but recommended)
5. A systemd or OpenRC service for the API

### Sample systemd service

```ini
# /etc/systemd/system/classroompath-api.service
[Unit]
Description=ClassroomPath API
After=network.target postgresql.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/ClassroomPath/upstream/openpath/api
ExecStart=/usr/bin/node dist/src/server.js
Restart=on-failure
RestartSec=10
EnvironmentFile=/home/deploy/ClassroomPath/config/.env

[Install]
WantedBy=multi-user.target
```

Enable with:
```bash
sudo systemctl daemon-reload
sudo systemctl enable classroompath-api
sudo systemctl start classroompath-api
```
