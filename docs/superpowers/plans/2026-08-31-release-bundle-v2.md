# Release Bundle v2 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

Goal: Make ClassroomPath consume the exact OpenPath v2 promotion contract and carry one immutable Release Bundle v2 identity through RC, staging, evidence, production, and rollback.

Architecture: Add a self-contained ClassroomPath contract boundary that resolves only the gitlink SHA URL, preserves downloaded bytes, and exposes validated provenance. Build a deterministic bundle from that contract and OCI digest references. Keep existing manifest/state formats only as projections during migration, while active workflows and deployment paths consume the bundle and releaseId.

Tech Stack: Node.js 20 ESM, TypeScript tests through tsx/node:test, Bash deployment helpers, GitHub Actions YAML, OCI image labels, JSON and environment-file artifacts.

---

## 1. Exact contract boundary

Files:

- Add: scripts/lib/openpath-promotion-contract.mjs
- Add: scripts/resolve-openpath-promotion-contract.mjs
- Add: tests/openpath-promotion-contract.test.ts
- Modify: package.json only if a focused test script is needed

Steps:

- [ ] Write tests for the v2 URL built from one full lowercase SHA, exact SHA mismatch, unsupported schema/interface, missing component, malformed JSON, non-OK response, and exact bytes containing insignificant JSON whitespace.
- [ ] Write a test proving the resolver makes one request for the exact v2 URL and never tries an ancestor, branch, tag, latest, or composed component URL.
- [ ] Run node --import tsx --test tests/openpath-promotion-contract.test.ts; record the expected red failure because the module does not exist.
- [ ] Implement constants for the v2 base URL and supported interface versions.
- [ ] Implement exact URL construction and strict SHA/hash validation.
- [ ] Implement byte-preserving parse and validation. Compute contractSha256 from the received Buffer before any JSON serialization.
- [ ] Implement injected-fetch resolution and gitlink SHA resolution from git rev-parse HEAD:upstream/openpath.
- [ ] Implement the CLI to write the exact contract artifact and machine-readable SHA/URL outputs without emitting the contract through a line-oriented output channel.
- [ ] Rerun the focused test and confirm green.
- [ ] Run prettier on only the new files and git diff --check.

## 2. Release Bundle v2 and releaseId

Files:

- Add: scripts/lib/release-bundle.mjs
- Add: tests/release-bundle.test.ts
- Modify: scripts/lib/release-manifest.mjs
- Modify: scripts/lib/release-manifest.sh

Steps:

- [ ] Write tests for deterministic key order, newline/byte identity, releaseId SHA-256, invalid SHA/hash fields, tag-only image references, missing image keys, unknown volatile fields, contract hash mismatch, and OpenPath source SHA mismatch.
- [ ] Run the focused bundle test before implementation and confirm red.
- [ ] Implement a strict v2 bundle schema with exactly schemaVersion, classroomPathSha, openPath.sourceSha, openPath.contractSha256, and the six named image references.
- [ ] Require every image reference to be repository@sha256:<64 lowercase hex> and reject mutable tags.
- [ ] Implement canonical serialization with fixed key order and a single terminal newline. Keep releaseId outside the serialized bundle and derive it only from serialized bytes.
- [ ] Implement artifact verification against exact bundle bytes and exact contract bytes.
- [ ] Implement helpers to write bundle and contract artifacts atomically and to project validated contract values into legacy runtime fields.
- [ ] Extend shell manifest/runtime validation so v2 paths require releaseId, OpenPath source SHA, and contract hash while old fields can only be loaded as projections.
- [ ] Rerun focused tests and run the existing release-manifest tests.

## 3. OpenPath provenance, reuse, and legacy resolver migration

Files:

- Modify: .github/actions/build-release-candidate-image/action.yml
- Modify: .github/workflows/reusable-release-candidate-image-family.yml
- Modify: scripts/resolve-openpath-linux-agent-version.mjs
- Modify: scripts/resolve-windows-offline-installer-template-pin.mjs
- Modify: scripts/lib/release-images.mjs
- Modify: scripts/lib/release-manifest.mjs
- Add or modify: tests/release-images.test.ts
- Add or modify: tests/openpath-linux-agent-version.test.ts
- Add or modify: tests/resolve-windows-offline-installer-template-pin.test.ts

Steps:

