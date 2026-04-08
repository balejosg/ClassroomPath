# Verification Refactor Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modularize the remaining ClassroomPath verification and release helper surfaces while preserving the current local verification contract.

**Architecture:** Move remaining mixed CLI/runtime logic into small libraries, replace hardcoded verification-domain regex ownership with declarative policy data, and make the JSON verification report a first-class machine-readable interface for hooks and CI. Keep `scripts/verify-full.ts` and release CLIs as thin orchestration wrappers over reusable helpers.

**Tech Stack:** TypeScript, Node test runner, tsx, shell hooks, GitHub Actions YAML.

### Task 1: Lock the new contracts with failing tests

**Files:**

- Modify: `tests/verify-plan.test.ts`
- Modify: `tests/verify-report.test.ts`
- Modify: `tests/workflow-config.test.ts`
- Modify: `tests/deployment.test.ts`
- Create: `tests/resolve-latest-verifier-image.test.ts`

**Step 1: Write the failing test**

Add coverage for:

- declarative verification-domain policy exports
- machine-readable verify report consumption from hooks/workflows
- thin `resolve-latest-verifier-image` CLI delegating to a library helper
- `verify-stages` orchestration loading docker/runtime/playwright helpers

**Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/verify-plan.test.ts tests/verify-report.test.ts tests/workflow-config.test.ts tests/deployment.test.ts tests/resolve-latest-verifier-image.test.ts`

Expected: FAIL with missing exports or old inline implementation assumptions.

### Task 2: Implement the new verification planning/data model

**Files:**

- Create: `scripts/lib/verify-domain-policy.ts`
- Modify: `scripts/lib/verify-plan.ts`
- Modify: `scripts/lib/regression-plan.mjs`

**Step 1: Write minimal implementation**

Move domain ownership/capability metadata to a dedicated module and make `verify-plan.ts` consume it for scope selection and release-automation targeting.

**Step 2: Run targeted tests**

Run: `node --import tsx --test tests/verify-plan.test.ts tests/deployment.test.ts`

Expected: PASS

### Task 3: Promote verify report to a reusable machine interface

**Files:**

- Modify: `scripts/lib/verify-report.ts`
- Create: `scripts/lib/verify-report-consumer.ts`
- Modify: `.husky/pre-commit`
- Modify: `.github/workflows/ci.yml` (or current verification workflow consumers)

**Step 1: Write minimal implementation**

Add helpers to load/summarize report JSON and wire them into local hook / workflow consumers without changing the existing human-readable stdout contract.

**Step 2: Run targeted tests**

Run: `node --import tsx --test tests/verify-report.test.ts tests/workflow-config.test.ts tests/deployment.test.ts`

Expected: PASS

### Task 4: Split verification runtime orchestration by responsibility

**Files:**

- Create: `scripts/lib/verify-docker.ts`
- Create: `scripts/lib/verify-test-runners.ts`
- Create: `scripts/lib/verify-playwright.ts`
- Modify: `scripts/lib/verify-stages.ts`
- Modify: `scripts/verify-full.ts`

**Step 1: Write minimal implementation**

Extract docker lifecycle, runner execution, and Playwright gate/report validation into focused modules while keeping exported verification entrypoints stable.

**Step 2: Run targeted tests**

Run: `node --import tsx --test tests/deployment.test.ts tests/verify-report.test.ts`

Expected: PASS

### Task 5: Finish CLI/lib separation for verifier image resolution

**Files:**

- Create: `scripts/lib/resolve-latest-verifier-image.mjs`
- Modify: `scripts/resolve-latest-verifier-image.mjs`
- Modify: `tests/release-images.test.ts`
- Modify: `tests/resolve-latest-verifier-image.test.ts`

**Step 1: Write minimal implementation**

Move gh-run parsing, manifest selection, and output building into a reusable library helper. Leave the CLI as argument parsing + execution wrapper.

**Step 2: Run targeted tests**

Run: `node --import tsx --test tests/release-images.test.ts tests/resolve-latest-verifier-image.test.ts tests/workflow-config.test.ts`

Expected: PASS

### Task 6: Full verification and commit

**Files:**

- Modify: `docs/plans/2026-04-08-release-automation-followups.md` or current follow-up notes if new refactors emerge

**Step 1: Run comprehensive verification**

Run: `npm run verify:commit`

Expected: PASS

**Step 2: Commit**

```bash
git add docs/plans/2026-04-08-verification-refactor-phase-2.md scripts tests .husky .github
git commit -m "refactor(verify): modularize verification runtime"
```

## Follow-up Refactors

- Add a persistent stage cache keyed by diff + environment fingerprint so repeated `verify:commit` runs can skip already-proven stages safely.
- Move the declarative verification-domain policy to a shared ownership map that can also drive CODEOWNERS-style reporting and release approvals.
- Teach CI and hooks to upload or retain the JSON verification report as a first-class artifact instead of treating it as an ephemeral local file.
- Continue splitting `scripts/lib/verify-stages.ts` until it is only orchestration over stage descriptors, not a mixed runtime/helper surface.
- Apply the same CLI/lib boundary cleanup to the remaining deploy and release helper scripts so tests can stay pure and environment-light.
