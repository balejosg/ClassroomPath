# ClassroomPath #158 Runtime Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and restore the complete OpenPath Linux runtime tuple, reject incompatible production rollback inputs before any observable mutation, and derive the Windows installer tag entirely from its published template commit.

**Architecture:** Extend the existing typed release-state snapshot contract with `OPENPATH_LINUX_AGENT_APT_SUITE` and its staging verification counterpart. Add a shell-level, non-sourcing snapshot preflight that validates required keys and production RC-only policy before checkout or Docker work; staging keeps its source-build branch and only requires the Linux tuple for release-candidate rollback. Keep the current manifest, readiness gate, migration/storage safeguards, and OpenPath ownership boundaries unchanged.

**Tech Stack:** Bash deployment helpers, Node.js ESM/TypeScript `node:test` contract tests, YAML workflow contracts, Prettier, TypeScript, and the existing release manifest/state CLI.

---

### Task 1: Add failing snapshot/runtime contract tests

**Files:**

- Modify: `tests/release-state-cli.test.ts`
- Modify: `tests/deployment-runtime-contracts.test.ts`
- Modify: `tests/deployment-staging-release.test.ts`

- [x] **Step 1: Write the failing assertions**

Add `OPENPATH_LINUX_AGENT_APT_SUITE=stable` to the promotion-eligible runtime fixtures and assert that `write-snapshot --snapshot-type current-runtime` persists it. Add `STAGING_VERIFIED_OPENPATH_LINUX_AGENT_APT_SUITE=stable` to staging evidence fixtures and assert that the CLI rejects a mismatching suite. Extend the shell contract assertions to require the same field in the runtime writer, current-state schema, staging verification schema, production rollback `.env` restoration, and staging release-candidate rollback.

Add a regression fixture with a previous production snapshot that contains every current-runtime key except `OPENPATH_LINUX_AGENT_APT_SUITE`, while the process environment contains `OPENPATH_LINUX_AGENT_APT_SUITE=unstable`; assert that the rollback preflight exits non-zero and records no checkout, reset, submodule, `.env`, Docker, or activation call.

- [x] **Step 2: Run the focused tests and verify the expected failures**

Run:

```sh
npm exec -- node --import tsx --test \
  tests/release-state-cli.test.ts \
  tests/deployment-runtime-contracts.test.ts \
  tests/deployment-staging-release.test.ts
```

Expected: failures identify the missing APT snapshot field/propagation and the absent production preflight behavior; no implementation changes are made before these failures are observed.

### Task 2: Add the Windows published-commit regression

**Files:**

- Modify: `tests/workflow-release-candidate.test.ts`

- [x] **Step 1: Replace the stale source-contract expectation and add the mismatch scenario**

Change the workflow assertion from `git -C upstream/openpath show HEAD:VERSION` to the commit-qualified form. Add a temporary Git repository fixture whose HEAD contains `VERSION=4.2.0` and whose promotion-contract parent contains `VERSION=4.1.0`; run the exact commit-qualified `git show`/`rev-parse --short` commands used by the workflow and assert the resulting tag is `scripts-v4.1.0-<published-short-sha>`, never the HEAD-version tag.

- [x] **Step 2: Run the workflow regression and verify it fails on the current workflow**

Run:

```sh
npm exec -- node --import tsx --test tests/workflow-release-candidate.test.ts
```

Expected: the changed source-contract assertion fails because the current workflow still reads `HEAD:VERSION`.

### Task 3: Implement the canonical runtime snapshot extension

**Files:**

- Modify: `scripts/lib/release-state-contract.mjs`
- Modify: `scripts/release-state-cli.mjs`
- Modify: `scripts/lib/release-evidence-snapshot.mjs`
- Modify: `scripts/lib/release-state.sh`
- Modify: `scripts/lib/release-runtime.sh`
- Modify: `scripts/lib/deploy-production-runtime.sh`
- Modify: `scripts/deploy-staging-remote.sh`
- Modify: `scripts/run-staging-verification.sh`

