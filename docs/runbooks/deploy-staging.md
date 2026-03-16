# Runbook: Deploy Staging

> Status: maintained
> Applies to: staging environment
> Last verified: 2026-03-13
> Source of truth: `docs/runbooks/deploy-staging.md`

Staging deploys are executed locally via SSH and always deploy `origin/main`.

Canonical public targets live in `config/deploy-targets.json`.

## Prerequisites

- `.env.local` configured (copy from `.env.local.example`)
- SSH access to the staging host

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
- Health checks pass:
  - `https://classroompath-staging.duckdns.org/cp/health`
  - `https://classroompath-staging.duckdns.org/health`
- Smoke tests pass (script prints the summary)

If the script reports `PASS_WITH_FALLBACK`, local smoke had to fall back to direct IP / relaxed CORS. Treat that as deploy evidence, but rerun a strict public-domain smoke pass before tagging production when possible.

## Promotion Gate

Before creating a production tag, run the staging release gate and keep its output with the UAT evidence:

```bash
npm run test:release-gate:staging
```

This gate performs live mutable checks for:

- `auth.register` returning `emailSent: true`
- `auth.register` returning a public verification URL on the staging origin
- `auth.generateEmailVerificationToken` returning a fresh public verification URL

After staging is green, promote using the canonical production runbook:

- [`docs/runbooks/deploy-production.md`](deploy-production.md)

## Debugging

The deploy script prints the exact SSH + docker commands it runs. If needed:

```bash
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "docker logs classroompath-gateway --tail 50"
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "docker logs classroompath-api --tail 50"
```
