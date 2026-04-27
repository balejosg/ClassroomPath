# ClassroomPath Documentation Index

> Status: maintained
> Applies to: first-party ClassroomPath documentation
> Last verified: 2026-04-16
> Source of truth: `docs/INDEX.md`

This index is the entrypoint for the maintained ClassroomPath documentation set.

Rules:

- Canonical technical and operational docs are maintained in English.
- The buyer-facing guide under `docs/evaluation/es/` is a maintained Spanish exception for school IT evaluation.
- Draft docs may change or disappear without notice.
- Archived docs are historical context only and must not be treated as operational runbooks.

## Start Here

- Repository overview and operator-facing summary: [`README.md`](../README.md)
- Agent workflow, environment identification, and deployment rules: [`AGENTS.md`](../AGENTS.md)
- Workspace routing and search policy: `agent-manifest.json` in the workspace root
- OpenPath documentation index: [`upstream/openpath/docs/INDEX.md`](../upstream/openpath/docs/INDEX.md)
- OpenPath SPA wrapper boundary: [`upstream/openpath/docs/adr/0010-public-spa-extension-surface.md`](../upstream/openpath/docs/adr/0010-public-spa-extension-surface.md)

## Canonical Contracts

- Environment variables and runtime policy: [`docs/contracts/env.md`](contracts/env.md)
- Public routes, passthroughs, and port wiring: [`docs/contracts/routes-ports.md`](contracts/routes-ports.md)
- Cross-system mutation ledger and retry model: [`docs/contracts/cross-system-mutations.md`](contracts/cross-system-mutations.md)
- Verification matrix: [`docs/verification-matrix.md`](verification-matrix.md)

## Evaluation

- Security and trust overview: [`docs/evaluation/security-trust.md`](evaluation/security-trust.md)
- Claims and evidence map: [`docs/evaluation/claims-and-evidence.md`](evaluation/claims-and-evidence.md)
- Compatibility matrix: [`docs/evaluation/compatibility-matrix.md`](evaluation/compatibility-matrix.md)
- IT evaluation checklist: [`docs/evaluation/it-evaluation-checklist.md`](evaluation/it-evaluation-checklist.md)
- Pilot runbook: [`docs/evaluation/pilot-runbook.md`](evaluation/pilot-runbook.md)
- IT objections FAQ: [`docs/evaluation/faq-it-objections.md`](evaluation/faq-it-objections.md)
- OpenPath vs. ClassroomPath: [`docs/evaluation/openpath-vs-classroompath.md`](evaluation/openpath-vs-classroompath.md)
- Spanish guide for school IT teams: [`docs/evaluation/es/guia-evaluacion-centros.md`](evaluation/es/guia-evaluacion-centros.md)

## Operations

- Shared workspace hypothesis-validation wrapper: [`../../scripts/validate-hypothesis.sh`](../../scripts/validate-hypothesis.sh)
- Direct Windows runner diagnostic: [`scripts/run-windows-ajax-direct.mjs`](../scripts/run-windows-ajax-direct.mjs)
- Deploy staging (local SSH workflow after push): [`docs/runbooks/deploy-staging.md`](runbooks/deploy-staging.md)
- Deploy production (tag-only promotion): [`docs/runbooks/deploy-production.md`](runbooks/deploy-production.md)
- Configure Stripe billing: [`docs/runbooks/configure-stripe-billing.md`](runbooks/configure-stripe-billing.md)
- Canonical deploy targets: [`config/deploy-targets.json`](../config/deploy-targets.json)
- Update OpenPath submodule: [`docs/runbooks/update-openpath-submodule.md`](runbooks/update-openpath-submodule.md)
- Docker + Nginx Proxy Manager: [`docs/DOCKER.md`](DOCKER.md)
- Production secrets (GitHub Actions): [`docs/SECRETS.md`](SECRETS.md)
- Session/security model: [`docs/SESSION_SECURITY_MODEL.md`](SESSION_SECURITY_MODEL.md)

## Architecture Decisions

- Cross-system mutation ledger ADR: [`docs/adr/0001-cross-system-mutation-ledger.md`](adr/0001-cross-system-mutation-ledger.md)
- Release risk gating ADR: [`docs/adr/0002-release-risk-gating.md`](adr/0002-release-risk-gating.md)
- OpenPath boundary contract: [`upstream/openpath/docs/adr/0010-public-spa-extension-surface.md`](../upstream/openpath/docs/adr/0010-public-spa-extension-surface.md)

## Drafts And Historical Context

- Draft plans and design notes (may be empty between active efforts): [`docs/plans/README.md`](plans/README.md)
- Archive boundary and retention policy: [`docs/archive/README.md`](archive/README.md)