- [x] **Step 1: Add the field to every existing typed and shell contract**

Insert `OPENPATH_LINUX_AGENT_APT_SUITE` immediately after `OPENPATH_LINUX_AGENT_VERSION` in `current-runtime`; insert `STAGING_VERIFIED_OPENPATH_LINUX_AGENT_APT_SUITE` immediately after the verified Linux agent version in `staging-verification`; mirror both additions in the shell fallback list. Add `EXPECTED_OPENPATH_LINUX_AGENT_APT_SUITE` to `expectedRuntimeFromEnv`, and compare the suite in both current-runtime and staging-verification eligibility checks.

- [x] **Step 2: Extend the existing positional runtime writer without creating a new manifest**

Change `write_release_runtime_state` to accept the APT suite after the Linux agent version, shift the SPA/template positional parameters, export the suite while writing `current-runtime`, and update both staging and production callers. Add the suite to `ensure_production_release_candidate_runtime_env` validation and to the staging resolved runtime variables. Set the staging verification field from the loaded current runtime and reset it to empty in pending evidence.

- [x] **Step 3: Run the focused snapshot tests**

Run:

```sh
npm exec -- node --import tsx --test \
  tests/release-state-cli.test.ts \
  tests/deployment-runtime-contracts.test.ts \
  tests/deployment-staging-release.test.ts
```

Expected: snapshot persistence, staging/production propagation, and evidence comparison tests pass; rollback preflight and workflow tests remain red until their tasks are complete.

### Task 4: Implement fail-closed snapshot and production rollback preflight

**Files:**

- Modify: `scripts/lib/release-state.sh`
- Modify: `scripts/lib/release-runtime.sh`
- Modify: `scripts/rollback-production-remote.sh`
- Modify: `scripts/lib/staging-rollback.sh`
- Modify: `tests/deployment-staging-release.test.ts`
- Modify: `tests/deployment-runtime-contracts.test.ts`

- [x] **Step 1: Add non-sourcing snapshot key validation**

Implement `release_state_snapshot_field_present` with `awk` key matching and `release_state_require_snapshot_fields <path> <snapshot-type> [fields...]`. When no explicit fields are supplied, validate every field returned by `release_state_list_fields`. Add `release_state_snapshot_value` for simple preflight decisions without sourcing the snapshot. Missing fields must emit an error and return non-zero.

- [x] **Step 2: Add a shared Linux runtime pin check**

Implement `require_openpath_linux_agent_runtime_pin` in `scripts/lib/release-runtime.sh`; it must require and export both `OPENPATH_LINUX_AGENT_VERSION` and `OPENPATH_LINUX_AGENT_APT_SUITE`, with no default or inferred suite. Keep the existing Windows pin helper unchanged except for using it alongside the Linux helper.

- [x] **Step 3: Gate production before loading or mutating runtime state**

In `rollback-production-remote.sh`, after state paths are initialized and before `deployment_state_load_previous_release`, validate all `current-runtime` keys in the previous snapshot and read `IMAGE_SOURCE` without sourcing. Reject every source other than `release-candidate`, including `source-build`, at that point. Only after that gate succeeds may the script source the snapshot, require all non-empty RC runtime fields including the Linux version/suite pair, and continue to the existing checkout, `.env`, Docker, readiness, and activation sequence. Write `OPENPATH_LINUX_AGENT_APT_SUITE` to `config/.env` before Docker operations.

- [x] **Step 4: Preserve staging source-build while requiring the tuple for RC rollback**

In `staging-rollback.sh`, inspect the snapshot image source before sourcing. Require the complete current-runtime key set for `release-candidate`; for `source-build`, require the fields needed by its existing rebuild path and explicitly unset/remove the Linux runtime suite before build. Use `require_openpath_linux_agent_runtime_pin` for RC rollback and retain the current readiness-before-current-state-copy ordering.

- [x] **Step 5: Run rollback tests and verify all mutation ordering**

Run:

