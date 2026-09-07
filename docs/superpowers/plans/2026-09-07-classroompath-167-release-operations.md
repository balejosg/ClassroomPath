# ClassroomPath #167 Release Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert ClassroomPath promotion to an explicit-RC, staging-proven, readiness-gated, tag-only production flow backed by one shared deployment executor and an append-only safe ledger.

**Architecture:** `release:promote` will resolve and persist one immutable RC identity, invoke the exact staging adapter, run the canonical read-only production readiness operation, and cross the tag boundary only in `--execute` mode. A shell executor will own runtime projection, transaction phases, semantic health/readiness, live identity, commit, recovery result, and ledger append; staging and production will provide only environment adapters.

**Tech Stack:** Node.js ESM CLIs and `node:test`/TypeScript regression tests; Bash deployment helpers; GitHub Actions YAML; existing Release Bundle v2, transaction, recovery-authority, release-state, and tag-reconciliation helpers.

---

## File map

Create:

- `scripts/lib/release-candidate-resolution.mjs` — explicit RC run validation and exact bundle identity resolution boundary.
- `scripts/lib/production-readiness.mjs` — blocker classification, report contract, and dependency-injected readiness orchestration.
- `scripts/production-readiness.mjs` — read-only CLI for human and JSON readiness output.
- `scripts/lib/deploy-runtime-executor.sh` — environment-neutral hermetic runtime phases and terminal outcome hooks.
- `scripts/lib/deployment-ledger.sh` — bounded allowlisted JSONL append with transaction-scoped serialization.
- `tests/release-candidate-resolution.test.ts` — explicit RC resolver contract.
- `tests/production-readiness.test.ts` — readiness blocker and no-mutation contract.
- `tests/deployment-ledger.test.ts` — safe append, serialization, and terminal outcome contract.

Modify:

- `scripts/lib/github-actions-artifacts.mjs` — exact workflow-run lookup helper.
- `scripts/lib/release-candidate-bundle.mjs` — delegate explicit-run resolution to the shared resolver while retaining exact SHA/artifact verification.
- `scripts/wait-for-release-candidate.mjs` — support `resolve-bundle --rc-run-id` without requiring a separately selected SHA.
- `scripts/lib/release-orchestration.mjs` — plan by RC run, use an `rc-<id>` state root, and remove tag-first/origin-main RC selection.
- `scripts/release-promote.mjs` — parse/require `--rc-run-id`, bind resume to immutable identity, and preserve orchestrator-only responsibilities.
- `scripts/lib/release-preflight.mjs` and `scripts/release-preflight.mjs` — accept exact candidate identity and surface typed readiness blockers without secret values.
- `scripts/lib/production-recovery-preflight.sh` — expose one reusable recovery-authority operation to readiness and `deploy.yml`.
- `scripts/deploy-staging-local.sh` and `scripts/lib/staging-deploy-local-release.sh` — accept an explicit RC run and pass the already selected identity through staging.
- `scripts/deploy-staging-remote.sh` — become the staging adapter for the common executor; retain only staging host/project/fence/fault policy.
- `scripts/deploy-production-remote.sh` and `scripts/lib/deploy-production-runtime.sh` — become the production adapter and invoke the common executor.
- `scripts/lib/remote-deploy-scaffold.sh` and `scripts/lib/remote-helper-contracts.sh` — load and contract-check the common executor/ledger helpers on remote hosts.
- `scripts/lib/deployment-transaction.sh` — initialize transaction ledger context and append one terminal fact without replacing existing phase history.
- `scripts/promote-current-staging-candidate.sh` — resolve only the exact current staging RC run ID and delegate to `release:promote`.
- `.github/workflows/promote-current-staging-candidate.yml` — pass the exact RC input to the canonical command; remove independent tag logic.
- `.github/workflows/nightly-staging-candidate.yml` and `.github/workflows/deploy.yml` — use the explicit RC contract, shared recovery operation, and tag-only identity revalidation.
- `package.json`, `docs/runbooks/deploy-production.md`, `docs/runbooks/deploy-staging.md`, and `docs/INDEX.md` — expose the read-only readiness command and document the compatibility boundary without private targets or values.
- Existing deployment/release/workflow tests — update old tag-first assumptions and add guards against duplicated promotion authority.

Every implementation edit must preserve the existing `OpenPath` independence rule and must not modify `upstream/openpath/`.

### Task 1: Add the explicit RC resolver

**Files:**

- Create: `scripts/lib/release-candidate-resolution.mjs`
- Modify: `scripts/lib/github-actions-artifacts.mjs`
- Modify: `scripts/lib/release-candidate-bundle.mjs`
- Modify: `scripts/wait-for-release-candidate.mjs`
- Test: `tests/release-candidate-resolution.test.ts`
- Extend: `tests/release-candidate-bundle.test.ts`

- [ ] **Step 1: Write failing resolver tests.**

