# GitHub Secrets Configuration (Production Deploy)

Production deployments are triggered by git tags `v*` via `.github/workflows/deploy.yml`.

Staging deployments are **not** handled by GitHub Actions; they run locally via `npm run deploy:staging`.

## Required Secrets

Configure these in GitHub:
Settings → Secrets and variables → Actions → New repository secret

| Secret           | Description                        | Example                                  |
| ---------------- | ---------------------------------- | ---------------------------------------- |
| `DEPLOY_HOST`    | Production hostname/IP             | `classroompath.eu`                       |
| `DEPLOY_USER`    | SSH user on the server             | `deploy`                                 |
| `DEPLOY_SSH_KEY` | Private SSH key for authentication | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `DEPLOY_PORT`    | SSH port (optional, default 22)    | `22`                                     |

## Generating SSH Keys

```bash
ssh-keygen -t ed25519 -C "classroompath-deploy" -f ~/.ssh/classroompath_deploy

# Copy the public key to your server
ssh-copy-id -i ~/.ssh/classroompath_deploy.pub deploy@YOUR_SERVER

# Add the private key (~/.ssh/classroompath_deploy) to DEPLOY_SSH_KEY
cat ~/.ssh/classroompath_deploy
```

## Server Prerequisites (Production)

The production workflow deploys Docker Compose, so the server must have:

- Docker + `docker compose`
- Git

The workflow expects the repo at:

- `/opt/classroompath/app`

And a real environment file at:

- `/opt/classroompath/app/config/.env` (gitignored; create from `config/.env.example`)
