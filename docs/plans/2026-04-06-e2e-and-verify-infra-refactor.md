# E2E And Verify Infra Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce the highest-risk duplication in ClassroomPath test infrastructure by centralizing E2E environment preparation, splitting mailbox providers behind an interface, and moving verify-lane policy out of shell into typed Node code.

**Architecture:** Keep the current behavior and verification guarantees, but introduce explicit contracts at the seams that are currently implicit. `global-setup.ts` should become a thin adapter over a declarative environment runner, mailbox selection should happen through a `MailboxProvider` contract, and `verify-full.sh` should become a small shell wrapper over a typed Node orchestrator that owns verification policy and reporting.

**Tech Stack:** TypeScript, Node test runner (`node --import tsx --test`), Playwright, Bash wrapper scripts, existing ClassroomPath E2E helpers.

### Task 1: Add RED tests for the new seams

**Files:**

- Modify: `ClassroomPath/tests/e2e/setup/global-setup.test.ts`
- Modify: `ClassroomPath/tests/deployment.test.ts`
- Create: `ClassroomPath/tests/e2e/fixtures/mailbox-providers.test.ts`

**Step 1: Write failing tests**

- Assert that global setup delegates environment prep to a reusable runner/plan instead of inlining seed/reset command policy.
- Assert that mailbox creation resolves through a provider interface and that local sink vs Mail.tm are separate implementations.
- Assert that the verify lane shell script delegates to a Node orchestrator and that the Playwright skip policy lives outside shell.

**Step 2: Run targeted tests to verify failure**

- Run: `node --import tsx --test tests/e2e/setup/global-setup.test.ts tests/e2e/fixtures/mailbox-providers.test.ts tests/deployment.test.ts`

### Task 2: Extract the declarative E2E environment runner

**Files:**

- Create: `ClassroomPath/tests/e2e/setup/test-environment.ts`
- Modify: `ClassroomPath/tests/e2e/setup/global-setup.ts`

**Step 1: Introduce a runner that computes and executes setup phases**

- Health wait
- Optional DB push policy
- Optional truncate-only reset
- Seed policy
- Local email sink cleanup

**Step 2: Keep global setup as a thin Playwright adapter**

- Dependency injection for tests should stay available.
- No product behavior change.

### Task 3: Split mailbox providers behind a contract

**Files:**

- Create: `ClassroomPath/tests/e2e/fixtures/mailbox-provider.ts`
- Create: `ClassroomPath/tests/e2e/fixtures/mailboxes/local-sink-provider.ts`
- Create: `ClassroomPath/tests/e2e/fixtures/mailboxes/mailtm-provider.ts`
- Modify: `ClassroomPath/tests/e2e/fixtures/mailtm.ts`
- Modify: `ClassroomPath/tests/e2e/fixtures/base-test.ts`
- Modify: `ClassroomPath/tests/e2e/auth-email.spec.ts`

**Step 1: Introduce the provider interface and move branching there**

- `createMailboxFixture()` should become a compatibility wrapper or thin selector.
- Message parsing utilities should stay shared instead of duplicated.

**Step 2: Re-run targeted tests**

- Run: `node --import tsx --test tests/e2e/fixtures/mailbox-providers.test.ts tests/e2e/setup/global-setup.test.ts`

### Task 4: Move verify policy into a typed Node orchestrator

**Files:**

- Create: `ClassroomPath/scripts/verify-full.mjs`
- Modify: `ClassroomPath/scripts/verify-full.sh`
- Modify: `ClassroomPath/package.json`
- Modify: `ClassroomPath/tests/deployment.test.ts`

**Step 1: Introduce a Node orchestrator**

- Model verify mode and lane selection explicitly.
- Own the Playwright JSON report parsing and skipped-test failure policy.
- Print commands and delegate actual execution to shell/npm tools.

**Step 2: Reduce shell to bootstrap/wrapper concerns**

- Preserve existing entrypoint names.
- Avoid changing user-facing `npm run verify:*` commands.

### Task 5: Verify and land

**Files:**

- No additional product files expected beyond the new helpers, tests, and plan doc

**Step 1: Run targeted regression suites**

- Run: `node --import tsx --test tests/e2e/setup/global-setup.test.ts tests/e2e/fixtures/mailbox-providers.test.ts tests/deployment.test.ts`

**Step 2: Run full local verification**

- Run: `npm run verify:commit`

**Step 3: Commit**

- Commit message target: `refactor(testing): centralize e2e setup and verify orchestration`
