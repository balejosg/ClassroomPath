# OpenPath APT Wait Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Release Candidate Images inline OpenPath APT polling loop with a tested, diagnostic wait mode that fails fast on terminal OpenPath check failures and preserves the ClassroomPath -> OpenPath dependency boundary.

**Architecture:** Keep ClassroomPath as the observer of OpenPath checks. Extend the existing OpenPath required-checks CLI with a `wait` subcommand instead of adding callbacks from OpenPath into ClassroomPath. The workflow calls that CLI from `derive-release-image-refs`, so later jobs still receive the same outputs and no release image contract changes.

**Tech Stack:** Node ESM scripts, GitHub REST API via `fetch`, GitHub Actions YAML, Node test runner with `tsx`, existing workflow contract tests.

## Design Constraints

- Do not add any OpenPath -> ClassroomPath dependency, dispatch, secret, or terminology.
- Do not change image names, release-candidate manifest shape, deploy flow, or Firefox asset behavior.
- Do not reduce required checks or bypass `Publish Prerelease to APT Repository / Publish to APT Repository (unstable)`.
- Do not replace the current RC workflow trigger in this slice. This is the safe E1 implementation, not the later event-driven redesign.
- Keep the default max wait at 600 seconds and interval at 10 seconds so behavior is compatible, but add fail-fast and better diagnostics.

## Task 1: Add Pure Wait-State Helpers

**Files:**

- Modify: `ClassroomPath/scripts/lib/openpath-ci-checks.mjs`
- Modify: `ClassroomPath/tests/openpath-required-checks.test.ts`

**Step 1: Write failing tests for required-check wait state**

Append tests under `describe('evaluateRequiredChecks', ...)` or add a new `describe('classifyRequiredCheckWaitState', ...)` block:

```ts
import { classifyRequiredCheckWaitState } from '../scripts/lib/openpath-ci-checks.mjs';

it('classifies missing checks as pending for wait mode', () => {
  const state = classifyRequiredCheckWaitState({
    checkRuns: [],
    requiredChecks: ['Publish Prerelease to APT Repository / Publish to APT Repository (unstable)'],
  });

  assert.equal(state.kind, 'pending');
  assert.deepEqual(state.pending, [
    'Publish Prerelease to APT Repository / Publish to APT Repository (unstable)',
  ]);
  assert.deepEqual(state.terminalFailures, []);
});

it('classifies in-progress checks as pending for wait mode', () => {
  const state = classifyRequiredCheckWaitState({
    checkRuns: [
      {
        name: 'Publish Prerelease to APT Repository / Publish to APT Repository (unstable)',
        status: 'in_progress',
        conclusion: null,
        started_at: '2026-04-22T07:00:00Z',
      },
    ],
    requiredChecks: ['Publish Prerelease to APT Repository / Publish to APT Repository (unstable)'],
  });

  assert.equal(state.kind, 'pending');
  assert.deepEqual(state.pending, [
    'Publish Prerelease to APT Repository / Publish to APT Repository (unstable)',
  ]);
});

it('classifies terminal non-success checks as terminal failures', () => {
  const state = classifyRequiredCheckWaitState({
    checkRuns: [
      {
        name: 'Publish Prerelease to APT Repository / Publish to APT Repository (unstable)',
        status: 'completed',
        conclusion: 'failure',
        completed_at: '2026-04-22T07:03:00Z',
      },
    ],
    requiredChecks: ['Publish Prerelease to APT Repository / Publish to APT Repository (unstable)'],
  });

  assert.equal(state.kind, 'terminal_failure');
  assert.deepEqual(state.pending, []);
  assert.deepEqual(state.terminalFailures, [
    {
      name: 'Publish Prerelease to APT Repository / Publish to APT Repository (unstable)',
      status: 'completed',
      conclusion: 'failure',
    },
  ]);
});

it('classifies all required checks passing as passed', () => {
  const state = classifyRequiredCheckWaitState({
    checkRuns: [
      {
        name: 'Publish Prerelease to APT Repository / Publish to APT Repository (unstable)',
        status: 'completed',
        conclusion: 'success',
        completed_at: '2026-04-22T07:03:00Z',
      },
    ],
    requiredChecks: ['Publish Prerelease to APT Repository / Publish to APT Repository (unstable)'],
  });

  assert.equal(state.kind, 'passed');
  assert.deepEqual(state.pending, []);
  assert.deepEqual(state.terminalFailures, []);
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
cd ClassroomPath
node --import tsx --test tests/openpath-required-checks.test.ts
```

Expected: FAIL because `classifyRequiredCheckWaitState` is not exported.

**Step 3: Implement the helper**

Add this export near `evaluateRequiredChecks` in `scripts/lib/openpath-ci-checks.mjs`:

