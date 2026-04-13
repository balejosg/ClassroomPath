# ClassroomPath Documentation Index

> Status: maintained
> Applies to: first-party ClassroomPath documentation
> Last verified: 2026-04-13
> Source of truth: `docs/INDEX.md`

This index is the entrypoint for the maintained ClassroomPath documentation set.

Rules:

- Maintained docs are English-only.
- Draft docs may change or disappear without notice.
- Archived docs are historical context only and must not be treated as operational runbooks.

## Start Here

- Repository overview and operator-facing summary: [`README.md`](../README.md)
- Agent workflow, environment identification, and deployment rules: [`AGENTS.md`](../AGENTS.md)
- Workspace routing and search policy: [`agent-manifest.json`](../../agent-manifest.json)
- OpenPath documentation index: [`OpenPath/docs/INDEX.md`](../../OpenPath/docs/INDEX.md)
- OpenPath SPA wrapper boundary: [`OpenPath/docs/adr/0010-public-spa-extension-surface.md`](../../OpenPath/docs/adr/0010-public-spa-extension-surface.md)

## Canonical Contracts

- Environment variables and runtime policy: [`docs/contracts/env.md`](contracts/env.md)
- Public routes, passthroughs, and port wiring: [`docs/contracts/routes-ports.md`](contracts/routes-ports.md)
- Cross-system mutation ledger and retry model: [`docs/contracts/cross-system-mutations.md`](contracts/cross-system-mutations.md)
- Verification matrix: [`docs/verification-matrix.md`](verification-matrix.md)

## Operations

- Deploy staging (local SSH workflow after push): [`docs/runbooks/deploy-staging.md`](runbooks/deploy-staging.md)
- Deploy production (tag-only promotion): [`docs/runbooks/deploy-production.md`](runbooks/deploy-production.md)
- Configure Stripe billing: [`docs/runbooks/configure-stripe-billing.md`](runbooks/configure-stripe-billing.md)
- Canonical deploy targets: [`config/deploy-targets.json`](../config/deploy-targets.json)
- Update OpenPath submodule: [`docs/runbooks/update-openpath-submodule.md`](runbooks/update-openpath-submodule.md)
- Docker + Nginx Proxy Manager: [`docs/DOCKER.md`](DOCKER.md)
- Production secrets (GitHub Actions): [`docs/SECRETS.md`](SECRETS.md)
- Session/security model: [`docs/SESSION_SECURITY_MODEL.md`](SESSION_SECURITY_MODEL.md)

## Architecture Decisions

- ClassroomPath ADRs: [`docs/adr/`](adr/)
- OpenPath boundary contract: [`OpenPath/docs/adr/0010-public-spa-extension-surface.md`](../../OpenPath/docs/adr/0010-public-spa-extension-surface.md)

## Drafts And Historical Context

- Draft plans and design notes (may be empty between active efforts): [`docs/plans/`](plans/)
- Archive boundary and retention policy: [`docs/archive/README.md`](archive/README.md)
