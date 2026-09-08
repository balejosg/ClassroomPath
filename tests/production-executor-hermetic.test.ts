import assert from 'node:assert/strict';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { checkReleaseVerifierPackage } from '../scripts/release-verifier-package.mjs';

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

test('package check executes its critical entrypoints and rejects broken packaged code', () => {
  const root = mkdtempSync(join(tmpdir(), 'cp-verifier-package-'));
  try {
    cpSync(join(projectRoot, 'scripts'), join(root, 'scripts'), { recursive: true });
    assert.equal(checkReleaseVerifierPackage(root).ok, true);
    writeFileSync(
      join(root, 'scripts/release-state-cli.mjs'),
      'throw new Error("synthetic-private-detail");\n'
    );
    const broken = checkReleaseVerifierPackage(root);
    assert.equal(broken.ok, false);
    assert.doesNotMatch(JSON.stringify(broken), /synthetic-private-detail/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
    'basename',
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
    'gzip',
    'timeout',
    'touch',
    'tar',
    'sha256sum',
    'stat',
    'uname',
    'mkfifo',
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

test('hermetic host contract exposes recovery packaging dependencies', () => {
  const shellContract = readFileSync(
    resolve(projectRoot, 'scripts/lib/production-host-contract.sh'),
    'utf8'
  );

  assert.equal(PRODUCTION_HOST_REQUIRED_COMMANDS.includes('basename'), true);
  assert.equal(PRODUCTION_HOST_REQUIRED_COMMANDS.includes('gzip'), true);
  assert.equal(PRODUCTION_HOST_REQUIRED_COMMANDS.includes('mkfifo'), true);
  assert.match(shellContract, /\n  basename\n/u);
  assert.match(shellContract, /\n  gzip\n/u);
  assert.match(shellContract, /\n  mkfifo\n/u);
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

test('host command inventories agree with the executable shell contract', () => {
  const commands = execFileSync(
    'bash',
    [
      '-c',
      'source scripts/lib/production-host-contract.sh; printf "%s\\n" "${PRODUCTION_HOST_REQUIRED_COMMANDS[@]}"',
    ],
    { cwd: projectRoot, encoding: 'utf8' }
  )
    .trim()
    .split('\n');
  assert.deepEqual(PRODUCTION_HOST_REQUIRED_COMMANDS, commands);
});

for (const diskUsagePercent of [undefined, null, '', 'unknown', -1, 101, 1.5]) {
  test(`host model rejects invalid disk observation ${String(diskUsagePercent)}`, () => {
    const report = validateProductionHostContract({
      commands: Object.fromEntries(PRODUCTION_HOST_REQUIRED_COMMANDS.map((name) => [name, true])),
      docker: { daemonReachable: true, composeAvailable: true },
      deployRoot: { exists: true, writable: true },
      diskUsagePercent,
      networkReachable: true,
    });
    assert.equal(report.mutationAllowed, false);
    assert.ok(report.errors.includes('disk-threshold-exceeded'));
  });
}

for (const scenario of [
  'regular-file',
  'symlink',
  'write-failure',
  'rename-failure',
  'stat-incompatible',
  'invalid-threshold',
  'empty-threshold',
  'valid',
  'missing',
]) {
  test(`shell host preflight checks durable state access: ${scenario}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'cp-host-state-'));
    const stateRoot = join(root, 'release-state');
    if (scenario === 'regular-file') writeFileSync(stateRoot, 'preserve');
    else if (scenario === 'symlink') symlinkSync(root, stateRoot);
    else if (scenario !== 'missing') mkdirSync(stateRoot);
    try {
      const output = execFileSync(
        'bash',
        [
          '-c',
          `
        source scripts/lib/production-host-contract.sh
        CLASSROOMPATH_DEPLOY_ROOT="$1"
        scenario="$2"
        production_host_contract_command_available() { return 0; }
        docker() { return 0; }
        production_host_contract_network_reachable() { return 0; }
        production_host_contract_disk_usage_percent() { printf 20; }
        mktemp() {
          if [ "$scenario" = write-failure ] && [[ "$1" == "$CLASSROOMPATH_DEPLOY_ROOT/release-state/"* ]]; then return 1; fi
          command mktemp "$@"
        }
        stat() {
          [ "$scenario" != stat-incompatible ] || return 1
          command stat "$@"
        }
        mv() {
          if [ "$scenario" = rename-failure ] && [[ "$*" == *"$CLASSROOMPATH_DEPLOY_ROOT/release-state/"* ]]; then return 1; fi
          command mv "$@"
        }
        threshold=80
        [ "$scenario" != invalid-threshold ] || threshold=unknown
        [ "$scenario" != empty-threshold ] || threshold=""
        if production_host_contract_validate "$1" "$threshold" "$1/report.json"; then echo ACCEPTED; else echo REJECTED; fi
      `,
          'host-fixture',
          root,
          scenario,
        ],
        { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      const expected = ['valid', 'missing'].includes(scenario);
      assert.equal(output.includes('ACCEPTED'), expected, output);
      const report = JSON.parse(readFileSync(join(root, 'report.json'), 'utf8'));
      assert.equal(report.mutationAllowed, expected);
      if (!expected)
        assert.ok(
          report.errors.includes(
            ['invalid-threshold', 'empty-threshold'].includes(scenario)
              ? 'disk-threshold-exceeded'
              : 'release-state-root-not-usable'
          )
        );
      if (scenario === 'regular-file') assert.equal(readFileSync(stateRoot, 'utf8'), 'preserve');
      assert.ok(!readdirSync(root).some((name) => name.startsWith('.host-contract.')));
      if (!['regular-file', 'symlink', 'missing'].includes(scenario))
        assert.deepEqual(readdirSync(stateRoot), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('shell and local model agree on disk admission at valid and malformed boundaries', () => {
  const cases = [
    ['0', '0'],
    ['80', '80'],
    ['81', '80'],
    ['080', '080'],
    ['100', '100'],
    ['', '80'],
    ['unknown', '80'],
    ['-1', '80'],
    ['1.5', '80'],
    ['101', '100'],
    ['20', 'unknown'],
    ['20', '-1'],
    ['20', '101'],
  ];
  for (const [usage, threshold] of cases) {
    const shell = execFileSync(
      'bash',
      [
        '-c',
        `
      source scripts/lib/production-host-contract.sh
      if production_host_contract_disk_percentage_valid "$1" &&
        production_host_contract_disk_percentage_valid "$2" &&
        [ "$((10#$1))" -le "$((10#$2))" ]; then printf allowed; else printf blocked; fi
    `,
        'disk',
        usage,
        threshold,
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    );
    const report = validateProductionHostContract({
      commands: Object.fromEntries(PRODUCTION_HOST_REQUIRED_COMMANDS.map((name) => [name, true])),
      docker: { daemonReachable: true, composeAvailable: true },
      deployRoot: { exists: true, writable: true },
      diskUsagePercent: usage,
      diskThresholdPercent: threshold,
      networkReachable: true,
    });
    assert.equal(report.mutationAllowed, shell === 'allowed', `${usage}/${threshold}`);
  }
});

test('host preflight rejects a failed report publication in a conditional caller', () => {
  const root = mkdtempSync(join(tmpdir(), 'cp-host-report-'));
  const report = join(root, 'report.json');
  writeFileSync(report, 'previous-report');
  try {
    const output = execFileSync(
      'bash',
      [
        '-c',
        `
      source scripts/lib/production-host-contract.sh
      CLASSROOMPATH_DEPLOY_ROOT="$1"
      production_host_contract_command_available() { return 0; }
      production_host_contract_disk_usage_percent() { printf 20; }
      production_host_contract_network_reachable() { return 0; }
      docker() { return 0; }
      install() { return 1; }
      if production_host_contract_validate "$1" 80 "$1/report.json"; then printf accepted; else printf rejected; fi
    `,
        'report',
        root,
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    );
    assert.equal(output.trim(), 'rejected');
    assert.equal(readFileSync(report, 'utf8'), 'previous-report');
    assert.deepEqual(readdirSync(root), ['report.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('host report describes the explicit validated root instead of unrelated environment', () => {
  const root = mkdtempSync(join(tmpdir(), 'cp-host-report-root-'));
  try {
    execFileSync(
      'bash',
      [
        '-c',
        `
      source scripts/lib/production-host-contract.sh
      CLASSROOMPATH_DEPLOY_ROOT=/unrelated
      production_host_contract_command_available() { return 0; }
      production_host_contract_disk_usage_percent() { [ "$1" != /unrelated ] && printf 20 || printf 99; }
      production_host_contract_network_reachable() { return 0; }
      docker() { return 0; }
      production_host_contract_validate "$1" 80 "$1/report.json"
    `,
        'report-root',
        root,
      ],
      { cwd: projectRoot }
    );
    const report = JSON.parse(readFileSync(join(root, 'report.json'), 'utf8'));
    assert.equal(report.deployRoot, root);
    assert.equal(report.diskUsagePercent, '20');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