```js
export function classifyRequiredCheckWaitState({ checkRuns, requiredChecks, workflowJobs = [] }) {
  const evaluation = evaluateRequiredChecks({ checkRuns, requiredChecks, workflowJobs });

  if (evaluation.ok) {
    return {
      kind: 'passed',
      pending: [],
      terminalFailures: [],
      evaluation,
    };
  }

  const latestByName = selectLatestCheckRuns(checkRuns);
  const terminalFailures = [];
  const pending = [];

  for (const checkName of requiredChecks) {
    const checkRun = latestByName.get(checkName);

    if (!checkRun) {
      pending.push(checkName);
      continue;
    }

    if (checkRun.status === 'completed' && checkRun.conclusion !== 'success') {
      terminalFailures.push({
        name: checkName,
        status: checkRun.status ?? 'unknown',
        conclusion: checkRun.conclusion ?? 'unknown',
      });
      continue;
    }

    if (checkRun.status !== 'completed') {
      pending.push(checkName);
      continue;
    }
  }

  return {
    kind: terminalFailures.length > 0 ? 'terminal_failure' : 'pending',
    pending,
    terminalFailures,
    evaluation,
  };
}
```

**Step 4: Run tests to verify they pass**

Run:

```bash
cd ClassroomPath
node --import tsx --test tests/openpath-required-checks.test.ts
```

Expected: PASS.

**Step 5: Commit**

Do not commit yet if this is being implemented in the shared trunk workspace. Stage/commit only when the session owner is ready:

```bash
cd ClassroomPath
git add scripts/lib/openpath-ci-checks.mjs tests/openpath-required-checks.test.ts
git commit -m "fix(ci): classify openpath required check wait state"
```

## Task 2: Add Wait Mode to the OpenPath Required Checks CLI

**Files:**

- Modify: `ClassroomPath/scripts/openpath-required-checks.mjs`
- Modify: `ClassroomPath/tests/openpath-required-checks.test.ts`

**Step 1: Write failing tests for wait option parsing**

Add exported pure helpers and tests before wiring network behavior:

```ts
import { parseWaitOptions } from '../scripts/openpath-required-checks.mjs';

describe('parseWaitOptions', () => {
  it('uses compatible defaults', () => {
    assert.deepEqual(parseWaitOptions({}), {
      timeoutSeconds: 600,
      intervalSeconds: 10,
      failFast: true,
    });
  });

  it('parses explicit wait settings', () => {
    assert.deepEqual(
      parseWaitOptions({
        OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS: '120',
        OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS: '5',
        OPENPATH_REQUIRED_CHECKS_FAIL_FAST: 'false',
      }),
      {
        timeoutSeconds: 120,
        intervalSeconds: 5,
        failFast: false,
      }
    );
  });

  it('rejects invalid timeout and interval values', () => {
    assert.throws(
      () => parseWaitOptions({ OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS: '0' }),
      /OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS must be a positive integer/
    );
    assert.throws(
      () => parseWaitOptions({ OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS: '-1' }),
      /OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS must be a positive integer/
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
cd ClassroomPath
node --import tsx --test tests/openpath-required-checks.test.ts
```

Expected: FAIL because `parseWaitOptions` is not exported.

**Step 3: Implement parsing and wait mode**

In `scripts/openpath-required-checks.mjs`:

- Import `classifyRequiredCheckWaitState`.
- Export `parseWaitOptions(env = process.env)`.
- Add a `sleep(ms)` helper.
- Extract the current one-shot GitHub evaluation into a reusable function.
- Add a `waitForRequiredChecks(context, options)` loop.
- Make `node scripts/openpath-required-checks.mjs wait` call wait mode; the existing no-arg invocation remains one-shot.

Required behavior:

- One-shot mode remains backward compatible.
- Wait mode prints an attempt line including elapsed seconds and pending checks.
- Wait mode exits immediately when all required checks pass.
- If `failFast` is true and a required check is completed with non-success, wait mode exits `1` immediately.
- Timeout exits `1` and prints pending checks plus total elapsed seconds.

Use these env var names:

```text
OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS
OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS
OPENPATH_REQUIRED_CHECKS_FAIL_FAST
```

Default values:

```js
{
  timeoutSeconds: 600,
  intervalSeconds: 10,
  failFast: true,
}
```

**Step 4: Run tests to verify parsing passes**

Run:

```bash
cd ClassroomPath
node --import tsx --test tests/openpath-required-checks.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
cd ClassroomPath
git add scripts/openpath-required-checks.mjs tests/openpath-required-checks.test.ts
git commit -m "fix(ci): add wait mode for openpath required checks"
```

## Task 3: Replace the Inline APT Polling Loop in RC Images

**Files:**

- Modify: `ClassroomPath/.github/workflows/release-candidate-images.yml`
- Modify: `ClassroomPath/tests/workflow-release-candidate.test.ts`

**Step 1: Write failing workflow contract tests**

In `tests/workflow-release-candidate.test.ts`, update the existing release candidate workflow contract test to assert:

```ts
assert.ok(waitForOpenPathAptPublishRun.includes('node scripts/openpath-required-checks.mjs wait'));
assert.ok(waitForOpenPathAptPublishRun.includes('OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS'));
assert.ok(waitForOpenPathAptPublishRun.includes('OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS'));
assert.ok(!waitForOpenPathAptPublishRun.includes('for attempt in $(seq 1 60)'));
assert.ok(!waitForOpenPathAptPublishRun.includes('sleep 10'));
```

