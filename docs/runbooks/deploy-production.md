# Runbook: Deploy Production

> Status: maintained
> Applies to: ClassroomPath production environment
> Last verified: 2026-04-13
> Source of truth: `docs/runbooks/deploy-production.md`

Source files:

- `.github/workflows/deploy.yml`
- `scripts/deploy-production-remote.sh`
- `scripts/verify-staging-release-state.sh`
- `scripts/lib/deploy-production-context.sh`
- `scripts/lib/deploy-production-runtime.sh`
- `scripts/lib/release-state.sh`
- `config/deploy-targets.json`

Production is deployed on the Oracle host behind `https://classroompath.eu`.

This is the canonical promotion path. Do not replace it with ad-hoc SSH deploys.

## Canonical Facts

- production URL: `https://classroompath.eu`
- gateway health: `https://classroompath.eu/cp/health`
- gateway readiness: `https://classroompath.eu/cp/ready`
- upstream config passthrough: `https://classroompath.eu/api/config`
- trigger: git tag `v*` only
- workflow: `.github/workflows/deploy.yml`
- production app path: `/opt/classroompath/app`
- production compose dir: `/opt/classroompath/app/docker`
- production env file: `/opt/classroompath/app/config/.env`
- container platform: `linux/arm64`
- production host readiness gate: `npm run verify:production-host -- <candidate-host>`

Machine-readable public targets: [`config/deploy-targets.json`](../../config/deploy-targets.json)

## Rules

- do not deploy production from a normal local shell flow
- do not use `workflow_dispatch` as the canonical release path
- staging must be validated first from a developer machine with `npm run deploy:staging`
- Production server images support linux/arm64 because the production host remains ARM64.
- ARM64 client artifacts are not required for the Windows/Linux endpoint clients.
- before changing `DEPLOY_HOST`, validate the candidate host with `npm run verify:production-host -- <candidate-host>`
- destructive migration releases require a recorded backup or snapshot reference before production migrations run
- if server drift is discovered, backport to git and reconcile production through a new tag

## Production Host Readiness

Production remains on the existing ARM64 host. Validate that host before tagging; do not move
production to a different architecture as part of normal promotion.

Required host state:

- native `arm64`/`aarch64` Linux host for the current production target
- Docker and the Docker Compose plugin available to the deploy user
- deploy SSH user and key installed
- git checkout at `/opt/classroompath/app`
- compose directory at `/opt/classroompath/app/docker`
- runtime env file at `/opt/classroompath/app/config/.env`
- optional release state at `/opt/classroompath/release-state/current-images.env`

Run the read-only readiness gate against the candidate:

```bash
DEPLOY_SSH_KEY=~/.ssh/classroompath_deploy \
npm run verify:production-host -- <candidate-host>
```

Only after that gate passes, update the GitHub production deploy secrets (`DEPLOY_HOST`,
`DEPLOY_PORT`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`) if the host or access path changed. Do not create a
production tag until both `npm run verify:production-host -- <candidate-host>` and
`npm run verify:promotion-ready` pass against the production host.

## Promotion Steps

1. Land the desired release commit on `main`.

```bash
git push origin main
```

2. Deploy and verify staging locally.

```bash
npm run deploy:staging
```

3. Run the explicit pre-tag promotion gate against the live staging evidence.

```bash
npm run verify:promotion-ready
```

4. Create and push the production tag through the canonical gated script.

```bash
npm run promote:production -- v1.2.4
```

The script creates an annotated production tag. The annotation embeds the
staging release-state evidence that was just verified locally, so the GitHub
Deploy workflow can validate the same evidence even when the runner cannot
reach staging over SSH. This is a fallback for runner connectivity, not a bypass:
the workflow still compares the embedded evidence against the approved release
candidate manifest and the promoted commit SHA.

5. Monitor the workflow and inspect the release evidence.

```bash
gh run watch --workflow Deploy
```

6. Verify production after the workflow finishes.

```bash
curl -sS https://classroompath.eu/cp/ready
curl -sS https://classroompath.eu/api/config
```

## What The Workflow Verifies

1. persisted staging verification evidence for the exact promoted SHA
2. immutable image references, release manifest compatibility, and production `linux/arm64`
   platform support for every runtime image
3. migration risk as `safe`, `expand-contract`, or `destructive`
4. backup/snapshot reference for destructive migrations
5. Dockerized runtime config on the production host
6. post-deploy health, readiness, and smoke behavior

## Windows Canary Timeout Note

The Windows/Firefox canary is advisory. GitHub-hosted Windows runners can time out when opening
SSH to the private staging host; when staging evidence for the same tag already records successful
Windows bootstrap and Firefox policy checks, and production deploy plus smoke pass, treat that SSH
timeout as the documented platform connectivity defect rather than as a production rollback signal.

Successful tagged releases publish `release-evidence-<tag>` with:

- ClassroomPath SHA
- OpenPath SHA
- immutable image refs
- staging evidence
- production smoke results

## Rollback Semantics

- rollback can trigger on deploy failure or post-deploy smoke failure
- rollback restores the previous application/image state recorded in release-state files
- rollback does not restore the database automatically
- if `deploy-context.env` reports `DB_MIGRATED=1`, use the recorded backup reference for any data restoration plan

Relevant host files:

- `/opt/classroompath/release-state/current-images.env`
- `/opt/classroompath/release-state/previous-images.env`
- `/opt/classroompath/release-state/deploy-context.env`

## Required Server-Local Configuration

These stay outside git on the production host:

- `DATABASE_URL`
- `PUBLIC_URL=https://classroompath.eu`
- `CORS_ORIGINS=https://classroompath.eu,https://www.classroompath.eu`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

The workflow also syncs billing/runtime values from GitHub Environment secrets before restart:

- `CP_BILLING_MODE`
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

## Debugging

Use SSH only for debugging and operational inspection:

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

Always export `COMPOSE_PROJECT_NAME=classroompath-production` before any manual `docker compose`
command on the production host. Without it, Docker Compose can derive a different project name and
create a second network namespace.
