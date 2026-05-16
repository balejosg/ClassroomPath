# ClassroomPath AGENTS.md

> Status: maintained
> Applies to: agent workflow inside the ClassroomPath repository
> Last verified: 2026-04-27
> Source of truth: `AGENTS.md`

SaaS distribution wrapper for OpenPath. Provides tenancy, deployment, and environment-specific
operations on top of the upstream OpenPath submodule.

Primary references:

- Docs index: `docs/INDEX.md`
- Workspace routing manifest: `../agent-manifest.json`
- Staging runbook: `docs/runbooks/deploy-staging.md`
- Production runbook: `docs/runbooks/deploy-production.md`

## Trunk-Based Workflow

`main` is the only allowed working branch.

- Do not create feature branches, PR branches, or integration branches.
- Do not commit from detached HEAD.
- If you need isolation, use a detached worktree based on `main`.
- Never push from the workspace root; push only from `ClassroomPath/` when explicitly asked.

Technical enforcement:

- `.husky/pre-commit` runs `scripts/require-main-branch.sh` and `npm run verify:commit`
- `.husky/pre-push` runs `scripts/require-main-branch.sh`

## Verification And Promotion Flow

Normal local verification:

- `git commit` triggers `npm run verify:commit`
- `npm run verify:docs` is the focused check for maintained repo-hosted documentation
- use targeted manual suites only when you need extra confidence while iterating
- for CI/CD optimization or runner follow-up, use `docs/verification-matrix.md`
  to record run IDs, per-job durations, cache signals, artifact evidence, and
  the highest evidence rung before changing workflow routing or cache policy

## Hypothesis Validation Order

Do not use `npm run deploy:staging`, production tagging, or a broad CI workflow as the first hypothesis check when a cheaper lane can falsify the change.

Default order:

- `npm run verify:incremental`
- direct runner connection for Windows bootstrap/canary hypotheses
- `npm run deploy:staging` for integrated staging evidence
- production tag workflow for promotion evidence only

From the shared workspace, use `../scripts/validate-hypothesis.sh` when choosing the first pass:

- `../scripts/validate-hypothesis.sh classroompath local`
- `../scripts/validate-hypothesis.sh classroompath windows-bootstrap-gh --integration`
- `../scripts/validate-hypothesis.sh classroompath windows-ajax-direct`

The Windows direct diagnostic stays staging-first by default and requires explicit confirmation for production.

Repo-local fallback when the workspace wrapper is unavailable:

- `npm run verify:incremental`
- `npm run diagnostics:windows-ajax:direct -- --environment staging`
- `npm run diagnostics:runner -- --suite windows-bootstrap-ajax` only when workflow-shaped integration evidence is the goal

Use GitHub Actions runner workflows for integration/deployment time, not as the default development loop when the direct runner lane can answer the question sooner.

If you push changes to `main`, you must run local staging deployment immediately:

```bash
git add .
git commit -m "your message"
git push origin main
npm run deploy:staging
```

Before production promotion, verify staging evidence and then promote through the canonical
tagging script:

```bash
npm run verify:promotion-ready
npm run promote:production -- v1.2.4
```

Production is tag-only. Do not use ad-hoc SSH deploys or `workflow_dispatch` as the canonical path.
Canonical production trigger: annotated tag `v*`.

The promotion script writes `Promotion evidence` into the annotated tag message so GitHub Actions
can reuse the staging release state without re-reading staging over SSH. The SSH read path in
`.github/workflows/deploy.yml` is fallback-only for legacy/lightweight tags.

Production server images require linux/arm64 because the production host is ARM64. Endpoint client
arm64 builds are discontinued for now; do not remove server `linux/arm64` image support when
disabling or discussing endpoint client ARM64 work.

## Environment Identification

Use exact URLs before debugging or deploying anything.

| Check          | Staging                                     | Production                                          |
| -------------- | ------------------------------------------- | --------------------------------------------------- |
| Public URL     | `https://classroompath-staging.duckdns.org` | `https://classroompath.eu`                          |
| Gateway health | `http://192.168.1.114:3000/cp/health`       | `https://classroompath.eu/cp/health`                |
| Trigger        | `npm run deploy:staging`                    | tag `v*`                                            |
| Runtime host   | CT 114 (`classroompath-app-staging`)        | Oracle host (`/opt/classroompath/app`)              |
| Database       | CT 113 PostgreSQL (`classroompath_staging`) | PostgreSQL on the production host (`classroompath`) |

Debugging rule:

1. Confirm the affected URL first.
2. Staging issues stay in the staging environment unless the user explicitly asks for production work.
3. Production drift must be reconciled back into git and redeployed by a new tag.

## Staging Deployment

Staging is deployed by the local script only. GitHub Actions does not deploy staging.

Local setup:

```bash
cp .env.local.example .env.local
ssh-keygen -t ed25519 -C "agent-staging-deploy" -f ~/.ssh/classroompath_staging
```

The local deploy script:

- loads `.env.local`
- resolves the canonical staging URL from `config/deploy-targets.json`
- deploys either release-candidate images or explicit source-build fallback
- runs remote health checks plus staging verification
- writes reusable verification evidence under `/opt/classroompath/release-state/`

Useful staging commands:

```bash
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "docker logs classroompath-gateway --tail 50"
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "docker logs classroompath-api --tail 50"
curl -v http://192.168.1.114:3000/cp/health
ssh -i ~/.ssh/classroompath_staging deploy@192.168.1.114 "cat /opt/classroompath/release-state/staging-verification.env"
```

## Architecture Boundary

Read these first for wrapper work:

- `../agent-manifest.json`
- `react-spa/vite.config.ts`
- `react-spa/src/ClassroomPathApp.tsx`
- `react-spa/src/ClassroomPathShell.tsx`
- `../OpenPath/docs/adr/0010-public-spa-extension-surface.md`

Rules:

- consume OpenPath SPA functionality through the public entrypoints only
- do not deep-import upstream OpenPath SPA internals during ordinary ClassroomPath wrapper work
- OpenPath must remain agnostic of ClassroomPath

## Deployment And Runtime Facts

- canonical public targets live in `config/deploy-targets.json`
- `docker/docker-compose.yml` is the authoritative runtime compose file
- `config/.env` and Nginx Proxy Manager config stay server-local and must not be committed
- production app path is `/opt/classroompath/app`
- production compose project name defaults to `classroompath-production`

## Common Mistakes To Avoid

- editing `upstream/openpath/` directly for ClassroomPath-only changes
- committing `.env` or `.env.local`
- documenting or debugging the wrong environment
- promoting to production without verify staging evidence first
- assuming upstream passthroughs are unrestricted; tenant-scoped data belongs on `/cp/trpc/*`
