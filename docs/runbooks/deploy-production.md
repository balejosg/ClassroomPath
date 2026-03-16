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

## Rules

- Do not deploy production from a local shell when the goal is a normal release.
- Do not use `workflow_dispatch` for production. Production is intentionally tag-only.
- Do not leave code-only hotfixes on the server. If an emergency server change is made, backport it to the repo and redeploy by tag immediately.
- Staging must be validated first from a developer machine with `npm run deploy:staging`.

## Promotion Steps

1. Land the desired commit on `main`.

```bash
git push origin main
```

2. Deploy staging locally and require a clean exit.

```bash
npm run deploy:staging
```

3. If needed, keep the release-gate/UAT evidence for the promotion.

```bash
npm run test:release-gate:staging
```

4. Create and push the production tag.

```bash
git tag v1.2.4
git push origin v1.2.4
```

5. Monitor the workflow.

```bash
gh run watch --workflow Deploy
```

Inspect the workflow summary and `release-evidence-<tag>` artifact before calling the release complete.

6. Verify production after the workflow finishes.

```bash
curl -sS https://classroompath.eu/cp/ready
curl -sS https://classroompath.eu/api/config
```

Expected result:

- release gate passes against staging
- GitHub Actions deploys to production through SSH
- production smoke tests pass
- `release-evidence-<tag>` captures the exact SHA, OpenPath SHA, gate results, and immutable image refs
- `/cp/ready` returns `ready: true`

## What the Workflow Does

The production workflow performs these steps automatically:

1. Run the staging release gate in GitHub Actions
2. SSH into production using `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PORT`, `DEPLOY_SSH_KEY`
3. Check out the exact tag commit in `/opt/classroompath/app`
4. Update the OpenPath submodule recursively
5. Run ClassroomPath DB migrations
6. Run OpenPath DB migrations
7. Rebuild and restart Docker Compose services
8. Check `/cp/health` and `/cp/ready`
9. Run smoke tests against `https://classroompath.eu`

## Production Runtime Expectations

- Docker Compose is authoritative from `docker/docker-compose.yml`
- `gateway` and `api` must resolve `host.docker.internal` directly from tracked compose config
- `config/.env` is intentionally local-only on the server; it is not committed
- Nginx Proxy Manager and TLS are server-local infrastructure and are not recreated by the deploy workflow

## Required Server-Local Configuration

These stay outside git and must remain present on the host:

- `DATABASE_URL`
- `PUBLIC_URL=https://classroompath.eu`
- `CORS_ORIGINS=https://classroompath.eu`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

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
docker compose ps
docker logs classroompath-gateway --tail 50
docker logs classroompath-api --tail 50
```

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
