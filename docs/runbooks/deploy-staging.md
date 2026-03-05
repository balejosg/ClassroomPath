# Runbook: Deploy Staging

> Status: maintained
> Applies to: staging environment
> Last verified: 2026-03-05
> Source of truth: `docs/runbooks/deploy-staging.md`

Staging deploys are executed locally via SSH and always deploy `origin/main`.

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
- Health checks pass:
  - `https://classroompath-staging.duckdns.org/cp/health`
  - `https://classroompath-staging.duckdns.org/health`
- Smoke tests pass (script prints the summary)

## Debugging

The deploy script prints the exact SSH + docker commands it runs. If needed:

```bash
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "docker logs classroompath-gateway --tail 50"
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "docker logs classroompath-api --tail 50"
```
