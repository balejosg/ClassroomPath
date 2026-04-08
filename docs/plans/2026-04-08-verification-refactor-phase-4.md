# Verification Refactor Phase 4 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert verification and release automation from stage-level heuristics into artifact-aware, policy-driven workflows with a thinner remote deploy entrypoint.

**Architecture:** Extend the verification catalog so a single policy source describes domains, suites, approvals, reviewers, and release-gate impact. Build artifact-aware verification cache/report layers on top of that catalog, then reuse them in CI and release scripts. Extract the remote deployment script into helper modules so the shell entrypoint mainly orchestrates plan/apply steps.

**Tech Stack:** TypeScript via `tsx`, Node test runner, GitHub Actions YAML, POSIX shell.

### Task 1: Plan verification policy and artifact cache

**Files:**

- Modify: `scripts/lib/verification-catalog.mjs`
- Modify: `scripts/lib/verify-cache.ts`
- Modify: `scripts/lib/verify-report.ts`
- Test: `tests/verify-plan.test.ts`

**Step 1: Write failing/changed contract expectations**

Add tests that expect artifact metadata, reviewer/release-gate metadata, and richer report payloads.

**Step 2: Run targeted tests to confirm current gaps**

Run: `node --import tsx --test tests/verify-plan.test.ts tests/workflow-config.test.ts`

**Step 3: Implement minimal policy/catalog and artifact cache changes**

Teach the catalog/cache/report code to describe and persist artifact metadata plus reviewer/release-gate policy.

**Step 4: Re-run targeted tests**

Run: `node --import tsx --test tests/verify-plan.test.ts tests/workflow-config.test.ts`

### Task 2: Make verification report a canonical CI artifact

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/lib/verify-report-consumer.mjs`
- Modify: `scripts/print-verify-report-summary.mjs`
- Test: `tests/workflow-config.test.ts`

**Step 1: Add failing workflow assertions**

Assert CI uploads and consumes the verification report artifact directly.

**Step 2: Implement workflow and consumer wiring**

Upload the report artifact and reuse the contract-aware consumer instead of ad-hoc log parsing.

**Step 3: Re-run workflow-focused tests**

Run: `node --import tsx --test tests/workflow-config.test.ts`

### Task 3: Extract remote deploy orchestration helpers

**Files:**

- Modify: `scripts/deploy-production-remote.sh`
- Create: `scripts/lib/deploy-production-context.sh`
- Create: `scripts/lib/deploy-production-runtime.sh`
- Test: `tests/deployment.test.ts`

**Step 1: Add/adjust shell-oriented tests**

Assert the remote deploy entrypoint sources dedicated helper modules and keeps orchestration boundaries narrow.

**Step 2: Move context/runtime/readiness helpers into library files**

Leave `deploy-production-remote.sh` as a thin coordinator.

**Step 3: Re-run deployment tests**

Run: `node --import tsx --test tests/deployment.test.ts`

### Task 4: Reduce verify cost for scripts/workflow-only changes

**Files:**

- Modify: `scripts/verify-full.ts`
- Modify: `scripts/lib/verify-plan.ts`
- Modify: `scripts/lib/verify-stages.ts`
- Modify: `scripts/lib/regression-plan.mjs`
- Test: `tests/verify-plan.test.ts`

**Step 1: Add failing coverage for narrower verification scopes**

Express a policy-backed scope between `release-automation` and `full`.

**Step 2: Implement the new scope conservatively**

Skip only work that the catalog proves irrelevant; keep release/deploy regression coverage intact.

**Step 3: Re-run targeted verification tests**

Run: `node --import tsx --test tests/verify-plan.test.ts tests/release-images.test.ts tests/wait-for-release-candidate.test.ts`

### Task 5: Full verification and commit

**Files:**

- Modify: `docs/plans/2026-04-08-verification-refactor-phase-4.md`
- Modify: `docs/plans/2026-04-08-verification-refactor-phase-3.md`

**Step 1: Run the relevant targeted suites**

Run: `node --import tsx --test tests/verify-plan.test.ts tests/workflow-config.test.ts tests/deployment.test.ts tests/release-images.test.ts tests/wait-for-release-candidate.test.ts`

**Step 2: Run full local verification policy**

Run: `npm run verify:commit`

**Step 3: Commit**

Run:

```bash
git add docs/plans/2026-04-08-verification-refactor-phase-4.md scripts .github/workflows/ci.yml tests
git commit -m "refactor(verify): harden artifact-driven release automation"
```
