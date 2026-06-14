/**
 * Tests for the --from-step / --only / --resume flags and the per-step state helpers.
 *
 * Run alongside the main orchestration suite:
 *   node --import tsx --test tests/release-orchestration.test.ts tests/release-execution.test.ts tests/release-promote-resume.test.ts
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { readStepState, writeStepState } from '../scripts/lib/release-orchestration.mjs';
import { parseReleasePromoteArgs, runReleasePromoteCommand } from '../scripts/release-promote.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a dependency bundle with all steps succeeding (unless overridden). */
function makeSuccessDeps(overrides: Record<string, unknown> = {}) {
  return {
    stdout: () => {},
    stderr: () => {},
    runStep: async (step: { id: string }) => ({ id: step.id, status: 'success', seconds: 1 }),
    writeStepState: () => {},
    readStepState: () => null,
    ...overrides,
  };
}

/** Minimal step-state shape with given gates marked success. */
function stateWithSuccessGates(...ids: string[]) {
  const steps: Record<string, { status: string; seconds: number }> = {};
  for (const id of ids) {
    steps[id] = { status: 'success', seconds: 1 };
  }
  return {
    tag: 'v1.2.301',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps,
  };
}

// Full ordered step list for the default plan (highRiskWindows=true, postProductionWindowsCanary=true)
const ALL_STEP_IDS = [
  'verify-clean-repos',
  'resolve-origin-main',
  'wait-release-candidate',
  'deploy-staging',
  'ensure-windows-prepromotion-evidence',
  'verify-promotion-ready',
  'verify-production-target-ready',
  'release-preflight',
  'tag-production',
  'wait-production-deploy',
  'verify-production-health',
  'run-post-production-windows-canary',
  'report-residual-actions-runs',
  'print-summary',
];

// Gates that must never be skipped without a prior success record.
const GATE_IDS = [
  'verify-clean-repos',
  'verify-promotion-ready',
  'verify-production-target-ready',
  'release-preflight',
];

// ---------------------------------------------------------------------------
// parseReleasePromoteArgs — new flags
// ---------------------------------------------------------------------------

describe('parseReleasePromoteArgs — resume flags', () => {
  it('parses --from-step', () => {
    const opts = parseReleasePromoteArgs(['--tag', 'v1.2.301', '--from-step', 'deploy-staging']);
    assert.equal(opts.fromStep, 'deploy-staging');
    assert.deepEqual(opts.only, []);
    assert.equal(opts.resume, false);
  });

  it('parses --only (single)', () => {
    const opts = parseReleasePromoteArgs(['--tag', 'v1.2.301', '--only', 'release-preflight']);
    assert.equal(opts.fromStep, null);
    assert.deepEqual(opts.only, ['release-preflight']);
    assert.equal(opts.resume, false);
  });

  it('parses --only (repeated)', () => {
    const opts = parseReleasePromoteArgs([
      '--tag',
      'v1.2.301',
      '--only',
      'verify-promotion-ready',
      '--only',
      'release-preflight',
    ]);
    assert.deepEqual(opts.only, ['verify-promotion-ready', 'release-preflight']);
  });

  it('parses --resume', () => {
    const opts = parseReleasePromoteArgs(['--tag', 'v1.2.301', '--resume']);
    assert.equal(opts.resume, true);
    assert.equal(opts.fromStep, null);
    assert.deepEqual(opts.only, []);
  });

  it('rejects unknown step id for --from-step in dry-run', async () => {
    const result = await runReleasePromoteCommand(
      ['--tag', 'v1.2.301', '--from-step', 'does-not-exist'],
      makeSuccessDeps()
    );
    assert.equal(result.status, 2, 'should reject with status 2');
  });

  it('rejects unknown step id for --only in dry-run', async () => {
    const result = await runReleasePromoteCommand(
      ['--tag', 'v1.2.301', '--only', 'does-not-exist'],
      makeSuccessDeps()
    );
    assert.equal(result.status, 2);
  });
});

// ---------------------------------------------------------------------------
// Step filtering — correct run/skip partition
// ---------------------------------------------------------------------------

