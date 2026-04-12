import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  parseReleaseStateText,
  readReleaseStateSnapshot,
} from '../scripts/lib/release-state-contract.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');
const cliPath = resolve(projectRoot, 'scripts/release-state-cli.mjs');
const compatHelperPath = resolve(projectRoot, 'scripts/lib/release-state-compat.sh');

test('release-state CLI writes shell-compatible snapshots through the typed contract', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'release-state-cli-write-'));
  const snapshotPath = join(tempDir, 'current-images.env');

  execFileSync(
    'node',
    [cliPath, 'write-snapshot', '--snapshot-type', 'current-runtime', '--output', snapshotPath],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        APP_SHA: 'abc123',
        IMAGE_SOURCE: 'release-candidate',
        CLASSROOMPATH_GATEWAY_IMAGE: 'ghcr.io/balejosg/classroompath-gateway:abc123',
        CLASSROOMPATH_MIGRATIONS_IMAGE: 'ghcr.io/balejosg/classroompath-migrations:abc123',
        OPENPATH_API_IMAGE: 'ghcr.io/balejosg/openpath-api:abc123',
        OPENPATH_VERSION: '4.1.19',
        OPENPATH_LINUX_AGENT_VERSION: '4.1.19',
        CLASSROOMPATH_SPA_IMAGE: 'ghcr.io/balejosg/classroompath-spa:abc123',
      },
    }
  );

  const writtenText = readFileSync(snapshotPath, 'utf-8');
  const snapshot = parseReleaseStateText(writtenText);

  assert.match(writtenText, /APP_SHA=abc123/);
  assert.equal(
    snapshot.CLASSROOMPATH_GATEWAY_IMAGE,
    'ghcr.io/balejosg/classroompath-gateway:abc123'
  );
  assert.equal(snapshot.OPENPATH_LINUX_AGENT_VERSION, '4.1.19');
});