```ts
test('resolves one successful push RC by explicit run id and derives its exact SHA', () => {
  const result = resolveExplicitReleaseCandidateBundle({
    repository: 'owner/repo',
    rcRunId: '34124312483',
    run: {
      databaseId: 34124312483,
      headSha: 'a'.repeat(40),
      event: 'push',
      status: 'completed',
      conclusion: 'success',
    },
    resolveBundle: () => ({
      runId: '34124312483',
      headSha: 'a'.repeat(40),
      releaseId: 'b'.repeat(64),
      openpathSha: 'c'.repeat(40),
      openpathContractSha256: 'd'.repeat(64),
      artifactName: `release-bundle-${'a'.repeat(40)}`,
    }),
  });

  assert.equal(result.rcRunId, '34124312483');
  assert.equal(result.classroomPathSha, 'a'.repeat(40));
  assert.equal(result.releaseId, 'b'.repeat(64));
});

test('rejects an explicit RC run that is failed, non-push, or has a different id', () => {
  assert.throws(
    () =>
      resolveExplicitReleaseCandidateBundle({
        repository: 'owner/repo',
        rcRunId: '10',
        run: {
          databaseId: 11,
          headSha: 'a'.repeat(40),
          event: 'push',
          status: 'completed',
          conclusion: 'success',
        },
      }),
    /run id/i
  );
  assert.throws(
    () =>
      resolveExplicitReleaseCandidateBundle({
        repository: 'owner/repo',
        rcRunId: '10',
        run: {
          databaseId: 10,
          headSha: 'a'.repeat(40),
          event: 'workflow_dispatch',
          status: 'completed',
          conclusion: 'success',
        },
      }),
    /push/i
  );
  assert.throws(
    () =>
      resolveExplicitReleaseCandidateBundle({
        repository: 'owner/repo',
        rcRunId: '10',
        run: {
          databaseId: 10,
          headSha: 'a'.repeat(40),
          event: 'push',
          status: 'completed',
          conclusion: 'failure',
        },
      }),
    /successful|conclusion/i
  );
});
```

- [ ] **Step 2: Run the focused test and observe the expected missing-export failure.**

Run: `node --import tsx --test tests/release-candidate-resolution.test.ts`

Expected: FAIL because the explicit resolver is not exported yet.

- [ ] **Step 3: Implement the exact run lookup and delegation.**

Add `viewGitHubWorkflowRun({ repo, runId, cwd })` using `gh run view <id> --json databaseId,headSha,status,conclusion,event,workflowName,name`, and implement:

```js
export function resolveExplicitReleaseCandidateBundle({
  repository,
  rcRunId,
  run,
  resolveBundle = resolveExactReleaseCandidateBundle,
  ...options
} = {}) {
  const requestedRunId = normalizeRcRunId(rcRunId);
  const selectedRun =
    run ??
    viewGitHubWorkflowRun({
      repo: repository,
      runId: requestedRunId,
      cwd: options.cwd,
    });
  assertSuccessfulPushRun(selectedRun, requestedRunId);
  const classroomPathSha = normalizeSha40(selectedRun.headSha ?? selectedRun.head_sha);
  const resolved = resolveBundle({
    ...options,
    repository,
    classroomPathSha,
    runId: requestedRunId,
    run: selectedRun,
  });
  return { ...resolved, rcRunId: requestedRunId, classroomPathSha };
}
```

The resolver must never call a latest/ancestor/current-staging fallback. Extend `resolve-bundle` parsing with `--rc-run-id`; when supplied, fetch the run, derive its SHA, and use the existing exact bundle/artifact/contract byte verification. Keep `--sha [--run-id]` compatibility for existing workflows, but make the new promotion path use only `--rc-run-id`.

- [ ] **Step 4: Run the focused resolver and existing bundle suites.**

Run: `node --import tsx --test tests/release-candidate-resolution.test.ts tests/release-candidate-bundle.test.ts tests/wait-for-release-candidate.test.ts`

Expected: PASS, with existing exact-SHA behavior unchanged.

- [ ] **Step 5: Commit the resolver boundary.**

```bash
git add scripts/lib/github-actions-artifacts.mjs scripts/lib/release-candidate-resolution.mjs scripts/lib/release-candidate-bundle.mjs scripts/wait-for-release-candidate.mjs tests/release-candidate-resolution.test.ts tests/release-candidate-bundle.test.ts tests/wait-for-release-candidate.test.ts
git commit -m "feat(release): resolve explicit candidate runs" -m "Refs #167"
```

### Task 2: Make promotion RC-first and resume-safe

**Files:**

- Modify: `scripts/lib/release-orchestration.mjs`
- Modify: `scripts/release-promote.mjs`
- Modify: `scripts/lib/release-transcript.mjs`
- Test: `tests/release-orchestration.test.ts`
- Test: `tests/release-promote-resume.test.ts`

- [ ] **Step 1: Add failing plan and CLI tests for the new identity.**