describe('step filtering — --from-step', () => {
  it('skips all steps before the given id and runs the rest', async () => {
    const executedSteps: string[] = [];
    // All gates are pre-recorded as success so the guard allows the skip.
    const state = stateWithSuccessGates(...GATE_IDS);

    const result = await runReleasePromoteCommand(
      [
        '--tag',
        'v1.2.301',
        '--execute',
        '--no-post-production-windows-canary',
        '--from-step',
        'verify-promotion-ready',
      ],
      makeSuccessDeps({
        readStepState: () => state,
        runStep: async (step: { id: string }) => {
          executedSteps.push(step.id);
          return { id: step.id, status: 'success', seconds: 1 };
        },
      })
    );

    assert.equal(result.status, 0);
    // Steps before verify-promotion-ready must not appear.
    for (const id of [
      'verify-clean-repos',
      'resolve-origin-main',
      'wait-release-candidate',
      'deploy-staging',
      'ensure-windows-prepromotion-evidence',
    ]) {
      assert.equal(executedSteps.includes(id), false, `${id} should be skipped`);
    }
    // verify-promotion-ready and onwards must run.
    assert.ok(executedSteps.includes('verify-promotion-ready'), 'verify-promotion-ready must run');
    assert.ok(executedSteps.includes('tag-production'), 'tag-production must run');
    assert.ok(
      executedSteps.includes('verify-production-health'),
      'verify-production-health must run'
    );
  });
});

describe('step filtering — --only', () => {
  it('runs exactly the specified steps and skips all others', async () => {
    const executedSteps: string[] = [];
    const state = stateWithSuccessGates(...GATE_IDS);

    const result = await runReleasePromoteCommand(
      [
        '--tag',
        'v1.2.301',
        '--execute',
        '--only',
        'verify-production-health',
        '--only',
        'report-residual-actions-runs',
      ],
      makeSuccessDeps({
        readStepState: () => state,
        runStep: async (step: { id: string }) => {
          executedSteps.push(step.id);
          return { id: step.id, status: 'success', seconds: 1 };
        },
      })
    );

    assert.equal(result.status, 0);
    assert.deepEqual(
      executedSteps.sort(),
      ['report-residual-actions-runs', 'verify-production-health'].sort()
    );
  });
});

describe('step filtering — --resume', () => {
  it('skips steps recorded success and runs the rest', async () => {
    const executedSteps: string[] = [];
    // Simulate a prior run that passed everything up to and including deploy-staging.
    const state = stateWithSuccessGates(
      'verify-clean-repos',
      'resolve-origin-main',
      'wait-release-candidate',
      'deploy-staging'
    );

    const result = await runReleasePromoteCommand(
      [
        '--tag',
        'v1.2.301',
        '--execute',
        '--no-high-risk-windows',
        '--no-post-production-windows-canary',
        '--resume',
      ],
      makeSuccessDeps({
        readStepState: () => state,
        runStep: async (step: { id: string }) => {
          executedSteps.push(step.id);
          return { id: step.id, status: 'success', seconds: 1 };
        },
      })
    );

    assert.equal(result.status, 0);
    // Already-success steps must be skipped.
    for (const id of [
      'verify-clean-repos',
      'resolve-origin-main',
      'wait-release-candidate',
      'deploy-staging',
    ]) {
      assert.equal(executedSteps.includes(id), false, `${id} should be skipped`);
    }
    // Everything after must run.
    assert.ok(executedSteps.includes('verify-promotion-ready'), 'verify-promotion-ready must run');
    assert.ok(executedSteps.includes('tag-production'), 'tag-production must run');
  });
});

// ---------------------------------------------------------------------------
// Fail-closed guard
// ---------------------------------------------------------------------------

