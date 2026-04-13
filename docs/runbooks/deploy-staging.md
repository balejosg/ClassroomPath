# Runbook: Deploy Staging

> Status: maintained
> Applies to: staging environment
> Last verified: 2026-03-13
> Source of truth: `docs/runbooks/deploy-staging.md`

Staging deploys are executed locally via SSH and always deploy `origin/main`.
When release-candidate images for `origin/main` already exist in GHCR, the script deploys those exact images by default, runs migrations from the matching prebuilt migrations image, and fails if those artifacts are missing. `source-build` remains available only as an explicit debug/recovery mode.

Canonical public targets live in `config/deploy-targets.json`.

## Prerequisites

- `.env.local` configured (copy from `.env.local.example`)
- SSH access to the staging host
- Optional: local billing overrides may be exported, but they are no longer required for the
  normal flow. If absent, `deploy:staging` reuses the current billing block from
  `/opt/classroompath/app/config/.env` on staging for that run.

## Steps

```bash
git add .
git commit -m "<message>"
git push origin main

npm run deploy:staging
```

## Expected Result

- Script exits `0`
- Script prints `Verification Status: PASS` or `Verification Status: PASS_WITH_FALLBACK`
- Script prints `Release Gate: success`
- Script reports `Image Source: release-candidate` when it deployed the prebuilt candidate images
- Health checks pass:
  - `https://classroompath-staging.duckdns.org/cp/health`
  - `https://classroompath-staging.duckdns.org/health`
- Smoke tests pass (script prints the summary)
- The staging host stores `/opt/classroompath/release-state/staging-verification.env` for the promoted SHA
- If startup/readiness fails after migrations, the script attempts to restore the previous application release and records the result in `/opt/classroompath/release-state/staging-deploy-context.env`

If the script reports `PASS_WITH_FALLBACK`, local smoke had to fall back to direct IP / relaxed CORS. Treat that as deploy evidence, but rerun a strict public-domain smoke pass before tagging production when possible.

## Promotion Gate

`npm run deploy:staging` now runs the staging release gate by default and records the result in `staging-verification.env`. Production promotion reuses that evidence instead of rerunning the same gate in GitHub Actions.

If you need to rerun the gate diagnostically without redeploying staging, you can still run:

```bash
npm run test:release-gate:staging
```

After staging is green, promote using the canonical production runbook:

- [`docs/runbooks/deploy-production.md`](deploy-production.md)

## Debugging

The deploy script prints the exact SSH + docker commands it runs. If needed:

```bash
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "docker logs classroompath-gateway --tail 50"
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "docker logs classroompath-api --tail 50"
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "cat /opt/classroompath/release-state/staging-deploy-context.env"
```
