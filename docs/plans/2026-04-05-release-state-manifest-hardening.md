# Release State And Manifest Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden deploy promotion by validating the release manifest as a strict contract, centralizing release-state/evidence snapshots, and making production deployment phases explicit like staging.

**Architecture:** Add two small shell helpers under `scripts/lib/`: one for strict manifest validation and one for release-state/evidence snapshot I/O. Rewire staging and production scripts to consume those helpers and refactor production into named phases that mirror the staging deploy flow.

**Tech Stack:** Bash, Node test runner (`tests/deployment.test.ts`), GitHub Actions workflow shell integration.

### Task 1: Add RED deploy regressions

**Files:**

- Modify: `ClassroomPath/tests/deployment.test.ts`

**Step 1: Write the failing tests**

- Assert that `scripts/lib/release-manifest.sh` exposes strict contract validation.
- Assert that `scripts/lib/release-state.sh` exists and owns current-image plus staging-verification snapshot I/O.
- Assert that `scripts/deploy-production-remote.sh` is organized into explicit production phases.

**Step 2: Run the targeted RED checks**

- Run: `node --import tsx --test tests/deployment.test.ts --test-name-pattern "release manifest flows through staging and production as a single contract payload|release-state helpers centralize current-image and staging-verification evidence writes|production remote deploy executes explicit deployment phases in order"`

### Task 2: Introduce release-state helper

**Files:**

- Create: `ClassroomPath/scripts/lib/release-state.sh`
- Modify: `ClassroomPath/scripts/deploy-staging-remote.sh`
- Modify: `ClassroomPath/scripts/deploy-production-remote.sh`
- Modify: `ClassroomPath/scripts/persist-staging-verification-remote.sh`
- Modify: `ClassroomPath/scripts/verify-staging-release-state.sh`

**Step 1: Add generic snapshot helpers**

- `load_release_state_env()`
- `write_current_release_state()`
- `write_staging_verification_state()`

**Step 2: Reuse the helper**

- Make staging and production write `current-images.env` through the helper.
- Make staging verification persistence write `staging-verification.env` through the helper.
- Make staging state verification load env snapshots through the helper.

### Task 3: Harden release-manifest validation

**Files:**

- Modify: `ClassroomPath/scripts/lib/release-manifest.sh`
- Modify: `ClassroomPath/scripts/deploy-staging-remote.sh`
- Modify: `ClassroomPath/scripts/deploy-production-remote.sh`

**Step 1: Add strict validation**

- Require all manifest keys to exist and be non-empty.
- Validate repository shape, numeric run id, 40-char app sha, semantic-ish agent version, and image refs pinned by digest.
- Reject production promotion if manifest `app_sha` does not match `TARGET_SHA`.

**Step 2: Wire validation into runtime**

- Validate after decoding the manifest and before exporting runtime env vars.

### Task 4: Refactor production deployment into phases

**Files:**

- Modify: `ClassroomPath/scripts/deploy-production-remote.sh`

**Step 1: Extract named production phases**

- `prepare_production_checkout()`
- `load_production_release_manifest()`
- `classify_production_migration_risk()`
- `run_production_database_migrations()`
- `start_production_runtime()`
- `wait_for_production_runtime_readiness()`

**Step 2: Preserve semantics**

- Keep backup gating for destructive migrations.
- Keep helper reload after checkout.
- Keep current-image metadata persistence and readiness gates.

### Task 5: Verify and land

**Files:**

- Modify: `ClassroomPath/tests/deployment.test.ts`

**Step 1: Run deploy/workflow regressions**

- Run: `node --import tsx --test tests/deployment.test.ts`
- Run: `node --import tsx --test tests/workflow-config.test.ts`

**Step 2: Run shell syntax checks**

- Run: `bash -n scripts/deploy-production-remote.sh scripts/deploy-staging-remote.sh scripts/persist-staging-verification-remote.sh scripts/verify-staging-release-state.sh scripts/lib/release-manifest.sh scripts/lib/release-state.sh`

**Step 3: Commit**

- Commit message target: `refactor(deploy): harden release-state and manifest flow`
