import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildOpenPathCiRecoveryScenario } from './helpers/release-fixtures.ts';
import {
  classifyRequiredCheckWaitState,
  evaluateRequiredChecks,
  resolveOpenPathRequiredChecks,
  OPENPATH_CI_JOB_NAMES,
  OPENPATH_PRERELEASE_APT_REQUIRED_CHECK,
} from '../scripts/lib/openpath-ci-checks.mjs';
import { fetchCheckRuns, parseWaitOptions } from '../scripts/openpath-required-checks.mjs';

function buildCompletedWorkflowJob(name: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name,
    status: 'completed',
    conclusion: 'success',
    completed_at: '2026-03-13T10:00:00Z',
    steps: [
      {
        name: 'Set up job',
        status: 'completed',
        conclusion: 'success',
      },
      {
        name: 'Complete job',
        status: 'completed',
        conclusion: 'success',
      },
    ],
    ...overrides,
  };
}

function buildFetchResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

describe('evaluateRequiredChecks', () => {
  it('accepts the latest success for every required check', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [
        {
          name: 'CI Success',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:00:00Z',
        },
        {
          name: 'E2E Summary',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:01:00Z',
        },
      ],
      requiredChecks: ['CI Success', 'E2E Summary'],
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.failing, []);
  });

  it('fails when a required check is missing', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [
        {
          name: 'CI Success',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:00:00Z',
        },
      ],
      requiredChecks: ['CI Success', 'E2E Summary'],
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ['E2E Summary']);
    assert.deepEqual(result.failing, []);
  });

  it('fails when the latest run of a required check is not successful', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [
        {
          name: 'CI Success',
          conclusion: 'failure',
          status: 'completed',
          completed_at: '2026-03-13T10:02:00Z',
        },
        {
          name: 'E2E Summary',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:01:00Z',
        },
      ],
      requiredChecks: ['CI Success', 'E2E Summary'],
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.failing, [
      {
        conclusion: 'failure',
        name: 'CI Success',
        status: 'completed',
      },
    ]);
  });

  it('deduplicates retries by keeping the latest run per check name', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [
        {
          name: 'CI Success',
          conclusion: 'failure',
          status: 'completed',
          completed_at: '2026-03-13T10:00:00Z',
        },
        {
          name: 'CI Success',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:05:00Z',
        },
        {
          name: 'E2E Summary',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:01:00Z',
        },
      ],
      requiredChecks: ['CI Success', 'E2E Summary'],
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.failing, []);
  });

  it('recovers CI Success from workflow jobs when the summary check is missing', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [],
      requiredChecks: ['CI Success'],
      workflowJobs: OPENPATH_CI_JOB_NAMES.map((jobName) => buildCompletedWorkflowJob(jobName)),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.failing, []);
  });

  it('recovers CI Success when the windows job is stuck in progress after all steps succeed', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [],
      requiredChecks: ['CI Success'],
      workflowJobs: [
        buildCompletedWorkflowJob('Detect Relevant Changes'),
        buildCompletedWorkflowJob('Linux Agent Tests (BATS)'),
        buildCompletedWorkflowJob('Delivery Contracts (Node)'),
        buildCompletedWorkflowJob('Windows Agent Tests (Pester)', {
          status: 'in_progress',
          conclusion: null,
          completed_at: null,
          steps: [
            {
              name: 'Set up job',
              status: 'completed',
              conclusion: 'success',
            },
            {
              name: 'Run Windows Unit Tests',
              status: 'completed',
              conclusion: 'success',
            },
            {
              name: 'Upload test results',
              status: 'completed',
              conclusion: 'success',
            },
            {
              name: 'Complete job',
              status: 'completed',
              conclusion: 'success',
            },
          ],
        }),
      ],
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.failing, []);
  });

  it('recovers CI Success when the windows job is marked failed after all steps succeed', () => {
    const fixture = buildOpenPathCiRecoveryScenario();
    const result = evaluateRequiredChecks({
      checkRuns: fixture.checkRuns,
      requiredChecks: ['CI Success'],
      workflowJobs: fixture.workflowJobs,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.failing, []);
  });

  it('does not recover CI Success when a required workflow job actually fails', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [],
      requiredChecks: ['CI Success'],
      workflowJobs: [
        buildCompletedWorkflowJob('Detect Relevant Changes'),
        buildCompletedWorkflowJob('Linux Agent Tests (BATS)'),
        buildCompletedWorkflowJob('Delivery Contracts (Node)'),
        buildCompletedWorkflowJob('Windows Agent Tests (Pester)', {
          status: 'completed',
          conclusion: 'failure',
          steps: [
            {
              name: 'Set up job',
              status: 'completed',
              conclusion: 'success',
            },
            {
              name: 'Run Windows Unit Tests',
              status: 'completed',
              conclusion: 'failure',
            },
            {
              name: 'Complete job',
              status: 'completed',
              conclusion: 'success',
            },
          ],
        }),
      ],
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ['CI Success']);
    assert.deepEqual(result.failing, []);
  });

  it('does not recover CI Success when a workflow job is still genuinely running', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [],
      requiredChecks: ['CI Success'],
      workflowJobs: [
        buildCompletedWorkflowJob('Detect Relevant Changes'),
        buildCompletedWorkflowJob('Linux Agent Tests (BATS)'),
        buildCompletedWorkflowJob('Delivery Contracts (Node)'),
        buildCompletedWorkflowJob('Windows Agent Tests (Pester)', {
          status: 'in_progress',
          conclusion: null,
          completed_at: null,
          steps: [
            {
              name: 'Set up job',
              status: 'completed',
              conclusion: 'success',
            },
            {
              name: 'Run Windows Unit Tests',
              status: 'in_progress',
              conclusion: null,
            },
          ],
        }),
      ],
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ['CI Success']);
    assert.deepEqual(result.failing, []);
  });
});