```ts
test('requires an explicit RC run and keys state by rc run id', () => {
  assert.throws(() => buildPromotionPlan({ tag: 'v1.2.380' }), /rcRunId/i);
  const plan = buildPromotionPlan({ rcRunId: '34124312483', tag: 'v1.2.380' });
  assert.equal(plan.identityRoot, '.opencode/tmp/release-promote/rc-34124312483');
  assert.equal(plan.steps[0].id, 'resolve-release-candidate');
  assert.equal(
    plan.steps.some((step) => step.id === 'resolve-origin-main'),
    false
  );
  assert.match(formatCommand(plan.steps[0].command), /--rc-run-id/);
});

test('resume rejects a changed RC, source, release, OpenPath, or contract identity', () => {
  assert.throws(
    () =>
      assertPromotionResumeIdentity({
        state: {
          rcRunId: '34124312483',
          classroomPathSha: 'a'.repeat(40),
          releaseId: 'b'.repeat(64),
          openpathSha: 'c'.repeat(40),
          openpathContractSha256: 'd'.repeat(64),
        },
        locator: {
          rcRunId: '34124312484',
          classroomPathSha: 'a'.repeat(40),
          releaseId: 'b'.repeat(64),
          openpathSha: 'c'.repeat(40),
          openpathContractSha256: 'd'.repeat(64),
        },
      }),
    /rcRunId/i
  );
});
```

- [ ] **Step 2: Run the focused orchestration suites and observe the tag-first assertion failures.**

Run: `node --import tsx --test tests/release-orchestration.test.ts tests/release-promote-resume.test.ts`

Expected: FAIL at the old tag-first/path assumptions.

- [ ] **Step 3: Refactor the plan and CLI around `rcRunId`.**

Change the public option shape to include `rcRunId`, require it unless `--help`, and use the following plan construction contract:

```js
const identityRoot = join(transcriptRoot, `rc-${rcRunId}`);
const releaseBundleStateDir = join(identityRoot, 'bundle');
const releaseBundleStateFile = join(releaseBundleStateDir, 'staging-release.env');

const steps = [
  step('resolve-release-candidate', [
    'node',
    'scripts/wait-for-release-candidate.mjs',
    'resolve-bundle',
    '--rc-run-id',
    rcRunId,
    '--output-file',
    join(releaseBundleStateDir, 'release-candidate-images.env'),
    '--output-dir',
    join(releaseBundleStateDir, 'release-bundle'),
  ]),
  step('verify-promotion-identity', [
    'bash',
    '-lc',
    'test -s "$RELEASE_PROMOTION_IDENTITY_FILE" && node scripts/release-bundle.mjs verify --bundle-file "$RELEASE_BUNDLE_FILE" --contract-file "$OPENPATH_CONTRACT_FILE" --release-id "$RELEASE_ID" --classroompath-sha "$CLASSROOMPATH_SHA" --openpath-sha "$OPENPATH_SHA"',
  ]),
  step('deploy-staging', [
    'env',
    `STAGING_RC_RUN_ID=${rcRunId}`,
    'STAGING_DEPLOYMENT_MODE=promotion-eligible',
    'STAGING_IMAGE_MODE=release-candidate',
    'npm',
    'run',
    'deploy:staging',
    '--',
    '--rc-run-id',
    rcRunId,
  ]),
  step('verify-staging-exact', [
    'npm',
    'run',
    'verify:promotion-ready',
    '--',
    '--rc-run-id',
    rcRunId,
  ]),
  step('production-readiness', [
    'npm',
    'run',
    'verify:production-readiness',
    '--',
    '--rc-run-id',
    rcRunId,
    '--json',
  ]),
  step('tag-production', [
    'bash',
    'scripts/tag-production-release.sh',
    tag,
    '--rc-run-id',
    rcRunId,
  ]),
];
```

Use explicit identity files/arguments rather than recomputing `origin/main`; checking the current checkout against the resolved `C` is allowed as a safety assertion. Make all step-state writes use `identityRoot` and persist the five identity fields before the proposed tag. Keep `--execute` as the approval boundary; dry-run prints the ordered plan and never invokes mutation commands. Add `production-readiness` to the mandatory gate set and make `--resume`, `--from-step`, and `--only` reject skipped gates without a successful record bound to the same five-field identity.

- [ ] **Step 4: Run the focused suites and transcript checks.**

Run: `node --import tsx --test tests/release-orchestration.test.ts tests/release-promote-resume.test.ts tests/release-evidence.test.ts`

Expected: PASS; the plan starts with explicit RC resolution, staging precedes readiness, and no dry-run command contains an unapproved tag/push operation.

- [ ] **Step 5: Commit the RC-first orchestrator.**

```bash
git add scripts/lib/release-orchestration.mjs scripts/release-promote.mjs scripts/lib/release-transcript.mjs tests/release-orchestration.test.ts tests/release-promote-resume.test.ts
git commit -m "refactor(release): make promotion RC-first" -m "Refs #167"
```

### Task 3: Implement canonical production readiness and recovery verification

**Files:**

