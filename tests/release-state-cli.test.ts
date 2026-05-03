import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
const promotionEvidenceCliPath = resolve(projectRoot, 'scripts/promotion-evidence-cli.mjs');

function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  encoding: 'utf-8' | 'utf8' = 'utf-8'
): string {
  const executable = command === 'node' ? process.execPath : command;
  const result = spawnSync(executable, args, {
    cwd: projectRoot,
    encoding,
    env,
  });

  if (result.status !== 0) {
    throw (
      result.error ??
      new Error(result.stderr || `${executable} exited with code ${String(result.status)}`)
    );
  }

  if (result.error && result.error.code !== 'EPERM') {
    throw result.error;
  }

  return result.stdout;
}

test('release-state CLI writes shell-compatible snapshots through the typed contract', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'release-state-cli-write-'));
  const snapshotPath = join(tempDir, 'current-images.env');

  runCommand(
    'node',
    [cliPath, 'write-snapshot', '--snapshot-type', 'current-runtime', '--output', snapshotPath],
    {
      ...process.env,
      APP_SHA: 'abc123',
      IMAGE_SOURCE: 'release-candidate',
      CLASSROOMPATH_GATEWAY_IMAGE: 'ghcr.io/balejosg/classroompath-gateway:abc123',
      CLASSROOMPATH_MIGRATIONS_IMAGE: 'ghcr.io/balejosg/classroompath-migrations:abc123',
      OPENPATH_API_IMAGE: 'ghcr.io/balejosg/openpath-api:abc123',
      OPENPATH_VERSION: '4.1.19',
      OPENPATH_LINUX_AGENT_VERSION: '4.1.19',
      CLASSROOMPATH_SPA_IMAGE: 'ghcr.io/balejosg/classroompath-spa:abc123',
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
  const reportPath = join(tempDir, 'promotion-eligibility.json');

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
      'STAGING_EMAIL_PREFLIGHT_MODE=required',
      'STAGING_EMAIL_DELIVERY_HIGH_RISK=true',
      'STAGING_EMAIL_PREFLIGHT_RESULT=success',
      'STAGING_EMAIL_PREFLIGHT_PROVIDER=resend',
      'STAGING_SMOKE_RESULT=success',
      'STAGING_SMOKE_STATUS=PASS',
      'STAGING_RELEASE_GATE_RESULT=success',
      'STAGING_WINDOWS_BOOTSTRAP_RESULT=success',
      'STAGING_FIREFOX_POLICY_RESULT=success',
      'STAGING_FIREFOX_EXTENSION_ID=openpath@example',
      'STAGING_FIREFOX_RELEASE_VERSION=4.1.19',
      'STAGING_FIREFOX_METADATA_SHA256=meta123',
      'STAGING_FIREFOX_XPI_SHA256=xpi123',
      'STAGING_LINUX_BOOTSTRAP_RESULT=success',
      'STAGING_LINUX_BOOTSTRAP_RUN_ID=123456',
      'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID=none',
      'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE=Linux AJAX auto-allow canary completed successfully.',
      '',
    ].join('\n'),
    'utf-8'
  );

  runCommand(
    'node',
    [
      cliPath,
      'verify-staging',
      '--current',
      currentStatePath,
      '--verification',
      verificationStatePath,
      '--deployment-mode',
      'promotion-eligible',
      '--high-risk',
      'true',
      '--report-json',
      reportPath,
      '--github-output',
      outputPath,
    ],
    {
      ...process.env,
      EXPECTED_APP_SHA: 'abc123',
      EXPECTED_GATEWAY_IMAGE: 'ghcr.io/balejosg/classroompath-gateway:abc123',
      EXPECTED_MIGRATIONS_IMAGE: 'ghcr.io/balejosg/classroompath-migrations:abc123',
      EXPECTED_OPENPATH_API_IMAGE: 'ghcr.io/balejosg/openpath-api:abc123',
      EXPECTED_OPENPATH_VERSION: '4.1.19',
      EXPECTED_OPENPATH_LINUX_AGENT_VERSION: '4.1.19',
      EXPECTED_SPA_IMAGE: 'ghcr.io/balejosg/classroompath-spa:abc123',
    }
  );

  const outputs = readReleaseStateSnapshot(outputPath);
  const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as {
    eligible: boolean;
    deploymentMode: string;
    checks: {
      windowsFirefox: { status: string };
    };
  };

  assert.equal(outputs.promotion_eligible, 'true');
  assert.equal(outputs.promotion_deployment_mode, 'promotion-eligible');
  assert.equal(outputs.staging_smoke_result, 'success');
  assert.equal(outputs.staging_email_preflight_result, 'success');
  assert.equal(outputs.staging_email_preflight_mode, 'required');
  assert.equal(outputs.staging_firefox_release_version, '4.1.19');
  assert.equal(outputs.staging_linux_bootstrap_result, 'success');
  assert.equal(outputs.staging_verified_at, '2026-04-11T06:00:00Z');
  assert.equal(report.eligible, true);
  assert.equal(report.deploymentMode, 'promotion-eligible');
  assert.equal(report.checks.windowsFirefox.status, 'pass');
});