describe('classifyRequiredCheckWaitState', () => {
  const aptCheck = 'Publish Prerelease to APT Repository / Publish to APT Repository (unstable)';

  it('classifies missing checks as pending for wait mode', () => {
    const state = classifyRequiredCheckWaitState({
      checkRuns: [],
      requiredChecks: [aptCheck],
    });

    assert.equal(state.kind, 'pending');
    assert.deepEqual(state.pending, [aptCheck]);
    assert.deepEqual(state.terminalFailures, []);
  });

  it('classifies in-progress checks as pending for wait mode', () => {
    const state = classifyRequiredCheckWaitState({
      checkRuns: [
        {
          name: aptCheck,
          status: 'in_progress',
          conclusion: null,
          started_at: '2026-04-22T07:00:00Z',
        },
      ],
      requiredChecks: [aptCheck],
    });

    assert.equal(state.kind, 'pending');
    assert.deepEqual(state.pending, [aptCheck]);
    assert.deepEqual(state.terminalFailures, []);
  });

  it('classifies terminal non-success checks as terminal failures', () => {
    const state = classifyRequiredCheckWaitState({
      checkRuns: [
        {
          name: aptCheck,
          status: 'completed',
          conclusion: 'failure',
          completed_at: '2026-04-22T07:03:00Z',
        },
      ],
      requiredChecks: [aptCheck],
    });

    assert.equal(state.kind, 'terminal_failure');
    assert.deepEqual(state.pending, []);
    assert.deepEqual(state.terminalFailures, [
      {
        name: aptCheck,
        status: 'completed',
        conclusion: 'failure',
      },
    ]);
  });

  it('classifies all required checks passing as passed', () => {
    const state = classifyRequiredCheckWaitState({
      checkRuns: [
        {
          name: aptCheck,
          status: 'completed',
          conclusion: 'success',
          completed_at: '2026-04-22T07:03:00Z',
        },
      ],
      requiredChecks: [aptCheck],
    });

    assert.equal(state.kind, 'passed');
    assert.deepEqual(state.pending, []);
    assert.deepEqual(state.terminalFailures, []);
  });
});

