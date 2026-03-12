# Production Release Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an enforced staging preflight so production deploys only proceed after a live release gate verifies the auth/email verification path is launch-safe.

**Architecture:** Keep the existing smoke suite for broad health checks, add a separate release-gate live test for launch-blocking auth assertions, and make the production deploy workflow depend on that gate. Preserve the manual UAT checklist as a human sign-off layer, but stop relying on it as the only control.

**Tech Stack:** GitHub Actions, Node test runner with `tsx`, live tRPC calls against ClassroomPath staging

### Task 1: Add failing release-gate policy tests

**Files:**

- Create: `ClassroomPath/tests/release-gate-policy.test.ts`
- Create: `ClassroomPath/tests/release-gate-policy.ts`

**Step 1: Write the failing test**

- Assert the policy rejects localhost verification URLs, wrong hosts, missing `emailSent`, and missing `verificationRequired`.

**Step 2: Run test to verify it fails**

Run: `cd ClassroomPath && node --import tsx --test tests/release-gate-policy.test.ts`

**Step 3: Write minimal implementation**

- Add tiny helpers that parse the target environment origin and validate the verification delivery payload.

**Step 4: Run test to verify it passes**

Run: `cd ClassroomPath && node --import tsx --test tests/release-gate-policy.test.ts`

### Task 2: Add the live release-gate test

**Files:**

- Create: `ClassroomPath/tests/release-gate.test.ts`
- Modify: `ClassroomPath/package.json`

**Step 1: Write the failing test**

- Add a live test that calls `auth.register` and `auth.generateEmailVerificationToken` against `RELEASE_GATE_URL`, asserting `emailSent === true` and a public verification URL on the same origin.

**Step 2: Run test to verify it fails**

Run: `cd ClassroomPath && RELEASE_GATE_URL=https://classroompath-staging.duckdns.org RELEASE_GATE_ALLOW_MUTATIONS=1 node --import tsx --test tests/release-gate.test.ts`

**Step 3: Write minimal implementation**

- Reuse the policy helper and add only the smallest live-fetch helpers needed.
- Add `test:release-gate` and `test:release-gate:staging` npm scripts.

**Step 4: Run test to verify it passes**

Run: `cd ClassroomPath && RELEASE_GATE_URL=https://classroompath-staging.duckdns.org RELEASE_GATE_ALLOW_MUTATIONS=1 node --import tsx --test tests/release-gate.test.ts`

### Task 3: Enforce the gate in production deploy

**Files:**

- Modify: `ClassroomPath/.github/workflows/deploy.yml`

**Step 1: Write the failing test**

- The “failure” here is structural: production deploy currently proceeds without a staging auth preflight. Capture that by making the workflow require a new gate job before `deploy-production`.

**Step 2: Write minimal implementation**

- Add a `release-gate-production` job that installs dependencies and runs `npm run test:release-gate:staging`.
- Make `deploy-production` depend on `release-gate-production`.

**Step 3: Verify**

- Review the rendered workflow diff and ensure the job dependency chain is `release-gate-production -> deploy-production -> smoke-test-production`.

### Task 4: Align docs

**Files:**

- Modify: `ClassroomPath/README.md`
- Modify: `ClassroomPath/docs/plans/launch-uat-checklist.md`

**Step 1: Update docs**

- Document that production deploys now run a staging release gate first.
- Keep the manual UAT checklist as the final human layer and call out what remains manual.

**Step 2: Verify**

- Re-read the changed sections and ensure they match the workflow behavior exactly.