test('release-state CLI rejects high-risk promotion without Linux staging bootstrap evidence', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'release-state-cli-linux-gate-'));
  const currentStatePath = join(tempDir, 'staging-release-state.env');
  const verificationStatePath = join(tempDir, 'staging-verification.env');

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
      'STAGING_LINUX_BOOTSTRAP_RESULT=failure',
      'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID=firefox-extension-ready',
      '',
    ].join('\n'),
    'utf-8'
  );

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      'verify-staging',
      '--current',
      currentStatePath,
      '--verification',
      verificationStatePath,
      '--deployment-mode',
      'promotion-eligible',
      '--high-risk',
      'true',
    ],
    {
      cwd: projectRoot,
      encoding: 'utf-8',
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

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Linux bootstrap evidence is missing or failed/);
  assert.match(result.stderr, /firefox-extension-ready/);
});

test('verify-promotion-ready rejects pending staging verification for target SHA', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'release-state-cli-pending-'));
  const currentStatePath = join(tempDir, 'staging-release-state.env');
  const verificationStatePath = join(tempDir, 'staging-verification.env');

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
      'STAGING_VERIFICATION_STATE=pending',
      'STAGING_EXPECTED_APP_SHA=abc123',
      'STAGING_EXPECTED_OPENPATH_SHA=openpathsha',
      'STAGING_EXPECTED_IMAGE_SOURCE=release-candidate',
      'STAGING_VERIFICATION_STARTED_AT=2026-04-11T06:00:00Z',
      'STAGING_VERIFIED_APP_SHA=',
      'STAGING_SMOKE_RESULT=pending',
      'STAGING_RELEASE_GATE_RESULT=pending',
      '',
    ].join('\n'),
    'utf-8'
  );

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      'verify-promotion-ready',
      '--current',
      currentStatePath,
      '--verification',
      verificationStatePath,
    ],
    {
      cwd: projectRoot,
      encoding: 'utf-8',
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

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Staging verification for abc123 is pending or failed; expected successful evidence for abc123/
  );
});

test('promotion evidence CLI embeds and extracts staging evidence from annotated tag messages', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'promotion-evidence-cli-'));
  const currentStatePath = join(tempDir, 'current-images.env');
  const verificationStatePath = join(tempDir, 'staging-verification.env');
  const tagMessagePath = join(tempDir, 'tag-message.txt');
  const extractedCurrentPath = join(tempDir, 'extracted-current-images.env');
  const extractedVerificationPath = join(tempDir, 'extracted-staging-verification.env');

  const currentStateText = [
    'APP_SHA=abc123',
    'IMAGE_SOURCE=release-candidate',
    'CLASSROOMPATH_GATEWAY_IMAGE=ghcr.io/balejosg/classroompath-gateway:abc123',
    '',
  ].join('\n');
  const verificationStateText = [
    'STAGING_VERIFIED_AT=2026-04-11T06:00:00Z',
    'STAGING_VERIFIED_APP_SHA=abc123',
    'STAGING_SMOKE_STATUS=PASS',
    '',
  ].join('\n');

  writeFileSync(currentStatePath, currentStateText, 'utf-8');
  writeFileSync(verificationStatePath, verificationStateText, 'utf-8');

  runCommand(
    'node',
    [
      promotionEvidenceCliPath,
      'write-tag-message',
      '--tag',
      'v1.2.131',
      '--commit',
      'abc123',
      '--staging-current',
      currentStatePath,
      '--staging-verification',
      verificationStatePath,
      '--output',
      tagMessagePath,
    ],
    { ...process.env }
  );

  const tagMessage = readFileSync(tagMessagePath, 'utf-8');
  assert.match(tagMessage, /CLASSROOMPATH_PROMOTION_EVIDENCE_V1_BEGIN/);
  assert.match(tagMessage, /staging-current-images.env.base64=/);
  assert.match(tagMessage, /staging-verification.env.base64=/);

  runCommand(
    'node',
    [
      promotionEvidenceCliPath,
      'extract-tag-message',
      '--message-file',
      tagMessagePath,
      '--staging-current-output',
      extractedCurrentPath,
      '--staging-verification-output',
      extractedVerificationPath,
    ],
    { ...process.env }
  );

  assert.equal(readFileSync(extractedCurrentPath, 'utf-8'), currentStateText);
  assert.equal(readFileSync(extractedVerificationPath, 'utf-8'), verificationStateText);
});