test('release-state CLI verifies staging evidence and emits workflow outputs', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'release-state-cli-verify-'));
  const currentStatePath = join(tempDir, 'staging-release-state.env');
  const verificationStatePath = join(tempDir, 'staging-verification.env');
  const outputPath = join(tempDir, 'github-output.env');

  writeFileSync(
    currentStatePath,
    [
      'APP_SHA=abc123',
      'IMAGE_SOURCE=release-candidate',
      'CLASSROOMPATH_GATEWAY_IMAGE=ghcr.io/balejosg/classroompath-gateway:abc123',
      'CLASSROOMPATH_MIGRATIONS_IMAGE=ghcr.io/balejosg/classroompath-migrations:abc123',
      'OPENPATH_API_IMAGE=ghcr.io/balejosg/openpath-api:abc123',
      'OPENPATH_VERSION=4.1.19',
      'OPENPATH_LINUX_AGENT_VERSION=4.1.19',
      'CLASSROOMPATH_SPA_IMAGE=ghcr.io/balejosg/classroompath-spa:abc123',
      '',
    ].join('\n'),
    'utf-8'
  );

  writeFileSync(
    verificationStatePath,
    [
      'STAGING_VERIFIED_AT=2026-04-11T06:00:00Z',
      'STAGING_VERIFIED_BY=github-actions',
      'STAGING_VERIFIED_APP_SHA=abc123',
      'STAGING_VERIFIED_OPENPATH_SHA=openpathsha',
      'STAGING_VERIFIED_IMAGE_SOURCE=release-candidate',
      'STAGING_VERIFIED_GATEWAY_IMAGE=ghcr.io/balejosg/classroompath-gateway:abc123',
      'STAGING_VERIFIED_MIGRATIONS_IMAGE=ghcr.io/balejosg/classroompath-migrations:abc123',
      'STAGING_VERIFIED_OPENPATH_API_IMAGE=ghcr.io/balejosg/openpath-api:abc123',
      'STAGING_VERIFIED_OPENPATH_VERSION=4.1.19',
      'STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION=4.1.19',
      'STAGING_VERIFIED_SPA_IMAGE=ghcr.io/balejosg/classroompath-spa:abc123',
      'STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS=present',
      'STAGING_SMOKE_RESULT=success',
      'STAGING_SMOKE_STATUS=PASS',
      'STAGING_RELEASE_GATE_RESULT=success',
      'STAGING_WINDOWS_BOOTSTRAP_RESULT=success',
      'STAGING_FIREFOX_POLICY_RESULT=success',
      'STAGING_FIREFOX_EXTENSION_ID=openpath@example',
      'STAGING_FIREFOX_RELEASE_VERSION=4.1.19',
      'STAGING_FIREFOX_METADATA_SHA256=meta123',
      'STAGING_FIREFOX_XPI_SHA256=xpi123',
      '',
    ].join('\n'),
    'utf-8'
  );

  execFileSync(
    'node',
    [
      cliPath,
      'verify-staging',
      '--current',
      currentStatePath,
      '--verification',
      verificationStatePath,
      '--high-risk',
      'true',
      '--github-output',
      outputPath,
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        EXPECTED_APP_SHA: 'abc123',
        EXPECTED_GATEWAY_IMAGE: 'ghcr.io/balejosg/classroompath-gateway:abc123',
        EXPECTED_MIGRATIONS_IMAGE: 'ghcr.io/balejosg/classroompath-migrations:abc123',
        EXPECTED_OPENPATH_API_IMAGE: 'ghcr.io/balejosg/openpath-api:abc123',
        EXPECTED_OPENPATH_VERSION: '4.1.19',
        EXPECTED_OPENPATH_LINUX_AGENT_VERSION: '4.1.19',
        EXPECTED_SPA_IMAGE: 'ghcr.io/balejosg/classroompath-spa:abc123',
      },
    }
  );

  const outputs = readReleaseStateSnapshot(outputPath);
  assert.equal(outputs.staging_smoke_result, 'success');
  assert.equal(outputs.staging_firefox_release_version, '4.1.19');
  assert.equal(outputs.staging_verified_at, '2026-04-11T06:00:00Z');
});

test('release-state CLI lists canonical snapshot fields for shell consumers', () => {
  const output = execFileSync(
    'node',
    [cliPath, 'list-fields', '--snapshot-type', 'staging-verification-run'],
    {
      cwd: projectRoot,
      env: { ...process.env },
      encoding: 'utf-8',
    }
  );

  assert.deepEqual(output.trim().split('\n'), [
    'SMOKE_TARGET_URL',
    'SMOKE_SKIP_CORS',
    'STAGING_SMOKE_RESULT',
    'STAGING_SMOKE_STATUS',
    'RELEASE_GATE_TARGET_URL',
    'RELEASE_GATE_EXPECTED_ORIGIN',
    'STAGING_RELEASE_GATE_RESULT',
    'STAGING_VERIFIED_AT',
    'STAGING_FIREFOX_RELEASE_ARTIFACTS',
    'STAGING_WINDOWS_BOOTSTRAP_RESULT',
    'STAGING_FIREFOX_POLICY_RESULT',
    'STAGING_FIREFOX_EXTENSION_ID',
    'STAGING_FIREFOX_RELEASE_VERSION',
    'STAGING_FIREFOX_METADATA_SHA256',
    'STAGING_FIREFOX_XPI_SHA256',
  ]);
});

