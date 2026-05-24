import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runProjectCommand } from './helpers/ops-contracts.ts';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');

function writeHelper(tempDir: string, name: string, body: string): string {
  const helperPath = join(tempDir, name);
  writeFileSync(helperPath, body, 'utf-8');
  return helperPath;
}

function runPredicate(
  functionName: string,
  helperPath: string
): { stdout: string; status: number } {
  const stdout = runProjectCommand('bash', [
    '-lc',
    [
      'source scripts/lib/remote-helper-contracts.sh',
      `if ${functionName} "${helperPath}"; then echo supported; else echo unsupported:$?; fi`,
    ].join('; '),
  ]).stdout.trim();

  return {
    stdout,
    status: stdout === 'supported' ? 0 : Number(stdout.split(':')[1] ?? '1'),
  };
}

test('versioned helper contracts accept the exact minimum version', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'remote-helper-contracts-min-'));
  const helperPath = writeHelper(
    tempDir,
    'release-manifest.sh',
    'RELEASE_MANIFEST_HELPER_CONTRACT_VERSION=1\n'
  );

  const result = runPredicate('release_manifest_helper_supports_contract', helperPath);

  assert.equal(result.stdout, 'supported');
  assert.equal(result.status, 0);
});

test('versioned helper contracts accept higher versions', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'remote-helper-contracts-high-'));
  const helperPath = writeHelper(
    tempDir,
    'release-runtime.sh',
    'RELEASE_RUNTIME_HELPER_CONTRACT_VERSION=3\n'
  );

  const result = runPredicate('release_runtime_helper_supports_runtime_contract', helperPath);

  assert.equal(result.stdout, 'supported');
  assert.equal(result.status, 0);
});

test('release execution helper contract requires the sibling release risk policy helper', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'remote-helper-contracts-release-execution-'));
  const helperPath = writeHelper(
    tempDir,
    'release-execution.sh',
    'RELEASE_EXECUTION_HELPER_CONTRACT_VERSION=2\n'
  );

  const missingPolicy = runPredicate('release_execution_helper_supports_contract', helperPath);
  assert.equal(missingPolicy.stdout, 'unsupported:2');
  assert.equal(missingPolicy.status, 2);

  writeHelper(tempDir, 'release-risk-policy.sh', 'RELEASE_RISK_POLICY_HELPER_CONTRACT_VERSION=1\n');

  const withPolicy = runPredicate('release_execution_helper_supports_contract', helperPath);
  assert.equal(withPolicy.stdout, 'supported');
  assert.equal(withPolicy.status, 0);
});

test('versioned helper contracts reject lower versions even when legacy snippets still match', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'remote-helper-contracts-low-'));
  const helperPath = writeHelper(
    tempDir,
    'release-state.sh',
    [
      'RELEASE_STATE_HELPER_CONTRACT_VERSION=0',
      'write_deploy_context_state() { :; }',
      'OPENPATH_LINUX_AGENT_VERSION=""',
      '',
    ].join('\n')
  );

  const result = runPredicate('release_state_helper_supports_runtime_contract', helperPath);

  assert.equal(result.stdout, 'unsupported:1');
  assert.equal(result.status, 1);
});

test('legacy unversioned helpers are rejected once rollback shares the version-only helper floor', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'remote-helper-contracts-legacy-'));
  const helperPath = writeHelper(
    tempDir,
    'deployment-state.sh',
    [
      'deployment_state_capture_previous_release() { :; }',
      'deployment_state_activate_previous_release() { :; }',
      '',
    ].join('\n')
  );

  const result = runPredicate('deployment_state_helper_supports_contract', helperPath);

  assert.equal(result.stdout, 'unsupported:2');
  assert.equal(result.status, 2);
});

test('helpers without version constants or matching legacy snippets are rejected', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'remote-helper-contracts-missing-'));
  const helperPath = writeHelper(tempDir, 'release-manifest.sh', 'echo nope\n');

  const result = runPredicate('release_manifest_helper_supports_contract', helperPath);

  assert.equal(result.stdout, 'unsupported:2');
  assert.equal(result.status, 2);
});
