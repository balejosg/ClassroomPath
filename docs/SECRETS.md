# GitHub Secrets Configuration

> Status: maintained
> Applies to: ClassroomPath GitHub Actions deploy and verification workflows
> Last verified: 2026-04-13
> Source of truth: `docs/SECRETS.md`

Primary workflow: `.github/workflows/deploy.yml`

Staging deploys still run locally via `npm run deploy:staging`, but GitHub Actions also needs
staging access for verification, cleanup, and canary workflows.

## Production Deploy Secrets

Configure these for the production deploy workflow:

- `DEPLOY_HOST`
- `DEPLOY_PORT`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`

`DEPLOY_HOST` points to the production server. The current production server target is
`linux/arm64`; ARM64 support here is for ClassroomPath server images, not endpoint client
artifacts. Before changing the host or access path, run:

```bash
DEPLOY_SSH_KEY=~/.ssh/classroompath_deploy \
npm run verify:production-host -- <candidate-host>
```

Do not create or push a production tag until the host-readiness gate and
`npm run verify:promotion-ready` both pass against the same host.

Production environment/runtime secrets used by the deploy workflow:

- `CP_BILLING_MODE`
- `CP_PLATFORM_ADMIN_EMAILS`
- `CP_CLIENT_CANARY_ADMIN_TOKEN`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_ANNUAL_PRICE_1_10`
- `STRIPE_ANNUAL_PRICE_11_25`
- `STRIPE_ANNUAL_PRICE_26_50`
- `STRIPE_ANNUAL_PRICE_51_100`
- `STRIPE_ONBOARDING_PRICE_1_25`
- `STRIPE_ONBOARDING_PRICE_26_100`
- `STRIPE_PILOT_PRICE`
- `PRODUCTION_DB_BACKUP_COMMAND`
- `PRODUCTION_DB_BACKUP_ID`

## Staging Access Secrets Used By GitHub Actions

- `STAGING_DEPLOY_HOST`
- `STAGING_DEPLOY_PORT`
- `STAGING_DEPLOY_USER`
- `STAGING_DEPLOY_SSH_KEY`

These are used for:

- staging-state verification in production promotion for legacy/lightweight tags
- staging cleanup workflow
- Windows/Firefox canary workflows

Current production tags created by `npm run promote:production -- vX.Y.Z` embed
the locally verified staging release-state evidence in the annotated tag. The
Deploy workflow validates that embedded evidence first, then falls back to these
staging SSH secrets only when promoting an older tag without embedded evidence.

## SSH Key Setup

```bash
ssh-keygen -t ed25519 -C "classroompath-deploy" -f ~/.ssh/classroompath_deploy
ssh-copy-id -i ~/.ssh/classroompath_deploy.pub deploy@YOUR_SERVER
cat ~/.ssh/classroompath_deploy
```

Store the private key in the corresponding GitHub secret.

## Server Prerequisites

The production workflow expects:

- Docker with `docker compose`
- Git
- repo checkout at `/opt/classroompath/app`
- real runtime env file at `/opt/classroompath/app/config/.env`

Do not commit the production or staging runtime `.env` files into the repository.