test('promotion evidence CLI rejects unknown options through the shared parser', () => {
  const result = spawnSync(
    process.execPath,
    [promotionEvidenceCliPath, 'write-tag-message', '--unexpected', 'value'],
    {
      cwd: projectRoot,
      encoding: 'utf-8',
      env: { ...process.env },
    }
  );

  assert.equal(result.status, 1);
  if (result.error?.code === 'EPERM') {
    return;
  }
  assert.match(result.stderr, /Unknown argument: --unexpected/);
});

test('release-state CLI lists canonical snapshot fields for shell consumers', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'release-state-cli-fields-'));
  const outputPath = join(tempDir, 'fields.txt');

  runCommand(
    'bash',
    [
      '-lc',
      `node "${cliPath}" list-fields --snapshot-type staging-verification-run > "${outputPath}"`,
    ],
    { ...process.env }
  );
  const output = readFileSync(outputPath, 'utf-8');

  assert.deepEqual(output.trim().split('\n'), [
    'SMOKE_TARGET_URL',
    'SMOKE_SKIP_CORS',
    'STAGING_SMOKE_RESULT',
    'STAGING_SMOKE_STATUS',
    'RELEASE_GATE_TARGET_URL',
    'RELEASE_GATE_EXPECTED_ORIGIN',
    'STAGING_RELEASE_GATE_RESULT',
    'STAGING_VERIFIED_AT',
    'STAGING_EMAIL_PREFLIGHT_MODE',
    'STAGING_EMAIL_DELIVERY_HIGH_RISK',
    'STAGING_EMAIL_PREFLIGHT_RESULT',
    'STAGING_EMAIL_PREFLIGHT_PROVIDER',
    'STAGING_WINDOWS_FIREFOX_HIGH_RISK',
    'STAGING_FIREFOX_RELEASE_ARTIFACTS',
    'STAGING_WINDOWS_BOOTSTRAP_RESULT',
    'STAGING_FIREFOX_POLICY_RESULT',
    'STAGING_FIREFOX_EXTENSION_ID',
    'STAGING_FIREFOX_RELEASE_VERSION',
    'STAGING_FIREFOX_METADATA_SHA256',
    'STAGING_FIREFOX_XPI_SHA256',
    'STAGING_LINUX_BOOTSTRAP_RESULT',
    'STAGING_LINUX_BOOTSTRAP_RUN_ID',
    'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID',
    'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE',
  ]);
});

test('canonical shell release-state helper serializes snapshots through the typed contract', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'release-state-shell-write-'));
  const snapshotPath = join(tempDir, 'staging-verification.env');

  runCommand(
    'bash',
    [
      '-lc',
      [
        'source scripts/lib/common.sh',
        'source scripts/lib/release-state.sh',
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
        'STAGING_EMAIL_PREFLIGHT_MODE=skip',
        'STAGING_EMAIL_DELIVERY_HIGH_RISK=false',
        'STAGING_EMAIL_PREFLIGHT_RESULT=skipped-low-risk',
        'STAGING_EMAIL_PREFLIGHT_PROVIDER=skipped',
        'STAGING_WINDOWS_FIREFOX_HIGH_RISK=true',
        'STAGING_SMOKE_RESULT=success',
        'STAGING_SMOKE_STATUS=PASS',
        'STAGING_RELEASE_GATE_RESULT=success',
        'STAGING_WINDOWS_BOOTSTRAP_RESULT=success',
        'STAGING_FIREFOX_POLICY_RESULT=success',
        'STAGING_FIREFOX_EXTENSION_ID=openpath@example',
        'STAGING_FIREFOX_RELEASE_VERSION=4.1.19',
        'STAGING_FIREFOX_METADATA_SHA256=meta123',
        'STAGING_FIREFOX_XPI_SHA256=xpi123',
        'STAGING_LINUX_BOOTSTRAP_RESULT=skipped-low-risk',
        'STAGING_LINUX_BOOTSTRAP_RUN_ID=',
        'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID=skipped-low-risk',
        'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE=Linux bootstrap gate skipped for low-risk staging deploy.',
        `write_release_state_snapshot staging-verification ${snapshotPath}`,
      ].join('; '),
    ],
    { ...process.env }
  );

  const snapshot = readReleaseStateSnapshot(snapshotPath);
  assert.equal(snapshot.STAGING_VERIFIED_APP_SHA, 'abc123');
  assert.equal(snapshot.STAGING_EMAIL_PREFLIGHT_RESULT, 'skipped-low-risk');
  assert.equal(snapshot.STAGING_WINDOWS_FIREFOX_HIGH_RISK, 'true');
  assert.equal(snapshot.STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION, '4.1.19');
  assert.equal(snapshot.STAGING_FIREFOX_XPI_SHA256, 'xpi123');
});

