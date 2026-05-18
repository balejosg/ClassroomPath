# ClassroomPath AGENTS.md

> Status: maintained
> Applies to: agent workflow inside the ClassroomPath repository
> Last verified: 2026-05-18
> Source of truth: `AGENTS.md`

ClassroomPath is the source-available managed service layer built on OpenPath. Keep public repo work
focused on transparency, auditability, security review, interoperability assessment, and local
private evaluation.

## Public Repository Posture

- ClassroomPath is source-available, not open source.
- OpenPath is the OSS core and primary community contribution target.
- Do not publish live deployment targets, staging hosts, internal IPs, private filesystem paths,
  provider secrets, runner hostnames, VM identifiers, billing setup details, or production runbooks.
- Do not run staging deploys, production deploys, live smoke tests, billing calls, release/tag
  commands, DNS changes, or external service calls unless the user explicitly requests that
  operational work in a private context.

## Trunk-Based Workflow

`main` is the only allowed working branch.

- Do not create feature branches, PR branches, or integration branches.
- Do not commit from detached HEAD.
- Never push from the workspace root.
- Push only from `ClassroomPath/` when explicitly asked.

## Verification

For public-surface or documentation changes, prefer local checks:

- `npm run verify:public-surface`
- `npm run verify:docs`
- `npm run format:check`
- `npm run verify:commit`

Do not use deploy workflows, live staging/production checks, or provider APIs as the first signal for
ordinary code or documentation work.

## Architecture Boundary

Read these first for wrapper work:

- `../agent-manifest.json`
- `react-spa/vite.config.ts`
- `react-spa/src/ClassroomPathApp.tsx`
- `react-spa/src/ClassroomPathShell.tsx`
- `../OpenPath/docs/adr/0010-public-spa-extension-surface.md`

Rules:

- consume OpenPath SPA functionality through public entrypoints only
- do not deep-import upstream OpenPath SPA internals during ordinary ClassroomPath wrapper work
- OpenPath must remain agnostic of ClassroomPath
- do not edit files inside `upstream/openpath/` directly for ClassroomPath-only changes

## Private Deployment Targets

Committed deploy target files use `.invalid` placeholders. Maintainers who need private deploy
operations should create `config/deploy-targets.local.json` from
`config/deploy-targets.example.json` or set `CLASSROOMPATH_DEPLOY_TARGETS_FILE` to a private config
path. Real targets must stay untracked.

## Common Mistakes To Avoid

- treating ClassroomPath as the OpenPath community support repo
- committing `.env`, `.env.local`, or `config/deploy-targets.local.json`
- documenting live hostnames, LAN addresses, SSH users, key filenames, VM identifiers, or provider
  setup commands
- claiming production resolution from local or staging-only evidence