```sh
npm exec -- node --import tsx --test tests/deployment-staging-release.test.ts
```

Expected: production `source-build`, missing-suite, stale-suite, and incomplete-snapshot cases fail closed with no mutation calls; release-candidate rollback restores version plus suite; staging RC/source-build paths and readiness behavior pass.

### Task 5: Correct the Windows template commit/version coupling

**Files:**

- Modify: `.github/workflows/release-candidate-images.yml`
- Modify: `tests/workflow-release-candidate.test.ts`

- [x] **Step 1: Read `VERSION` from the promotion contract commit**

In the existing `Resolve OpenPath installer template version` step, keep `OPENPATH_TEMPLATE_COMMIT` equal to the Linux resolver’s `openpath_promotion_contract_sha`, keep the short SHA from `git rev-parse --short "$OPENPATH_TEMPLATE_COMMIT"`, and change only the version lookup to `git -C upstream/openpath show "${OPENPATH_TEMPLATE_COMMIT}:VERSION"`. Keep the Windows pin’s `OPENPATH_VERSION` and `OPENPATH_SHORT_SHA` sourced from this step and do not use `linux_agent_version`.

- [x] **Step 2: Run the workflow tests**

Run:

```sh
npm exec -- node --import tsx --test \
  tests/workflow-release-candidate.test.ts \
  tests/resolve-windows-offline-installer-template-pin.test.ts
```

Expected: the HEAD/promotion-commit mismatch regression and all existing template pin tests pass.

### Task 6: Align documentation and verify no production source-build claim remains

**Files:**

- Modify: `docs/contracts/env.md`
- Modify: `docs/runbooks/windows-offline-installer-legacy-retirement.md`
- Modify: `tests/deployment-staging-release.test.ts`

- [x] **Step 1: Document the contract and production boundary**

Document `OPENPATH_LINUX_AGENT_APT_SUITE` as part of the persisted OpenPath runtime tuple and state that production automatic rollback accepts only release-candidate snapshots with the complete tuple. Clarify that `source-build` remains a staging recovery/debug mode and is rejected for production rollback before checkout/Docker mutation. Preserve the existing invocation-scoped retirement confirmation language.

- [x] **Step 2: Update contract assertions**

Change the staging/production rollback test wording so it no longer describes production `source-build` as compatible, while retaining the explicit staging source-build rebuild coverage and all readiness, storage, public URL, and ownership assertions.

- [x] **Step 3: Run documentation and contract checks**

Run:

```sh
npm run verify:docs
npm run verify:public-surface
npm run verify:scripts-types
```

Expected: all commands pass and no production documentation or comments claim `source-build` rollback compatibility.

### Task 7: Full local verification and landing

**Files:**

- Modify: all files listed above only; do not modify `OpenPath`.

- [x] **Step 1: Run the required focused suites**

Run:

```sh
npm exec -- node --import tsx --test \
  tests/release-state-cli.test.ts \
  tests/deployment-runtime-contracts.test.ts \
  tests/deployment-staging-release.test.ts \
  tests/release-manifest.test.ts \
  tests/release-manifest-platforms.test.ts \
  tests/openpath-linux-agent-version.test.ts \
  tests/resolve-windows-offline-installer-template-pin.test.ts \
  tests/workflow-release-candidate.test.ts
```

Expected: all focused tests pass.

- [x] **Step 2: Run the required project checks**

Run:

```sh
npm run test:deployment
npm run typecheck
npm run lint
npm run format:check
npm run verify:docs
npm run verify:public-surface
npm run verify:scripts-types
npm run verify:commit
```

Expected: all local commands pass. Do not run deploy, staging smoke, promotion, release, tag, push, or workflow-dispatch commands.

- [x] **Step 3: Inspect the final diff and commit locally**

Run `git diff --check`, `git status --short`, `git diff --stat`, and `git diff -- scripts .github docs tests package.json`. Confirm the OpenPath gitlink is unchanged and no unrelated checkout changes are included. Create a local Conventional Commit for the implementation only; do not push it.