- Create: `scripts/lib/production-readiness.mjs`
- Create: `scripts/production-readiness.mjs`
- Create or modify: `scripts/lib/production-recovery-preflight.sh`
- Modify: `scripts/lib/release-preflight.mjs`
- Modify: `scripts/release-preflight.mjs`
- Modify: `package.json`
- Test: `tests/production-readiness.test.ts`
- Test: `tests/production-recovery-authority.test.ts`

- [ ] **Step 1: Write failing report/classification tests.**

```ts
test('classifies all readiness failures without exposing values', () => {
  const report = buildProductionReadinessReport({
    checks: [
      { name: 'rc', ok: false, blocker: 'RC_BLOCKER', message: 'explicit RC is unavailable' },
      {
        name: 'staging',
        ok: false,
        blocker: 'STAGING_BLOCKER',
        message: 'staging identity differs',
      },
      {
        name: 'config',
        ok: false,
        blocker: 'CONFIG_BLOCKER',
        message: 'required secret names are absent',
      },
      { name: 'recovery', ok: false, blocker: 'RECOVERY_BLOCKER', message: 'R is missing' },
      { name: 'host', ok: false, blocker: 'HOST_BLOCKER', message: 'host contract is blocked' },
      {
        name: 'artifacts',
        ok: false,
        blocker: 'ARTIFACT_BLOCKER',
        message: 'digest pullability is blocked',
      },
    ],
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.blockers, [
    'RC_BLOCKER',
    'STAGING_BLOCKER',
    'CONFIG_BLOCKER',
    'RECOVERY_BLOCKER',
    'HOST_BLOCKER',
    'ARTIFACT_BLOCKER',
  ]);
  assert.doesNotMatch(JSON.stringify(report), /token|private.key|password|secret-value/i);
});

test('readiness never reports a different R as valid for C', () => {
  assert.throws(
    () => validateRecoveryIdentity({ candidateSha: 'a'.repeat(40), recoverySha: 'a'.repeat(40) }),
    /differ/i
  );
});
```

- [ ] **Step 2: Run the focused readiness test and observe the expected missing-module failure.**

Run: `node --import tsx --test tests/production-readiness.test.ts`

Expected: FAIL because the report builder and recovery identity validator do not yet exist.

- [ ] **Step 3: Implement the pure readiness contract.**

Expose these functions:

```js
export const READINESS_BLOCKERS = Object.freeze([
  'RC_BLOCKER',
  'STAGING_BLOCKER',
  'CONFIG_BLOCKER',
  'RECOVERY_BLOCKER',
  'HOST_BLOCKER',
  'ARTIFACT_BLOCKER',
]);

export function validateRecoveryIdentity({ candidateSha, recoverySha }) {
  assertFullLowercaseSha(candidateSha, 'candidate SHA');
  assertFullLowercaseSha(recoverySha, 'PRODUCTION_RECOVERY_SHA');
  if (candidateSha === recoverySha)
    throw new Error('PRODUCTION_RECOVERY_SHA must differ from candidate SHA');
  return { candidateSha, recoverySha };
}

export function buildProductionReadinessReport({ identity, checks }) {
  const normalized = checks.map((check) => ({
    name: String(check.name),
    ok: check.ok === true,
    blocker: check.ok === true ? null : check.blocker,
    message: sanitizeReadinessMessage(check.message),
  }));
  const blockers = [
    ...new Set(normalized.filter((check) => !check.ok).map((check) => check.blocker)),
  ];
  return {
    ok: blockers.length === 0,
    identity: sanitizeIdentity(identity),
    checks: normalized,
    blockers,
  };
}
```

The CLI accepts `--rc-run-id`, `--json`, `--candidate-sha`, and `--recovery-sha`/the configured `PRODUCTION_RECOVERY_SHA`. It resolves the explicit RC first, verifies exact staging evidence for that identity, calls the shared recovery-authority `validate`/`package`/`preflight` operation, checks config names, host contract, and safe artifact pullability, and prints only names, hashes, IDs, statuses, and bounded messages. It must return non-zero for any blocker and perform no tag, push, deploy, or remote mutation.

- [ ] **Step 4: Extract one recovery operation and call it from both readiness and `deploy.yml`.**

The shared shell operation must have this concrete shape:

