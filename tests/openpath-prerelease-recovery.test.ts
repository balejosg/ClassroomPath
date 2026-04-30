import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { OPENPATH_PRERELEASE_APT_REQUIRED_CHECK } from '../scripts/lib/openpath-ci-checks.mjs';
import { classifyOpenPathPrereleaseRecovery } from '../scripts/lib/openpath-prerelease-recovery.mjs';

const SUPPORTING_CHECKS = ['CI Success', 'E2E Summary', 'Installer Contracts Success'];
const REQUIRED_CHECKS = [...SUPPORTING_CHECKS, OPENPATH_PRERELEASE_APT_REQUIRED_CHECK];

function buildCheckRun(name: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name,
    status: 'completed',
    conclusion: 'success',
    completed_at: '2026-04-30T09:00:00Z',
    details_url: 'https://github.com/balejosg/openpath/actions/runs/1200/job/1',
    html_url: 'https://github.com/balejosg/openpath/runs/1',
    ...overrides,
  };
}

function buildWorkflowRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    databaseId: 1200,
    headSha: 'openpathsha',
    status: 'completed',
    conclusion: 'failure',
    updatedAt: '2026-04-30T09:02:00Z',
    ...overrides,
  };
}

function buildWorkflowJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'publish-prerelease-apt',
    status: 'completed',
    conclusion: 'failure',
    steps: [
      {
        name: 'Set up job',
        status: 'completed',
        conclusion: 'success',
      },
      {
        name: 'Publish to APT Repository (unstable)',
        status: 'completed',
        conclusion: 'failure',
      },
    ],
    ...overrides,
  };
}

