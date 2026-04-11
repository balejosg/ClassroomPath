# Release State, Risk, and Release Workflow Follow-ups Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move release-state validation into a small typed Node CLI, make client/canary risk policy declarative, and reduce release-candidate workflow duplication without changing its job graph.

**Architecture:** Keep remote deployment orchestration in shell, but move schema/policy logic into small `mjs` modules that shell wrappers and workflow scripts call. Extract repeated Docker build and manifest-publish workflow steps into local composite actions so the release-candidate workflow keeps the same topology and outputs with less duplicated YAML.

**Tech Stack:** Node ESM (`mjs`), GitHub composite actions, Bash wrappers, existing `tsx` test runner, existing release/workflow regression tests.

### Task 1: Add typed release-state contract and CLI

**Files:**

- Create: `scripts/lib/release-state-contract.mjs`
- Create: `scripts/release-state-cli.mjs`
- Modify: `scripts/lib/release-state.sh`
- Modify: `scripts/verify-staging-release-state.sh`
- Test: `tests/release-state-cli.test.ts`

**Steps:**

1. Define snapshot schemas and env parsing/serialization helpers in `scripts/lib/release-state-contract.mjs`.
2. Add `scripts/release-state-cli.mjs` with `write-snapshot` and `verify-staging` commands.
3. Keep `scripts/lib/release-state.sh` as compatibility layer, but let write paths delegate to the CLI when available.
4. Replace the handwritten staging verification flow in `scripts/verify-staging-release-state.sh` with a thin CLI wrapper.
5. Add focused tests for env parsing, snapshot writing, and staging verification outputs.

### Task 2: Make release-risk policy declarative

**Files:**

- Create: `scripts/lib/release-risk-policy.mjs`
- Create: `scripts/lib/release-risk.mjs`
- Create: `scripts/detect-windows-firefox-risk.mjs`
- Modify: `scripts/lib/release-risk.sh`
- Modify: `scripts/detect-windows-firefox-risk.sh`
- Test: `tests/release-risk.test.ts`
- Test: `tests/release-risk-policy.test.ts`

**Steps:**

1. Move high-risk path policy into a single exported catalog with rule ids and canary metadata.
2. Add typed risk helpers for target/base resolution and changed-file evaluation.
3. Convert `detect-windows-firefox-risk.sh` into a thin wrapper around the Node CLI.
4. Leave a shell compatibility layer in `scripts/lib/release-risk.sh` so existing callers can still source it.
5. Add tests that assert policy coverage and base-ref resolution still behave correctly.

### Task 3: Extract repeated release-candidate workflow steps

**Files:**

- Create: `.github/actions/build-release-candidate-image/action.yml`
- Create: `.github/actions/publish-release-candidate-manifest/action.yml`
- Modify: `.github/workflows/release-candidate-images.yml`
- Modify: `tests/workflow-config.test.ts`

**Steps:**

1. Extract repeated Docker setup, optional artifact download, and image build/push logic into `build-release-candidate-image`.
2. Extract repeated manifest merge/output logic into `publish-release-candidate-manifest`.
3. Rewire `release-candidate-images.yml` to use those actions while preserving job names, outputs, and dependencies.
4. Extend workflow regression tests to cover the new action files and ensure `.github/actions/**` stays CI-relevant.

### Task 4: Keep release automation coverage aligned

**Files:**

- Modify: `scripts/lib/verification-catalog.mjs`
- Modify: `tests/deployment.test.ts`
- Modify: `tests/workflow-config.test.ts`

**Steps:**

1. Register the new CLI/library/action paths in the verification catalog.
2. Update existing deployment/workflow assertions so they validate delegation to typed contracts and composite actions instead of old inline logic.
3. Include the new tests in the release automation regression plan.

### Task 5: Verify and land

**Files:**

- Modify: git metadata only

**Steps:**

1. Run `bash -n` on touched shell scripts.
2. Run focused `tsx` tests for deployment/workflow/release-state/risk changes.
3. Run `node scripts/check-new-file-coverage.js`.
4. Commit with a conventional commit.
5. Push `main` and wait for the relevant GitHub Actions runs to finish green.
