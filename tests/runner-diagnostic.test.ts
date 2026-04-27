import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readProjectJson } from './helpers/ops-contracts.ts';

type PackageDefinition = {
  scripts?: Record<string, string>;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');
const scriptPath = resolve(projectRoot, 'scripts/run-runner-diagnostic.mjs');

function runDiagnostic(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      RUNNER_DIAGNOSTIC_DRY_RUN: '1',
    },
  });
}

describe('runner diagnostic wrapper', () => {
  test('package.json exposes the local diagnostics entrypoint', () => {
    const packageJson = readProjectJson<PackageDefinition>('package.json');

    assert.equal(
      packageJson.scripts?.['diagnostics:runner'],
      'node scripts/run-runner-diagnostic.mjs'
    );
  });

  test('dispatches the Windows bootstrap AJAX diagnostic against staging by default', () => {
    const result = runDiagnostic([
      '--suite',
      'windows-bootstrap-ajax',
      '--wait',
      '--download-artifacts',
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /gh workflow run windows-production-bootstrap-canary\.yml/);
    assert.match(result.stdout, /--repo balejosg\/ClassroomPath/);
    assert.match(result.stdout, /-f target_environment=staging/);
    assert.match(result.stdout, /-f diagnostic_mode=true/);
    assert.match(result.stdout, /gh run watch/);
    assert.match(result.stdout, /gh run download/);
  });

  test('refuses production diagnostics without explicit confirmation', () => {
    const result = runDiagnostic([
      '--suite',
      'windows-bootstrap-ajax',
      '--environment',
      'production',
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--confirm-production/);
  });

  test('maps OpenPath Windows student policy to the targeted E2E workflow inputs', () => {
    const result = runDiagnostic(['--suite', 'openpath-windows-student-policy']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--repo balejosg\/Openpath/);
    assert.match(result.stdout, /gh workflow run e2e-tests\.yml/);
    assert.match(result.stdout, /-f platform=windows/);
    assert.match(result.stdout, /-f suite=student-policy/);
  });
});