describe('resolveOpenPathRequiredChecks', () => {
  it('keeps low-risk OpenPath promotions on the CI summary gate', () => {
    const result = resolveOpenPathRequiredChecks({
      changedFiles: ['docs/INDEX.md', 'README.md'],
    });

    assert.deepEqual(result.requiredChecks, ['CI Success']);
    assert.equal(result.highRisk, false);
    assert.deepEqual(result.matchedFiles, []);
  });

  it('requires E2E and installer evidence for Windows, Linux, Firefox, and token delivery changes', () => {
    const result = resolveOpenPathRequiredChecks({
      changedFiles: [
        'windows/OpenPath.psm1',
        'linux/lib/firefox-policy.sh',
        'firefox-extension/src/lib/request-api.ts',
        'tests/selenium/student-policy-driver-browser.ts',
        'api/src/routes/token-delivery.ts',
      ],
    });

    assert.equal(result.highRisk, true);
    assert.deepEqual(result.requiredChecks, [
      'CI Success',
      'E2E Summary',
      'Installer Contracts Success',
    ]);
    assert.deepEqual(result.matchedFiles, [
      'windows/OpenPath.psm1',
      'linux/lib/firefox-policy.sh',
      'firefox-extension/src/lib/request-api.ts',
      'tests/selenium/student-policy-driver-browser.ts',
      'api/src/routes/token-delivery.ts',
    ]);
  });

  it('adds prerelease APT publication only for release infrastructure changes', () => {
    const result = resolveOpenPathRequiredChecks({
      changedFiles: [
        'package-lock.json',
        'VERSION',
        '.github/workflows/release.yml',
        'scripts/require-release-quality-gate.mjs',
      ],
    });

    assert.equal(result.highRisk, true);
    assert.deepEqual(result.requiredChecks, ['CI Success', OPENPATH_PRERELEASE_APT_REQUIRED_CHECK]);
  });

  it('does not require release-script checks for Debian package and E2E workflow changes', () => {
    const result = resolveOpenPathRequiredChecks({
      changedFiles: [
        '.github/workflows/e2e-tests.yml',
        'linux/debian-package/DEBIAN/postinst',
        'tests/install.bats',
        'tests/repo-config/workflow-contracts.test.mjs',
      ],
    });

    assert.equal(result.highRisk, true);
    assert.deepEqual(result.requiredChecks, [
      'CI Success',
      'E2E Summary',
      'Installer Contracts Success',
    ]);
  });

  it('honors OPENPATH_REQUIRED_CHECKS as an explicit override', () => {
    const result = resolveOpenPathRequiredChecks({
      explicitRequiredChecks: ['CI Success'],
      changedFiles: ['windows/OpenPath.psm1'],
    });

    assert.equal(result.highRisk, true);
    assert.deepEqual(result.requiredChecks, ['CI Success']);
  });
});

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

describe('fetchCheckRuns', () => {
  it('fetches later pages so high-risk required checks are not falsely missing', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      const page = new URL(url).searchParams.get('page');

      if (page === '1') {
        return buildFetchResponse({
          check_runs: Array.from({ length: 100 }, (_, index) => ({
            name: `Unrelated Check ${index}`,
            status: 'completed',
            conclusion: 'success',
            completed_at: '2026-04-27T18:00:00Z',
          })),
        });
      }

      return buildFetchResponse({
        check_runs: [
          {
            name: OPENPATH_PRERELEASE_APT_REQUIRED_CHECK,
            status: 'completed',
            conclusion: 'success',
            completed_at: '2026-04-27T18:40:00Z',
          },
        ],
      });
    }) as typeof fetch;

    try {
      const checkRuns = await fetchCheckRuns({
        repo: 'balejosg/openpath',
        sha: '01e495c70bcbf6261ebce05d16d7119319d92f36',
        token: 'test-token',
      });

      assert.equal(checkRuns.length, 101);
      assert.equal(checkRuns.at(-1)?.name, OPENPATH_PRERELEASE_APT_REQUIRED_CHECK);
      assert.equal(new URL(requestedUrls[0]).searchParams.get('per_page'), '100');
      assert.equal(new URL(requestedUrls[1]).searchParams.get('page'), '2');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