test('canonical shell release-state helper serializes pending staging verification intent', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'release-state-shell-pending-'));
  const snapshotPath = join(tempDir, 'staging-verification.env');

  runCommand(
    'bash',
    [
      '-lc',
      [
        'source scripts/lib/common.sh',
        'source scripts/lib/release-state.sh',
        `write_staging_verification_pending_state ${snapshotPath} abc123 openpathsha release-candidate`,
      ].join('; '),
    ],
    { ...process.env }
  );

  const snapshot = readReleaseStateSnapshot(snapshotPath);
  assert.equal(snapshot.STAGING_VERIFICATION_STATE, 'pending');
  assert.equal(snapshot.STAGING_EXPECTED_APP_SHA, 'abc123');
  assert.equal(snapshot.STAGING_EXPECTED_OPENPATH_SHA, 'openpathsha');
  assert.equal(snapshot.STAGING_EXPECTED_IMAGE_SOURCE, 'release-candidate');
  assert.match(snapshot.STAGING_VERIFICATION_STARTED_AT ?? '', /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(snapshot.STAGING_VERIFIED_APP_SHA, '');
  assert.equal(snapshot.STAGING_SMOKE_RESULT, 'pending');
  assert.equal(snapshot.STAGING_RELEASE_GATE_RESULT, 'pending');
  assert.equal(snapshot.STAGING_WINDOWS_BOOTSTRAP_RESULT, 'pending');
  assert.equal(snapshot.STAGING_LINUX_BOOTSTRAP_RESULT, 'pending');
});

test('bash release-state helpers preserve shell-only staging verification values when delegating to the typed CLI', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'release-state-shell-helper-'));
  const snapshotPath = join(tempDir, 'staging-verification-run.env');

  runCommand(
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
        'STAGING_EMAIL_PREFLIGHT_MODE=skip',
        'STAGING_EMAIL_DELIVERY_HIGH_RISK=false',
        'STAGING_EMAIL_PREFLIGHT_RESULT=skipped-low-risk',
        'STAGING_EMAIL_PREFLIGHT_PROVIDER=skipped',
        'STAGING_WINDOWS_FIREFOX_HIGH_RISK=false',
        'STAGING_FIREFOX_RELEASE_ARTIFACTS=present',
        'STAGING_WINDOWS_BOOTSTRAP_RESULT=success',
        'STAGING_FIREFOX_POLICY_RESULT=success',
        'STAGING_FIREFOX_EXTENSION_ID=openpath@example',
        'STAGING_FIREFOX_RELEASE_VERSION=4.1.19',
        'STAGING_FIREFOX_METADATA_SHA256=meta123',
        'STAGING_FIREFOX_XPI_SHA256=xpi123',
        'STAGING_LINUX_BOOTSTRAP_RESULT=skipped-low-risk',
        'STAGING_LINUX_BOOTSTRAP_RUN_ID=',
        'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID=skipped-low-risk',
        'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE=Linux bootstrap gate skipped for low-risk staging deploy.',
        `write_staging_verification_run_state ${snapshotPath}`,
      ].join('; '),
    ],
    { ...process.env }
  );

  const snapshot = readReleaseStateSnapshot(snapshotPath);
  assert.equal(snapshot.STAGING_SMOKE_RESULT, 'success');
  assert.equal(snapshot.STAGING_RELEASE_GATE_RESULT, 'success');
  assert.equal(snapshot.STAGING_EMAIL_PREFLIGHT_RESULT, 'skipped-low-risk');
  assert.equal(snapshot.STAGING_WINDOWS_FIREFOX_HIGH_RISK, 'false');
  assert.equal(snapshot.STAGING_VERIFIED_AT, '2026-04-11T10:00:00Z');
  assert.equal(snapshot.STAGING_WINDOWS_BOOTSTRAP_RESULT, 'success');
  assert.equal(snapshot.STAGING_FIREFOX_EXTENSION_ID, 'openpath@example');
});
