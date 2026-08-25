# Windows Offline Installer production-safe implementation plan

> Approved input: user-provided implementation specification for issue #157.
> Scope: ClassroomPath only; no live deployment, promotion, tag, or smoke test.

## Contract and storage

1. Update `api/tests/windows-offline-installer-config.test.ts` first. Add red cases for full commit, release-independent runtime config, separate template/artifact directories, new-variable precedence, and legacy cache fallback.
2. Update `api/src/lib/windows-offline-installer-config.ts` to validate the canonical variables, expose `templateCommit`, `templateDir`, and `artifactsDir`, retain only the specified legacy fallback, and centralize non-throwing artifact-directory resolution for the download route.
3. Update template-loader tests, then `api/src/services/windows-offline-installer-template-cache.service.ts`: use `<templateDir>/<version>/<full-commit>/...`, validate sidecar and bytes, never fetch/create/repair.
4. Update artifact and route tests, then `api/src/services/windows-offline-installer-artifact.service.ts` and `api/src/server.ts`: read only from `templateDir`, write/stage/cleanup only in `artifactsDir`, and share canonical artifact-path resolution.
5. Run focused config/template/artifact/route tests.

## Readiness and deployment contract

6. Add red readiness tests covering every specified code and network silence. Implement `api/src/lib/windows-offline-installer-readiness.ts` with local hash checks and real temporary write/delete validation.
7. Extend gateway readiness and health-route tests so `ready` requires installer readiness and payload includes `offlineInstallerReady` plus safe status code only.
8. Add provisioner tests with injected fetch. Implement `scripts/provision-windows-offline-installer-template.mjs` with exact release-tag pin validation, public asset URLs, shared verify logic, atomic temporary publication, idempotence, safe reprovision, and mutation-free `--verify-only`.
9. Add the common deployment preflight helper and wire staging/production preflight sequences to provision then verify before gateway readiness. Do not invoke them against live infrastructure.
10. Update Docker contract tests, `docker/Dockerfile.cp-api`, and `docker/docker-compose.yml`: create internal mount points, RO template bind mount via deploy-side variable, RW named artifact volume, explicit container paths, no template in image.
11. Run provisioner, readiness, Docker/deployment contract tests.

## Frontend, canary, docs

12. Update frontend tests first to capture navigation inside temporary anchor click, prove second click generates B after A, prove no persistent consumed `href`, and preserve retry behavior.
13. Update `react-spa/src/components/WindowsOfflineInstallerAction.tsx`: remove installer URL cache, keep display metadata separate, expose `href` only for synchronous navigation, clear it immediately afterward.
14. Add canary tests and implement `scripts/windows-offline-installer-canary.mjs`: generate, download 200/attachment/non-empty/hash, reuse 410, safe serialized evidence, injected fetch/test seams.
15. Update `config/.env.example`, `docs/contracts/env.md`, and permitted public runbooks with canonical pins/paths, deprecated legacy variable, provisioning-before-runtime, and network-free readiness.
16. Run focused API/SPA/canary tests, then all required local gates:

```bash
npm run test:deployment
npm run verify:static
npm run verify:public-surface
npm run verify:docs
npm run verify:commit
```

17. Inspect diff/status, confirm no `upstream/openpath/` edits and no live-operation command was run, then report files, confirmed root cause, architecture, evidence, and real remaining risks.

## Verification invariants

- Runtime config never infers commit from version.
- Provisioner is the only networked template acquisition path; readiness and HTTP generation are local-only with respect to template acquisition.
- Template path and artifact path cannot overlap by construction in deployment defaults.
- Generation and download resolve the same artifact directory.
- Cleanup cannot target template files.
- Every frontend click mints a fresh single-use reference.
- Canary output contains no URL, raw reference, token, JWT, or authorization header.