describe('fail-closed promotion gate guard', () => {
  it('rejects --from-step past a gate when no state file exists', async () => {
    let stderr = '';
    const result = await runReleasePromoteCommand(
      ['--tag', 'v1.2.301', '--execute', '--from-step', 'tag-production'],
      makeSuccessDeps({
        readStepState: () => null, // no state file
        stderr: (value: string) => {
          stderr += value;
        },
      })
    );

    assert.equal(result.status, 2);
    assert.match(stderr, /Refusing to skip un-passed promotion gate/);
    assert.match(stderr, /verify-clean-repos/);
    assert.match(stderr, /verify-promotion-ready/);
    assert.match(stderr, /verify-production-target-ready/);
    assert.match(stderr, /release-preflight/);
  });

  it('rejects --only a non-gate step when gates have no state', async () => {
    let stderr = '';
    const result = await runReleasePromoteCommand(
      ['--tag', 'v1.2.301', '--execute', '--only', 'tag-production'],
      makeSuccessDeps({
        readStepState: () => null,
        stderr: (value: string) => {
          stderr += value;
        },
      })
    );

    assert.equal(result.status, 2);
    assert.match(stderr, /Refusing to skip un-passed promotion gate/);
  });

  it('rejects combining selection flags (--from-step + --resume) even with passing state', async () => {
    let stderr = '';
    const result = await runReleasePromoteCommand(
      ['--tag', 'v1.2.301', '--execute', '--from-step', 'tag-production', '--resume'],
      makeSuccessDeps({
        // Even if every gate is recorded success, combining flags is ambiguous and must be rejected
        // before any skip is computed — closing the hole where --resume bypassed the from-step guard.
        readStepState: () => stateWithSuccessGates(...GATE_IDS),
        stderr: (value: string) => {
          stderr += value;
        },
      })
    );

    assert.equal(result.status, 2);
    assert.match(stderr, /mutually exclusive/);
  });

  it('allows --from-step past a gate when all gates are recorded success', async () => {
    const executedSteps: string[] = [];
    const state = stateWithSuccessGates(...GATE_IDS);

    const result = await runReleasePromoteCommand(
      [
        '--tag',
        'v1.2.301',
        '--execute',
        '--no-high-risk-windows',
        '--no-post-production-windows-canary',
        '--from-step',
        'tag-production',
      ],
      makeSuccessDeps({
        readStepState: () => state,
        runStep: async (step: { id: string }) => {
          executedSteps.push(step.id);
          return { id: step.id, status: 'success', seconds: 1 };
        },
      })
    );

    assert.equal(result.status, 0);
    assert.ok(executedSteps.includes('tag-production'), 'tag-production must run');
    assert.equal(
      executedSteps.includes('verify-clean-repos'),
      false,
      'verify-clean-repos must be skipped'
    );
  });

  it('allows --resume when all skipped gates were recorded success', async () => {
    const executedSteps: string[] = [];
    // All non-postcanary steps already succeeded.
    const succeededIds = ALL_STEP_IDS.filter(
      (id) =>
        id !== 'verify-production-health' &&
        id !== 'print-summary' &&
        id !== 'run-post-production-windows-canary'
    );
    const state = stateWithSuccessGates(...succeededIds);

    const result = await runReleasePromoteCommand(
      [
        '--tag',
        'v1.2.301',
        '--execute',
        '--no-high-risk-windows',
        '--no-post-production-windows-canary',
        '--resume',
      ],
      makeSuccessDeps({
        readStepState: () => state,
        runStep: async (step: { id: string }) => {
          executedSteps.push(step.id);
          return { id: step.id, status: 'success', seconds: 1 };
        },
      })
    );

    assert.equal(result.status, 0);
    // Only the not-yet-succeeded steps should have run.
    assert.ok(
      executedSteps.includes('verify-production-health'),
      'verify-production-health must run'
    );
    assert.equal(
      executedSteps.includes('verify-clean-repos'),
      false,
      'verify-clean-repos was already success'
    );
  });
});

// ---------------------------------------------------------------------------
// Default behavior — no new flags — must be byte-identical to before
// ---------------------------------------------------------------------------

describe('default behavior unchanged', () => {
  it('runs the full plan when no resume flags are passed', async () => {
    const executedSteps: string[] = [];

    const result = await runReleasePromoteCommand(
      ['--tag', 'v1.2.301', '--execute', '--no-post-production-windows-canary'],
      makeSuccessDeps({
        runStep: async (step: { id: string }) => {
          executedSteps.push(step.id);
          return { id: step.id, status: 'success', seconds: 1 };
        },
      })
    );

    assert.equal(result.status, 0);
    // All executable steps (everything except print-summary which has no command) must appear.
    const expectedCommandSteps = ALL_STEP_IDS.filter(
      (id) => id !== 'print-summary' && id !== 'run-post-production-windows-canary'
    );
    for (const id of expectedCommandSteps) {
      assert.ok(executedSteps.includes(id), `${id} must run in the default plan`);
    }
  });
});

// ---------------------------------------------------------------------------
// Dry-run output shows skip reasons
// ---------------------------------------------------------------------------

