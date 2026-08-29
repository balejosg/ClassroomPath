# ClassroomPath Documentation Index

> Status: maintained
> Applies to: first-party ClassroomPath documentation
> Last verified: 2026-08-29
> Source of truth: `docs/INDEX.md`

This index is the entrypoint for the maintained ClassroomPath documentation set.

Rules:

- Canonical technical and operational docs are maintained in English.
- The buyer-facing guide under `docs/evaluation/es/` is a maintained Spanish exception for school IT evaluation.
- Draft docs may change or disappear without notice.
- Archived docs are historical context only and must not be treated as operational runbooks.

## Start Here

- Repository overview and public positioning: [`README.md`](../README.md)
- Security reporting policy: [`SECURITY.md`](../SECURITY.md)
- Agent workflow and public repository rules: [`AGENTS.md`](../AGENTS.md)
- Workspace routing and search policy: `agent-manifest.json` in the workspace root
- OpenPath documentation index: [`upstream/openpath/docs/INDEX.md`](../upstream/openpath/docs/INDEX.md)
- OpenPath SPA wrapper boundary: [`upstream/openpath/docs/adr/0010-public-spa-extension-surface.md`](../upstream/openpath/docs/adr/0010-public-spa-extension-surface.md)

## Canonical Contracts

- Environment variables and runtime policy: [`docs/contracts/env.md`](contracts/env.md)
- Public routes, passthroughs, and port wiring: [`docs/contracts/routes-ports.md`](contracts/routes-ports.md)
- Cross-system mutation ledger and retry model: [`docs/contracts/cross-system-mutations.md`](contracts/cross-system-mutations.md)
- OpenPath public SPA surface and wrapper bridge: [`docs/contracts/openpath-public-surface.md`](contracts/openpath-public-surface.md)
- Test inventory (which test guards which contract): [`docs/test-inventory.md`](test-inventory.md)
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

## Public Operations Boundary

- CI/CD signal inventory: [`docs/ci-cd-signal-inventory.md`](ci-cd-signal-inventory.md)
- Public staging deployment note: [`docs/runbooks/deploy-staging.md`](runbooks/deploy-staging.md)
- Public production deployment note: [`docs/runbooks/deploy-production.md`](runbooks/deploy-production.md)
- Public billing provider note: [`docs/runbooks/configure-stripe-billing.md`](runbooks/configure-stripe-billing.md)
- Public staging QA note: [`docs/runbooks/staging-qa-fixtures.md`](runbooks/staging-qa-fixtures.md)
- Public Windows runner recovery note: [`docs/runbooks/windows-runner-recovery.md`](runbooks/windows-runner-recovery.md)
- Windows offline installer legacy retirement: [`docs/runbooks/windows-offline-installer-legacy-retirement.md`](runbooks/windows-offline-installer-legacy-retirement.md)
- Deploy target example: [`config/deploy-targets.example.json`](../config/deploy-targets.example.json)
- Update OpenPath submodule boundary: [`docs/runbooks/update-openpath-submodule.md`](runbooks/update-openpath-submodule.md)
- Add a cross-system mutation: [`docs/runbooks/add-cross-system-mutation.md`](runbooks/add-cross-system-mutation.md)
- Add a database table: [`docs/runbooks/add-database-table.md`](runbooks/add-database-table.md)
- Write integration tests (canonical harness, signToken, scenario builder): [`docs/runbooks/write-integration-tests.md`](runbooks/write-integration-tests.md)
- Docker + Nginx Proxy Manager: [`docs/DOCKER.md`](DOCKER.md)
- Secrets and private operations: [`docs/SECRETS.md`](SECRETS.md)
- Session/security model: [`docs/SESSION_SECURITY_MODEL.md`](SESSION_SECURITY_MODEL.md)
- Public readiness notes: [`docs/PUBLICATION-READINESS.md`](PUBLICATION-READINESS.md)

## Architecture Decisions

- Cross-system mutation ledger ADR: [`docs/adr/0001-cross-system-mutation-ledger.md`](adr/0001-cross-system-mutation-ledger.md)
- Release risk gating ADR: [`docs/adr/0002-release-risk-gating.md`](adr/0002-release-risk-gating.md)
- Tenant isolation application-layer ADR: [`docs/adr/0003-tenant-isolation-application-layer.md`](adr/0003-tenant-isolation-application-layer.md)
- OpenPath boundary contract: [`upstream/openpath/docs/adr/0010-public-spa-extension-surface.md`](../upstream/openpath/docs/adr/0010-public-spa-extension-surface.md)

## Drafts And Historical Context

- Draft plans and design notes (may be empty between active efforts): [`docs/plans/README.md`](plans/README.md)
  - `docs/plans/2026-04-22-openpath-apt-wait.md` -- OpenPath APT wait implementation plan
  - `docs/plans/2026-04-30-existing-user-invitation-org-transfer-design.md` -- existing-user invitation org-transfer design
- Archive boundary and retention policy: [`docs/archive/README.md`](archive/README.md)