test('shared shell compatibility helper serializes snapshots through the canonical contract', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'release-state-compat-'));
  const snapshotPath = join(tempDir, 'staging-verification.env');

  assert.ok(existsSync(compatHelperPath), 'release-state-compat.sh should exist');

  execFileSync(
    'bash',
    [
      '-lc',
      [
        'source scripts/lib/common.sh',
        'source scripts/lib/release-state-compat.sh',
        'STAGING_VERIFIED_AT=2026-04-11T06:00:00Z',
        'STAGING_VERIFIED_BY=github-actions',
        'STAGING_VERIFIED_APP_SHA=abc123',
        'STAGING_VERIFIED_OPENPATH_SHA=openpathsha',
        'STAGING_VERIFIED_IMAGE_SOURCE=release-candidate',
        'STAGING_VERIFIED_GATEWAY_IMAGE=ghcr.io/balejosg/classroompath-gateway:abc123',
        'STAGING_VERIFIED_MIGRATIONS_IMAGE=ghcr.io/balejosg/classroompath-migrations:abc123',
        'STAGING_VERIFIED_OPENPATH_API_IMAGE=ghcr.io/balejosg/openpath-api:abc123',
        'STAGING_VERIFIED_OPENPATH_VERSION=4.1.19',
        'STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION=4.1.19',
        'STAGING_VERIFIED_SPA_IMAGE=ghcr.io/balejosg/classroompath-spa:abc123',
        'STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS=present',
        'STAGING_SMOKE_RESULT=success',
        'STAGING_SMOKE_STATUS=PASS',
        'STAGING_RELEASE_GATE_RESULT=success',
        'STAGING_WINDOWS_BOOTSTRAP_RESULT=success',
        'STAGING_FIREFOX_POLICY_RESULT=success',
        'STAGING_FIREFOX_EXTENSION_ID=openpath@example',
        'STAGING_FIREFOX_RELEASE_VERSION=4.1.19',
        'STAGING_FIREFOX_METADATA_SHA256=meta123',
        'STAGING_FIREFOX_XPI_SHA256=xpi123',
        `write_release_state_snapshot_compat staging-verification ${snapshotPath}`,
      ].join('; '),
    ],
    { cwd: projectRoot, env: { ...process.env } }
  );

  const snapshot = readReleaseStateSnapshot(snapshotPath);
  assert.equal(snapshot.STAGING_VERIFIED_APP_SHA, 'abc123');
  assert.equal(snapshot.STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION, '4.1.19');
  assert.equal(snapshot.STAGING_FIREFOX_XPI_SHA256, 'xpi123');
});

test('bash release-state helpers preserve shell-only staging verification values when delegating to the typed CLI', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'release-state-shell-helper-'));
  const snapshotPath = join(tempDir, 'staging-verification-run.env');

  execFileSync(
    'bash',
    [
      '-lc',
      [
        'source scripts/lib/common.sh',
        'source scripts/lib/release-state.sh',
        'STAGING_SMOKE_RESULT=success',
        'STAGING_SMOKE_STATUS=PASS',
        'STAGING_RELEASE_GATE_RESULT=success',
        'STAGING_VERIFIED_AT=2026-04-11T10:00:00Z',
        'STAGING_FIREFOX_RELEASE_ARTIFACTS=present',
        'STAGING_WINDOWS_BOOTSTRAP_RESULT=success',
        'STAGING_FIREFOX_POLICY_RESULT=success',
        'STAGING_FIREFOX_EXTENSION_ID=openpath@example',
        'STAGING_FIREFOX_RELEASE_VERSION=4.1.19',
        'STAGING_FIREFOX_METADATA_SHA256=meta123',
        'STAGING_FIREFOX_XPI_SHA256=xpi123',
        `write_staging_verification_run_state ${snapshotPath}`,
      ].join('; '),
    ],
    { cwd: projectRoot, env: { ...process.env } }
  );

  const snapshot = readReleaseStateSnapshot(snapshotPath);
  assert.equal(snapshot.STAGING_SMOKE_RESULT, 'success');
  assert.equal(snapshot.STAGING_RELEASE_GATE_RESULT, 'success');
  assert.equal(snapshot.STAGING_VERIFIED_AT, '2026-04-11T10:00:00Z');
  assert.equal(snapshot.STAGING_WINDOWS_BOOTSTRAP_RESULT, 'success');
  assert.equal(snapshot.STAGING_FIREFOX_EXTENSION_ID, 'openpath@example');
});
