# ClassroomPath #162 Hermetic Production Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ClassroomPath production promotion and rollback paths hermetic, transactional, fail-closed, and locally testable without staging or production access.

**Architecture:** Extend the existing remote deploy, release-state, verifier, and smoke workflows with a small shell contract/state layer. Node-based release utilities run only from the immutable verifier image when the host has no Node; stored `previous` Release Bundle state is the sole rollback authority. Workflow diagnostics and scheduled smoke are independent and always preserve failure evidence.

**Tech Stack:** Bash, Node.js 20 ESM, `node:test`/tsx, Dockerfile contracts, GitHub Actions YAML, existing Release Bundle v2 artifacts.

---

### Task 1: Host contract and verifier command contract

**Files:**

- Create: `scripts/lib/production-host-contract.sh`
- Modify: `scripts/deploy-production-remote.sh`
- Modify: `scripts/rollback-production-remote.sh`
- Modify: `docker/Dockerfile.release-verifier.dockerignore`
- Test: `tests/production-executor-hermetic.test.ts`

- [ ] Write failing tests for required host commands, Docker daemon/Compose probing, state-root permissions, no host Node/npm requirement, and every verifier command required by production/rollback.
- [ ] Run `node --import tsx --test tests/production-executor-hermetic.test.ts`; confirm the missing contract/helper assertions fail.
- [ ] Implement the host probe with injectable command names, bounded disk/network checks, and machine-readable safe results; reject missing/invalid requirements before mutation.
- [ ] Implement one verifier invocation helper and require the built verifier allowlist to include bundle, state, release-state, and evidence dependencies.
- [ ] Rerun the focused test and `bash -n` on changed shell scripts.

### Task 2: Transaction phases and state machine

**Files:**

- Create: `scripts/lib/deployment-transaction.sh`
- Modify: `scripts/lib/release-execution.sh`
- Modify: `scripts/lib/deployment-state.sh`
- Modify: `scripts/lib/release-state.sh`
- Modify: `scripts/deploy-production-remote.sh`
- Test: `tests/production-executor-state.test.ts`

- [ ] Add red tests for `PREPARED`, `SWITCHING`, `ACTIVATED_UNVERIFIED`, `VERIFIED`, `COMMITTED`, `ROLLING_BACK`, `ROLLED_BACK`, and `FAILED`, plus invalid transitions and current-pointer preservation.
- [ ] Add red tests proving a pre-switch failure performs no mutation and a post-switch failure cannot emit `COMMITTED`.
- [ ] Implement atomic phase markers/context writes with the existing typed snapshot writer and strict transition table.
- [ ] Mark the deploy boundary immediately before container stop/switch; commit only after semantic readiness and state persistence.
- [ ] Rerun focused state tests and shell syntax checks.

### Task 3: Stable rollback executor and rollback preflight

**Files:**

- Create: `scripts/lib/rollback-executor.sh`
- Modify: `scripts/rollback-production-remote.sh`
- Modify: `scripts/lib/deployment-state.sh`
- Modify: `scripts/lib/rollback-readiness.sh`
- Test: `tests/rollback-executor.test.ts`

- [ ] Add red fixtures for releases A/B where B helpers, checkout, Node, current OpenPath metadata, and new RC metadata are unavailable; assert rollback still selects exact stored A.
- [ ] Add red tests for missing bundle/contract/runtime, digest drift, missing verifier command, failed health/readiness, and activation-write failure.
- [ ] Implement a stable shell executor that reads only `previous`, validates stored immutable artifacts through the previous pinned verifier, materializes exact runtime, and records `ROLLING_BACK`/`ROLLED_BACK` or precise failure.
- [ ] Move rollback preflight before checkout/Docker mutation and keep candidate helper refresh out of the recovery authority path.
- [ ] Rerun focused rollback tests and shell syntax checks.

### Task 4: Fault-injection harness for the forward executor

**Files:**

- Create: `scripts/lib/production-executor-scenario.mjs`
- Create: `tests/production-executor-fault-injection.test.ts`
- Modify: `scripts/deploy-production-remote.sh`
- Modify: `scripts/lib/deploy-production-runtime.sh`

- [ ] Write red scenario tests for verifier unavailable/command missing, projection, Docker pull, migration, stop/create/start, health, malformed ready JSON, ready false, state persist, pointer update, and commit failures.
- [ ] Implement dependency-injected phase runners and a disposable fixture state root; never invoke a real host, registry, SSH target, or destructive Docker operation.
- [ ] Assert each scenario reports its phase/category, preserves the prior current ID when required, emits bounded secret-safe diagnostics, and applies deterministic rollback policy after switch.
- [ ] Run all fault-injection scenarios and inspect JSON evidence for secret absence.

### Task 5: Post-switch diagnostics and workflow regression contracts

**Files:**

- Modify: `.github/workflows/deploy.yml`
- Modify: `scripts/deploy-production-remote.sh`
- Create or modify: `scripts/production-deployment-diagnostic.sh`
- Test: `tests/workflow-deploy.test.ts`
- Test: `tests/production-executor-hermetic.test.ts`

- [ ] Add red workflow assertions for phase marker propagation, `always()` diagnostic collection after possible switch, read-only health/ready/container/state evidence, and original failure preservation.
- [ ] Implement the bounded diagnostic artifact and workflow upload/summary path; distinguish success smoke from failure diagnostic smoke.
- [ ] Ensure diagnostics include requested/current/candidate/previous identities, container status, health/readiness payload status, checked-out SHAs, phase, rollback outcome, and classification without secrets.
- [ ] Rerun workflow regression and JSON/script tests.

### Task 6: Scheduled smoke independence and documentation

**Files:**

- Modify: `.github/workflows/smoke-tests.yml`
- Modify: `.github/workflows/reusable-smoke-test.yml` only if required by the job contract
- Modify: `docs/runbooks/deploy-production.md`
- Modify: `docs/ci-cd-signal-inventory.md`
- Test: `tests/workflow-deploy.test.ts`
- Test: `tests/ci-workflow-hygiene.test.ts`

- [ ] Add red assertions that scheduled staging and production resolution/smoke jobs are independent and the aggregate reports partial failure accurately.
- [ ] Make staging and production jobs independently gated; retain exact release identity inputs and aggregate only after both outcomes exist.
- [ ] Document the minimal host contract, mutation boundary, state phases, rollback limitations, and the implementation-complete/operational-proof-pending distinction without live targets.
- [ ] Rerun workflow/documentation regressions.

### Task 7: Full local verification and handoff

**Files:**

- Modify only tests/docs needed to fix verified regressions.

- [ ] Run focused new tests, `npm run test:deployment`, `npm run test:ci-regression`, `npm run verify:static`, `npm run verify:scripts-types`, `npm run verify:docs`, `npm run verify:public-surface`, `npm run format:check`, and the repository fast regression lane.
- [ ] Run `git diff --check`, inspect status/diff, and verify no tags, releases, pushes, remote mutations, real-host calls, or destructive operations occurred.
- [ ] Report phases A–J actually covered, exact commands/results, remaining acceptance criteria, and K–M explicitly as operational proof pending.