```bash
production_recovery_validate_sha() {
  local label="$1" value="$2"
  [[ "$value" =~ ^[0-9a-f]{40}$ ]] || {
    printf '%s must be a full lowercase 40-character SHA\n' "$label" >&2
    return 1
  }
}

production_recovery_prepare_and_preflight() {
  local source_root="$1" candidate_sha="$2" recovery_sha="$3" artifact_path="$4" evidence_path="$5"
  production_recovery_validate_sha candidate_sha "$candidate_sha" || return 1
  production_recovery_validate_sha recovery_sha "$recovery_sha" || return 1
  [ "$candidate_sha" != "$recovery_sha" ] || return 1
  [ -f "$source_root/scripts/production-recovery-authority.sh" ] || return 1
  PRODUCTION_RECOVERY_SHA="$recovery_sha" bash "$source_root/scripts/production-recovery-authority.sh" validate --recovery-sha "$recovery_sha" --candidate-sha "$candidate_sha" --source-root "$source_root" || return 1
  PRODUCTION_RECOVERY_SHA="$recovery_sha" bash "$source_root/scripts/production-recovery-authority.sh" package --recovery-sha "$recovery_sha" --candidate-sha "$candidate_sha" --source-root "$source_root" --output "$artifact_path" --evidence "$evidence_path" || return 1
  PRODUCTION_RECOVERY_SHA="$recovery_sha" bash "$source_root/scripts/production-recovery-authority.sh" preflight --recovery-sha "$recovery_sha" --artifact "$artifact_path" --evidence "$evidence_path" --candidate-sha "$candidate_sha" || return 1
}
```

Both callers must invoke this one function/operation with the existing authority helper's exact argument order. The workflow must retain the post-tag revalidation and must not retain an inline second implementation.

- [ ] **Step 5: Run readiness, recovery, and workflow contract tests.**

Run: `node --import tsx --test tests/production-readiness.test.ts tests/production-recovery-authority.test.ts tests/deployment-staging-release.test.ts`

Expected: PASS; missing/malformed/equal/wrong-source R values produce `RECOVERY_BLOCKER`, and no report contains secret values.

- [ ] **Step 6: Commit the readiness boundary.**

```bash
git add scripts/lib/production-readiness.mjs scripts/production-readiness.mjs scripts/lib/production-recovery-preflight.sh scripts/lib/release-preflight.mjs scripts/release-preflight.mjs package.json tests/production-readiness.test.ts tests/production-recovery-authority.test.ts tests/deployment-staging-release.test.ts .github/workflows/deploy.yml
git commit -m "feat(release): add production readiness gate" -m "Use one recovery authority operation before and after tagging." -m "Refs #167"
```

### Task 4: Converge staging and production on the shared executor

**Files:**

- Create: `scripts/lib/deploy-runtime-executor.sh`
- Modify: `scripts/deploy-staging-remote.sh`
- Modify: `scripts/deploy-production-remote.sh`
- Modify: `scripts/lib/deploy-production-runtime.sh`
- Modify: `scripts/lib/staging-rollback.sh`
- Modify: `scripts/lib/remote-deploy-scaffold.sh`
- Modify: `scripts/lib/remote-helper-contracts.sh`
- Test: `tests/deployment-runtime-contracts.test.ts`
- Test: `tests/production-executor-workflow.test.ts`
- Test: `tests/staging-equivalent-harness.test.ts`

- [ ] **Step 1: Write failing source-contract tests for common ownership.**

```ts
test('both remote environments source and invoke the canonical runtime executor', () => {
  const common = readFileSync(
    resolve(projectRoot, 'scripts/lib/deploy-runtime-executor.sh'),
    'utf8'
  );
  const staging = readFileSync(resolve(projectRoot, 'scripts/deploy-staging-remote.sh'), 'utf8');
  const production = readFileSync(
    resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
    'utf8'
  );
  assert.match(common, /deploy_runtime_execute/);
  assert.match(common, /ACTIVATED_UNVERIFIED/);
  assert.match(common, /VERIFIED/);
  assert.match(common, /COMMITTED/);
  assert.match(staging, /deploy-runtime-executor\.sh/);
  assert.match(production, /deploy-runtime-executor\.sh/);
  assert.equal((staging.match(/apply_release_runtime_projection_to_env_file/g) ?? []).length, 0);
  assert.equal((staging.match(/deployment_transaction_transition/g) ?? []).length, 0);
});
```

- [ ] **Step 2: Run the contract tests and observe the expected missing/duplicate ownership failures.**

Run: `node --import tsx --test tests/deployment-runtime-contracts.test.ts tests/production-executor-workflow.test.ts tests/staging-equivalent-harness.test.ts`

Expected: FAIL while staging and production still own separate transition/projection/commit code.

- [ ] **Step 3: Implement the executor interface and shared phase machine.**

Define adapter hooks and one entrypoint:

```bash
deploy_runtime_execute() {
  deploy_runtime_adapter_prepare || return 1
  deployment_transaction_transition "$DEPLOYMENT_PHASE_SWITCHING" SWITCH || return 1
  deploy_runtime_adapter_switch || return 1
  deployment_transaction_transition "$DEPLOYMENT_PHASE_ACTIVATED_UNVERIFIED" SWITCH || return 1
  deploy_runtime_adapter_fault_barrier || return 1
  deploy_runtime_wait_health_and_readiness || return 1
  deploy_runtime_adapter_validate_live || return 1
  deployment_state_activate_v2_release "$RELEASE_ID" || return 1
  deployment_state_publish_pending_release || return 1
  deployment_transaction_transition "$DEPLOYMENT_PHASE_VERIFIED" VERIFY || return 1
  deployment_transaction_transition "$DEPLOYMENT_PHASE_COMMITTED" COMMIT || return 1
  deploy_runtime_record_terminal COMMITTED
}
```

