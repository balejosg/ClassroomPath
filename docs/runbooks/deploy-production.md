# Runbook: Deploy Production

> Status: maintained
> Applies to: production environment
> Last verified: 2026-03-13
> Source of truth: `docs/runbooks/deploy-production.md`

Production is deployed on the Oracle host behind `https://classroompath.eu`.

This is the canonical production promotion path for ClassroomPath. Future LLMs should follow this runbook instead of inventing ad-hoc SSH deploys.

## Canonical Facts

- Production URL: `https://classroompath.eu`
- Canonical deploy targets: `config/deploy-targets.json`
- Production health:
  - `https://classroompath.eu/cp/health`
  - `https://classroompath.eu/cp/ready`
- Production deploy trigger: Git tag `v*` only
- Production workflow: `.github/workflows/deploy.yml`
- Production host layout:
  - app repo: `/opt/classroompath/app`
  - compose dir: `/opt/classroompath/app/docker`
  - runtime env: `/opt/classroompath/app/config/.env`
- Production access path: GitHub Actions SSH using `DEPLOY_*` secrets
- Billing runtime source of truth: GitHub Environment secrets for production

## Rules

- Do not deploy production from a local shell when the goal is a normal release.
- Do not use `workflow_dispatch` for production. Production is intentionally tag-only.
- Do not leave code-only hotfixes on the server. If an emergency server change is made, backport it to the repo and redeploy by tag immediately.
- Staging must be validated first from a developer machine with `npm run deploy:staging`.
- Destructive migration releases require a recorded backup or snapshot reference before production migrations run.

## Migration Risk Categories

Production deploys classify changed migration SQL into one of these categories:

- `safe`: no schema/data changes detected or index-only changes
- `expand-contract`: additive schema changes such as `CREATE TABLE`, `ADD COLUMN`, `ADD CONSTRAINT`, `CREATE INDEX`
- `destructive`: deletes, drops, type changes, or data rewrites

Destructive releases have extra requirements:

1. staging evidence must already exist for the exact promoted SHA
2. a production backup/snapshot reference must be recorded
3. rollback should be understood as code/image rollback only unless the backup is also restored manually

The deploy script persists this classification in `/opt/classroompath/release-state/deploy-context.env`.

## Promotion Steps

1. Land the desired commit on `main`.

```bash
git push origin main
```

2. Deploy staging locally and require a clean exit.

```bash
npm run deploy:staging
```

3. Create and push the production tag.

```bash
git tag v1.2.4
git push origin v1.2.4
```

4. Monitor the workflow.

```bash
gh run watch --workflow Deploy
```

Inspect the workflow summary and `release-evidence-<tag>` artifact before calling the release complete.

If the release includes destructive migrations, also ensure the workflow had either:

- `PRODUCTION_DB_BACKUP_ID` set explicitly, or
- `PRODUCTION_DB_BACKUP_COMMAND` configured so the remote deploy script could generate a backup reference

5. Verify production after the workflow finishes.

```bash
curl -sS https://classroompath.eu/cp/ready
curl -sS https://classroompath.eu/api/config
```

Expected result:

- staging verification evidence matches the exact promoted SHA and image digests
- GitHub Actions deploys to production through SSH
- production smoke tests pass
- `release-evidence-<tag>` captures the exact SHA, OpenPath SHA, staging verification evidence, and immutable image refs
- `/cp/ready` returns `ready: true`

## What the Workflow Does

The production workflow performs these steps automatically:

1. Verify the staging release state and persisted staging verification evidence
2. SSH into production using `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PORT`, `DEPLOY_SSH_KEY`
3. Classify changed migrations as `safe`, `expand-contract`, or `destructive`
4. Require a backup/snapshot reference before any destructive production migration
5. Check out the exact tag commit in `/opt/classroompath/app`
6. Update the OpenPath submodule recursively
7. Run ClassroomPath DB migrations
8. Run OpenPath DB migrations
9. Sync the billing runtime block into `/opt/classroompath/app/config/.env`
10. Validate runtime config against Docker with the production env file
11. Rebuild and restart Docker Compose services
12. Check `/cp/health` and `/cp/ready`
13. Run smoke tests against `https://classroompath.eu`

