import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');
const helperPath = resolve(projectRoot, 'scripts/lib/staging-gates.sh');
const runnerPath = resolve(projectRoot, 'scripts/run-staging-verification.sh');
const windowsBootstrapGatePath = resolve(projectRoot, 'tests/windows-bootstrap-gate.test.ts');

function runHelper(expression: string): string {
  const result = spawnSync('bash', ['-lc', `source scripts/lib/staging-gates.sh; ${expression}`], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw (
      result.error ?? new Error(result.stderr || `bash exited with code ${String(result.status)}`)
    );
  }

  if (result.error && result.error.code !== 'EPERM') {
    throw result.error;
  }

  return result.stdout.trim();
}

describe('staging gates helper', () => {
  test('publishes canonical npm scripts and results files for each gate', () => {
    assert.equal(runHelper('staging_gate_npm_script smoke'), 'test:smoke');
    assert.equal(runHelper('staging_gate_npm_script release-gate'), 'test:release-gate');
    assert.equal(
      runHelper('staging_gate_npm_script windows-bootstrap-gate'),
      'test:windows-bootstrap-gate'
    );

    assert.equal(runHelper('staging_gate_results_file smoke'), '/tmp/smoke-results.txt');
    assert.equal(
      runHelper('staging_gate_results_file release-gate'),
      '/tmp/release-gate-results.txt'
    );
    assert.equal(
      runHelper('staging_gate_results_file windows-bootstrap-gate'),
      '/tmp/windows-bootstrap-gate-results.txt'
    );
  });

  test('publishes the gate-owned state fields for evidence persistence', () => {
    assert.deepEqual(runHelper('staging_gate_state_fields smoke').split('\n'), [
      'STAGING_SMOKE_RESULT',
      'STAGING_SMOKE_STATUS',
    ]);
    assert.deepEqual(runHelper('staging_gate_state_fields release-gate').split('\n'), [
      'STAGING_RELEASE_GATE_RESULT',
      'STAGING_VERIFIED_AT',
      'STAGING_FIREFOX_RELEASE_ARTIFACTS',
      'STAGING_FIREFOX_EXTENSION_ID',
      'STAGING_FIREFOX_RELEASE_VERSION',
      'STAGING_FIREFOX_METADATA_SHA256',
      'STAGING_FIREFOX_XPI_SHA256',
    ]);
    assert.deepEqual(runHelper('staging_gate_state_fields windows-bootstrap-gate').split('\n'), [
      'STAGING_WINDOWS_BOOTSTRAP_RESULT',
      'STAGING_FIREFOX_POLICY_RESULT',
    ]);
  });

  test('shared runner sources the helper and delegates gate orchestration to it', () => {
    const content = readFileSync(runnerPath, 'utf8');

    assert.ok(existsSync(helperPath), 'scripts/lib/staging-gates.sh should exist');
    assert.ok(
      content.includes('source "$SCRIPT_DIR/lib/staging-gates.sh"'),
      'run-staging-verification.sh should source the shared staging gate helper'
    );
    assert.ok(
      content.includes('run_staging_smoke_gate') &&
        content.includes('run_staging_release_gate') &&
        content.includes('run_staging_windows_bootstrap_gate'),
      'run-staging-verification.sh should delegate smoke, release-gate, and windows bootstrap execution to the helper'
    );
    assert.ok(
      !content.includes('run_smoke_checks()') && !content.includes('run_release_gate_checks()'),
      'run-staging-verification.sh should no longer own the full gate bodies inline'
    );
  });

  test('windows bootstrap gate emits per-stage timing evidence', () => {
    const content = readFileSync(windowsBootstrapGatePath, 'utf8');

    assert.match(
      content,
      /type BootstrapGateTiming/,
      'windows bootstrap gate should keep structured timing entries'
    );
    assert.match(
      content,
      /async function timedBootstrapGateStep/,
      'windows bootstrap gate should centralize per-stage timing'
    );
    assert.match(
      content,
      /Windows bootstrap gate timing/,
      'windows bootstrap gate should emit searchable timing output'
    );

    for (const stage of [
      'register teacher',
      'verify email',
      'login teacher',
      'create checkout',
      'stripe webhook',
      'create classroom',
      'create enrollment ticket',
      'read bootstrap manifest',
      'download runtime policy spec',
      'download private Firefox metadata',
      'download private Firefox XPI',
      'download public Firefox XPI',
    ]) {
      assert.match(
        content,
        new RegExp(`timedBootstrapGateStep\\(\\s*'${stage}'`),
        `missing timed stage: ${stage}`
      );
    }
  });
});