The common helper must use `rollback_readiness_json_is_ready`, exact runtime projection, and the existing transaction constants. Staging and production adapters supply pull/migration/switch details, health endpoint configuration, live identity validation, and environment fences. Keep `COMPOSE_PROJECT_NAME=classroompath-staging` in staging, `classroompath-production` in production, and keep the K fault barrier fenced to staging-equivalent only.

- [ ] **Step 4: Move production and staging release-candidate paths behind the adapter hooks.**

Production's existing immutable pull/state/projection code becomes `deploy_runtime_adapter_prepare`; its container stop/start becomes `deploy_runtime_adapter_switch`; its K wait remains `deploy_runtime_adapter_fault_barrier`. Staging's release-candidate pull/state/projection code becomes the staging equivalents. Remove staging's local `activate_release_bundle_state`, readiness grep, and direct commit path from the normal release-candidate flow. Preserve source-build debug behavior outside promotion eligibility and preserve stable-candidate rollback semantics.

- [ ] **Step 5: Run shell syntax, targeted executor, and staging-equivalent tests.**

Run: `bash -n scripts/lib/deploy-runtime-executor.sh scripts/deploy-staging-remote.sh scripts/deploy-production-remote.sh scripts/lib/deploy-production-runtime.sh && node --import tsx --test tests/deployment-runtime-contracts.test.ts tests/production-executor-state.test.ts tests/production-executor-hermetic.test.ts tests/production-executor-workflow.test.ts tests/staging-equivalent-harness.test.ts`

Expected: PASS; both normal environments use the same phase/readiness/commit implementation and their fences remain distinct.

- [ ] **Step 6: Commit executor convergence.**

```bash
git add scripts/lib/deploy-runtime-executor.sh scripts/deploy-staging-remote.sh scripts/deploy-production-remote.sh scripts/lib/deploy-production-runtime.sh scripts/lib/staging-rollback.sh scripts/lib/remote-deploy-scaffold.sh scripts/lib/remote-helper-contracts.sh tests/deployment-runtime-contracts.test.ts tests/production-executor-workflow.test.ts tests/staging-equivalent-harness.test.ts
git commit -m "refactor(deploy): share hermetic runtime executor" -m "Refs #167"
```

### Task 5: Add the serialized bounded deployment ledger

**Files:**

- Create: `scripts/lib/deployment-ledger.sh`
- Modify: `scripts/lib/deployment-transaction.sh`
- Modify: `scripts/lib/deploy-runtime-executor.sh`
- Modify: `scripts/deploy-production-remote.sh`
- Modify: `scripts/deploy-staging-remote.sh`
- Test: `tests/deployment-ledger.test.ts`
- Extend: `tests/production-executor-state.test.ts`

- [ ] **Step 1: Write failing ledger tests.**

```ts
test('appends terminal JSONL without secrets and never rewrites a prior result', () => {
  const ledger = createLedgerFixture();
  appendDeploymentLedgerRecord(ledger, {
    environment: 'production',
    transactionId: 'a'.repeat(64),
    candidateSha: 'b'.repeat(40),
    releaseId: 'c'.repeat(64),
    previous: 'd'.repeat(64),
    recoverySha: 'e'.repeat(40),
    phase: 'COMMITTED',
    result: 'COMMITTED',
    health: 200,
    ready: true,
    workflowRunId: '123',
    token: 'must-not-be-written',
    envDump: 'must-not-be-written',
  });
  appendDeploymentLedgerRecord(ledger, {
    environment: 'production',
    transactionId: 'a'.repeat(64),
    candidateSha: 'b'.repeat(40),
    releaseId: 'c'.repeat(64),
    previous: 'd'.repeat(64),
    recoverySha: 'e'.repeat(40),
    phase: 'ROLLED_BACK',
    result: 'ROLLED_BACK',
    current: 'd'.repeat(64),
    health: 200,
    ready: true,
  });
  const lines = readFileSync(ledger, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).result, 'COMMITTED');
  assert.equal(JSON.parse(lines[1]).result, 'ROLLED_BACK');
  assert.doesNotMatch(readFileSync(ledger, 'utf8'), /must-not-be-written/);
});

test('rejects a duplicate transaction with different identity', () => {
  const ledger = createLedgerFixture();
  appendDeploymentLedgerRecord(ledger, {
    transactionId: 'a'.repeat(64),
    candidateSha: 'b'.repeat(40),
    result: 'FAILED',
  });
  assert.throws(
    () =>
      appendDeploymentLedgerRecord(ledger, {
        transactionId: 'a'.repeat(64),
        candidateSha: 'f'.repeat(40),
        result: 'COMMITTED',
      }),
    /identity|duplicate/i
  );
});
```

- [ ] **Step 2: Run the focused ledger test and observe the expected missing-module failure.**

