import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildOpenPathCiRecoveryScenario } from './helpers/release-fixtures.ts';
import {
  classifyRequiredCheckWaitState,
  evaluateRequiredChecks,
  resolveOpenPathRequiredChecks,
  OPENPATH_CI_JOB_NAMES,
  OPENPATH_PRERELEASE_APT_REQUIRED_CHECK,
  OPENPATH_WEDU_CAPTIVE_PORTAL_REQUIRED_CHECK,
} from '../scripts/lib/openpath-ci-checks.mjs';
import {
  fetchCheckRuns,
  dispatchMissingOpenPathRequiredChecks,
  ensureOpenPathEvidenceRef,
  parseWaitOptions,
  runOpenPathRequiredChecksCommand,
} from '../scripts/openpath-required-checks.mjs';

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

function checkRun({
  name,
  status,
  conclusion,
  runId,
  completedAt,
}: {
  name: string;
  status: string;
  conclusion: string | null;
  runId: string;
  completedAt?: string;
}) {
  return {
    name,
    status,
    conclusion,
    completed_at: completedAt ?? null,
    started_at: '2026-04-27T18:00:00Z',
    details_url: `https://github.com/balejosg/openpath/actions/runs/${runId}/job/1`,
    html_url: `https://github.com/balejosg/openpath/actions/runs/${runId}`,
  };
}

