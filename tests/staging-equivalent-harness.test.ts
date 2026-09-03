import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');
const harnessPath = resolve(projectRoot, 'scripts/staging-equivalent-harness.sh');

const candidateSha = 'c'.repeat(40);
const recoverySha = 'a'.repeat(40);
const previousSha = 'b'.repeat(40);
const transactionId = 'e'.repeat(64);
const staleTransactionId = 'f'.repeat(64);
const releaseId = '1'.repeat(64);
const bundleSha = '2'.repeat(64);
const contractSha = '3'.repeat(64);
const runtimeSha = '4'.repeat(64);
const gatewayImage = `ghcr.io/example/classroompath-gateway@sha256:${'5'.repeat(64)}`;
const apiImage = `ghcr.io/example/openpath-api@sha256:${'6'.repeat(64)}`;
const spaImage = `ghcr.io/example/classroompath-spa@sha256:${'7'.repeat(64)}`;
const network = 'classroompath-production_openpath_default';
const apiDataVolume = 'classroompath-production_api-data';
const templatesVolume = 'classroompath-production_windows_offline_installer_templates';
const artifactsVolume = 'classroompath-production_windows_offline_installer_artifacts';

function runHarness(args: string[], env: NodeJS.ProcessEnv = {}) {
  return execFileSync(harnessPath, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: 'pipe',
  });
}

function runShell(args: string[], env: NodeJS.ProcessEnv = {}) {
  return execFileSync('bash', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: 'pipe',
  });
}

function expectFailure(action: () => unknown, message: string) {
  assert.throws(action, message);
}