Keep the existing assertion that the explicit required check is:

```text
Publish Prerelease to APT Repository / Publish to APT Repository (unstable)
```

**Step 2: Run tests to verify they fail**

Run:

```bash
cd ClassroomPath
node --import tsx --test tests/workflow-release-candidate.test.ts
```

Expected: FAIL because the workflow still contains the inline bash loop.

**Step 3: Update the workflow wait step**

Replace the `Wait for OpenPath prerelease APT publish` `run` block in `.github/workflows/release-candidate-images.yml` with:

```yaml
run: |
  set -euo pipefail
  OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS=600 \
  OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS=10 \
  OPENPATH_REQUIRED_CHECKS_FAIL_FAST=true \
    node scripts/openpath-required-checks.mjs wait
```

Keep existing `env` values:

```yaml
GITHUB_TOKEN: ${{ github.token }}
OPENPATH_SHA: ${{ steps.openpath.outputs.sha }}
OPENPATH_REQUIRED_CHECKS: Publish Prerelease to APT Repository / Publish to APT Repository (unstable)
```

**Step 4: Run tests to verify they pass**

Run:

```bash
cd ClassroomPath
node --import tsx --test tests/workflow-release-candidate.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
cd ClassroomPath
git add .github/workflows/release-candidate-images.yml tests/workflow-release-candidate.test.ts
git commit -m "fix(ci): use diagnostic openpath apt wait mode"
```

## Task 4: Add Workflow Regression Coverage to the Existing Catalog

**Files:**

- Modify: `ClassroomPath/tests/workflow-core.test.ts` only if the workflow regression catalog does not already include `tests/workflow-release-candidate.test.ts`.
- Modify: `ClassroomPath/scripts/lib/verification-catalog.mjs` only if the changed files are not already mapped to the workflow regression suite.

**Step 1: Inspect existing coverage**

Run:

```bash
cd ClassroomPath
rg -n "workflow-release-candidate|release-candidate-images.yml|openpath-required-checks" tests scripts/lib/verification-catalog.mjs
```

Expected: `tests/workflow-release-candidate.test.ts` is already present in the workflow regression set. If it is present, do not edit catalog files.

**Step 2: Run workflow regression tests**

Run:

```bash
cd ClassroomPath
node --import tsx --test tests/workflow-release-candidate.test.ts tests/openpath-required-checks.test.ts tests/workflow-core.test.ts
```

Expected: PASS.

**Step 3: Commit only if catalog files changed**

If no catalog files changed, skip this commit. If they changed:

```bash
cd ClassroomPath
git add tests/workflow-core.test.ts scripts/lib/verification-catalog.mjs
git commit -m "test(ci): route openpath apt wait regressions"
```

## Task 5: Update Operator Notes and Measurement Follow-Up

**Files:**

- Modify: `toc_cicd_analysis.md`
- Optional modify: `ClassroomPath/docs/verification-matrix.md` only if the implementation changes the maintained verification process. Do not mark a draft plan as maintained.

**Step 1: Update the TOC analysis**

In `toc_cicd_analysis.md`, update E1 to state that the first implementation slice has replaced inline bash polling with diagnostic wait mode. Keep the broader event-driven redesign as future work.

**Step 2: Run docs formatting**

Run:

```bash
cd ClassroomPath
npm exec prettier -- --check ../toc_cicd_analysis.md docs/plans/2026-04-22-openpath-apt-wait.md
```

Expected: PASS.

**Step 3: Run docs verification if maintained docs changed**

If `ClassroomPath/docs/verification-matrix.md` or any other maintained doc changed, run:

```bash
cd ClassroomPath
npm run verify:docs
```

Expected: PASS.

**Step 4: Commit**

```bash
cd ClassroomPath
git add ../toc_cicd_analysis.md docs/plans/2026-04-22-openpath-apt-wait.md
git commit -m "docs(ci): plan openpath apt wait hardening"
```

## Final Verification

Run the targeted suite:

```bash
cd ClassroomPath
node --import tsx --test tests/openpath-required-checks.test.ts tests/workflow-release-candidate.test.ts tests/workflow-core.test.ts
npm exec prettier -- --check ../toc_cicd_analysis.md docs/plans/2026-04-22-openpath-apt-wait.md
```

If maintained docs changed, also run:

```bash
cd ClassroomPath
npm run verify:docs
```

Expected:

- Node test runner exits `0`.
- Prettier exits `0`.
- `npm run verify:docs` exits `0` when applicable.

## Acceptance Criteria

- Release Candidate Images no longer contains an inline `for attempt in $(seq 1 60)` polling loop.
- The OpenPath APT wait still requires `Publish Prerelease to APT Repository / Publish to APT Repository (unstable)`.
- Wait mode uses the same default timeout and interval as the old workflow.
- Terminal OpenPath check failures fail fast instead of burning the full timeout.
- Timeout and pending-check diagnostics name the OpenPath SHA and required check.
- No OpenPath code, workflow, secret, or behavior references ClassroomPath.
- Existing release-candidate image outputs and manifest shape are unchanged.