Run: `node --import tsx --test tests/deployment-ledger.test.ts`

Expected: FAIL because the append contract does not exist.

- [ ] **Step 3: Implement allowlisted JSONL append with `mkdir` serialization.**

The shell helper must expose `deployment_ledger_append_terminal` and use an atomic lock directory under the same state root:

```bash
deployment_ledger_append_terminal() {
  local ledger_file="$1" lock_dir="${1}.lock" record_json="$2"
  mkdir -p "$(dirname "$ledger_file")" || return 1
  while ! mkdir "$lock_dir" 2>/dev/null; do sleep 0.05; done
  trap 'rmdir "$lock_dir" 2>/dev/null || true' RETURN
  printf '%s\n' "$record_json" >> "$ledger_file"
  sync -d "$ledger_file" 2>/dev/null || sync
}
```

Before append, build JSON from an explicit allowlist only: timestamp, environment, tag, transactionId, candidate/C, RC run, release ID, OpenPath SHA, contract hash, recovery R, phase, result, previous/current, bounded image digest map, health status, ready boolean, rollback result, and workflow run ID. Validate hash/ID formats, cap message/map sizes, and reject a transaction whose existing identity differs. Ensure terminal append is called for `COMMITTED`, `FAILED`, and `ROLLED_BACK`, including failures before the mutation boundary with `MUTATION_BOUNDARY_REACHED=0`. Do not replace transaction history or unrelated state files.

- [ ] **Step 4: Integrate the ledger at executor terminal paths and rollback.**

Set `DEPLOYMENT_LEDGER_FILE="$STATE_DIR/deployment-ledger.jsonl"` during both remote adapters, call the common terminal recorder after phase persistence, and preserve the original forward failure result when rollback later succeeds. Add workflow run/tag identity from bounded environment variables only.

- [ ] **Step 5: Run ledger and executor regression suites.**

Run: `bash -n scripts/lib/deployment-ledger.sh scripts/lib/deployment-transaction.sh scripts/lib/deploy-runtime-executor.sh && node --import tsx --test tests/deployment-ledger.test.ts tests/production-executor-state.test.ts tests/production-executor-fault-injection.test.ts tests/production-recovery-authority.test.ts`

Expected: PASS; concurrent append is serialized, rollback appends a new line, and secret-like fields are absent.

- [ ] **Step 6: Commit the ledger.**

```bash
git add scripts/lib/deployment-ledger.sh scripts/lib/deployment-transaction.sh scripts/lib/deploy-runtime-executor.sh scripts/deploy-production-remote.sh scripts/deploy-staging-remote.sh tests/deployment-ledger.test.ts tests/production-executor-state.test.ts
git commit -m "feat(deploy): record terminal deployment facts" -m "Refs #167"
```

### Task 6: Remove duplicate promotion authority and align workflows/docs

**Files:**

- Modify: `scripts/promote-current-staging-candidate.sh`
- Modify: `.github/workflows/promote-current-staging-candidate.yml`
- Modify: `.github/workflows/nightly-staging-candidate.yml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `scripts/tag-production-release.sh`
- Modify: `scripts/deploy-staging-local.sh`
- Modify: `scripts/lib/staging-deploy-local-release.sh`
- Modify: `package.json`
- Modify: `docs/runbooks/deploy-production.md`
- Modify: `docs/runbooks/deploy-staging.md`
- Modify: `docs/INDEX.md`
- Extend: `tests/deployment-staging-release.test.ts`
- Extend: `tests/deployment-foundation.test.ts`
- Extend: `tests/workflow-release-candidate.test.ts`

- [ ] **Step 1: Write failing compatibility/workflow tests.**

```ts
test('current-staging compatibility delegates and owns no tag or readiness implementation', () => {
  const helper = readFileSync(
    resolve(projectRoot, 'scripts/promote-current-staging-candidate.sh'),
    'utf8'
  );
  assert.match(helper, /release:promote/);
  assert.doesNotMatch(
    helper,
    /git tag -a|git push|production_tag_reconcile_existing|verify-production-promotion-ready/
  );
  assert.doesNotMatch(helper, /next_tag|latest_tag/);
});

test('manual promotion workflow requires an explicit RC input and invokes the canonical entrypoint', () => {
  const workflow = readFileSync(
    resolve(projectRoot, '.github/workflows/promote-current-staging-candidate.yml'),
    'utf8'
  );
  assert.match(workflow, /rc_run_id/);
  assert.match(workflow, /release:promote/);
  assert.doesNotMatch(workflow, /promote-current-staging-candidate\.sh\s*$/m);
});
```

- [ ] **Step 2: Run targeted workflow tests and observe the independent-authority failures.**

Run: `node --import tsx --test tests/deployment-staging-release.test.ts tests/deployment-foundation.test.ts tests/workflow-release-candidate.test.ts`

Expected: FAIL on the old wrapper/tag-generation expectations.

- [ ] **Step 3: Replace the wrapper with exact staging RC delegation.**

The wrapper may read only `RC_RUN_ID` from exact current staging state, validate it is numeric, and execute:

```bash
exec npm run release:promote -- \
  --rc-run-id "$STAGING_RC_RUN_ID" \
  --auto-tag \
  --execute