function sha256File(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fixtureDatabaseUrl(
  user = 'fixture-user',
  password = 'fixture-password',
  host = 'fixture-db',
  database = 'classroompath'
) {
  return ['postgresql', `://${user}:${password}@${host}:5432/${database}`].join('');
}

function writeConfig(
  root: string,
  overrides: Record<string, string> = {},
  options: { includeAttestation?: boolean; includeRecovery?: boolean } = {}
) {
  const configDir = join(root, 'config');
  const deployRoot = join(root, 'deploy-root');
  const identityPath = join(root, 'staging-equivalent.identity');
  const hostIdPath = '/etc/machine-id';
  mkdirSync(configDir, { recursive: true });
  mkdirSync(deployRoot, { recursive: true });

  const hostIdSha = sha256File(hostIdPath);
  const deployRootSha = createHash('sha256').update(resolve(deployRoot)).digest('hex');
  const baseUrl = 'https://staging-equivalent.example.invalid';
  const baseUrlSha = createHash('sha256').update(baseUrl).digest('hex');
  const databaseUrl = fixtureDatabaseUrl();
  const databaseEndpointSha = createHash('sha256').update(databaseUrl).digest('hex');
  const identity = [
    'STAGING_EQUIVALENT_VERSION=1',
    'STAGING_EQUIVALENT_ID=fixture-k-host',
    'STAGING_EQUIVALENT_PRODUCTION_TARGET=false',
    `STAGING_EQUIVALENT_HOST_ID_SHA256=${hostIdSha}`,
    `STAGING_EQUIVALENT_DEPLOY_ROOT_SHA256=${deployRootSha}`,
    'STAGING_EQUIVALENT_COMPOSE_PROJECT=classroompath-production',
    'STAGING_EQUIVALENT_NORMAL_STAGING_ALLOWED=false',
    'STAGING_EQUIVALENT_RECOVERY_AUTHORITY_SCOPE=local-staging-equivalent',
    'STAGING_EQUIVALENT_DATABASE_IDENTITY=fixture-db',
    `STAGING_EQUIVALENT_DATABASE_ENDPOINT_SHA256=${databaseEndpointSha}`,
    'STAGING_EQUIVALENT_DATABASE_SCOPE=staging-equivalent',
    'STAGING_EQUIVALENT_CREDENTIALS_SCOPE=staging-equivalent',
    'STAGING_EQUIVALENT_DOCKER_DAEMON_ID=fixture-daemon',
    `STAGING_EQUIVALENT_GATEWAY_DOWNLOAD_DEVICE_SHA256=${'8'.repeat(64)}`,
    `STAGING_EQUIVALENT_BASE_URL_SHA256=${baseUrlSha}`,
    '',
  ].join('\n');
  writeFileSync(identityPath, identity);
  chmodSync(identityPath, 0o600);

  const values: Record<string, string> = {
    K_ENVIRONMENT: 'staging-equivalent',
    K_ENVIRONMENT_ID: 'fixture-k-host',
    K_IDENTITY_FILE: identityPath,
    K_IDENTITY_FILE_SHA256: sha256File(identityPath),
    K_HOST_ID_FILE: hostIdPath,
    K_HOST_ID_SHA256: hostIdSha,
    K_DEPLOY_ROOT: deployRoot,
    K_DEPLOY_ROOT_SHA256: deployRootSha,
    K_COMPOSE_PROJECT: 'classroompath-production',
    K_PRODUCTION_TARGET: 'false',
    K_NORMAL_STAGING_ALLOWED: 'false',
    K_RECOVERY_AUTHORITY_SCOPE: 'local-staging-equivalent',
    K_DATABASE_IDENTITY: 'fixture-db',
    K_DATABASE_ENDPOINT_SHA256: databaseEndpointSha,
    K_DATABASE_SCOPE: 'staging-equivalent',
    K_CREDENTIALS_SCOPE: 'staging-equivalent',
    K_DOCKER_DAEMON_ID: 'fixture-daemon',
    K_GATEWAY_DOWNLOAD_HOST_ROOT: '/srv/classroompath/downloads',
    K_GATEWAY_DOWNLOAD_DEVICE_SHA256: '8'.repeat(64),
    K_CONTAINER_PLATFORM: 'linux/amd64',
    K_HOST_ID_KIND: 'system-machine-id',
    K_BASE_URL: baseUrl,
    K_BASE_URL_SHA256: baseUrlSha,
    K_NETWORK_PREFLIGHT_URL: 'https://registry.example.invalid/v2/',
    K_RUNTIME_ENVIRONMENT: 'staging-equivalent',
  };

  if (options.includeAttestation) {
    Object.assign(values, {
      K_EXPECTED_RELEASE_ID: releaseId,
      K_EXPECTED_APP_SHA: previousSha,
      K_EXPECTED_OPENPATH_SHA: 'd'.repeat(40),
      K_EXPECTED_GATEWAY_IMAGE: gatewayImage,
      K_EXPECTED_API_IMAGE: apiImage,
      K_EXPECTED_SPA_IMAGE: spaImage,
      K_EXPECTED_NETWORKS: network,
      K_EXPECTED_GATEWAY_NAME: 'classroompath-gateway',
      K_EXPECTED_API_NAME: 'classroompath-api',
      K_EXPECTED_SPA_NAME: 'classroompath-spa',
      K_EXPECTED_PROVISION_NAME: 'classroompath-openpath-windows-offline-installer-provision',
      K_EXPECTED_API_DATA_VOLUME: apiDataVolume,
      K_EXPECTED_TEMPLATES_VOLUME: templatesVolume,
      K_EXPECTED_ARTIFACTS_VOLUME: artifactsVolume,
      K_EXPECTED_API_MOUNT: `${apiDataVolume}|/app/data|rw`,
      K_EXPECTED_PROVISION_TEMPLATES_MOUNT: `${templatesVolume}|/app/var/windows-offline-installer/templates|rw`,
      K_EXPECTED_API_TEMPLATES_MOUNT: `${templatesVolume}|/app/var/windows-offline-installer/templates|ro`,
      K_EXPECTED_API_ARTIFACTS_MOUNT: `${artifactsVolume}|/app/var/windows-offline-installer/artifacts|rw`,
      K_EXPECTED_GATEWAY_DOWNLOAD_MOUNT:
        '/srv/classroompath/downloads|/app/react-spa/dist/downloads|ro',
      K_EXPECTED_API_FIREFOX_MOUNT:
        '/srv/classroompath/openpath-firefox-release/current|/openpath-firefox-release|ro',
      K_EXPECTED_SPA_MOUNT: '/fixture/app/docker/spa-nginx.conf|/etc/nginx/conf.d/default.conf|ro',
      K_EXPECTED_RUNTIME_SHA256: runtimeSha,
      K_EXPECTED_BUNDLE_SHA256: bundleSha,
      K_EXPECTED_CONTRACT_SHA256: contractSha,
      K_EXPECTED_RC_RUN_ID: '123456789',
      K_EXPECTED_RUNTIME_PROJECTION_SHA256: '9'.repeat(64),
      K_EXPECTED_SERVICE_STATUS_GATEWAY: 'running',
      K_EXPECTED_SERVICE_STATUS_API: 'running',
      K_EXPECTED_SERVICE_STATUS_SPA: 'running',
      K_EXPECTED_SERVICE_STATUS_PROVISION: 'exited',
    });
  }

  if (options.includeRecovery) {
    Object.assign(values, {
      K_CANDIDATE_SHA: candidateSha,
      K_RECOVERY_SHA: recoverySha,
      K_RECOVERY_SOURCE_SHA: recoverySha,
      K_RECOVERY_CONTRACT_VERSION: '1',
      K_RECOVERY_SOURCE_VERSION: '1',
    });
  }

  Object.assign(values, overrides);
  const configPath = join(configDir, 'harness.env');
  writeFileSync(
    configPath,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`
  );
  chmodSync(configPath, 0o600);
  return { configPath, deployRoot, identityPath, hostIdPath, values };
}

function writeSnapshot(root: string, overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    STATE_CURRENT_RELEASE_ID: releaseId,
    STATE_PREVIOUS_RELEASE_ID: '0'.repeat(64),
    DURABLE_BUNDLE_SHA256: bundleSha,
    DURABLE_CONTRACT_SHA256: contractSha,
    DURABLE_RUNTIME_SHA256: runtimeSha,
    DURABLE_RC_RUN_ID: '123456789',
    LIVE_CHECKOUT_SHA: previousSha,
    LIVE_OPENPATH_GITLINK_SHA: 'd'.repeat(40),
    LIVE_PROJECT: 'classroompath-production',
    LIVE_GATEWAY_ID: 'gateway-p',
    LIVE_GATEWAY_NAME: 'classroompath-gateway',
    LIVE_GATEWAY_PROJECT: 'classroompath-production',
    LIVE_GATEWAY_SERVICE: 'gateway',
    LIVE_GATEWAY_IMAGE: gatewayImage,
    LIVE_GATEWAY_IMAGE_DIGEST: gatewayImage,
    LIVE_GATEWAY_STATUS: 'running',
    LIVE_GATEWAY_NETWORKS: network,
    LIVE_GATEWAY_MOUNTS: '/srv/classroompath/downloads|/app/react-spa/dist/downloads|ro',
    LIVE_API_ID: 'api-p',
    LIVE_API_NAME: 'classroompath-api',
    LIVE_API_PROJECT: 'classroompath-production',
    LIVE_API_SERVICE: 'api',
    LIVE_API_IMAGE: apiImage,
    LIVE_API_IMAGE_DIGEST: apiImage,
    LIVE_API_STATUS: 'running',
    LIVE_API_NETWORKS: network,
    LIVE_API_MOUNTS: [
      `${apiDataVolume}|/app/data|rw`,
      `${templatesVolume}|/app/var/windows-offline-installer/templates|ro`,
      `${artifactsVolume}|/app/var/windows-offline-installer/artifacts|rw`,
      '/srv/classroompath/openpath-firefox-release/current|/openpath-firefox-release|ro',
    ].join(','),
    LIVE_SPA_ID: 'spa-p',
    LIVE_SPA_NAME: 'classroompath-spa',
    LIVE_SPA_PROJECT: 'classroompath-production',
    LIVE_SPA_SERVICE: 'spa',
    LIVE_SPA_IMAGE: spaImage,
    LIVE_SPA_IMAGE_DIGEST: spaImage,
    LIVE_SPA_STATUS: 'running',
    LIVE_SPA_NETWORKS: network,
    LIVE_SPA_MOUNTS: '/fixture/app/docker/spa-nginx.conf|/etc/nginx/conf.d/default.conf|ro',
    LIVE_PROVISION_ID: 'provision-p',
    LIVE_PROVISION_NAME: 'classroompath-openpath-windows-offline-installer-provision',
    LIVE_PROVISION_PROJECT: 'classroompath-production',
    LIVE_PROVISION_SERVICE: 'windows-offline-installer-provision',
    LIVE_PROVISION_IMAGE: apiImage,
    LIVE_PROVISION_IMAGE_DIGEST: apiImage,
    LIVE_PROVISION_STATUS: 'exited',
    LIVE_PROVISION_NETWORKS: network,
    LIVE_PROVISION_MOUNTS: `${templatesVolume}|/app/var/windows-offline-installer/templates|rw`,
    LIVE_VOLUME_API_DATA_ID: apiDataVolume,
    LIVE_VOLUME_API_DATA_NAME: apiDataVolume,
    LIVE_VOLUME_API_DATA_MOUNTPOINT: '/var/lib/docker/volumes/' + apiDataVolume + '/_data',
    LIVE_VOLUME_API_DATA_PROJECT: 'classroompath-production',
    LIVE_VOLUME_API_DATA_COMPOSE_KEY: 'api-data',
    LIVE_VOLUME_TEMPLATES_ID: templatesVolume,
    LIVE_VOLUME_TEMPLATES_NAME: templatesVolume,
    LIVE_VOLUME_TEMPLATES_MOUNTPOINT: '/var/lib/docker/volumes/' + templatesVolume + '/_data',
    LIVE_VOLUME_TEMPLATES_PROJECT: 'classroompath-production',
    LIVE_VOLUME_TEMPLATES_COMPOSE_KEY: 'windows_offline_installer_templates',
    LIVE_VOLUME_ARTIFACTS_ID: artifactsVolume,
    LIVE_VOLUME_ARTIFACTS_NAME: artifactsVolume,
    LIVE_VOLUME_ARTIFACTS_MOUNTPOINT: '/var/lib/docker/volumes/' + artifactsVolume + '/_data',
    LIVE_VOLUME_ARTIFACTS_PROJECT: 'classroompath-production',
    LIVE_VOLUME_ARTIFACTS_COMPOSE_KEY: 'windows_offline_installer_artifacts',
    LIVE_RUNTIME_PROJECTION_SHA256: '9'.repeat(64),
    LIVE_API_DATA_MOUNT: apiDataVolume + '|/app/data|rw',
    LIVE_PROVISION_TEMPLATES_MOUNT:
      templatesVolume + '|/app/var/windows-offline-installer/templates|rw',
    LIVE_API_TEMPLATES_MOUNT: templatesVolume + '|/app/var/windows-offline-installer/templates|ro',
    LIVE_API_ARTIFACTS_MOUNT: artifactsVolume + '|/app/var/windows-offline-installer/artifacts|rw',
    LIVE_API_FIREFOX_MOUNT:
      '/srv/classroompath/openpath-firefox-release/current|/openpath-firefox-release|ro',
    HEALTH_HTTP_STATUS: '200',
    READY_HTTP_STATUS: '200',
    READY_JSON_VALID: 'true',
    READY: 'true',
    WORKTREE_CLEAN: 'true',
    ...overrides,
  };
  const snapshotPath = join(root, 'k0.snapshot');
  writeFileSync(
    snapshotPath,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`
  );
  return snapshotPath;
}

test('environment fence rejects non-equivalent topology and production identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-k-fence-'));
  try {
    const fixture = writeConfig(root);
    assert.match(
      runHarness(['validate-environment', '--config', fixture.configPath]),
      /staging-equivalent/u
    );

    const stagingNamespace = writeConfig(root, { K_COMPOSE_PROJECT: 'classroompath-staging' });
    expectFailure(
      () => runHarness(['validate-environment', '--config', stagingNamespace.configPath]),
      'staging namespace must be rejected'
    );

    const productionTarget = writeConfig(root, { K_PRODUCTION_TARGET: 'true' });
    expectFailure(
      () => runHarness(['validate-environment', '--config', productionTarget.configPath]),
      'production target must be rejected'
    );

    const wrongHost = writeConfig(root, { K_HOST_ID_SHA256: 'f'.repeat(64) });
    expectFailure(
      () => runHarness(['validate-environment', '--config', wrongHost.configPath]),
      'copied identity must be rejected on another host'
    );

    const internalOverride = writeConfig(root, {
      K_CONFIRM_STAGING_EQUIVALENT: '1',
      K_HARNESS_COMPOSE_PROJECT: 'production',
    });
    expectFailure(
      () => runHarness(['validate-environment', '--config', internalOverride.configPath]),
      'config must not override harness internals or CLI confirmation'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('environment admission rejects a non-private marker or harness config', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-k-private-admission-'));
  try {
    const fixture = writeConfig(root);

    chmodSync(fixture.configPath, 0o644);
    expectFailure(
      () => runHarness(['validate-environment', '--config', fixture.configPath]),
      'the harness config must require mode 0600'
    );

    chmodSync(fixture.configPath, 0o600);
    chmodSync(fixture.identityPath, 0o644);
    expectFailure(
      () => runHarness(['validate-environment', '--config', fixture.configPath]),
      'the durable marker must require mode 0600'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K0 rejects code, digest, volume, mount, and readiness drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-k0-'));
  try {
    const fixture = writeConfig(root, {}, { includeAttestation: true });
    const goodSnapshot = writeSnapshot(root);
    assert.match(
      runHarness([
        'validate-attestation',
        '--config',
        fixture.configPath,
        '--snapshot',
        goodSnapshot,
      ]),
      /attestation passed/u
    );

    for (const [field, value, label] of [
      [
        'LIVE_GATEWAY_IMAGE_DIGEST',
        `${gatewayImage.slice(0, -64)}${'8'.repeat(64)}`,
        'live digest',
      ],
      ['LIVE_CHECKOUT_SHA', 'd'.repeat(40), 'checkout'],
      ['LIVE_OPENPATH_GITLINK_SHA', 'e'.repeat(40), 'gitlink'],
      ['LIVE_VOLUME_API_DATA_ID', 'classroompath-production_other-api-data', 'volume identity'],
      ['LIVE_API_DATA_MOUNT', 'wrong-volume|/app/data|rw', 'mount identity'],
      ['READY', 'false', 'semantic readiness'],
      ['READY_JSON_VALID', 'false', 'malformed readiness'],
    ] as const) {
      const snapshot = writeSnapshot(root, { [field]: value });
      expectFailure(
        () =>
          runHarness([
            'validate-attestation',
            '--config',
            fixture.configPath,
            '--snapshot',
            snapshot,
          ]),
        `${label} drift must fail K0`
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K0 rejects a rollback that changes the baseline persistent volume topology', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-k0-baseline-'));
  try {
    const fixture = writeConfig(root, {}, { includeAttestation: true });
    mkdirSync(join(root, 'baseline'), { recursive: true });
    mkdirSync(join(root, 'post-rollback'), { recursive: true });
    const baseline = writeSnapshot(join(root, 'baseline'));
    const postRollback = writeSnapshot(join(root, 'post-rollback'), {
      LIVE_VOLUME_API_DATA_MOUNTPOINT: '/var/lib/docker/volumes/other-api-data/_data',
    });
    expectFailure(
      () =>
        runHarness([
          'validate-attestation',
          '--config',
          fixture.configPath,
          '--snapshot',
          postRollback,
          '--baseline',
          baseline,
        ]),
      'rollback must preserve the baseline volume identity'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('effective host path rejects Node/npm even when an operator adds them', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-k-path-'));
  try {
    const fakeNode = join(root, 'node');
    const fakeNpm = join(root, 'npm');
    writeFileSync(fakeNode, '#!/bin/sh\nexit 0\n');
    writeFileSync(fakeNpm, '#!/bin/sh\nexit 0\n');
    chmodSync(fakeNode, 0o755);
    chmodSync(fakeNpm, 0o755);
    expectFailure(
      () =>
        runShell([
          '-c',
          'source "$1"; k_validate_effective_host_path "$2"',
          'bash',
          harnessPath,
          root,
        ]),
      'Node/npm in the effective PATH must fail closed'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('host contract validation retains the helper after building the effective PATH', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-k-host-contract-'));
  try {
    const binDir = join(root, 'bin');
    const harnessDir = join(root, 'harness');
    const contractDir = join(harnessDir, 'lib');
    const deployRoot = join(root, 'deploy-root');
    const evidenceDir = join(deployRoot, 'k-evidence');
    const downloadsDir = join(root, 'downloads');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(contractDir, { recursive: true });
    mkdirSync(evidenceDir, { recursive: true });
    mkdirSync(downloadsDir, { recursive: true });

    const dockerPath = join(binDir, 'docker');
    writeFileSync(
      dockerPath,
      '#!/usr/bin/env bash\n[ "$1" = info ] && printf "%s\\n" fixture-daemon\n'
    );
    chmodSync(dockerPath, 0o755);
    writeFileSync(
      join(contractDir, 'production-host-contract.sh'),
      [
        'PRODUCTION_HOST_REQUIRED_COMMANDS=(bash docker df awk sha256sum tr)',
        'production_host_contract_validate() { return 0; }',
        '',
      ].join('\n')
    );

    const device = execFileSync('df', ['-P', downloadsDir], { encoding: 'utf8' })
      .trim()
      .split(/\r?\n/u)[1]
      ?.trim()
      .split(/\s+/u)[0];
    assert.ok(device);
    const deviceSha = createHash('sha256').update(device).digest('hex');

    assert.doesNotThrow(() =>
      runShell(
        [
          '-c',
          [
            'source "$1"',
            'K_HARNESS_DIR="$2"',
            'K_DEPLOY_ROOT="$3"',
            'K_EVIDENCE_DIR="$4"',
            'K_GATEWAY_DOWNLOAD_HOST_ROOT="$5"',
            'K_DOCKER_DAEMON_ID=fixture-daemon',
            'K_GATEWAY_DOWNLOAD_DEVICE_SHA256="$6"',
            'K_COMPOSE_PROJECT=classroompath-production',
            'PATH="$7:$PATH"',
            'export K_HARNESS_DIR K_DEPLOY_ROOT K_EVIDENCE_DIR K_GATEWAY_DOWNLOAD_HOST_ROOT K_DOCKER_DAEMON_ID K_GATEWAY_DOWNLOAD_DEVICE_SHA256 K_COMPOSE_PROJECT PATH',
            'k_validate_host_contract',
          ].join('; '),
          'bash',
          harnessPath,
          harnessDir,
          deployRoot,
          evidenceDir,
          downloadsDir,
          deviceSha,
          binDir,
        ],
        { PATH: `${binDir}:${process.env.PATH ?? ''}` }
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime credentials are read from a private external file without sourcing or archiving it', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-k-secrets-'));
  try {
    const deployRoot = join(root, 'deploy-root');
    const appDir = join(deployRoot, 'app');
    const secrets = join(root, 'runtime.env');
    mkdirSync(appDir, { recursive: true });
    const databaseUrl = fixtureDatabaseUrl();
    const databaseEndpointSha = createHash('sha256').update(databaseUrl).digest('hex');
    writeFileSync(
      secrets,
      `DATABASE_URL=${databaseUrl}\nGHCR_USERNAME=fixture-user\nGHCR_TOKEN=fixture-credential\n`
    );
    chmodSync(secrets, 0o600);
    assert.doesNotThrow(() =>
      runShell([
        '-c',
        'source "$1"; K_DEPLOY_ROOT="$2"; K_APP_DIR="$3"; K_RUNTIME_SECRETS_FILE="$4"; K_DATABASE_ENDPOINT_SHA256="$5"; k_load_runtime_secrets; test -n "$GHCR_USERNAME" -a -n "$GHCR_TOKEN"',
        'bash',
        harnessPath,
        deployRoot,
        appDir,
        secrets,
        databaseEndpointSha,
      ])
    );

    writeFileSync(secrets, `DATABASE_URL=${databaseUrl}\nGHCR_USERNAME=fixture-user\n`);
    expectFailure(
      () =>
        runShell([
          '-c',
          'source "$1"; K_DEPLOY_ROOT="$2"; K_APP_DIR="$3"; K_RUNTIME_SECRETS_FILE="$4"; K_DATABASE_ENDPOINT_SHA256="$5"; k_load_runtime_secrets',
          'bash',
          harnessPath,
          deployRoot,
          appDir,
          secrets,
          databaseEndpointSha,
        ]),
      'missing registry credential must fail closed'
    );

    writeFileSync(
      secrets,
      `DATABASE_URL=${fixtureDatabaseUrl('other-user', 'other-password', 'other-db', 'other')}\nGHCR_USERNAME=fixture-user\nGHCR_TOKEN=fixture-credential\n`
    );
    expectFailure(
      () =>
        runShell([
          '-c',
          'source "$1"; K_DEPLOY_ROOT="$2"; K_APP_DIR="$3"; K_RUNTIME_SECRETS_FILE="$4"; K_DATABASE_ENDPOINT_SHA256="$5"; k_load_runtime_secrets',
          'bash',
          harnessPath,
          deployRoot,
          appDir,
          secrets,
          databaseEndpointSha,
        ]),
      'database endpoint copied from another environment must fail closed'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime secrets admission rejects a non-private external file', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-k-private-secrets-'));
  try {
    const deployRoot = join(root, 'deploy-root');
    const appDir = join(deployRoot, 'app');
    const secrets = join(root, 'runtime.env');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      secrets,
      `DATABASE_URL=${fixtureDatabaseUrl()}\nGHCR_USERNAME=fixture-user\nGHCR_TOKEN=fixture-credential\n`
    );
    chmodSync(secrets, 0o644);

    expectFailure(
      () =>
        runShell([
          '-c',
          'source "$1"; K_DEPLOY_ROOT="$2"; K_RUNTIME_SECRETS_FILE="$3"; k_validate_runtime_secrets_path "$4"',
          'bash',
          harnessPath,
          deployRoot,
          secrets,
          appDir,
        ]),
      'the runtime secrets file must require mode 0600'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K forward skips email preflight without changing production or staging policy', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-k-email-preflight-'));
  try {
    const appDir = join(root, 'app');
    const payload = join(root, 'candidate-payload.env');
    const recovery = join(root, 'recovery.tgz');
    const prepared = join(root, 'recovery-prepared.env');
    const entrypoint = join(root, 'forward-entrypoint.sh');
    const capture = join(root, 'forward-environment.txt');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(payload, 'candidate-payload\n');
    writeFileSync(recovery, 'recovery-bytes\n');
    writeFileSync(prepared, 'RECOVERY_PREPARED_BEFORE_BOUNDARY=true\n');
    writeFileSync(
      entrypoint,
      [
        '#!/usr/bin/env bash',
        'printf "forward_email=%s\\n" "${CP_EMAIL_PREFLIGHT_MODE:-unset}" > "$K_CAPTURE_FILE"',
        'printf "forward_staging=%s\\n" "${STAGING_EMAIL_PREFLIGHT_MODE:-unset}" >> "$K_CAPTURE_FILE"',
        '',
      ].join('\n')
    );
    chmodSync(entrypoint, 0o755);

    const output = runShell(
      [
        '-c',
        [
          'source "$1"',
          'K_APP_DIR="$2"',
          'K_C_PAYLOAD_FILE="$3"',
          'K_RECOVERY_TRANSMITTED_FILE="$4"',
          'K_RECOVERY_PREPARED_FILE="$5"',
          'K_C_FORWARD_ENTRYPOINT_FILE="$6"',
          'K_EFFECTIVE_HOST_PATH="$PATH"',
          `K_CANDIDATE_SHA="${candidateSha}"`,
          `K_RECOVERY_SHA="${recoverySha}"`,
          `K_RECOVERY_SOURCE_SHA="${recoverySha}"`,
          'K_RECOVERY_CONTRACT_VERSION=1',
          'K_RECOVERY_SOURCE_VERSION=1',
          `K_RECOVERY_ARTIFACT_SHA256="${bundleSha}"`,
          `K_RECOVERY_EXECUTOR_SHA256="${runtimeSha}"`,
          `K_DEPLOY_ROOT="${root}"`,
          'K_COMPOSE_PROJECT=classroompath-production',
          'K_NETWORK_PREFLIGHT_URL=https://registry.example.invalid/v2/',
          'K_CONTAINER_PLATFORM=linux/amd64',
          'export K_APP_DIR K_C_PAYLOAD_FILE K_RECOVERY_TRANSMITTED_FILE K_RECOVERY_PREPARED_FILE K_C_FORWARD_ENTRYPOINT_FILE K_EFFECTIVE_HOST_PATH K_CANDIDATE_SHA K_RECOVERY_SHA K_RECOVERY_SOURCE_SHA K_RECOVERY_CONTRACT_VERSION K_RECOVERY_SOURCE_VERSION K_RECOVERY_ARTIFACT_SHA256 K_RECOVERY_EXECUTOR_SHA256 K_DEPLOY_ROOT K_COMPOSE_PROJECT K_NETWORK_PREFLIGHT_URL K_CONTAINER_PLATFORM',
          'k_validate_candidate_payload() { return 0; }',
          'k_preflight_recovery() { return 0; }',
          'k_validate_recovery_transmitted() { return 0; }',
          'k_run_forward_from_stdin',
          'printf "parent_email=%s\\n" "$CP_EMAIL_PREFLIGHT_MODE"',
        ].join('; '),
        'bash',
        harnessPath,
        appDir,
        payload,
        recovery,
        prepared,
        entrypoint,
      ],
      { K_CAPTURE_FILE: capture, CP_EMAIL_PREFLIGHT_MODE: 'required' }
    );

    assert.match(readFileSync(capture, 'utf8'), /forward_email=skip/u);
    assert.match(readFileSync(capture, 'utf8'), /forward_staging=unset/u);
    assert.match(output, /parent_email=required/u);

    const productionSource = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf8'
    );
    assert.match(
      productionSource,
      /CP_EMAIL_PREFLIGHT_MODE="\$\{CP_EMAIL_PREFLIGHT_MODE:-required\}"/u
    );
    assert.doesNotMatch(productionSource, /CP_EMAIL_PREFLIGHT_MODE=skip/u);

    const stagingSource = readFileSync(
      resolve(projectRoot, 'scripts/lib/staging-deploy-local-runtime.sh'),
      'utf8'
    );
    assert.match(stagingSource, /STAGING_EMAIL_PREFLIGHT_MODE/u);
    assert.match(stagingSource, /export CP_EMAIL_PREFLIGHT_MODE/u);
    assert.doesNotMatch(stagingSource, /CP_EMAIL_PREFLIGHT_MODE=skip/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('leg host evidence records the observed npm field from host admission', () => {
  const source = readFileSync(
    resolve(projectRoot, 'scripts/staging-equivalent-harness.sh'),
    'utf8'
  );
  const npmEvidence = source.match(
    /k_record "\$records" host npm_observed "\$\{K_[A-Z_]+:-unknown\}"/gu
  );
  assert.equal(npmEvidence?.length, 2);
  assert.doesNotMatch(source, /host npm_observed "\$\{K_NPM_OBSERVED:-unknown\}"/u);
  assert.match(source, /host npm_observed "\$\{K_HOST_NPM_OBSERVED:-unknown\}"/u);
});

test('runtime snapshot resolves image digests from the inspected image object', () => {
  const source = readFileSync(
    resolve(projectRoot, 'scripts/staging-equivalent-harness.sh'),
    'utf8'
  );
  const snapshotService = source.slice(
    source.indexOf('k_snapshot_service()'),
    source.indexOf('\nk_snapshot_volume()', source.indexOf('k_snapshot_service()'))
  );

  assert.match(snapshotService, /image_id="\$\(docker inspect -f '\{\{\.Image\}\}' "\$id"\)"/u);
  assert.match(snapshotService, /docker image inspect -f '\{\{range \.RepoDigests\}\}/u);
  assert.doesNotMatch(snapshotService, /docker inspect -f '\{\{range \.RepoDigests\}\}/u);
});

test('provisioning rejects pre-existing production-named persistent resources on a fresh host', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-k-resources-'));
  try {
    const dockerPath = join(root, 'docker');
    writeFileSync(
      dockerPath,
      [
        '#!/bin/sh',
        'case "$1:$2" in',
        '  ps:*) exit 0 ;;',
        '  volume:inspect) [ "${FAKE_RESOURCE:-}" = volume ] && exit 0 || exit 1 ;;',
        '  volume:ls) exit 0 ;;',
        '  network:inspect) [ "${FAKE_RESOURCE:-}" = network ] && exit 0 || exit 1 ;;',
        '  network:ls) exit 0 ;;',
        'esac',
        'exit 1',
        '',
      ].join('\n')
    );
    chmodSync(dockerPath, 0o755);
    const command = [
      'source "$1"',
      'K_EFFECTIVE_HOST_PATH="$2"',
      `K_EXPECTED_API_DATA_VOLUME="${apiDataVolume}"`,
      `K_EXPECTED_TEMPLATES_VOLUME="${templatesVolume}"`,
      `K_EXPECTED_ARTIFACTS_VOLUME="${artifactsVolume}"`,
      'K_EXPECTED_NETWORKS="' + network + '"',
      'k_require_fresh_runtime_resources',
    ].join('; ');
    assert.doesNotThrow(() =>
      runShell(['-c', command, 'bash', harnessPath, root], { K_EFFECTIVE_HOST_PATH: root })
    );
    expectFailure(
      () =>
        runShell(['-c', command, 'bash', harnessPath, root], {
          K_EFFECTIVE_HOST_PATH: root,
          FAKE_RESOURCE: 'volume',
        }),
      'pre-existing persistent volume must fail provisioning'
    );
    expectFailure(
      () =>
        runShell(['-c', command, 'bash', harnessPath, root], {
          K_EFFECTIVE_HOST_PATH: root,
          FAKE_RESOURCE: 'network',
        }),
      'pre-existing Compose network must fail provisioning'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeRecoveryArtifact(root: string) {
  const bundleRoot = join(root, 'recovery-bundle');
  mkdirSync(join(bundleRoot, 'lib'), { recursive: true });
  const requiredFiles = [
    'production-recovery-executor.sh',
    'lib/common.sh',
    'lib/remote-bootstrap.sh',
    'lib/remote-deploy-scaffold.sh',
    'lib/remote-helper-contracts.sh',
    'lib/release-state.sh',
    'lib/release-runtime.sh',
    'lib/deployment-state.sh',
    'lib/production-host-contract.sh',
    'lib/deployment-transaction.sh',
    'lib/rollback-executor.sh',
    'lib/rollback-readiness.sh',
    'lib/deploy-container-platform.sh',
    'lib/production-recovery-contract.sh',
  ];
  for (const file of requiredFiles) {
    const path = join(bundleRoot, file);
    writeFileSync(
      path,
      file === 'production-recovery-executor.sh' ? '#!/usr/bin/env bash\n' : '# fixture\n'
    );
  }
  chmodSync(join(bundleRoot, 'production-recovery-executor.sh'), 0o700);
  writeFileSync(
    join(bundleRoot, 'lib/production-recovery-contract.sh'),
    [
      'PRODUCTION_RECOVERY_CONTRACT_HELPER_CONTRACT_VERSION=1',
      'PRODUCTION_RECOVERY_CONTRACT_VERSION=1',
      'PRODUCTION_RECOVERY_SOURCE_VERSION=1',
      '',
    ].join('\n')
  );
  writeFileSync(
    join(bundleRoot, 'lib/recovery-authority.env'),
    `PRODUCTION_RECOVERY_SOURCE_SHA=${recoverySha}\nPRODUCTION_RECOVERY_CONTRACT_VERSION=1\nPRODUCTION_RECOVERY_SOURCE_VERSION=1\n`
  );
  const artifactPath = join(root, 'recovery.tgz');
  execFileSync('tar', [
    '-czf',
    artifactPath,
    '-C',
    bundleRoot,
    'production-recovery-executor.sh',
    'lib',
  ]);
  return {
    artifactPath,
    executorSha: sha256File(join(bundleRoot, 'production-recovery-executor.sh')),
  };
}

test('recovery validation requires independent full R and identical transmitted/persisted bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-recovery-'));
  try {
    const artifact = writeRecoveryArtifact(root);
    const transmitted = join(root, 'evidence', 'recovery-transmitted.tgz');
    const artifactHash = sha256File(artifact.artifactPath);
    const persisted = join(
      root,
      'deploy-root',
      'recovery',
      'releases',
      artifactHash,
      'production-recovery-bundle.tgz'
    );
    mkdirSync(join(root, 'evidence'), { recursive: true });
    mkdirSync(join(root, 'deploy-root', 'recovery', 'releases', artifactHash), {
      recursive: true,
    });
    copyFileSync(artifact.artifactPath, transmitted);
    copyFileSync(artifact.artifactPath, persisted);
    const fixture = writeConfig(
      root,
      {
        K_RECOVERY_ARTIFACT_FILE: artifact.artifactPath,
        K_RECOVERY_TRANSMITTED_FILE: transmitted,
        K_RECOVERY_PERSISTED_FILE: persisted,
        K_RECOVERY_ARTIFACT_SHA256: artifactHash,
        K_RECOVERY_EXECUTOR_SHA256: artifact.executorSha,
      },
      { includeRecovery: true }
    );
    assert.match(
      runHarness(['validate-recovery', '--config', fixture.configPath]),
      /recovery identity passed/u
    );

    const sameCandidate = writeConfig(
      root,
      { K_RECOVERY_SHA: candidateSha },
      { includeRecovery: true }
    );
    expectFailure(
      () => runHarness(['validate-recovery', '--config', sameCandidate.configPath]),
      'R=C must fail'
    );

    const shortRecovery = writeConfig(
      root,
      { K_RECOVERY_SHA: 'r'.repeat(39) },
      { includeRecovery: true }
    );
    expectFailure(
      () => runHarness(['validate-recovery', '--config', shortRecovery.configPath]),
      'short R must fail'
    );

    writeFileSync(persisted, 'different recovery bytes\n');
    expectFailure(
      () => runHarness(['validate-recovery', '--config', fixture.configPath]),
      'transmitted/persisted mismatch must fail'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('migration classifier is fail-closed for non-safe risk', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-migration-'));
  try {
    const fixture = writeConfig(root);
    const repo = join(root, 'repo');
    mkdirSync(repo, { recursive: true });
    runShell([
      '-c',
      'git init -q "$1" && git -C "$1" config user.email test@example.invalid && git -C "$1" config user.name test',
      'bash',
      repo,
    ]);
    writeFileSync(join(repo, 'README.md'), 'base\n');
    runShell(['-c', 'git -C "$1" add . && git -C "$1" commit -qm base', 'bash', repo]);
    const fromSha = runShell(['-c', 'git -C "$1" rev-parse HEAD', 'bash', repo]).trim();
    mkdirSync(join(repo, 'api/drizzle'), { recursive: true });
    writeFileSync(
      join(repo, 'api/drizzle/0001-add-table.sql'),
      'CREATE TABLE example (id integer);\n'
    );
    runShell(['-c', 'git -C "$1" add . && git -C "$1" commit -qm migration', 'bash', repo]);
    const toSha = runShell(['-c', 'git -C "$1" rev-parse HEAD', 'bash', repo]).trim();

    const output = join(root, 'migration.env');
    expectFailure(
      () =>
        runHarness([
          'validate-migration',
          '--config',
          fixture.configPath,
          '--repo',
          repo,
          '--from',
          fromSha,
          '--to',
          toSha,
          '--output',
          output,
        ]),
      'expand-contract risk must block the fault leg'
    );
    assert.match(readFileSync(output, 'utf8'), /MIGRATION_RISK_LEVEL=expand-contract/u);
    assert.match(
      readFileSync(output, 'utf8'),
      /MIGRATION_CHANGED_FILES=api\/drizzle\/0001-add-table\.sql/u
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('watchdog only stops a distinct candidate gateway at ACTIVATED_UNVERIFIED and only once', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-watchdog-'));
  try {
    const phasePath = join(root, 'phase.env');
    const recordsPath = join(root, 'containers.txt');
    const stopLog = join(root, 'stop.log');
    const markerPath = join(root, 'fault-target.env');
    const dockerPath = join(root, 'docker');
    writeFileSync(dockerPath, '#!/bin/sh\nprintf "%s\\n" "$2" >> "$STOP_LOG"\n');
    chmodSync(dockerPath, 0o755);
    writeFileSync(
      recordsPath,
      [
        `gateway-p|classroompath-production|gateway|${gatewayImage}|classroompath-gateway|running`,
        `gateway-c|classroompath-production|gateway|${gatewayImage}|classroompath-gateway|running`,
      ].join('\n') + '\n'
    );

    writeFileSync(
      phasePath,
      [
        'DEPLOYMENT_PHASE=PREPARED',
        `DEPLOYMENT_TRANSACTION_ID=${transactionId}`,
        `CANDIDATE_RELEASE_ID=${releaseId}`,
        `CANDIDATE_SHA=${candidateSha}`,
        `CURRENT_RELEASE_ID=${previousSha}`,
        `PREVIOUS_RELEASE_ID=${previousSha}`,
        'MUTATION_BOUNDARY_REACHED=0',
        '',
      ].join('\n')
    );
    expectFailure(
      () =>
        runShell(
          [
            '-c',
            'source "$1"; K_PREVIOUS_RELEASE_ID="$7"; k_watchdog_act_once "$2" "$3" gateway-p "$4" "$5" "$6" "$8" "$9" "${10}"',
            'bash',
            harnessPath,
            phasePath,
            recordsPath,
            gatewayImage,
            dockerPath,
            markerPath,
            previousSha,
            transactionId,
            releaseId,
            candidateSha,
          ],
          { STOP_LOG: stopLog }
        ),
      'watchdog must not act before ACTIVATED_UNVERIFIED'
    );
    assert.equal(existsSync(stopLog), false);

    writeFileSync(
      phasePath,
      [
        'DEPLOYMENT_PHASE=ACTIVATED_UNVERIFIED',
        `DEPLOYMENT_TRANSACTION_ID=${transactionId}`,
        `CANDIDATE_RELEASE_ID=${releaseId}`,
        `CANDIDATE_SHA=${candidateSha}`,
        `CURRENT_RELEASE_ID=${previousSha}`,
        `PREVIOUS_RELEASE_ID=${previousSha}`,
        'MUTATION_BOUNDARY_REACHED=1',
        '',
      ].join('\n')
    );
    runShell(
      [
        '-c',
        'source "$1"; K_PREVIOUS_RELEASE_ID="$7"; k_watchdog_act_once "$2" "$3" gateway-p "$4" "$5" "$6" "$8" "$9" "${10}"',
        'bash',
        harnessPath,
        phasePath,
        recordsPath,
        gatewayImage,
        dockerPath,
        markerPath,
        previousSha,
        transactionId,
        releaseId,
        candidateSha,
      ],
      { STOP_LOG: stopLog }
    );
    assert.equal(readFileSync(stopLog, 'utf8').trim(), 'gateway-c');
    expectFailure(
      () =>
        runShell(
          [
            '-c',
            'source "$1"; K_PREVIOUS_RELEASE_ID="$7"; k_watchdog_act_once "$2" "$3" gateway-p "$4" "$5" "$6" "$8" "$9" "${10}"',
            'bash',
            harnessPath,
            phasePath,
            recordsPath,
            gatewayImage,
            dockerPath,
            markerPath,
            previousSha,
            transactionId,
            releaseId,
            candidateSha,
          ],
          { STOP_LOG: stopLog }
        ),
      'watchdog must be one-shot'
    );

    writeFileSync(
      recordsPath,
      `gateway-p|classroompath-production|gateway|${gatewayImage}|classroompath-gateway|running\n`
    );
    rmSync(markerPath, { force: true });
    expectFailure(
      () =>
        runShell(
          [
            '-c',
            'source "$1"; K_PREVIOUS_RELEASE_ID="$7"; k_watchdog_act_once "$2" "$3" gateway-p "$4" "$5" "$6" "$8" "$9" "${10}"',
            'bash',
            harnessPath,
            phasePath,
            recordsPath,
            gatewayImage,
            dockerPath,
            markerPath,
            previousSha,
            transactionId,
            releaseId,
            candidateSha,
          ],
          { STOP_LOG: stopLog }
        ),
      'watchdog must fail when it cannot identify a distinct candidate'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('transaction identity is durable and history append failure remains secondary after SWITCHING', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-transaction-history-failure-'));
  try {
    const statePath = join(root, 'release-state', 'deployment-phase.env');
    const historyParent = join(root, 'history-parent');
    writeFileSync(historyParent, 'not-a-directory\n');
    const output = runShell([
      '-c',
      [
        'source "$1"',
        'DEPLOYMENT_TRANSACTION_HISTORY_FILE="$2/history"',
        'DEPLOYMENT_TRANSACTION_ID="$3"',
        'deployment_transaction_init "$4" "$5" "$6" "$3"; init_status=$?',
        'deployment_transaction_transition SWITCHING SWITCH; transition_status=$?',
        'phase="$(deployment_transaction_read_value "$4" DEPLOYMENT_PHASE)"',
        'boundary="$(deployment_transaction_read_value "$4" MUTATION_BOUNDARY_REACHED)"',
        'history_status="$(deployment_transaction_read_value "$4" DEPLOYMENT_TRANSACTION_HISTORY_STATUS)"',
        'persisted_id="$(deployment_transaction_read_value "$4" DEPLOYMENT_TRANSACTION_ID)"',
        'printf "init=%s transition=%s phase=%s boundary=%s history=%s id=%s\\n" "$init_status" "$transition_status" "$phase" "$boundary" "$history_status" "$persisted_id"',
      ].join('; '),
      'bash',
      resolve(projectRoot, 'scripts/lib/deployment-transaction.sh'),
      historyParent,
      transactionId,
      statePath,
      previousSha,
      releaseId,
    ]);
    assert.match(output, /init=0 transition=0 phase=SWITCHING boundary=1 history=incomplete/u);
    assert.match(output, new RegExp(`id=${transactionId}`, 'u'));

    const validHistoryOutput = runShell([
      '-c',
      [
        'source "$1"',
        'source "$2"',
        `K_TRANSACTION_ID="${transactionId}"`,
        'DEPLOYMENT_TRANSACTION_HISTORY_FILE="$3"',
        'deployment_transaction_init "$4" "$5" "$6" "$7"',
        'deployment_transaction_transition SWITCHING SWITCH',
        'k_validate_transaction_history "$3" PREPARED SWITCHING',
        'printf "history-valid\\n"',
      ].join('; '),
      'bash',
      harnessPath,
      resolve(projectRoot, 'scripts/lib/deployment-transaction.sh'),
      join(root, 'valid-history.env'),
      join(root, 'valid-state.env'),
      previousSha,
      releaseId,
      transactionId,
    ]);
    assert.match(validHistoryOutput, /history-valid/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('history append failure after durable SWITCHING still enters post-boundary recovery', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-history-recovery-'));
  try {
    const statePath = join(root, 'release-state', 'deployment-phase.env');
    const historyParent = join(root, 'history-parent');
    const recordsPath = join(root, 'records.jsonl');
    const callsPath = join(root, 'rollback.calls');
    writeFileSync(historyParent, 'not-a-directory\n');
    writeFileSync(recordsPath, '');
    const output = runShell([
      '-c',
      [
        'source "$1"',
        'source "$2"',
        `K_DEPLOY_ROOT="${root}"; K_EVIDENCE_DIR="${root}"; K_TRANSACTION_ID="${transactionId}"; K_C_RELEASE_ID="${releaseId}"; K_CANDIDATE_SHA="${candidateSha}"; K_PREVIOUS_RELEASE_ID="${previousSha}"; CANDIDATE_SHA="${candidateSha}"`,
        'DEPLOYMENT_TRANSACTION_HISTORY_FILE="$3/history"',
        'deployment_transaction_init "$4" "$5" "$6" "$7"',
        'deployment_transaction_transition SWITCHING SWITCH',
        'k_require_durable_recovery_artifact() { return 0; }',
        'CALLS_FILE="$9"; PHASE_FILE="$4"; k_run_rollback_observed() { printf "called\\n" >> "$CALLS_FILE"; K_ROLLBACK_STATUS=0; K_ROLLBACK_OBSERVER_STATUS=0; printf "DEPLOYMENT_TRANSACTION_HISTORY_STATUS=incomplete\\nDEPLOYMENT_PHASE=ROLLED_BACK\\nMUTATION_BOUNDARY_REACHED=1\\nCURRENT_RELEASE_ID=' +
          previousSha +
          '\\nPREVIOUS_RELEASE_ID=' +
          previousSha +
          '\\nCANDIDATE_RELEASE_ID=' +
          releaseId +
          '\\nCANDIDATE_SHA=' +
          candidateSha +
          '\\nDEPLOYMENT_TRANSACTION_ID=' +
          transactionId +
          '\\n" > "$PHASE_FILE"; return 0; }',
        'k_process_post_forward 1 success "$8" "$4"',
        'printf "phase=%s|history=%s|recovery=%s|safety=%s\\n" "$(k_read_file_value "$4" DEPLOYMENT_PHASE)" "$(k_read_file_value "$4" DEPLOYMENT_TRANSACTION_HISTORY_STATUS)" "$K_RECOVERY_RESULT" "$K_SAFETY_OUTCOME"',
      ].join('; '),
      'bash',
      harnessPath,
      resolve(projectRoot, 'scripts/lib/deployment-transaction.sh'),
      historyParent,
      statePath,
      previousSha,
      releaseId,
      transactionId,
      recordsPath,
      callsPath,
    ]);
    assert.match(
      output,
      /phase=ROLLED_BACK\|history=incomplete\|recovery=ROLLED_BACK\|safety=ROLLED_BACK/u
    );
    assert.equal(readFileSync(callsPath, 'utf8').trim(), 'called');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('forward outcome classification reads durable boundary and fails toward recovery when state is ambiguous', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-forward-classification-'));
  try {
    const makeState = (name: string, values: Record<string, string>) => {
      const path = join(root, `${name}.env`);
      writeFileSync(
        path,
        `${Object.entries({
          DEPLOYMENT_TRANSACTION_ID: transactionId,
          CANDIDATE_RELEASE_ID: releaseId,
          CANDIDATE_SHA: candidateSha,
          CURRENT_RELEASE_ID: previousSha,
          PREVIOUS_RELEASE_ID: previousSha,
          ...values,
        })
          .map(([key, value]) => `${key}=${value}`)
          .join('\n')}\n`
      );
      return path;
    };
    const classify = (statePath: string, status: number, leg = 'success', failure = '') =>
      runShell([
        '-c',
        'source "$1"; K_TRANSACTION_ID="$2"; K_C_RELEASE_ID="$3"; K_CANDIDATE_SHA="' +
          candidateSha +
          '"; K_PREVIOUS_RELEASE_ID="' +
          previousSha +
          '"; k_classify_forward_outcome "$4" "$5" "$6" "$7"; printf "%s|%s|%s|%s\\n" "$K_FORWARD_OUTCOME" "$K_FORWARD_BOUNDARY" "$K_FORWARD_PHASE" "$K_FORWARD_STATE_READABLE"',
        'bash',
        harnessPath,
        transactionId,
        releaseId,
        String(status),
        statePath,
        leg,
        failure,
      ]).trim();

    assert.equal(
      classify(
        makeState('pre-boundary', { DEPLOYMENT_PHASE: 'FAILED', MUTATION_BOUNDARY_REACHED: '0' }),
        1
      ),
      'FORWARD_FAILURE_PRE_BOUNDARY|0|FAILED|true'
    );
    assert.equal(
      classify(
        makeState('switching', { DEPLOYMENT_PHASE: 'SWITCHING', MUTATION_BOUNDARY_REACHED: '1' }),
        1
      ),
      'FORWARD_FAILURE_POST_BOUNDARY|1|SWITCHING|true'
    );
    assert.equal(
      classify(
        makeState('activated', {
          DEPLOYMENT_PHASE: 'ACTIVATED_UNVERIFIED',
          MUTATION_BOUNDARY_REACHED: '1',
        }),
        1
      ),
      'FORWARD_FAILURE_POST_BOUNDARY|1|ACTIVATED_UNVERIFIED|true'
    );
    assert.equal(
      classify(
        makeState('readiness', { DEPLOYMENT_PHASE: 'VERIFIED', MUTATION_BOUNDARY_REACHED: '1' }),
        1
      ),
      'FORWARD_FAILURE_POST_BOUNDARY|1|VERIFIED|true'
    );
    assert.equal(
      classify(
        makeState('evidence', { DEPLOYMENT_PHASE: 'SWITCHING', MUTATION_BOUNDARY_REACHED: '1' }),
        0,
        'fault',
        'evidence'
      ),
      'HARNESS_FAILURE_POST_BOUNDARY|1|SWITCHING|true'
    );
    assert.equal(
      classify(join(root, 'missing.env'), 1),
      'STATE_UNKNOWN_AFTER_FORWARD|unknown|unknown|false'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('shared post-forward policy recovers every non-terminal fault and preserves safety when evidence fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-post-forward-policy-'));
  try {
    const phasePath = join(root, 'phase.env');
    const recordsPath = join(root, 'records.jsonl');
    const callsPath = join(root, 'rollback.calls');
    writeFileSync(recordsPath, '');
    writeFileSync(
      phasePath,
      [
        'DEPLOYMENT_PHASE=SWITCHING',
        'MUTATION_BOUNDARY_REACHED=1',
        `CURRENT_RELEASE_ID=${previousSha}`,
        `PREVIOUS_RELEASE_ID=${previousSha}`,
        `CANDIDATE_RELEASE_ID=${releaseId}`,
        `CANDIDATE_SHA=${candidateSha}`,
        `DEPLOYMENT_TRANSACTION_ID=${transactionId}`,
        '',
      ].join('\n')
    );
    const command = [
      'source "$1"',
      `K_TRANSACTION_ID="${transactionId}"`,
      `K_C_RELEASE_ID="${releaseId}"`,
      `K_CANDIDATE_SHA="${candidateSha}"`,
      `K_PREVIOUS_RELEASE_ID="${previousSha}"`,
      'K_EVIDENCE_DIR="$(dirname "$3")"',
      'CALLS_FILE="$4"; PHASE_FILE="$2"; k_require_durable_recovery_artifact() { return 0; }',
      'k_run_rollback_observed() { printf "called\\n" >> "$CALLS_FILE"; K_ROLLBACK_STATUS=0; K_ROLLBACK_OBSERVER_STATUS=0; printf "DEPLOYMENT_TRANSACTION_HISTORY_STATUS=incomplete\\nDEPLOYMENT_PHASE=ROLLED_BACK\\nMUTATION_BOUNDARY_REACHED=1\\nCURRENT_RELEASE_ID=' +
        previousSha +
        '\\nPREVIOUS_RELEASE_ID=' +
        previousSha +
        '\\nCANDIDATE_RELEASE_ID=' +
        releaseId +
        '\\nCANDIDATE_SHA=' +
        candidateSha +
        '\\nDEPLOYMENT_TRANSACTION_ID=' +
        transactionId +
        '\\n" > "$PHASE_FILE"; return 0; }',
      'K_FORWARD_OUTCOME=FORWARD_FAILURE_POST_BOUNDARY',
      'K_FORWARD_PHASE=SWITCHING',
      'K_FORWARD_BOUNDARY=1',
      'k_ensure_post_boundary_recovery success "$3" "$2"',
      'printf "success=%s|%s|%s|%s\\n" "$K_RECOVERY_ATTEMPTED" "$K_RECOVERY_RESULT" "$K_SAFETY_OUTCOME" "$(wc -l < "$4")"',
    ].join('; ');
    const output = runShell([
      '-c',
      command,
      'bash',
      harnessPath,
      phasePath,
      recordsPath,
      callsPath,
      callsPath,
    ]);
    assert.match(output, /success=true\|ROLLED_BACK\|ROLLED_BACK\|1/u);

    const faultOutput = runShell([
      '-c',
      [
        'source "$1"',
        `K_TRANSACTION_ID="${transactionId}"`,
        `K_C_RELEASE_ID="${releaseId}"`,
        `K_CANDIDATE_SHA="${candidateSha}"`,
        `K_PREVIOUS_RELEASE_ID="${previousSha}"`,
        'CALLS_FILE="$4"; k_require_durable_recovery_artifact() { return 0; }',
        'k_run_rollback_observed() { printf "fault-called\\n" >> "$CALLS_FILE"; K_ROLLBACK_STATUS=0; K_ROLLBACK_OBSERVER_STATUS=0; return 0; }',
        'K_FORWARD_OUTCOME=FORWARD_FAILURE_TERMINAL_SAFE',
        'K_FORWARD_PHASE=COMMITTED',
        'K_FORWARD_BOUNDARY=1',
        'k_ensure_post_boundary_recovery fault "$3" "$2"',
        'printf "fault=%s|%s|%s\\n" "$K_RECOVERY_ATTEMPTED" "$K_RECOVERY_RESULT" "$K_SAFETY_OUTCOME"',
      ].join('; '),
      'bash',
      harnessPath,
      phasePath,
      recordsPath,
      callsPath,
    ]);
    assert.match(faultOutput, /fault=true\|ROLLED_BACK\|ROLLED_BACK/u);

    const evidenceOutput = runShell([
      '-c',
      [
        'source "$1"',
        'K_EVIDENCE_OUTCOME=COMPLETE',
        'K_SAFETY_OUTCOME=ROLLED_BACK',
        'k_build_evidence() { return 1; }',
        'if k_finalize_leg_evidence success "$2" "$3"; then status=0; else status=$?; fi',
        'printf "evidence_status=%s|safety=%s|evidence=%s\\n" "$status" "$K_SAFETY_OUTCOME" "$K_EVIDENCE_OUTCOME"',
      ].join('; '),
      'bash',
      harnessPath,
      recordsPath,
      join(root, 'missing-history'),
    ]);
    assert.match(evidenceOutput, /evidence_status=1\|safety=ROLLED_BACK\|evidence=INCOMPLETE/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ambiguous durable state still attempts R and rejects a rollback no-op', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-ambiguous-recovery-'));
  try {
    for (const terminal of [true, false]) {
      const caseRoot = join(root, terminal ? 'terminal' : 'noop');
      mkdirSync(caseRoot);
      const callsPath = join(caseRoot, 'rollback.calls');
      const command = [
        'source "$1"',
        `K_DEPLOY_ROOT="$2"; K_EVIDENCE_DIR="$2"; K_TRANSACTION_ID="${transactionId}"; K_C_RELEASE_ID="${releaseId}"; K_CANDIDATE_SHA="${candidateSha}"; K_PREVIOUS_RELEASE_ID="${previousSha}"`,
        'CALLS_FILE="$3"; PHASE_FILE="$2/phase.env"',
        'k_require_durable_recovery_artifact() { return 0; }',
        terminal
          ? 'k_run_rollback_observed() { printf "called\\n" >> "$CALLS_FILE"; K_ROLLBACK_STATUS=0; K_ROLLBACK_OBSERVER_STATUS=0; printf "DEPLOYMENT_PHASE=ROLLED_BACK\\nMUTATION_BOUNDARY_REACHED=1\\nCURRENT_RELEASE_ID=' +
            previousSha +
            '\\nPREVIOUS_RELEASE_ID=' +
            previousSha +
            '\\nCANDIDATE_RELEASE_ID=' +
            releaseId +
            '\\nCANDIDATE_SHA=' +
            candidateSha +
            '\\nDEPLOYMENT_TRANSACTION_ID=' +
            transactionId +
            '\\n" > "$PHASE_FILE"; return 0; }'
          : 'k_run_rollback_observed() { printf "called\\n" >> "$CALLS_FILE"; K_ROLLBACK_STATUS=0; K_ROLLBACK_OBSERVER_STATUS=0; return 0; }',
        'k_process_post_forward 1 success "$2/records.jsonl" "$2/phase.env"',
        'printf "%s|%s|%s\\n" "$K_RECOVERY_ATTEMPTED" "$K_RECOVERY_RESULT" "$K_SAFETY_OUTCOME"',
      ].join('; ');
      writeFileSync(join(caseRoot, 'records.jsonl'), '');
      const output = runShell(['-c', command, 'bash', harnessPath, caseRoot, callsPath], {
        K_EVIDENCE_DIR: caseRoot,
      });
      assert.match(
        output,
        terminal ? /true\|ROLLED_BACK\|ROLLED_BACK/u : /true\|FAILED\|RECOVERY_FAILED/u
      );
      assert.equal(readFileSync(callsPath, 'utf8').trim(), 'called');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('diagnostic, history, record, and observer failures remain after recovery is attempted', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-post-forward-evidence-failures-'));
  try {
    const phasePath = join(root, 'phase.env');
    const recordsPath = join(root, 'records.jsonl');
    const callsPath = join(root, 'rollback.calls');
    writeFileSync(
      phasePath,
      [
        'DEPLOYMENT_PHASE=ACTIVATED_UNVERIFIED',
        'MUTATION_BOUNDARY_REACHED=1',
        `CURRENT_RELEASE_ID=${previousSha}`,
        `PREVIOUS_RELEASE_ID=${previousSha}`,
        `CANDIDATE_RELEASE_ID=${releaseId}`,
        `CANDIDATE_SHA=${candidateSha}`,
        `DEPLOYMENT_TRANSACTION_ID=${transactionId}`,
        '',
      ].join('\n')
    );
    const output = runShell([
      '-c',
      [
        'source "$1"',
        'K_EVIDENCE_DIR="$2"; K_DEPLOY_ROOT="$2"; mkdir -p "$2"',
        `K_TRANSACTION_ID="${transactionId}"; K_C_RELEASE_ID="${releaseId}"; K_CANDIDATE_SHA="${candidateSha}"; K_PREVIOUS_RELEASE_ID="${previousSha}"`,
        'CALLS_FILE="$3"; PHASE_FILE="$4"',
        'k_require_durable_recovery_artifact() { return 0; }',
        'k_run_rollback_observed() { printf "rollback\\n" >> "$CALLS_FILE"; K_ROLLBACK_STATUS=0; K_ROLLBACK_OBSERVER_STATUS=0; printf "DEPLOYMENT_PHASE=ROLLED_BACK\\nMUTATION_BOUNDARY_REACHED=1\\nCURRENT_RELEASE_ID=' +
          previousSha +
          '\\nPREVIOUS_RELEASE_ID=' +
          previousSha +
          '\\nCANDIDATE_RELEASE_ID=' +
          releaseId +
          '\\nCANDIDATE_SHA=' +
          candidateSha +
          '\\nDEPLOYMENT_TRANSACTION_ID=' +
          transactionId +
          '\\n" > "$PHASE_FILE"; return 0; }',
        'k_process_post_forward 1 success "$2/records.jsonl" "$4"',
        'k_collect_diagnostic() { return 1; }',
        'k_validate_transaction_history() { return 1; }',
        'k_record_transaction_history() { return 1; }',
        'k_record() { return 1; }',
        'k_build_evidence() { return 1; }',
        'if k_finalize_leg_evidence success "$2/records.jsonl" "$2/missing-history"; then final=0; else final=$?; fi',
        'printf "%s|%s|%s|%s\\n" "$final" "$K_RECOVERY_RESULT" "$K_SAFETY_OUTCOME" "$K_EVIDENCE_OUTCOME"',
      ].join('; '),
      'bash',
      harnessPath,
      root,
      callsPath,
      phasePath,
    ]);
    assert.match(output, /1\|ROLLED_BACK\|ROLLED_BACK\|INCOMPLETE/u);
    assert.equal(readFileSync(callsPath, 'utf8').trim(), 'rollback');

    const observerOutput = runShell([
      '-c',
      [
        'source "$1"',
        'K_EVIDENCE_DIR="$2"; K_DEPLOY_ROOT="$2"; mkdir -p "$2"',
        `K_TRANSACTION_ID="${transactionId}"; K_C_RELEASE_ID="${releaseId}"; K_CANDIDATE_SHA="${candidateSha}"; K_PREVIOUS_RELEASE_ID="${previousSha}"`,
        'CALLS_FILE="$3"',
        'k_require_durable_recovery_artifact() { return 0; }',
        'k_initialize_rollback_phase_observations() { return 1; }',
        'k_run_rollback_from_stdin() { printf "observer-fallback\\n" >> "$CALLS_FILE"; return 0; }',
        'K_FORWARD_OUTCOME=FORWARD_FAILURE_POST_BOUNDARY; K_FORWARD_PHASE=ACTIVATED_UNVERIFIED; K_FORWARD_BOUNDARY=1',
        'k_ensure_post_boundary_recovery success "$2/records.jsonl" "$2/phase.env"',
        'printf "%s|%s|%s\\n" "$K_RECOVERY_ATTEMPTED" "$K_RECOVERY_RESULT" "$K_SAFETY_OUTCOME"',
      ].join('; '),
      'bash',
      harnessPath,
      root,
      callsPath,
    ]);
    assert.match(observerOutput, /true\|ROLLED_BACK\|ROLLED_BACK/u);
    assert.match(readFileSync(callsPath, 'utf8'), /observer-fallback/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('watchdog ignores stale terminal state, arms only after current PREPARED, and rejects another transaction', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-watchdog-correlation-'));
  try {
    const phasePath = join(root, 'phase.env');
    const recordsPath = join(root, 'records.txt');
    const markerPath = join(root, 'fault-target.env');
    const dockerPath = join(root, 'docker');
    const stopLog = join(root, 'stop.log');
    writeFileSync(dockerPath, '#!/bin/sh\nprintf "%s\\n" "$2" >> "$STOP_LOG"\n');
    chmodSync(dockerPath, 0o755);
    writeFileSync(
      recordsPath,
      `gateway-c|classroompath-production|gateway|${gatewayImage}|classroompath-gateway|running\n`
    );

    for (const stalePhase of ['ROLLED_BACK', 'COMMITTED']) {
      writeFileSync(
        phasePath,
        [
          `DEPLOYMENT_PHASE=${stalePhase}`,
          `DEPLOYMENT_TRANSACTION_ID=${staleTransactionId}`,
          `CANDIDATE_RELEASE_ID=${releaseId}`,
          `CANDIDATE_SHA=${candidateSha}`,
          `CURRENT_RELEASE_ID=${stalePhase === 'COMMITTED' ? releaseId : previousSha}`,
          `PREVIOUS_RELEASE_ID=${previousSha}`,
          'MUTATION_BOUNDARY_REACHED=1',
          '',
        ].join('\n')
      );
      expectFailure(
        () =>
          runShell(
            [
              '-c',
              'source "$1"; K_DEPLOY_ROOT="$2"; K_EVIDENCE_DIR="$3"; K_C_TRANSACTION_ID="$4"; K_C_RELEASE_ID="$5"; K_CANDIDATE_SHA="$6"; K_WATCHDOG_MAX_ATTEMPTS=1; K_WATCHDOG_POLL_SECONDS=0.01; K_WATCHDOG_RECORDS_FILE="$7"; K_FAULT_TARGET_FILE="$8"; K_BASELINE_GATEWAY_ID="gateway-p"; k_watchdog_loop "$4" "$5" "$6"',
              'bash',
              harnessPath,
              root,
              root,
              transactionId,
              releaseId,
              candidateSha,
              recordsPath,
              markerPath,
            ],
            { STOP_LOG: stopLog }
          ),
        `stale ${stalePhase} must not close the new watchdog window`
      );
    }
    assert.equal(existsSync(stopLog), false);

    writeFileSync(
      phasePath,
      [
        'DEPLOYMENT_PHASE=ACTIVATED_UNVERIFIED',
        `DEPLOYMENT_TRANSACTION_ID=${staleTransactionId}`,
        `CANDIDATE_RELEASE_ID=${releaseId}`,
        `CANDIDATE_SHA=${candidateSha}`,
        `CURRENT_RELEASE_ID=${previousSha}`,
        `PREVIOUS_RELEASE_ID=${previousSha}`,
        'MUTATION_BOUNDARY_REACHED=1',
        '',
      ].join('\n')
    );
    expectFailure(
      () =>
        runShell(
          [
            '-c',
            'source "$1"; K_PREVIOUS_RELEASE_ID="$2"; k_watchdog_act_once "$3" "$4" gateway-p "$5" "$6" "$7" "$8" "$9" "${10}"',
            'bash',
            harnessPath,
            previousSha,
            phasePath,
            recordsPath,
            gatewayImage,
            dockerPath,
            markerPath,
            transactionId,
            releaseId,
            candidateSha,
          ],
          { STOP_LOG: stopLog }
        ),
      'watchdog must never act on a different transaction ID'
    );
    assert.equal(existsSync(stopLog), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fault target evidence is bound to the current transaction and watchdog inventory', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-fault-target-evidence-'));
  try {
    const markerPath = join(root, 'fault-target.env');
    const recordsPath = join(root, 'watchdog-containers.txt');
    const targetId = 'a'.repeat(64);
    writeFileSync(
      markerPath,
      [
        `FAULT_TARGET_CONTAINER_ID=${targetId}`,
        'FAULT_PHASE=ACTIVATED_UNVERIFIED',
        `FAULT_TRANSACTION_ID=${transactionId}`,
        `FAULT_CANDIDATE_RELEASE_ID=${releaseId}`,
        `FAULT_CANDIDATE_SHA=${candidateSha}`,
        '',
      ].join('\n')
    );
    writeFileSync(
      recordsPath,
      `${targetId}|classroompath-production|gateway|${gatewayImage}|classroompath-gateway|running\n`
    );
    const output = runShell([
      '-c',
      'source "$1"; K_FAULT_TARGET_FILE="$2"; K_WATCHDOG_RECORDS_FILE="$3"; K_TRANSACTION_ID="$4"; K_C_RELEASE_ID="$5"; K_CANDIDATE_SHA="$6"; K_EXPECTED_GATEWAY_NAME=classroompath-gateway; K_C_GATEWAY_IMAGE="$7"; target="$(k_validate_fault_target_evidence)"; printf "%s\\n" "$target"',
      'bash',
      harnessPath,
      markerPath,
      recordsPath,
      transactionId,
      releaseId,
      candidateSha,
      gatewayImage,
    ]).trim();
    assert.equal(output, targetId);

    writeFileSync(
      markerPath,
      readFileSync(markerPath, 'utf8').replace(transactionId, staleTransactionId)
    );
    expectFailure(
      () =>
        runShell([
          '-c',
          'source "$1"; K_FAULT_TARGET_FILE="$2"; K_WATCHDOG_RECORDS_FILE="$3"; K_TRANSACTION_ID="$4"; K_C_RELEASE_ID="$5"; K_CANDIDATE_SHA="$6"; K_EXPECTED_GATEWAY_NAME=classroompath-gateway; K_C_GATEWAY_IMAGE="$7"; k_validate_fault_target_evidence',
          'bash',
          harnessPath,
          markerPath,
          recordsPath,
          transactionId,
          releaseId,
          candidateSha,
          gatewayImage,
        ]),
      'fault target evidence must reject another transaction'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('provisioning orders migrations before application runtime and records owned resources for retry cleanup', () => {
  const source = readFileSync(
    resolve(projectRoot, 'scripts/staging-equivalent-harness.sh'),
    'utf8'
  );
  const provisionStart = source.indexOf('k_provision_p()');
  const provisionEnd = source.indexOf('\nk_execute_fault_leg()', provisionStart);
  assert.ok(provisionStart >= 0 && provisionEnd > provisionStart);
  const provisionSource = source.slice(provisionStart, provisionEnd);
  const migrationIndex = provisionSource.indexOf('run-migrations-docker.sh');
  const composeUpIndex = provisionSource.indexOf(
    'docker compose',
    provisionSource.indexOf('docker compose') + 1
  );
  assert.ok(
    migrationIndex >= 0 && composeUpIndex > migrationIndex,
    'migrations must be invoked before compose up'
  );
  assert.match(source, /PROVISION_ATTEMPT_ID/u);
  assert.match(source, /k_provision_cleanup_attempt/u);
  assert.match(source, /PROVISION_OWNERSHIP_CONFIRMED=true/u);
  assert.match(source, /docker rm -f/u);
  assert.doesNotMatch(provisionSource, /docker compose[^\n]*down/u);
});

test('HTTP snapshot probes retry while the freshly started runtime becomes ready', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-http-probe-'));
  try {
    const fakeBin = join(root, 'bin');
    const countFile = join(root, 'curl-count');
    const bodyFile = join(root, 'ready.body');
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(countFile, '0\n');
    writeFileSync(
      join(fakeBin, 'curl'),
      [
        '#!/bin/sh',
        'set -eu',
        'count=$(cat "$FAKE_CURL_COUNT_FILE")',
        'count=$((count + 1))',
        'printf "%s\n" "$count" > "$FAKE_CURL_COUNT_FILE"',
        "body=''",
        'while [ "$#" -gt 0 ]; do',
        '  case "$1" in',
        '    -o) body="$2"; shift 2 ;;',
        '    *) shift ;;',
        '  esac',
        'done',
        'if [ "$count" -lt 3 ]; then exit 7; fi',
        'printf "%s\n" \'{"ready":true}\' > "$body"',
        'printf "200\n"',
        '',
      ].join('\n')
    );
    chmodSync(join(fakeBin, 'curl'), 0o755);

    const output = runShell(
      [
        '-c',
        'source "$1"; K_HTTP_PROBE_ATTEMPTS=3; K_HTTP_PROBE_DELAY_SECONDS=0; k_http_probe "$2" "$3"',
        'bash',
        harnessPath,
        'http://127.0.0.1:3000/cp/ready',
        bodyFile,
      ],
      {
        PATH: [fakeBin, process.env.PATH ?? '/usr/bin:/bin'].join(':'),
        FAKE_CURL_COUNT_FILE: countFile,
      }
    ).trim();

    assert.equal(output, '200');
    assert.equal(readFileSync(countFile, 'utf8').trim(), '3');
    assert.equal(readFileSync(bodyFile, 'utf8').trim(), '{"ready":true}');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('post-forward policy matrix never abandons a non-terminal boundary state', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-post-forward-matrix-'));
  try {
    const cases = [
      {
        phase: 'FAILED',
        boundary: '0',
        status: 1,
        leg: 'success',
        result: 'NO_RECOVERY',
        calls: 0,
      },
      {
        phase: 'SWITCHING',
        boundary: '1',
        status: 1,
        leg: 'success',
        result: 'ROLLED_BACK',
        calls: 1,
      },
      {
        phase: 'ACTIVATED_UNVERIFIED',
        boundary: '1',
        status: 1,
        leg: 'success',
        result: 'ROLLED_BACK',
        calls: 1,
      },
      {
        phase: 'VERIFIED',
        boundary: '1',
        status: 1,
        leg: 'success',
        result: 'ROLLED_BACK',
        calls: 1,
      },
      {
        phase: 'COMMITTED',
        boundary: '1',
        status: 0,
        leg: 'success',
        result: 'NOT_REQUIRED',
        calls: 0,
      },
      {
        phase: 'COMMITTED',
        boundary: '1',
        status: 1,
        leg: 'success',
        result: 'ROLLED_BACK',
        calls: 1,
      },
      {
        phase: 'COMMITTED',
        boundary: '1',
        status: 0,
        leg: 'fault',
        result: 'ROLLED_BACK',
        calls: 1,
      },
    ];

    for (const [index, item] of cases.entries()) {
      const phasePath = join(root, `phase-${index}.env`);
      const recordsPath = join(root, `records-${index}.jsonl`);
      const callsPath = join(root, `calls-${index}.txt`);
      writeFileSync(
        phasePath,
        [
          `DEPLOYMENT_PHASE=${item.phase}`,
          `MUTATION_BOUNDARY_REACHED=${item.boundary}`,
          `CURRENT_RELEASE_ID=${item.phase === 'COMMITTED' ? releaseId : previousSha}`,
          `PREVIOUS_RELEASE_ID=${previousSha}`,
          `CANDIDATE_RELEASE_ID=${releaseId}`,
          `CANDIDATE_SHA=${candidateSha}`,
          `DEPLOYMENT_TRANSACTION_ID=${transactionId}`,
          '',
        ].join('\n')
      );
      const output = runShell([
        '-c',
        [
          'source "$1"',
          'K_EVIDENCE_DIR="$2"',
          'K_DEPLOY_ROOT="$2"',
          'K_TRANSACTION_ID="$3"',
          'K_C_RELEASE_ID="$4"',
          'K_CANDIDATE_SHA="$5"',
          'K_PREVIOUS_RELEASE_ID="' + previousSha + '"',
          'CALLS_FILE="$6"; PHASE_FILE="$7"',
          'k_require_durable_recovery_artifact() { return 0; }',
          'k_run_rollback_observed() { printf "rollback\\n" >> "$CALLS_FILE"; K_ROLLBACK_STATUS=0; K_ROLLBACK_OBSERVER_STATUS=0; printf "DEPLOYMENT_PHASE=ROLLED_BACK\\nMUTATION_BOUNDARY_REACHED=1\\nCURRENT_RELEASE_ID=' +
            previousSha +
            '\\nPREVIOUS_RELEASE_ID=' +
            previousSha +
            '\\nCANDIDATE_RELEASE_ID=' +
            releaseId +
            '\\nCANDIDATE_SHA=' +
            candidateSha +
            '\\nDEPLOYMENT_TRANSACTION_ID=' +
            transactionId +
            '\\n" > "$PHASE_FILE"; return 0; }',
          'k_process_post_forward "$8" "$9" "$2/records.jsonl" "$7"',
          'printf "%s|%s|%s|%s\\n" "$K_FORWARD_OUTCOME" "$K_RECOVERY_RESULT" "$K_SAFETY_OUTCOME" "$(wc -l < "$6" 2>/dev/null || true)"',
        ].join('; '),
        'bash',
        harnessPath,
        root,
        transactionId,
        releaseId,
        candidateSha,
        callsPath,
        phasePath,
        String(item.status),
        item.leg,
      ]).trim();
      assert.match(output, new RegExp(`\\|${item.result}\\|`, 'u'));
      assert.equal(
        existsSync(callsPath)
          ? readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean).length
          : 0,
        item.calls
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('post-boundary recovery failure is explicit and evidence remains best-effort', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-recovery-failure-'));
  try {
    const phasePath = join(root, 'phase.env');
    const recordsPath = join(root, 'records.jsonl');
    const callsPath = join(root, 'calls.txt');
    writeFileSync(
      phasePath,
      [
        'DEPLOYMENT_PHASE=ACTIVATED_UNVERIFIED',
        'MUTATION_BOUNDARY_REACHED=1',
        `CURRENT_RELEASE_ID=${previousSha}`,
        `PREVIOUS_RELEASE_ID=${previousSha}`,
        `CANDIDATE_RELEASE_ID=${releaseId}`,
        `CANDIDATE_SHA=${candidateSha}`,
        `DEPLOYMENT_TRANSACTION_ID=${transactionId}`,
        '',
      ].join('\n')
    );
    const output = runShell([
      '-c',
      [
        'source "$1"',
        'K_EVIDENCE_DIR="$2"; K_DEPLOY_ROOT="$2"',
        `K_TRANSACTION_ID="${transactionId}"; K_C_RELEASE_ID="${releaseId}"; K_CANDIDATE_SHA="${candidateSha}"; K_PREVIOUS_RELEASE_ID="${previousSha}"`,
        'CALLS_FILE="$3"',
        'k_require_durable_recovery_artifact() { return 0; }',
        'k_run_rollback_observed() { printf "attempted\\n" >> "$CALLS_FILE"; K_ROLLBACK_STATUS=1; K_ROLLBACK_OBSERVER_STATUS=1; return 1; }',
        'k_process_post_forward 1 success "$2/records.jsonl" "$4"',
        'printf "%s|%s|%s\\n" "$K_RECOVERY_ATTEMPTED" "$K_RECOVERY_RESULT" "$K_SAFETY_OUTCOME"',
      ].join('; '),
      'bash',
      harnessPath,
      root,
      callsPath,
      phasePath,
    ]);
    assert.match(output, /true\|FAILED\|RECOVERY_FAILED/u);
    assert.equal(readFileSync(callsPath, 'utf8').trim(), 'attempted');
    assert.equal(existsSync(recordsPath), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('provisioning cleanup is ownership-bound and retryable after a partial compose failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-provision-cleanup-'));
  try {
    const deployRoot = join(root, 'deploy-root');
    const fakeBin = join(root, 'bin');
    const dockerLog = join(root, 'docker-removals.log');
    mkdirSync(join(deployRoot, 'release-state'), { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(
      join(fakeBin, 'docker'),
      [
        '#!/bin/sh',
        'set -eu',
        'case "${1:-}:${2:-}" in',
        '  ps:*)',
        '    case "${4:-}" in',
        '      \'name=^/classroompath-gateway$\') grep -q "container:container-gateway" "$DOCKER_LOG" || printf "container-gateway\\n" ;;',
        '      \'name=^/classroompath-api$\') grep -q "container:container-api" "$DOCKER_LOG" || printf "container-api\\n" ;;',
        '      \'name=^/classroompath-spa$\') grep -q "container:container-spa" "$DOCKER_LOG" || printf "container-spa\\n" ;;',
        '      \'name=^/classroompath-openpath-windows-offline-installer-provision$\') grep -q "container:container-provision" "$DOCKER_LOG" || printf "container-provision\\n" ;;',
        '      *) exit 0 ;;',
        '    esac',
        '    ;;',
        '  inspect:-f)',
        '    target="${4:-}"',
        '    case "$target" in',
        '      container-gateway) printf "container-gateway|/classroompath-gateway|classroompath-production|gateway\\n" ;;',
        '      container-api) printf "container-api|/classroompath-api|classroompath-production|api\\n" ;;',
        '      container-spa) printf "container-spa|/classroompath-spa|classroompath-production|spa\\n" ;;',
        '      container-provision) printf "container-provision|/classroompath-openpath-windows-offline-installer-provision|classroompath-production|windows-offline-installer-provision\\n" ;;',
        '      provision-network) printf "provision-network|classroompath-production_openpath_default|classroompath-production\\n" ;;',
        '      *) exit 1 ;;',
        '    esac',
        '    ;;',
        '  volume:inspect)',
        '    target="${3:-}"; [ "$target" = -f ] && target="${5:-}"',
        '    case "$target" in',
        `      ${apiDataVolume}) printf "${apiDataVolume}|classroompath-production|api-data\\n" ;;`,
        `      ${templatesVolume}) printf "${templatesVolume}|classroompath-production|windows_offline_installer_templates\\n" ;;`,
        `      ${artifactsVolume}) printf "${artifactsVolume}|classroompath-production|windows_offline_installer_artifacts\\n" ;;`,
        '      *) exit 1 ;;',
        '    esac',
        '    ;;',
        '  network:inspect)',
        '    target="${3:-}"; [ "$target" = -f ] && target="${5:-}"',
        `    [ "$target" = provision-network ] && printf "provision-network|${network}|classroompath-production\\n" || exit 1`,
        '    ;;',
        '  rm:-f) printf "container:%s\\n" "$3" >> "$DOCKER_LOG" ;;',
        '  volume:rm) printf "volume:%s\\n" "$3" >> "$DOCKER_LOG" ;;',
        '  network:rm) printf "network:%s\\n" "$3" >> "$DOCKER_LOG" ;;',
        '  *) exit 1 ;;',
        'esac',
        '',
      ].join('\n')
    );
    chmodSync(join(fakeBin, 'docker'), 0o755);
    writeFileSync(
      join(deployRoot, 'release-state', 'provision-attempt.env'),
      [
        `PROVISION_ATTEMPT_ID=${transactionId}`,
        'PROVISION_STATUS=RUNTIME_CREATED',
        'PROVISION_OWNERSHIP_CONFIRMED=true',
        'PROVISION_RESOURCES_ABSENT_BEFORE=true',
        `PROVISION_RELEASE_ID=${releaseId}`,
        'PROVISION_COMPOSE_PROJECT=classroompath-production',
        `PROVISION_NETWORK_NAME=${network}`,
        'PROVISION_GATEWAY_NAME=classroompath-gateway',
        'PROVISION_API_NAME=classroompath-api',
        'PROVISION_SPA_NAME=classroompath-spa',
        'PROVISION_PROVISION_NAME=classroompath-openpath-windows-offline-installer-provision',
        `PROVISION_API_DATA_VOLUME=${apiDataVolume}`,
        `PROVISION_TEMPLATES_VOLUME=${templatesVolume}`,
        `PROVISION_ARTIFACTS_VOLUME=${artifactsVolume}`,
        'PROVISION_GATEWAY_ID=container-gateway',
        'PROVISION_API_ID=container-api',
        'PROVISION_SPA_ID=container-spa',
        'PROVISION_PROVISION_ID=container-provision',
        'PROVISION_NETWORK_ID=provision-network',
        '',
      ].join('\n')
    );
    const output = runShell(
      [
        '-c',
        'source "$1"; K_DEPLOY_ROOT="$2"; K_COMPOSE_PROJECT=classroompath-production; K_EFFECTIVE_HOST_PATH="$3:/usr/bin:/bin"; K_EVIDENCE_DIR="$2/k-evidence"; K_P_RELEASE_ID="$4"; export K_DEPLOY_ROOT K_COMPOSE_PROJECT K_EFFECTIVE_HOST_PATH K_EVIDENCE_DIR K_P_RELEASE_ID; k_provision_cleanup_attempt; first=$?; k_provision_cleanup_attempt; second=$?; status="$(k_read_file_value "$2/release-state/provision-attempt.env" PROVISION_STATUS)"; printf "first=%s second=%s status=%s\\n" "$first" "$second" "$status"',
        'bash',
        harnessPath,
        deployRoot,
        fakeBin,
        releaseId,
      ],
      { DOCKER_LOG: dockerLog }
    );
    assert.match(output, /first=0 second=0 status=CLEANED/u);
    assert.equal(readFileSync(dockerLog, 'utf8').trim().split('\n').length, 8);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('manual rollback fence consumes durable R without history or candidate helpers', () => {
  const source = readFileSync(
    resolve(projectRoot, 'scripts/staging-equivalent-harness.sh'),
    'utf8'
  );
  assert.match(source, /k_validate_manual_rollback_fence/u);
  assert.match(source, /K_MANUAL_ROLLBACK/u);
  assert.match(source, /K_RECOVERY_PERSISTED_FILE/u);
  assert.match(source, /history_file=""/u);
  assert.doesNotMatch(
    source.slice(source.indexOf('rollback)')),
    /k_validate_transaction_history[^\n]*K_TRANSACTION/u
  );
});

test('all post-boundary exits advertise independent safety and evidence outcomes', () => {
  const source = readFileSync(
    resolve(projectRoot, 'scripts/staging-equivalent-harness.sh'),
    'utf8'
  );
  assert.match(source, /SAFETY_OUTCOME/u);
  assert.match(source, /EVIDENCE_OUTCOME/u);
  assert.match(source, /RECOVERY_ATTEMPTED/u);
  assert.match(source, /RECOVERY_RESULT.*ROLLED_BACK/u);
  assert.match(source, /RECOVERY_RESULT.*FAILED/u);
});

test('transaction validator preserves current until commit and rollback is candidate-independent', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-transaction-'));
  try {
    const statePath = join(root, 'phase.env');
    writeFileSync(
      statePath,
      [
        'DEPLOYMENT_PHASE=ACTIVATED_UNVERIFIED',
        `CURRENT_RELEASE_ID=${candidateSha}`,
        `PREVIOUS_RELEASE_ID=${previousSha}`,
        `CANDIDATE_RELEASE_ID=${candidateSha}`,
        '',
      ].join('\n')
    );
    expectFailure(
      () => runHarness(['validate-transition', '--state', statePath]),
      'current must not become C before commit'
    );

    writeFileSync(
      statePath,
      [
        'DEPLOYMENT_PHASE=COMMITTED',
        `CURRENT_RELEASE_ID=${candidateSha}`,
        `PREVIOUS_RELEASE_ID=${previousSha}`,
        `CANDIDATE_RELEASE_ID=${candidateSha}`,
        '',
      ].join('\n')
    );
    assert.match(
      runHarness(['validate-transition', '--state', statePath]),
      /transition contract passed/u
    );

    const harness = readFileSync(harnessPath, 'utf8');
    assert.match(harness, /bash -s < "\$K_RECOVERY_WRAPPER_FILE"/u);
    assert.match(harness, /cmp -- "\$K_RECOVERY_TRANSMITTED_FILE"/u);
    assert.match(harness, /PRODUCTION_CONTAINER_PLATFORM=/u);
    assert.match(harness, /PRODUCTION_ROLLBACK_PUBLIC_URL=/u);
    assert.doesNotMatch(harness, /rollback.*\$K_APP_DIR\/scripts/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SWITCHING history binds the mutation boundary to the exact persisted recovery artifact', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-history-'));
  try {
    const history = join(root, 'history.env');
    const persistedRecovery = join(root, 'recovery.tgz');
    const switchingRecord =
      'DEPLOYMENT_PHASE=SWITCHING DEPLOYMENT_PHASE_UPDATED_AT=2026-09-01T00:01:00Z ' +
      'DEPLOYMENT_STAGE=SWITCH MUTATION_BOUNDARY_REACHED=1 ' +
      'RECOVERY_SOURCE_SHA=' +
      recoverySha +
      ' RECOVERY_ARTIFACT_SHA256=' +
      bundleSha +
      ' RECOVERY_EXECUTOR_SHA256=' +
      contractSha +
      ' RECOVERY_ARTIFACT_PATH=' +
      persistedRecovery;
    writeFileSync(
      history,
      [
        'DEPLOYMENT_PHASE=PREPARED DEPLOYMENT_PHASE_UPDATED_AT=2026-09-01T00:00:00Z DEPLOYMENT_STAGE=RESOLVE MUTATION_BOUNDARY_REACHED=0',
        switchingRecord,
        '',
      ].join('\n')
    );
    const env = [
      'K_RECOVERY_SOURCE_SHA=' + recoverySha,
      'K_RECOVERY_ARTIFACT_SHA256=' + bundleSha,
      'K_RECOVERY_EXECUTOR_SHA256=' + contractSha,
      'K_RECOVERY_PERSISTED_FILE=' + persistedRecovery,
    ].join('; ');
    assert.doesNotThrow(() =>
      runShell([
        '-c',
        'source "$1"; ' + env + '; k_validate_transaction_history "$2" PREPARED SWITCHING',
        'bash',
        harnessPath,
        history,
      ])
    );

    writeFileSync(
      history,
      readFileSync(history, 'utf8').replace(
        'RECOVERY_ARTIFACT_SHA256=' + bundleSha,
        'RECOVERY_ARTIFACT_SHA256=wrong'
      )
    );
    expectFailure(
      () =>
        runShell([
          '-c',
          'source "$1"; ' + env + '; k_validate_transaction_history "$2" PREPARED SWITCHING',
          'bash',
          harnessPath,
          history,
        ]),
      'SWITCHING must bind the exact recovery artifact identity'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rollback phase observation is fail-closed and requires ROLLING_BACK then ROLLED_BACK', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-rollback-phases-'));
  try {
    const observations = join(root, 'rollback-phases.env');
    writeFileSync(
      observations,
      [
        'OBSERVED_PHASE=ROLLING_BACK OBSERVED_AT=2026-09-01T00:00:01Z',
        'OBSERVED_PHASE=ROLLED_BACK OBSERVED_AT=2026-09-01T00:00:02Z',
        '',
      ].join('\n')
    );
    runShell([
      '-c',
      'source "$1"; k_validate_rollback_phase_observations "$2" 1',
      'bash',
      harnessPath,
      observations,
    ]);

    writeFileSync(observations, 'OBSERVED_PHASE=FAILED OBSERVED_AT=2026-09-01T00:00:01Z\n');
    expectFailure(
      () =>
        runShell([
          '-c',
          'source "$1"; k_validate_rollback_phase_observations "$2" 0',
          'bash',
          harnessPath,
          observations,
        ]),
      'rollback observation without ROLLING_BACK must fail'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('evidence builder rejects secret-shaped records and emits bounded structured JSON', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-evidence-'));
  try {
    const fixture = writeConfig(root);
    const records = join(root, 'records.jsonl');
    const outputDir = join(root, 'evidence');
    writeFileSync(
      records,
      '{"schemaVersion":1,"timestampUtc":"2026-09-01T00:00:00Z","kind":"phase","name":"phase","value":"PREPARED"}\n'
    );
    runHarness([
      'evidence',
      '--config',
      fixture.configPath,
      '--records',
      records,
      '--output-dir',
      outputDir,
    ]);
    const evidence = readFileSync(join(outputDir, 'evidence.json'), 'utf8');
    assert.match(evidence, /"records"/u);
    assert.match(readFileSync(join(outputDir, 'evidence.json'), 'utf8'), /PREPARED/u);

    writeFileSync(
      records,
      '{"schemaVersion":1,"timestampUtc":"2026-09-01T00:00:00Z","kind":"secret","name":"bad","value":"Authorization: dummy"}\n'
    );
    expectFailure(
      () =>
        runHarness([
          'evidence',
          '--config',
          fixture.configPath,
          '--records',
          records,
          '--output-dir',
          outputDir,
        ]),
      'secret-shaped evidence must be rejected'
    );

    writeFileSync(
      records,
      '{"schemaVersion":1,"timestampUtc":"2026-09-01T00:00:00Z","kind":"secret","name":"bad","value":"database_url=hidden"}\n'
    );
    expectFailure(
      () =>
        runHarness([
          'evidence',
          '--config',
          fixture.configPath,
          '--records',
          records,
          '--output-dir',
          outputDir,
        ]),
      'case-insensitive secret-shaped evidence must be rejected'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('diagnostic artifacts are bounded and sanitized before provenance is accepted', () => {
  const root = mkdtempSync(join(tmpdir(), 'classroompath-k-diagnostic-'));
  try {
    const diagnostic = join(root, 'diagnostic.json');
    writeFileSync(
      diagnostic,
      JSON.stringify({
        mutation_boundary_reached: true,
        candidateSha,
        previousReleaseId: previousSha,
      }) + '\n'
    );
    assert.doesNotThrow(() =>
      runShell([
        '-c',
        'source "$1"; k_diagnostic_is_candidate_valid "$2" "$3" "$4"',
        'bash',
        harnessPath,
        diagnostic,
        candidateSha,
        previousSha,
      ])
    );
    writeFileSync(diagnostic, '{"mutation_boundary_reached":true,"DATABASE_URL":"hidden"}\n');
    expectFailure(
      () =>
        runShell([
          '-c',
          'source "$1"; k_validate_diagnostic_artifact "$2"',
          'bash',
          harnessPath,
          diagnostic,
        ]),
      'diagnostic secrets must fail before archiving'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('harness documents the real production topology and explicit no-K default', () => {
  const source = readFileSync(
    resolve(projectRoot, 'scripts/staging-equivalent-harness.sh'),
    'utf8'
  );
  assert.match(source, /classroompath-production/u);
  assert.match(source, /K_ENVIRONMENT=staging-equivalent/u);
  assert.match(source, /--confirm-staging-equivalent/u);
  assert.match(source, /production-recovery-authority/u);
  assert.match(source, /ACTIVATED_UNVERIFIED/u);
  assert.match(source, /STAGING_EQUIVALENT_DOCKER_DAEMON_ID/u);
  assert.match(source, /STAGING_EQUIVALENT_GATEWAY_DOWNLOAD_DEVICE_SHA256/u);
  assert.doesNotMatch(source, /gh variable/u);
  assert.doesNotMatch(source, /production-recovery-authority\.yml/u);
  assert.doesNotMatch(source, /git clean -[fd]/u);
});