async function runOpenPathRequiredChecks(
  command: 'check' | 'report' | 'wait',
  {
    checkRuns,
    jobsByRunId = {},
  }: {
    checkRuns: unknown[];
    jobsByRunId?: Record<string, unknown[]>;
  }
) {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const originalEnv = {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GH_TOKEN: process.env.GH_TOKEN,
    OPENPATH_SHA: process.env.OPENPATH_SHA,
    OPENPATH_REPO: process.env.OPENPATH_REPO,
    OPENPATH_REQUIRED_CHECKS: process.env.OPENPATH_REQUIRED_CHECKS,
    OPENPATH_BASE_SHA: process.env.OPENPATH_BASE_SHA,
    OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS: process.env.OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS,
    OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS:
      process.env.OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS,
    OPENPATH_REQUIRED_CHECKS_AUTO_DISPATCH: process.env.OPENPATH_REQUIRED_CHECKS_AUTO_DISPATCH,
    OPENPATH_REQUIRED_CHECKS_DISPATCH_TOKEN: process.env.OPENPATH_REQUIRED_CHECKS_DISPATCH_TOKEN,
  };
  let stdout = '';
  let stderr = '';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes('/actions/runs/')) {
      const runId = url.match(/\/actions\/runs\/(\d+)\/jobs/)?.[1] ?? '';
      return buildFetchResponse({ jobs: jobsByRunId[runId] ?? [] });
    }

    return buildFetchResponse({ check_runs: checkRuns });
  }) as typeof fetch;
  console.log = (...args: unknown[]) => {
    stdout += `${args.join(' ')}\n`;
  };
  console.error = (...args: unknown[]) => {
    stderr += `${args.join(' ')}\n`;
  };
  process.exitCode = undefined;
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.OPENPATH_SHA = '4d35dc2900000000000000000000000000000000';
  process.env.OPENPATH_REPO = 'balejosg/openpath';
  process.env.OPENPATH_REQUIRED_CHECKS = 'CI Success,Installer Contracts Success';
  process.env.OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS = '60';
  process.env.OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS = '60';
  delete process.env.OPENPATH_BASE_SHA;

  try {
    await runOpenPathRequiredChecksCommand([
      process.execPath,
      'scripts/openpath-required-checks.mjs',
      command,
    ]);

    return {
      status: process.exitCode ?? 0,
      stdout,
      stderr,
    };
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('openpath-required-checks CLI report output', () => {
  it('report mode prints missing and pending required checks with run hints', async () => {
    const result = await runOpenPathRequiredChecks('report', {
      checkRuns: [
        checkRun({
          name: 'CI Success',
          status: 'completed',
          conclusion: 'success',
          runId: '101',
          completedAt: '2026-04-27T18:01:00Z',
        }),
        checkRun({
          name: 'Installer Contracts Success',
          status: 'queued',
          conclusion: null,
          runId: '102',
        }),
      ],
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /OpenPath required checks for balejosg\/openpath@4d35dc29/);
    assert.match(result.stdout, /CI Success: success \(run 101\)/);
    assert.match(result.stdout, /Installer Contracts Success: pending \(run 102\)/);
    assert.match(result.stdout, /gh run view 102 --repo balejosg\/openpath/);
  });

  it('normal verification prints the same report before failing non-zero', async () => {
    const result = await runOpenPathRequiredChecks('check', {
      checkRuns: [
        checkRun({
          name: 'CI Success',
          status: 'completed',
          conclusion: 'success',
          runId: '101',
          completedAt: '2026-04-27T18:01:00Z',
        }),
        checkRun({
          name: 'Installer Contracts Success',
          status: 'completed',
          conclusion: 'failure',
          runId: '102',
          completedAt: '2026-04-27T18:02:00Z',
        }),
      ],
    });

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /OpenPath required checks for balejosg\/openpath@4d35dc29/);
    assert.match(result.stderr, /CI Success: success \(run 101\)/);
    assert.match(result.stderr, /Installer Contracts Success: failure \(run 102\)/);
    assert.match(result.stderr, /gh run view 102 --repo balejosg\/openpath/);
    assert.match(
      result.stderr,
      /OpenPath required checks failed for balejosg\/openpath@4d35dc2900000000000000000000000000000000/
    );
  });

  it('reports corrupt required-check runs with a rerun action', async () => {
    const result = await runOpenPathRequiredChecks('check', {
      checkRuns: [
        checkRun({
          name: 'CI Success',
          status: 'completed',
          conclusion: 'failure',
          runId: '102',
          completedAt: '2026-04-27T18:02:00Z',
        }),
        checkRun({
          name: 'Installer Contracts Success',
          status: 'completed',
          conclusion: 'success',
          runId: '103',
          completedAt: '2026-04-27T18:03:00Z',
        }),
      ],
      jobsByRunId: {
        '102': [
          {
            name: 'Windows Agent Tests (Pester)',
            status: 'queued',
            conclusion: null,
            started_at: '2026-04-27T18:01:00Z',
          },
        ],
      },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /CI Success: failure \(run 102\)/);
    assert.match(result.stderr, /Corrupt workflow run 102: queued jobs have startedAt/);
    assert.match(result.stderr, /Windows Agent Tests \(Pester\)/);
    assert.match(result.stderr, /gh run rerun 102 --repo balejosg\/openpath/);
  });

  it('wait mode fails fast for corrupt required-check runs', async () => {
    const startedAt = Date.now();
    const result = await runOpenPathRequiredChecks('wait', {
      checkRuns: [
        checkRun({
          name: 'CI Success',
          status: 'completed',
          conclusion: 'failure',
          runId: '102',
          completedAt: '2026-04-27T18:02:00Z',
        }),
        checkRun({
          name: 'Installer Contracts Success',
          status: 'completed',
          conclusion: 'success',
          runId: '103',
          completedAt: '2026-04-27T18:03:00Z',
        }),
      ],
      jobsByRunId: {
        '102': [
          {
            name: 'Windows Agent Tests (Pester)',
            status: 'queued',
            conclusion: null,
            started_at: '2026-04-27T18:01:00Z',
          },
        ],
      },
    });

    assert.equal(result.status, 1);
    assert.ok(Date.now() - startedAt < 5000);
    assert.match(result.stderr, /Corrupt workflow run 102: queued jobs have startedAt/);
    assert.match(result.stderr, /Next action: gh run rerun 102 --repo balejosg\/openpath/);
    assert.doesNotMatch(result.stderr, /Timed out/);
  });
});

describe('evaluateRequiredChecks', () => {
  it('includes the hosted Windows Pester job in CI Success recovery', () => {
    assert.ok(OPENPATH_CI_JOB_NAMES.includes('Windows Agent Tests (Pester, hosted)'));
  });

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
        buildCompletedWorkflowJob('Windows Agent Tests (Pester, hosted)'),
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
      workflowJobs: [
        ...fixture.workflowJobs,
        buildCompletedWorkflowJob('Windows Agent Tests (Pester, hosted)'),
      ],
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
        buildCompletedWorkflowJob('Windows Agent Tests (Pester, hosted)'),
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
        buildCompletedWorkflowJob('Windows Agent Tests (Pester, hosted)'),
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

describe('OpenPath required check auto-dispatch', () => {
  const sha = '4d35dc2900000000000000000000000000000000';
  const repo = 'balejosg/openpath';

  it('creates a durable release-evidence ref from the target SHA when it is missing', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      if (
        url.endsWith('/git/ref/heads/release-evidence/4d35dc2900000000000000000000000000000000')
      ) {
        return {
          ok: false,
          status: 404,
          text: async () => 'not found',
        } as Response;
      }

      return buildFetchResponse({
        ref: 'refs/heads/release-evidence/4d35dc2900000000000000000000000000000000',
      });
    }) as typeof fetch;

    try {
      const ref = await ensureOpenPathEvidenceRef({
        repo,
        sha,
        token: 'dispatch-token',
      });

      assert.equal(ref, 'release-evidence/4d35dc2900000000000000000000000000000000');
      assert.deepEqual(
        requests.map((request) => request.method),
        ['GET', 'POST']
      );
      assert.deepEqual(requests[1]?.body, {
        ref: `refs/heads/release-evidence/${sha}`,
        sha,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fails closed when the evidence ref cannot be read', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 403,
        text: async () => 'forbidden',
      }) as Response) as typeof fetch;

    try {
      await assert.rejects(
        () =>
          ensureOpenPathEvidenceRef({
            repo,
            sha,
            token: 'dispatch-token',
          }),
        /OpenPath evidence ref lookup failed with 403/
      );
      await assert.rejects(
        () =>
          ensureOpenPathEvidenceRef({
            repo,
            sha,
            token: 'dispatch-token',
          }),
        /OPENPATH_REQUIRED_CHECKS_DISPATCH_TOKEN has actions:write and contents:write/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('dispatches known missing checks once and reuses an existing run for the same SHA/workflow', async () => {
    const originalFetch = globalThis.fetch;
    const dispatches: unknown[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/actions/workflows/ci.yml/runs')) {
        return buildFetchResponse({
          workflow_runs: [
            {
              id: 101,
              head_sha: sha,
              status: 'in_progress',
            },
          ],
        });
      }

      if (url.includes('/actions/workflows/e2e-tests.yml/runs')) {
        return buildFetchResponse({ workflow_runs: [] });
      }

      if (url.includes('/git/ref/heads/release-evidence/')) {
        return buildFetchResponse({
          ref: `refs/heads/release-evidence/${sha}`,
        });
      }

      if (url.includes('/actions/workflows/e2e-tests.yml/dispatches')) {
        dispatches.push(JSON.parse(String(init?.body)));
        return {
          ok: true,
          status: 204,
          json: async () => ({}),
        } as Response;
      }

      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    try {
      const result = await dispatchMissingOpenPathRequiredChecks({
        repo,
        sha,
        token: 'dispatch-token',
        missingChecks: ['CI Success', 'E2E Summary'],
      });

      assert.deepEqual(result.dispatched, ['E2E Summary']);
      assert.deepEqual(result.reused, ['CI Success']);
      assert.deepEqual(dispatches, [
        {
          ref: `release-evidence/${sha}`,
          inputs: {
            platform: 'all',
            suite: 'all',
            student_policy_sse_group: 'auto',
          },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('dispatches the WEDU lab workflow with the full-lab timeout input', async () => {
    const originalFetch = globalThis.fetch;
    const dispatches: unknown[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/actions/workflows/wedu-captive-portal-lab.yml/runs')) {
        return buildFetchResponse({ workflow_runs: [] });
      }

      if (url.includes('/git/ref/heads/release-evidence/')) {
        return buildFetchResponse({
          ref: `refs/heads/release-evidence/${sha}`,
        });
      }

      if (url.includes('/actions/workflows/wedu-captive-portal-lab.yml/dispatches')) {
        dispatches.push(JSON.parse(String(init?.body)));
        return {
          ok: true,
          status: 204,
          json: async () => ({}),
        } as Response;
      }

      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    try {
      const result = await dispatchMissingOpenPathRequiredChecks({
        repo,
        sha,
        token: 'dispatch-token',
        missingChecks: [OPENPATH_WEDU_CAPTIVE_PORTAL_REQUIRED_CHECK],
      });

      assert.deepEqual(result.dispatched, [OPENPATH_WEDU_CAPTIVE_PORTAL_REQUIRED_CHECK]);
      assert.deepEqual(result.reused, []);
      assert.deepEqual(dispatches, [
        {
          ref: `release-evidence/${sha}`,
          inputs: {
            timeout_seconds: '900',
          },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fails closed for unknown required checks', async () => {
    await assert.rejects(
      () =>
        dispatchMissingOpenPathRequiredChecks({
          repo,
          sha,
          token: 'dispatch-token',
          missingChecks: ['Unexpected Check'],
        }),
      /No OpenPath workflow dispatch mapping for required check: Unexpected Check/
    );
  });

  it('fails closed with an actionable permission message when workflow dispatch is denied', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/actions/workflows/installer-contracts.yml/runs')) {
        return buildFetchResponse({ workflow_runs: [] });
      }

      if (url.includes('/git/ref/heads/release-evidence/')) {
        return buildFetchResponse({
          ref: `refs/heads/release-evidence/${sha}`,
        });
      }

      if (url.includes('/actions/workflows/installer-contracts.yml/dispatches')) {
        return {
          ok: false,
          status: 403,
          text: async () => 'Resource not accessible by integration',
        } as Response;
      }

      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    try {
      await assert.rejects(
        () =>
          dispatchMissingOpenPathRequiredChecks({
            repo,
            sha,
            token: 'dispatch-token',
            missingChecks: ['Installer Contracts Success'],
          }),
        /OPENPATH_REQUIRED_CHECKS_DISPATCH_TOKEN has actions:write and contents:write/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
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

  it('does not treat WEDU healthcheck or Linux smoke names as the full WEDU lab gate', () => {
    for (const checkName of ['WEDU gateway healthcheck', 'WEDU Linux client smoke']) {
      const state = classifyRequiredCheckWaitState({
        checkRuns: [
          {
            name: checkName,
            status: 'completed',
            conclusion: 'success',
            completed_at: '2026-04-22T07:03:00Z',
          },
        ],
        requiredChecks: [OPENPATH_WEDU_CAPTIVE_PORTAL_REQUIRED_CHECK],
      });

      assert.equal(state.kind, 'pending');
      assert.deepEqual(state.pending, [OPENPATH_WEDU_CAPTIVE_PORTAL_REQUIRED_CHECK]);
      assert.deepEqual(state.terminalFailures, []);
    }
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

  it('requires WEDU lab evidence for captive-sensitive Windows and Firefox changes', () => {
    const result = resolveOpenPathRequiredChecks({
      changedFiles: [
        'windows/scripts/Recover-CaptivePortal.ps1',
        'firefox-extension/src/lib/native-messaging-client.ts',
        'tests/e2e/ci/run-windows-captive-portal-wedu-lab.ps1',
      ],
    });

    assert.equal(result.highRisk, true);
    assert.deepEqual(result.requiredChecks, [
      'CI Success',
      'E2E Summary',
      'Installer Contracts Success',
      OPENPATH_WEDU_CAPTIVE_PORTAL_REQUIRED_CHECK,
    ]);
    assert.deepEqual(result.matchedFiles, [
      'windows/scripts/Recover-CaptivePortal.ps1',
      'firefox-extension/src/lib/native-messaging-client.ts',
      'tests/e2e/ci/run-windows-captive-portal-wedu-lab.ps1',
    ]);
  });

  it('keeps non-captive Windows and Firefox changes off the WEDU gate', () => {
    const result = resolveOpenPathRequiredChecks({
      changedFiles: ['windows/OpenPath.psm1', 'firefox-extension/src/lib/request-api.ts'],
    });

    assert.equal(result.highRisk, true);
    assert.deepEqual(result.requiredChecks, [
      'CI Success',
      'E2E Summary',
      'Installer Contracts Success',
    ]);
    assert.equal(
      result.requiredChecks.includes(OPENPATH_WEDU_CAPTIVE_PORTAL_REQUIRED_CHECK),
      false
    );
  });

  it('requires the exact WEDU lab check for WEDU captive portal paths', () => {
    const result = resolveOpenPathRequiredChecks({
      changedFiles: [
        'scripts/run-wedu-captive-portal-lab-ci.sh',
        'scripts/wedu-captive-portal-gateway-healthcheck.sh',
        'scripts/run-wedu-captive-portal-gateway-client-smoke.sh',
        'scripts/assert-wedu-captive-portal-result.mjs',
        '.github/workflows/wedu-captive-portal-lab.yml',
      ],
    });

    assert.equal(result.highRisk, true);
    assert.deepEqual(result.requiredChecks, [
      'CI Success',
      OPENPATH_WEDU_CAPTIVE_PORTAL_REQUIRED_CHECK,
    ]);
    assert.ok(result.requiredChecks.includes(OPENPATH_WEDU_CAPTIVE_PORTAL_REQUIRED_CHECK));
    assert.equal(result.requiredChecks.includes('WEDU Gateway Healthcheck'), false);
    assert.equal(result.requiredChecks.includes('WEDU Linux client smoke'), false);
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

  it('requires release evidence for the OpenPath release-scripts workflow', () => {
    const result = resolveOpenPathRequiredChecks({
      changedFiles: ['.github/workflows/release-scripts.yml'] as any,
    });

    assert.deepEqual(result.requiredChecks, [
      'CI Success',
      'E2E Summary',
      'Installer Contracts Success',
      OPENPATH_PRERELEASE_APT_REQUIRED_CHECK,
    ]);
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
      autoDispatch: false,
    });
  });

  it('parses explicit wait settings', () => {
    assert.deepEqual(
      parseWaitOptions({
        OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS: '120',
        OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS: '5',
        OPENPATH_REQUIRED_CHECKS_FAIL_FAST: 'false',
        OPENPATH_REQUIRED_CHECKS_AUTO_DISPATCH: 'true',
      }),
      {
        timeoutSeconds: 120,
        intervalSeconds: 5,
        failFast: false,
        autoDispatch: true,
      }
    );
  });

  it('enforces the minimum wait timeout for WEDU lab evidence', () => {
    assert.deepEqual(
      parseWaitOptions(
        {
          OPENPATH_REQUIRED_CHECKS_TIMEOUT_SECONDS: '900',
          OPENPATH_REQUIRED_CHECKS_INTERVAL_SECONDS: '30',
        },
        [OPENPATH_WEDU_CAPTIVE_PORTAL_REQUIRED_CHECK]
      ),
      {
        timeoutSeconds: 1200,
        intervalSeconds: 30,
        failFast: true,
        autoDispatch: false,
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
