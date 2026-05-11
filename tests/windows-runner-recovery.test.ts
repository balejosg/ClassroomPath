import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  recommendWindowsRunnerRecovery,
  selectBaselineSnapshot,
} from '../scripts/lib/windows-runner-recovery.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');
const scriptPath = resolve(projectRoot, 'scripts/recover-windows-runner.sh');

function runRecovery(args: string[]) {
  return spawnSync(scriptPath, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      WINDOWS_RUNNER_RECOVERY_DRY_RUN: '1',
    },
  });
}

describe('Windows runner recovery helper', () => {
  test('selects the newest clean baseline snapshot from Proxmox output', () => {
    const snapshot = selectBaselineSnapshot(`\
snapshot-clean-baseline-20260509 baseline limpia antes de labs bypass
snapshot-lab-after-bypass destructive lab checkpoint
snapshot-clean-baseline-20260510 pre-lab clean baseline
`);

    assert.equal(snapshot?.name, 'snapshot-clean-baseline-20260510');
    assert.match(snapshot?.description ?? '', /pre-lab clean baseline/);
  });

  test('recommends snapshot rollback when GitHub runner is offline but VM is running', () => {
    const recommendation = recommendWindowsRunnerRecovery({
      runner: { status: 'offline', busy: false },
      vm: { status: 'running', bootOrder: 'order=sata0' },
      snapshots: [{ name: 'snapshot-clean-baseline-20260510', baseline: true }],
      activeJobs: [],
      canaryArtifact: null,
    });

    assert.equal(recommendation.classification, 'snapshot-needed');
    assert.equal(recommendation.snapshot, 'snapshot-clean-baseline-20260510');
    assert.match(recommendation.reason, /GitHub runner is offline/);
  });

  test('recommends reviewing obsolete queue when runner is idle and old Windows work is queued', () => {
    const recommendation = recommendWindowsRunnerRecovery({
      runner: { status: 'online', busy: false },
      vm: { status: 'running', bootOrder: 'order=sata0' },
      snapshots: [],
      activeJobs: [
        {
          runId: '25500000001',
          workflow: 'Windows Production Bootstrap Canary',
          status: 'queued',
          ageMinutes: 95,
        },
      ],
      canaryArtifact: null,
    });

    assert.equal(recommendation.classification, 'online-but-stuck');
    assert.match(recommendation.action, /cancel obsolete queued Windows runs/);
  });

  test('does not treat unrelated queued workflows as Windows runner blockers', () => {
    const recommendation = recommendWindowsRunnerRecovery({
      runner: { status: 'online', busy: false },
      vm: { status: 'running', bootOrder: 'order=sata0' },
      snapshots: [],
      activeJobs: [
        {
          runId: '23509960850',
          workflow: 'Sync OpenPath',
          status: 'queued',
          ageMinutes: 68849,
        },
      ],
      canaryArtifact: null,
    });

    assert.equal(recommendation.classification, 'healthy');
  });

  test('classifies concrete Firefox readiness boundaries as product failures', () => {
    const recommendation = recommendWindowsRunnerRecovery({
      runner: { status: 'online', busy: false },
      vm: { status: 'running', bootOrder: 'order=sata0' },
      snapshots: [{ name: 'snapshot-clean-baseline-20260510', baseline: true }],
      activeJobs: [],
      canaryArtifact: {
        success: false,
        failureBoundary: {
          id: 'firefox-extension-ready',
          message: 'Firefox extension did not become ready after install.',
        },
        artifactEndpoint: { reachable: true },
        dns: { before: ['1.1.1.1'], after: ['1.1.1.1'] },
      },
    });

    assert.equal(recommendation.classification, 'product-failure');
    assert.match(recommendation.reason, /firefox-extension-ready/);
  });

  test('status dry-run prints only inspection commands', () => {
    const result = runRecovery(['status']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /gh api repos\/balejosg\/ClassroomPath\/actions\/runners/);
    assert.match(result.stdout, /gh run list --repo balejosg\/ClassroomPath --status queued/);
    assert.match(result.stdout, /ssh whitelist-proxmox qm status 103/);
    assert.match(result.stdout, /ssh whitelist-proxmox qm listsnapshot 103/);
    assert.match(result.stdout, /ssh whitelist-proxmox qm config 103/);
    assert.doesNotMatch(result.stdout, /\bqm rollback\b/);
    assert.doesNotMatch(result.stdout, /\bgh run cancel\b/);
  });

  test('restore refuses destructive rollback without confirmation', () => {
    const result = runRecovery(['restore', '--snapshot', 'snapshot-clean-baseline-20260510']);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires --confirm/);
  });

  test('restore dry-run renders rollback, boot order, start, and runner wait steps', () => {
    const result = runRecovery([
      'restore',
      '--snapshot',
      'snapshot-clean-baseline-20260510',
      '--confirm',
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /ssh whitelist-proxmox qm rollback 103 snapshot-clean-baseline-20260510/
    );
    assert.match(result.stdout, /ssh whitelist-proxmox qm set 103 --boot order=sata0/);
    assert.match(result.stdout, /ssh whitelist-proxmox qm start 103/);
    assert.match(result.stdout, /wait for classroompath-windows-103 online busy=false/);
  });
});