## Rollback Semantics

- The workflow can now trigger rollback when the production deploy job itself fails or when post-deploy smoke tests fail.
- Rollback restores the previous code/image state recorded in `previous-images.env`.
- Rollback does **not** restore the database automatically.
- If `deploy-context.env` reports `DB_MIGRATED=1`, use the recorded backup reference for any data restoration plan.

Useful server-side state files:

- `/opt/classroompath/release-state/current-images.env`
- `/opt/classroompath/release-state/previous-images.env`
- `/opt/classroompath/release-state/deploy-context.env`

## Staging Recovery Notes

- `npm run deploy:staging` now attempts to restore the previous application revision automatically if post-migration startup or readiness checks fail.
- This recovery is application-level only; the database may already be migrated.
- The latest staging deploy status is written to `/opt/classroompath/release-state/staging-deploy-context.env`.

## Production Runtime Expectations

- Docker Compose is authoritative from `docker/docker-compose.yml`
- `gateway` and `api` must resolve `host.docker.internal` directly from tracked compose config
- `config/.env` is intentionally local-only on the server; it is not committed
- Nginx Proxy Manager and TLS are server-local infrastructure and are not recreated by the deploy workflow

## Required Server-Local Configuration

These stay outside git and must remain present on the host:

- `DATABASE_URL`
- `PUBLIC_URL=https://classroompath.eu`
- `CORS_ORIGINS=https://classroompath.eu,https://www.classroompath.eu`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

The deploy workflow also syncs this billing block from the production GitHub Environment before restart:

- `CP_PLATFORM_ADMIN_EMAILS`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_ANNUAL_PRICE_1_10`
- `STRIPE_ANNUAL_PRICE_11_25`
- `STRIPE_ANNUAL_PRICE_26_50`
- `STRIPE_ANNUAL_PRICE_51_100`
- `STRIPE_ONBOARDING_PRICE_1_25`
- `STRIPE_ONBOARDING_PRICE_26_100`
- `STRIPE_PILOT_PRICE`

## Google Login Notes

- Production reads the Google client id from `/api/config`
- The configured OAuth client must allow these JavaScript origins:
  - `https://classroompath.eu`
  - `https://www.classroompath.eu`
- Google sign-in is only available to existing or preapproved accounts; it does not auto-provision a new ClassroomPath user

## Email Delivery Notes

- Production registration/resend email depends on `RESEND_API_KEY` + `RESEND_FROM_EMAIL`
- If either value is missing, the gateway disables Resend delivery and registration still succeeds without sending mail
- The sender domain must already be verified in Resend

## Production Debugging

Use SSH only for debugging/ops, not as the canonical code deploy path.

```bash
ssh -i ~/.ssh/classroompath_deploy deploy@classroompath.eu

cd /opt/classroompath/app
git rev-parse --short HEAD
git status --short --branch

cd /opt/classroompath/app/docker
export COMPOSE_PROJECT_NAME=classroompath-production
docker compose ps
docker logs classroompath-gateway --tail 50
docker logs classroompath-api --tail 50
```

Always export `COMPOSE_PROJECT_NAME=classroompath-production` before any manual `docker compose` command on the production host.
Without it, Docker Compose can derive the project name from the directory (`docker`), create a second network namespace, and strand `gateway` away from `api`.

Healthy production should look like:

- app repo on a detached tag commit
- `git status` clean in `/opt/classroompath/app`
- `git status` clean in `/opt/classroompath/app/upstream/openpath`

## If Production Drift Exists

If you discover production-only code edits or generated files:

1. Backport the intended change into git
2. Commit and push to `main`
3. Run `npm run deploy:staging`
4. Cut a new `v*` tag
5. Let GitHub Actions reconcile production back to the tagged commit
