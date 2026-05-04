# Runbook: Deploy Staging

> Status: maintained
> Applies to: ClassroomPath staging environment
> Last verified: 2026-04-13
> Source of truth: `docs/runbooks/deploy-staging.md`

Source files:

- `scripts/deploy-staging-local.sh`
- `scripts/deploy-staging-remote.sh`
- `scripts/check-staging-health.sh`
- `scripts/run-staging-verification.sh`
- `scripts/persist-staging-verification-remote.sh`
- `config/deploy-targets.json`

Staging deploys are executed locally via SSH and always deploy `origin/main`.

Normal mode uses release-candidate images and their matching migrations image. `STAGING_IMAGE_MODE=source-build`
is an explicit recovery/debug exception and should not become the default path.

## Prerequisites

- `.env.local` created from `.env.local.example`
- SSH access to the staging host
- if release-candidate images are private, valid `STAGING_GHCR_USERNAME` and `STAGING_GHCR_TOKEN`
- optional local billing overrides only when you intentionally need to override the staging billing block

## Canonical Targets

- public URL: `http://192.168.1.114:3000`
- gateway health: `http://192.168.1.114:3000/cp/health`
- gateway readiness: `http://192.168.1.114:3000/cp/ready`
- upstream health passthrough: `http://192.168.1.114:3000/health`

Machine-readable source of truth: [`config/deploy-targets.json`](../../config/deploy-targets.json)

Staging intentionally uses the LAN HTTP origin because it is a Proxmox VM reached from the operator
network. The release gate accepts HTTP verification links only when the expected origin is this
non-localhost LAN staging origin; production promotion keeps the HTTPS-only public-origin contract.

## Standard Flow

```bash
git add .
git commit -m "<message>"
git push origin main
npm run deploy:staging
```

## What The Script Does

1. Loads `.env.local`
2. Resolves the canonical staging URL from `config/deploy-targets.json`
3. Prepares the release-candidate manifest and SSH payload
4. Runs the remote staging deploy
5. Polls remote health and readiness
6. Runs the staging verification runner
7. Writes reusable evidence to `/opt/classroompath/release-state/staging-verification.env`

## Expected Result

- script exits `0`
- script prints `Verification Status: PASS` or `Verification Status: PASS_WITH_FALLBACK`
- script prints `Release Gate: success`
- script reports `Image Source: release-candidate` unless you intentionally forced `source-build`
- health and readiness pass
- `/opt/classroompath/release-state/staging-verification.env` exists for the promoted SHA
- `/opt/classroompath/release-state/staging-deploy-context.env` records failure/recovery context when needed

If startup or readiness fails after migrations, staging attempts application-level recovery to the
previous release state. This does not imply automatic database rollback.

## Promotion Gate

`npm run deploy:staging` already runs staging verification and records reusable release-gate
evidence. Production promotion should consume that evidence instead of rebuilding the same proof.

Optional diagnostic rerun without redeploying:

```bash
npm run test:release-gate:staging
```

## Debugging

```bash
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "docker logs classroompath-gateway --tail 50"
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "docker logs classroompath-api --tail 50"
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "cat /opt/classroompath/release-state/staging-deploy-context.env"
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "cat /opt/classroompath/release-state/staging-verification.env"
curl -sS http://192.168.1.114:3000/cp/ready
curl -sS http://192.168.1.114:3000/api/config
```

If the script reports `PASS_WITH_FALLBACK`, the smoke lane used direct-IP or relaxed-CORS fallback.
For LAN staging that is expected. Treat it as staging evidence, but do not infer production HTTPS
parity from that result alone.

The GitHub-hosted Linux bootstrap canary is skipped for LAN staging targets and records
`STAGING_LINUX_BOOTSTRAP_RESULT=skipped-lan-staging`. GitHub-hosted runners cannot route to
`192.168.1.114`, so this skip is the expected result after removing the public DuckDNS staging
ingress. When Linux bootstrap evidence is required for a release-risk decision, run a LAN-reachable
direct runner or a production-target canary instead of treating the hosted staging skip as target
platform evidence.
