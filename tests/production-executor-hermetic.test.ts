import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  PRODUCTION_HOST_REQUIRED_COMMANDS,
  PRODUCTION_HOST_FORBIDDEN_RUNTIME_COMMANDS,
  validateProductionHostContract,
} from '../scripts/lib/production-host-contract.mjs';
import {
  RELEASE_VERIFIER_COMMANDS,
  RELEASE_VERIFIER_REQUIRED_FILES,
  validateReleaseVerifierPackageFiles,
} from '../scripts/lib/release-verifier-contract.mjs';

const projectRoot = resolve(import.meta.dirname, '..');

test('production host contract is POSIX/Docker based and does not require Node', () => {
  assert.deepEqual(PRODUCTION_HOST_REQUIRED_COMMANDS, [
    'bash',
    'git',
    'docker',
    'curl',
    'awk',
    'sed',
    'grep',
    'install',
    'mktemp',
    'mv',
    'cp',
    'chmod',
    'df',
    'id',
    'tr',
    'base64',
    'cat',
    'cmp',
    'date',
    'dirname',
    'env',
    'head',
    'ln',
    'mkdir',
    'rm',
    'sh',
    'sleep',
    'tail',
    'timeout',
    'touch',
    'tar',
    'uname',
  ]);
  assert.deepEqual(PRODUCTION_HOST_FORBIDDEN_RUNTIME_COMMANDS, ['node', 'npm']);

  const report = validateProductionHostContract({
    commands: Object.fromEntries(PRODUCTION_HOST_REQUIRED_COMMANDS.map((name) => [name, true])),
    runtimeCommands: { node: false, npm: false },
    docker: { daemonReachable: true, composeAvailable: true },
    deployRoot: { exists: true, writable: true },
    diskUsagePercent: 61,
    diskThresholdPercent: 80,
    networkReachable: true,
  });

  assert.equal(report.ok, true);
  assert.equal(report.nodeRequired, false);
  assert.deepEqual(report.errors, []);
});

test('host contract fails before mutation when Docker or state prerequisites are missing', () => {
  const report = validateProductionHostContract({
    commands: Object.fromEntries(PRODUCTION_HOST_REQUIRED_COMMANDS.map((name) => [name, true])),
    runtimeCommands: { node: false, npm: false },
    docker: { daemonReachable: false, composeAvailable: false },
    deployRoot: { exists: true, writable: false },
    diskUsagePercent: 95,
    diskThresholdPercent: 80,
    networkReachable: false,
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.errors, [
    'docker-daemon-unreachable',
    'docker-compose-unavailable',
    'deploy-root-not-writable',
    'disk-threshold-exceeded',
    'required-network-unreachable',
  ]);
  assert.equal(report.mutationAllowed, false);
});

test('remote host preflight is shell-only and documents Node/npm as non-requirements', () => {
  const helper = readFileSync(
    resolve(projectRoot, 'scripts/lib/production-host-contract.sh'),
    'utf8'
  );

  assert.match(helper, /production_host_contract_validate\(\)/u);
  assert.match(helper, /docker info/u);
  assert.match(helper, /docker compose version/u);
  assert.match(helper, /node.*not required|node_required.*false/iu);
  assert.match(helper, /npm.*not required|npm_required.*false/iu);
  assert.doesNotMatch(helper, /require_cmd node|resolve_node_bin/u);
});

test('host network preflight accepts an unauthenticated registry HTTP response', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'classroompath-host-contract-'));
  const fakeCurl = join(tempDir, 'curl');
  const helperPath = resolve(projectRoot, 'scripts/lib/production-host-contract.sh');

  writeFileSync(fakeCurl, '#!/usr/bin/env bash\nprintf "%s" "${FAKE_HTTP_STATUS:-401}"\n');
  chmodSync(fakeCurl, 0o755);

  try {
    const env = { ...process.env, PATH: `${tempDir}:${process.env.PATH ?? ''}` };
    execFileSync(
      'bash',
      ['-c', 'source "$1"; production_host_contract_network_reachable', 'bash', helperPath],
      { env, stdio: 'pipe' }
    );

    let rejected = false;
    try {
      execFileSync(
        'bash',
        ['-c', 'source "$1"; production_host_contract_network_reachable', 'bash', helperPath],
        { env: { ...env, FAKE_HTTP_STATUS: '000' }, stdio: 'pipe' }
      );
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test('verifier package contract names every remote-critical CLI and rejects omissions', () => {
  const packageChecker = readFileSync(
    resolve(projectRoot, 'scripts/release-verifier-package.mjs'),
    'utf8'
  );
  const dockerIgnore = readFileSync(
    resolve(projectRoot, 'docker/Dockerfile.release-verifier.dockerignore'),
    'utf8'
  );

  assert.deepEqual(
    RELEASE_VERIFIER_COMMANDS.map((command) => command.name),
    [
      'verify-bundle',
      'project-runtime',
      'read-release-state',
      'write-release-state',
      'validate-release-state',
      'rollback-preflight',
    ]
  );
  assert.ok(packageChecker.includes('checkReleaseVerifierPackage'));
  for (const file of RELEASE_VERIFIER_REQUIRED_FILES) {
    assert.ok(
      dockerIgnore.includes(`!${file.replace('/app/', '')}`),
      `verifier Docker context must retain ${file}`
    );
  }
  const complete = validateReleaseVerifierPackageFiles([...RELEASE_VERIFIER_REQUIRED_FILES]);
  const missing = validateReleaseVerifierPackageFiles(RELEASE_VERIFIER_REQUIRED_FILES.slice(1));
  assert.equal(complete.ok, true);
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, [RELEASE_VERIFIER_REQUIRED_FILES[0]]);
});