describe('classifyOpenPathPrereleaseRecovery', () => {
  it('returns waiting while prerelease APT is still pending', () => {
    const decision = classifyOpenPathPrereleaseRecovery({
      openPathSha: 'openpathsha',
      requiredChecks: REQUIRED_CHECKS,
      checkRuns: [
        ...SUPPORTING_CHECKS.map((check) => buildCheckRun(check)),
        buildCheckRun(OPENPATH_PRERELEASE_APT_REQUIRED_CHECK, {
          status: 'in_progress',
          conclusion: null,
          started_at: '2026-04-30T09:01:00Z',
          completed_at: null,
        }),
      ],
      workflowRuns: [
        buildWorkflowRun({
          databaseId: 1200,
          status: 'in_progress',
          conclusion: null,
        }),
      ],
      workflowJobsByRunId: {
        '1200': [
          buildWorkflowJob({
            status: 'in_progress',
            conclusion: null,
            steps: [
              {
                name: 'Publish to APT Repository (unstable)',
                status: 'in_progress',
                conclusion: null,
              },
            ],
          }),
        ],
      },
      alreadyReran: false,
      allowRerun: false,
    });

    assert.equal(decision.state, 'waiting');
    assert.equal(decision.runId, '1200');
    assert.equal(decision.runUrl, 'https://github.com/balejosg/openpath/actions/runs/1200/job/1');
    assert.equal(decision.failedJob, '');
    assert.equal(decision.failedStep, '');
    assert.equal(decision.rerunCommand, 'gh run rerun 1200 --repo balejosg/openpath --failed');
  });

  it('returns rerun_available when prerelease APT failed after supporting checks turned green', () => {
    const decision = classifyOpenPathPrereleaseRecovery({
      openPathSha: 'openpathsha',
      requiredChecks: REQUIRED_CHECKS,
      checkRuns: [
        ...SUPPORTING_CHECKS.map((check) => buildCheckRun(check)),
        buildCheckRun(OPENPATH_PRERELEASE_APT_REQUIRED_CHECK, {
          conclusion: 'failure',
        }),
      ],
      workflowRuns: [buildWorkflowRun()],
      workflowJobsByRunId: {
        '1200': [buildWorkflowJob()],
      },
      alreadyReran: false,
      allowRerun: false,
    });

    assert.equal(decision.state, 'rerun_available');
    assert.equal(decision.runId, '1200');
    assert.equal(decision.runUrl, 'https://github.com/balejosg/openpath/actions/runs/1200/job/1');
    assert.equal(decision.failedJob, 'publish-prerelease-apt');
    assert.equal(decision.failedStep, 'Publish to APT Repository (unstable)');
    assert.equal(decision.rerunCommand, 'gh run rerun 1200 --repo balejosg/openpath --failed');
  });

  it('returns blocked when a supporting required check is still failed', () => {
    const decision = classifyOpenPathPrereleaseRecovery({
      openPathSha: 'openpathsha',
      requiredChecks: REQUIRED_CHECKS,
      checkRuns: [
        buildCheckRun('CI Success'),
        buildCheckRun('E2E Summary', {
          conclusion: 'failure',
        }),
        buildCheckRun('Installer Contracts Success'),
        buildCheckRun(OPENPATH_PRERELEASE_APT_REQUIRED_CHECK, {
          conclusion: 'failure',
        }),
      ],
      workflowRuns: [buildWorkflowRun()],
      workflowJobsByRunId: {
        '1200': [buildWorkflowJob()],
      },
      alreadyReran: false,
      allowRerun: false,
    });

    assert.equal(decision.state, 'blocked');
    assert.equal(decision.runId, '1200');
    assert.equal(decision.runUrl, 'https://github.com/balejosg/openpath/actions/runs/1200/job/1');
    assert.equal(decision.failedJob, 'publish-prerelease-apt');
    assert.equal(decision.failedStep, 'Publish to APT Repository (unstable)');
    assert.equal(decision.rerunCommand, 'gh run rerun 1200 --repo balejosg/openpath --failed');
  });

  it('returns failed after one rerun was already attempted', () => {
    const decision = classifyOpenPathPrereleaseRecovery({
      openPathSha: 'openpathsha',
      requiredChecks: REQUIRED_CHECKS,
      checkRuns: [
        ...SUPPORTING_CHECKS.map((check) => buildCheckRun(check)),
        buildCheckRun(OPENPATH_PRERELEASE_APT_REQUIRED_CHECK, {
          conclusion: 'failure',
        }),
      ],
      workflowRuns: [buildWorkflowRun()],
      workflowJobsByRunId: {
        '1200': [buildWorkflowJob()],
      },
      alreadyReran: true,
      allowRerun: true,
    });

    assert.equal(decision.state, 'failed');
    assert.equal(decision.runId, '1200');
    assert.equal(decision.runUrl, 'https://github.com/balejosg/openpath/actions/runs/1200/job/1');
    assert.equal(decision.failedJob, 'publish-prerelease-apt');
    assert.equal(decision.failedStep, 'Publish to APT Repository (unstable)');
    assert.equal(decision.rerunCommand, 'gh run rerun 1200 --repo balejosg/openpath --failed');
  });

  it('returns rerun_requested when rerun mode is explicitly enabled', () => {
    const decision = classifyOpenPathPrereleaseRecovery({
      openPathSha: 'openpathsha',
      requiredChecks: REQUIRED_CHECKS,
      checkRuns: [
        ...SUPPORTING_CHECKS.map((check) => buildCheckRun(check)),
        buildCheckRun(OPENPATH_PRERELEASE_APT_REQUIRED_CHECK, {
          conclusion: 'failure',
        }),
      ],
      workflowRuns: [buildWorkflowRun()],
      workflowJobsByRunId: {
        '1200': [buildWorkflowJob()],
      },
      alreadyReran: false,
      allowRerun: true,
    });

    assert.equal(decision.state, 'rerun_requested');
    assert.equal(decision.runId, '1200');
    assert.equal(decision.runUrl, 'https://github.com/balejosg/openpath/actions/runs/1200/job/1');
    assert.equal(decision.failedJob, 'publish-prerelease-apt');
    assert.equal(decision.failedStep, 'Publish to APT Repository (unstable)');
    assert.equal(decision.rerunCommand, 'gh run rerun 1200 --repo balejosg/openpath --failed');
  });
});