describe('dry-run output with resume flags', () => {
  it('labels skipped steps in dry-run output for --from-step', async () => {
    let stdout = '';
    const state = stateWithSuccessGates(...GATE_IDS);

    await runReleasePromoteCommand(
      ['--tag', 'v1.2.301', '--dry-run', '--from-step', 'verify-promotion-ready'],
      makeSuccessDeps({
        readStepState: () => state,
        stdout: (value: string) => {
          stdout += value;
        },
      })
    );

    assert.match(stdout, /skipped: before --from-step verify-promotion-ready/);
    // verify-promotion-ready itself should NOT be marked skipped.
    assert.doesNotMatch(stdout, /verify-promotion-ready.*skipped/);
  });

  it('labels skipped steps in dry-run output for --resume', async () => {
    let stdout = '';
    const state = stateWithSuccessGates('verify-clean-repos', 'resolve-origin-main');

    await runReleasePromoteCommand(
      ['--tag', 'v1.2.301', '--dry-run', '--resume'],
      makeSuccessDeps({
        readStepState: () => state,
        stdout: (value: string) => {
          stdout += value;
        },
      })
    );

    assert.match(stdout, /skipped: recorded success/);
  });
});

// ---------------------------------------------------------------------------
// writeStepState / readStepState helpers
// ---------------------------------------------------------------------------

describe('writeStepState / readStepState', () => {
  it('creates a state file and reads it back', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-state-'));
    const tag = 'v9.0.1';

    writeStepState({
      root,
      tag,
      startedAt: '2026-01-01T00:00:00.000Z',
      stepId: 'verify-clean-repos',
      status: 'success',
      seconds: 3,
    });

    const state = readStepState({ root, tag });
    assert.ok(state, 'state file should exist');
    assert.equal(state.tag, tag);
    assert.equal(state.steps['verify-clean-repos'].status, 'success');
    assert.equal(state.steps['verify-clean-repos'].seconds, 3);
    assert.ok(state.startedAt, 'startedAt should be set');
    assert.ok(state.updatedAt, 'updatedAt should be set');
  });

  it('accumulates step results across multiple writes', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-state-'));
    const tag = 'v9.0.2';
    const startedAt = '2026-01-01T00:00:00.000Z';

    writeStepState({
      root,
      tag,
      startedAt,
      stepId: 'verify-clean-repos',
      status: 'success',
      seconds: 1,
    });
    writeStepState({
      root,
      tag,
      startedAt,
      stepId: 'resolve-origin-main',
      status: 'success',
      seconds: 2,
    });
    writeStepState({
      root,
      tag,
      startedAt,
      stepId: 'deploy-staging',
      status: 'failed',
      seconds: 5,
    });

    const state = readStepState({ root, tag });
    assert.equal(state.steps['verify-clean-repos'].status, 'success');
    assert.equal(state.steps['resolve-origin-main'].status, 'success');
    assert.equal(state.steps['deploy-staging'].status, 'failed');
    // startedAt is preserved from the first write, not overwritten by later writes.
    assert.equal(state.startedAt, startedAt);
  });

  it('preserves startedAt across writes', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-state-'));
    const tag = 'v9.0.3';
    const startedAt = '2026-01-01T00:00:00.000Z';

    writeStepState({
      root,
      tag,
      startedAt,
      stepId: 'verify-clean-repos',
      status: 'success',
      seconds: 1,
    });
    writeStepState({
      root,
      tag,
      startedAt: '2099-12-31T00:00:00.000Z',
      stepId: 'deploy-staging',
      status: 'success',
      seconds: 2,
    });

    const state = readStepState({ root, tag });
    assert.equal(state.startedAt, startedAt, 'startedAt must be the first write value');
  });

  it('returns null when no state file exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-state-'));
    const state = readStepState({ root, tag: 'v0.0.0-nonexistent' });
    assert.equal(state, null);
  });

  it('state file is written per step during --execute', async () => {
    const root = mkdtempSync(join(tmpdir(), 'release-state-execute-'));

    await runReleasePromoteCommand(
      [
        '--tag',
        'v1.0.1',
        '--execute',
        '--no-high-risk-windows',
        '--no-post-production-windows-canary',
      ],
      {
        stdout: () => {},
        stderr: () => {},
        transcriptRoot: root,
        // Let real writeStepState run (don't stub it) to verify integration.
        readStepState: () => null,
        runStep: async (step: { id: string }) => ({ id: step.id, status: 'success', seconds: 1 }),
      }
    );

    const state = readStepState({ root, tag: 'v1.0.1' });
    assert.ok(state, 'state file should be written');
    assert.ok(Object.keys(state.steps).length > 0, 'at least one step should be recorded');
    assert.equal(state.steps['verify-clean-repos'].status, 'success');
  });
});
