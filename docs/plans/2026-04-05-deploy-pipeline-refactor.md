# Deploy Pipeline Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the highest-risk duplication from the staging/production deploy pipeline by centralizing tool-image execution, using a single release-manifest contract across boundaries, and splitting the remote staging deploy into explicit phases.

**Architecture:** Keep the existing deployment behavior and release-candidate promotion flow, but move repeated logic behind small shell helpers. Treat the release manifest as the authoritative contract at script boundaries instead of hand-copying image values through multiple shell variables. Refactor the staging remote deploy into named phases so failures, retries, and future tests have clear seams.

**Tech Stack:** Bash, GitHub Actions YAML, Node test runner (`node --import tsx --test`), existing ClassroomPath deployment shell helpers.

### Task 1: Add RED tests for the target architecture

**Files:**
- Modify: `ClassroomPath/tests/deployment.test.ts`

**Step 1: Write failing tests**
- Assert that staging local deploy writes/uses a release manifest file instead of manually parsing each output key.
- Assert that production deploy consumes a single release-manifest payload in the SSH boundary instead of individual image envs.
- Assert that a shared helper exists for tool images and that migrations, runtime validation, and smoke reuse it.
- Assert that `deploy-staging-remote.sh` is organized into named phase functions and calls them in order.

**Step 2: Run the targeted test file to verify failure**
- Run: `node --import tsx --test tests/deployment.test.ts`

### Task 2: Introduce shared deploy shell helpers

**Files:**
- Create: `ClassroomPath/scripts/lib/deploy-images.sh`
- Create: `ClassroomPath/scripts/lib/release-manifest.sh`
- Modify: `ClassroomPath/scripts/lib/common.sh`

**Step 1: Add minimal shared helpers**
- `deploy-images.sh` should own image ensure/fallback/required-run helpers.
- `release-manifest.sh` should own loading a `.env` manifest, reading required keys, and decoding a base64 manifest into a temp file.

**Step 2: Keep helpers generic but small**
- No new product behavior.
- Only centralize repeated deploy-shell logic.

### Task 3: Migrate image-execution scripts to the shared helper

**Files:**
- Modify: `ClassroomPath/scripts/run-migrations-docker.sh`
- Modify: `ClassroomPath/scripts/validate-runtime-config-docker.sh`
- Modify: `ClassroomPath/scripts/run-smoke-in-verifier.sh`

**Step 1: Replace duplicated docker image selection/pull logic**
- Reuse the new shared helper for required prebuilt images and pinned-node fallback behavior.

**Step 2: Re-run targeted tests**
- Run: `node --import tsx --test tests/deployment.test.ts`

### Task 4: Move staging and production to a single release-manifest contract

**Files:**
- Modify: `ClassroomPath/scripts/deploy-staging-local.sh`
- Modify: `ClassroomPath/scripts/deploy-staging-remote.sh`
- Modify: `ClassroomPath/scripts/deploy-production-remote.sh`
- Modify: `ClassroomPath/.github/workflows/deploy.yml`

**Step 1: Staging local**
- Write the resolved RC manifest to a file.
- Stop manual key-by-key parsing loops.
- Send the manifest as a single payload to the remote deploy.

**Step 2: Staging remote**
- Decode/load the manifest once and read required fields from helper functions.

**Step 3: Production**
- Pass one manifest payload into the SSH deploy boundary.
- Load the same manifest helper remotely instead of depending on a hand-maintained list of image env vars.

### Task 5: Refactor the staging remote deploy into phases

**Files:**
- Modify: `ClassroomPath/scripts/deploy-staging-remote.sh`

**Step 1: Extract named functions**
- Checkout/state prep
- Runtime validation
- Disk cleanup
- Migration execution
- Runtime start
- Health/readiness wait

**Step 2: Keep existing rollback and evidence behavior**
- No semantic change to the promotion guarantees.

### Task 6: Verify and land

**Files:**
- No new product files expected beyond the helpers and plan doc

**Step 1: Run deploy regression tests**
- Run: `node --import tsx --test tests/deployment.test.ts`

**Step 2: Review git diff and commit**
- Commit message target: `refactor(deploy): unify manifest and tool-image flow`

**Step 3: If promotion logic changed in a way that needs real confidence, rerun staging**
- Run: `npm run deploy:staging`

