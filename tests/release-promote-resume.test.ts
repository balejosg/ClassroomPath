/**
 * Tests for the --from-step / --only / --resume flags and the per-step state helpers.
 *
 * Run alongside the main orchestration suite:
 *   node --import tsx --test tests/release-orchestration.test.ts tests/release-execution.test.ts tests/release-promote-resume.test.ts
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
  'verify-promotion-identity',
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
    assert.ok(
      executedSteps.includes('verify-promotion-identity'),
      'verify-promotion-identity must always run'
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
      [
        'report-residual-actions-runs',
        'verify-production-health',
        'verify-promotion-identity',
      ].sort()
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
    assert.ok(
      executedSteps.includes('verify-promotion-identity'),
      'verify-promotion-identity must always run'
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

  it('binds persisted step state to one Release Bundle identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-state-identity-'));
    const tag = 'v9.0.4';
    const firstReleaseId = 'a'.repeat(64);
    const secondReleaseId = 'b'.repeat(64);

    writeStepState({
      root,
      tag,
      releaseId: firstReleaseId,
      startedAt: '2026-01-01T00:00:00.000Z',
      stepId: 'wait-release-candidate',
      status: 'success',
      seconds: 1,
    });

    assert.equal(readStepState({ root, tag }).releaseId, firstReleaseId);
    assert.throws(
      () =>
        writeStepState({
          root,
          tag,
          releaseId: secondReleaseId,
          startedAt: '2026-01-01T00:00:00.000Z',
          stepId: 'deploy-staging',
          status: 'success',
          seconds: 1,
        }),
      /different Release Bundle releaseId/
    );
  });

  it('persists the complete five-field Release Bundle identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-state-complete-identity-'));
    const tag = 'v9.0.45';
    const identity = {
      releaseId: 'a'.repeat(64),
      classroomPathSha: 'b'.repeat(40),
      openpathSha: 'c'.repeat(40),
      openpathContractSha256: 'd'.repeat(64),
      rcRunId: '123',
    };

    writeStepState({
      root,
      tag,
      ...identity,
      startedAt: '2026-01-01T00:00:00.000Z',
      stepId: 'wait-release-candidate',
      status: 'success',
      seconds: 1,
    });

    const state = readStepState({ root, tag });
    assert.deepEqual(
      {
        releaseId: state.releaseId,
        classroomPathSha: state.classroomPathSha,
        openpathSha: state.openpathSha,
        openpathContractSha256: state.openpathContractSha256,
        rcRunId: state.rcRunId,
      },
      identity
    );
  });

  it('rejects resume when the persisted state and exact bundle locator disagree', async () => {
    const root = mkdtempSync(join(tmpdir(), 'release-state-identity-mismatch-'));
    const tag = 'v9.0.5';
    const stateReleaseId = 'a'.repeat(64);
    const bundleReleaseId = 'b'.repeat(64);
    const classroomPathSha = 'c'.repeat(40);
    const openpathSha = 'd'.repeat(40);
    const openpathContractSha256 = 'e'.repeat(64);
    writeStepState({
      root,
      tag,
      releaseId: stateReleaseId,
      classroomPathSha,
      openpathSha,
      openpathContractSha256,
      rcRunId: '123',
      startedAt: '2026-01-01T00:00:00.000Z',
      stepId: 'verify-clean-repos',
      status: 'success',
      seconds: 1,
    });
    mkdirSync(join(root, tag, 'bundle'), { recursive: true });
    writeFileSync(
      join(root, tag, 'bundle', 'staging-release.env'),
      [
        `STAGING_RELEASE_ID=${bundleReleaseId}`,
        `STAGING_CLASSROOMPATH_SHA=${classroomPathSha}`,
        `STAGING_OPENPATH_SHA=${openpathSha}`,
        `STAGING_OPENPATH_CONTRACT_SHA256=${openpathContractSha256}`,
        'STAGING_RELEASE_RUN_ID=123',
        '',
      ].join('\n')
    );

    let stderr = '';
    const result = await runReleasePromoteCommand(
      ['--tag', tag, '--execute', '--resume'],
      makeSuccessDeps({
        transcriptRoot: root,
        readStepState: ({ root: stateRoot, tag: stateTag }) =>
          readStepState({ root: stateRoot, tag: stateTag }),
        stderr: (value: string) => {
          stderr += value;
        },
      })
    );

    assert.equal(result.status, 2);
    assert.match(stderr, /different Release Bundle releaseId/);
  });

  it('rejects resume when a persisted source identity field differs from the locator', async () => {
    const identity = {
      releaseId: 'a'.repeat(64),
      classroomPathSha: 'b'.repeat(40),
      openpathSha: 'c'.repeat(40),
      openpathContractSha256: 'd'.repeat(64),
      rcRunId: '123',
    };

    for (const [field, label] of [
      ['classroomPathSha', 'ClassroomPath SHA'],
      ['openpathSha', 'OpenPath SHA'],
      ['openpathContractSha256', 'OpenPath contract SHA-256'],
    ]) {
      const root = mkdtempSync(join(tmpdir(), `release-state-${field}-mismatch-`));
      const tag = 'v9.0.55';
      writeStepState({
        root,
        tag,
        ...identity,
        startedAt: '2026-01-01T00:00:00.000Z',
        stepId: 'verify-clean-repos',
        status: 'success',
        seconds: 1,
      });
      mkdirSync(join(root, tag, 'bundle'), { recursive: true });
      const locatorIdentity = {
        ...identity,
        [field]: field === 'openpathContractSha256' ? 'e'.repeat(64) : 'e'.repeat(40),
      };
      writeFileSync(
        join(root, tag, 'bundle', 'staging-release.env'),
        [
          `STAGING_RELEASE_ID=${locatorIdentity.releaseId}`,
          `STAGING_CLASSROOMPATH_SHA=${locatorIdentity.classroomPathSha}`,
          `STAGING_OPENPATH_SHA=${locatorIdentity.openpathSha}`,
          `STAGING_OPENPATH_CONTRACT_SHA256=${locatorIdentity.openpathContractSha256}`,
          `STAGING_RELEASE_RUN_ID=${locatorIdentity.rcRunId}`,
          '',
        ].join('\n')
      );

      let stderr = '';
      const result = await runReleasePromoteCommand(
        ['--tag', tag, '--execute', '--resume'],
        makeSuccessDeps({
          transcriptRoot: root,
          readStepState: ({ root: stateRoot, tag: stateTag }) =>
            readStepState({ root: stateRoot, tag: stateTag }),
          stderr: (value: string) => {
            stderr += value;
          },
        })
      );

      assert.equal(result.status, 2);
      assert.match(stderr, new RegExp(`different ${label}`));
    }
  });

  it('always runs the identity gate before accepting a resume skip set', async () => {
    const root = mkdtempSync(join(tmpdir(), 'release-state-current-identity-'));
    const tag = 'v9.0.6';
    const identity = {
      releaseId: 'a'.repeat(64),
      classroomPathSha: 'b'.repeat(40),
      openpathSha: 'c'.repeat(40),
      openpathContractSha256: 'd'.repeat(64),
      rcRunId: '123',
    };
    mkdirSync(join(root, tag), { recursive: true });
    writeFileSync(
      join(root, tag, 'state.json'),
      JSON.stringify({
        tag,
        ...identity,
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        steps: {
          'verify-clean-repos': { status: 'success', seconds: 1 },
          'verify-promotion-identity': { status: 'success', seconds: 1 },
          'resolve-origin-main': { status: 'success', seconds: 1 },
          'wait-release-candidate': { status: 'success', seconds: 1 },
          'deploy-staging': { status: 'success', seconds: 1 },
        },
      }) + '\n'
    );
    mkdirSync(join(root, tag, 'bundle'), { recursive: true });
    writeFileSync(
      join(root, tag, 'bundle', 'staging-release.env'),
      [
        `STAGING_RELEASE_ID=${identity.releaseId}`,
        `STAGING_CLASSROOMPATH_SHA=${identity.classroomPathSha}`,
        `STAGING_OPENPATH_SHA=${identity.openpathSha}`,
        `STAGING_OPENPATH_CONTRACT_SHA256=${identity.openpathContractSha256}`,
        `STAGING_RELEASE_RUN_ID=${identity.rcRunId}`,
        '',
      ].join('\n')
    );

    const executedSteps: string[] = [];
    const result = await runReleasePromoteCommand(
      [
        '--tag',
        tag,
        '--execute',
        '--no-high-risk-windows',
        '--no-post-production-windows-canary',
        '--resume',
      ],
      makeSuccessDeps({
        transcriptRoot: root,
        readStepState: ({ root: stateRoot, tag: stateTag }) =>
          readStepState({ root: stateRoot, tag: stateTag }),
        runStep: async (step: { id: string }) => {
          executedSteps.push(step.id);
          if (step.id === 'verify-promotion-identity') {
            return {
              id: step.id,
              status: 'failed',
              seconds: 1,
              stderr: 'current promotion identity changed',
            };
          }
          return { id: step.id, status: 'success', seconds: 1 };
        },
      })
    );

    assert.equal(result.status, 1);
    assert.deepEqual(executedSteps, ['verify-promotion-identity']);
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