- [ ] Add failing tests that verify OpenPath-derived image builds receive both OCI provenance labels and that a changed contract hash cannot reuse an old derived image.
- [ ] Add failing tests that Linux and Windows helpers reject selector inputs and verify only values projected from a validated v2 contract.
- [ ] Run the focused tests and confirm red.
- [ ] Pass OpenPath source SHA and contract hash through reusable image-family workflow calls into the build action.
- [ ] Apply org.opencontainers.image.revision and eu.classroompath.openpath.contract-sha256 to OpenPath-derived image builds.
- [ ] Add image-config verification before bundle publication.
- [ ] Replace Linux ancestor/contract selection with a verifier over the exact contract projection; keep package, APT suite, extension ID, and manifest checks as physical validators.
- [ ] Replace Windows VERSION/tag/sidecar selection with a verifier over the contract template tuple; preserve only exact artifact validation.
- [ ] Make release image output helpers carry immutable digest references and provenance metadata.
- [ ] Rerun focused and existing resolver/image tests.

## 4. Release-candidate workflow and artifacts

Files:

- Modify: .github/workflows/release-candidate-images.yml
- Modify: .github/workflows/firefox-release-assets.yml if its contract input is required
- Modify: scripts/lib/release-candidate.mjs
- Modify: scripts/lib/release-plan.mjs
- Modify: scripts/wait-for-release-candidate.mjs
- Modify: tests/workflow-release-candidate.test.ts
- Add or modify: tests/release-candidate.test.ts

Steps:

- [ ] Add failing workflow/source tests requiring exact contract resolution from the checked-out gitlink, bundle and exact contract artifacts, releaseId output, and absence of ancestor/latest/independent Linux/Windows selectors.
- [ ] Add a failing candidate test for same contract hash reuse versus changed-hash rebuild.
- [ ] Run the focused workflow/candidate tests and confirm red.
- [ ] Make the RC workflow resolve the exact contract before component detection and expose contract bytes/hash as job outputs/artifacts.
- [ ] Build or reuse image families from the bundle inputs, verify digest references and OpenPath labels, then serialize the bundle from the exact app SHA and digests.
- [ ] Upload classroompath-release-bundle.json, openpath-promotion-contract.json, and a releaseId-bound evidence artifact from the RC run.
- [ ] Keep release-candidate-images.env only as a generated projection of the bundle; remove independent Linux and Windows authority.
- [ ] Make Firefox assets and OpenPath-derived image jobs consume the resolved contract inputs rather than discover versions.
- [ ] Rerun focused tests and YAML/script syntax checks.

## 5. Persistent release state and staging consumption

Files:

- Modify: scripts/lib/release-state-contract.mjs
- Modify: scripts/lib/deployment-state.sh
- Modify: scripts/lib/release-runtime.sh
- Modify: scripts/deploy-staging-remote.sh
- Modify: scripts/lib/staging-deploy-local-release.sh
- Modify: scripts/lib/release-manifest.sh
- Modify: tests/release-state-cli.test.ts
- Modify: tests/deployment-foundation.test.ts
- Modify: tests/deployment-staging-release.test.ts
- Modify: tests/deployment-runtime-config.test.ts
- Modify: tests/deployment-runtime-contracts.test.ts

Steps:

- [ ] Add failing tests for release-state/releases/<releaseId>/, current/previous ID pointers, exact bundle/contract hash verification, and failed activation preserving the previous valid pointer.
- [ ] Add failing tests that staging refuses a mismatched releaseId, OpenPath SHA, contract hash, digest, Windows pin, or Linux pin.
- [ ] Run focused deployment/state tests and confirm red.
- [ ] Extend state snapshots with RELEASE_ID, APP_SHA, OPENPATH_SHA, and OPENPATH_CONTRACT_SHA256, with bundle and contract paths under the releaseId directory.
- [ ] Make staging load one bundle and exact contract artifact, verify all identities and physical pins, and materialize legacy environment variables only from the verified projection.
- [ ] Store current and previous as atomic release ID pointers and retain both referenced template/assets generations.
- [ ] Activate only after health/readiness; preserve valid state when reprovision or readiness fails.
- [ ] Ensure the local staging release path uses the same bundle verification code as the remote path.
- [ ] Rerun focused deployment/state tests and shell syntax checks.

## 6. Evidence, production tag, promotion, and resume identity

Files:

- Modify: scripts/lib/release-evidence-snapshot.mjs
- Modify: scripts/lib/release-evidence-bundle.mjs
- Modify: scripts/release-evidence-bundle.mjs
- Modify: scripts/promotion-evidence-cli.mjs
- Modify: scripts/tag-production-release.sh
- Modify: scripts/verify-production-promotion-ready.sh
- Modify: scripts/lib/release-orchestration.mjs
- Modify: scripts/release-promote.mjs
- Modify: scripts/deploy-production-remote.sh
- Modify: scripts/lib/deploy-production-context.sh
- Modify: scripts/lib/deploy-production-runtime.sh
- Modify: .github/workflows/deploy.yml
- Modify: tests/release-evidence-bundle.test.ts
- Modify: tests/release-orchestration.test.ts
- Modify: tests/release-promote-resume.test.ts
- Modify: tests/release-execution.test.ts
- Add or modify: tests/production-promotion-contract.test.ts

Steps:

- [ ] Add failing tests that evidence.releaseId equals bundle hash and live RELEASE_ID, and that a different ID is rejected.
- [ ] Add failing tests for annotated tag fields ClassroomPath-Release-Id and ClassroomPath-RC-Run-Id, tag target equality, same-identity idempotency, and conflicting-identity failure.
- [ ] Add failing resume tests proving skip/resume/only cannot cross release IDs.
- [ ] Run focused promotion/evidence tests and confirm red.
- [ ] Bind all evidence snapshots and bundles to releaseId while retaining app SHA as a secondary field.
- [ ] Make production readiness obtain the exact bundle from the RC run locator, verify its hash/contract/target, and avoid re-resolution or rebuilding.
- [ ] Make tag creation logic render required annotations and fail closed for lightweight or conflicting tags; keep the CLI capable of dry-run validation without pushing.
- [ ] Carry one verified bundle through production deploy payload and runtime state.
- [ ] Bind persisted promotion steps to releaseId and reject a resume with another bundle.
- [ ] Rerun focused tests and shell syntax checks. Do not invoke tag, release, deploy, or push commands.

## 7. Exact rollback and legacy authority removal

Files:

- Modify: scripts/lib/staging-rollback.sh
- Modify: scripts/rollback-production-remote.sh
- Modify: scripts/lib/release-runtime.sh
- Modify: scripts/lib/deployment-state.sh
- Modify: scripts/resolve-openpath-linux-agent-version.mjs
- Modify: scripts/resolve-windows-offline-installer-template-pin.mjs
- Modify: tests/staging-rollback.test.ts
- Modify: tests/rollback-production-remote.test.ts
- Modify: tests/release-manifest.test.ts

Steps:

- [ ] Add failing tests that rollback selects only previous releaseId, verifies the stored bundle and contract, and never derives a current remote version.
- [ ] Add failing tests for missing Linux APT suite in a stored snapshot and for stale Windows/Linux selector values.
- [ ] Run focused rollback tests and confirm red.
- [ ] Restore the exact previous bundle, image digests, Linux APT/package pin, Windows template and generated assets.
- [ ] Verify health/readiness before atomically switching current to previous.
- [ ] Remove active selector behavior and retain only verifier/projection seams until no consumer references them.
- [ ] Ensure legacy fields are generated from the contract and are rejected when they conflict with it.
- [ ] Rerun focused rollback/manifest tests and search active workflows/scripts for forbidden selector/fallback patterns.

## 8. Documentation, complete local verification, and landing

Files:

- Modify: docs/release\* or the relevant docs index/runbook files identified by existing documentation tests
- Modify: docs/superpowers/specs/2026-08-31-release-bundle-v2-design.md if implementation details require correction
- Modify: docs/superpowers/plans/2026-08-31-release-bundle-v2.md if task status is recorded in-file

Steps:

- [ ] Document the exact contract URL rule, byte hash rule, bundle schema, releaseId, OCI labels, reuse rule, state layout, and no-fallback policy.
- [ ] Run npm run format:check.
- [ ] Run npm run verify:docs.
- [ ] Run npm run verify:public-surface.
- [ ] Run npm run test:deployment.
- [ ] Run npm run test:ci-regression.
- [ ] Run npm run verify:scripts-types.
- [ ] Run npm run verify:commit if the full local lane is available without external deployment.
- [ ] Inspect git status and staged diffs separately in ClassroomPath; confirm the root Whitelist changes and OpenPath checkout remain untouched except for the authorized ClassroomPath gitlink.
- [ ] Record limitations precisely: local/unit/contract evidence only, no staging/production evidence, no tag/release/push.
- [ ] Before ending, use verification-before-completion and landing-the-plane. Do not push because the user explicitly prohibited it.