```

It must keep `--local-only` as a dry/local compatibility option only if it maps to the canonical command, and it must not contain tag schema, readiness, bundle identity, or push logic. Update the workflow input/step to invoke the canonical command and retain permissions/SSH preparation without duplicating promotion checks.

- [ ] **Step 4: Make tag and staging adapters consume the exact identity.**

Add `--rc-run-id` to `tag-production-release.sh`, require/verify its identity against the readiness evidence and canonical tag message, and keep the existing immutable annotated-tag reconciliation. Add `--rc-run-id` to `deploy-staging-local.sh`; its explicit path must resolve the requested RC exactly once, use its bundle bytes, and never silently replace it with `origin/main` or a newer run. Preserve the legacy non-promotion staging command only outside the canonical `release:promote --rc-run-id` path.

- [ ] **Step 5: Align workflows and public runbooks.**

Keep `.github/workflows/deploy.yml` tag-only. Replace its inline recovery validation with the shared recovery operation while retaining a post-tag revalidation. Ensure tag identity carries RC run, C, release ID, OpenPath SHA, and contract hash. Keep smoke jobs independent and retain blocker summaries. Document only the command contract, dry-run behavior, compatibility wrapper, and prohibition on live values/targets.

- [ ] **Step 6: Run targeted workflow/docs tests.**

Run: `node --import tsx --test tests/deployment-staging-release.test.ts tests/deployment-foundation.test.ts tests/deployment-remote-bootstrap.test.ts tests/workflow-release-candidate.test.ts tests/workflow-core.test.ts tests/docs-verification.test.ts`

Expected: PASS; only `release:promote --rc-run-id` owns promotion and production remains tag-only.

- [ ] **Step 7: Commit the compatibility and workflow changes.**

```bash
git add scripts/promote-current-staging-candidate.sh scripts/tag-production-release.sh scripts/deploy-staging-local.sh scripts/lib/staging-deploy-local-release.sh .github/workflows/promote-current-staging-candidate.yml .github/workflows/nightly-staging-candidate.yml .github/workflows/deploy.yml package.json docs/runbooks/deploy-production.md docs/runbooks/deploy-staging.md docs/INDEX.md tests/deployment-staging-release.test.ts tests/deployment-foundation.test.ts tests/deployment-remote-bootstrap.test.ts tests/workflow-release-candidate.test.ts tests/workflow-core.test.ts tests/docs-verification.test.ts
git commit -m "refactor(release): remove duplicate promotion paths" -m "Refs #167"
```

### Task 7: Final local verification and operational-proof boundary

**Files:**

- Modify only any failing tests/docs discovered by the commands below.
- Test: all affected release/deployment/workflow suites.

- [ ] **Step 1: Check the final diff and repository boundaries.**

Run: `git diff --check && git status --short && git diff --name-only origin/main...HEAD | rg '^(OpenPath/|upstream/openpath/)' || true`

Expected: no whitespace errors, no unrelated dirty files, and no OpenPath/upstream changes.

- [ ] **Step 2: Run the cheapest relevant local verification lane.**

Run: `npm run verify:incremental`

Expected: PASS without deployment, tag, release, promotion, push, or remote workflow dispatch.

- [ ] **Step 3: Run the complete targeted release/deployment regression set.**

Run: `npm run test:deployment && npm run test:release-automation && node --import tsx --test tests/release-orchestration.test.ts tests/release-promote-resume.test.ts tests/production-readiness.test.ts tests/deployment-ledger.test.ts tests/deployment-staging-release.test.ts tests/production-executor-state.test.ts tests/production-executor-workflow.test.ts tests/workflow-release-candidate.test.ts`

Expected: PASS, with the local evidence rung reported as `unit/contract test`; no staging or production evidence is claimed.

- [ ] **Step 4: Perform a read-only authority scan.**

Run: `rg -n 'git tag -a|git push|verify-production-promotion-ready|production_tag_reconcile_existing|next_tag|latest_tag|origin/main' scripts/promote-current-staging-candidate.sh .github/workflows/promote-current-staging-candidate.yml scripts/release-promote.mjs scripts/lib/release-orchestration.mjs`

Expected: tag/push authority appears only behind explicit execute/tag steps, the compatibility wrapper contains only exact RC delegation, and no canonical RC resolution uses latest/current-staging/origin-main fallback.

- [ ] **Step 5: Verify the implementation before reporting completion.**

Run: `git log -1 --oneline && git status --short && git diff HEAD^ --check`

Expected: a clean, locally committed ClassroomPath implementation with fresh verification output. Report files, root cause, tests, commands, limitations, and the final SHA; state explicitly that no operational proof, staging deployment, production deployment, tag, release, or push was performed.
