import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  classifyPrepromotionRequirement,
  readStagingVerificationEnv,
  verifyWindowsAjaxArtifact,
} from '../scripts/lib/prepromotion-runner-rehearsal.mjs';
import {
  buildWindowsPrepromotionPersistEnv,
  buildPrepromotionProcessEnv,
  resolveWindowsPrepromotionRequirement,
  runAndPersistWindowsPrepromotionEvidence,
} from '../scripts/lib/prepromotion-windows-evidence.mjs';

const tempDirs: string[] = [];
const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');
const cliPath = resolve(projectRoot, 'scripts/prepromotion-runner-rehearsal.mjs');

function createTempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeText(filePath: string, text: string) {
  writeFileSync(filePath, text, 'utf8');
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeStagingVerification(
  filePath: string,
  highRisk: 'true' | 'false',
  overrides: Record<string, string> = {}
) {
  const fields = {
    STAGING_VERIFIED_AT: '2026-04-30T10:00:00Z',
    STAGING_SMOKE_RESULT: 'success',
    STAGING_RELEASE_GATE_RESULT: 'success',
    STAGING_VERIFIED_APP_SHA: 'abc123',
    STAGING_WINDOWS_FIREFOX_HIGH_RISK: highRisk,
    STAGING_WINDOWS_BOOTSTRAP_RESULT: 'success',
    STAGING_FIREFOX_POLICY_RESULT: 'success',
    STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT: 'success',
    STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA: 'abc123',
    STAGING_WINDOWS_BOOTSTRAP_CANARY_RUN_ID: '123456789',
    STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID: 'none',
    STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_MESSAGE:
      'Windows page-resource observation completed without automatic rule creation and explicit allowlist probes succeeded.',
    STAGING_LINUX_BOOTSTRAP_RESULT: 'success',
    ...overrides,
  };
  writeText(
    filePath,
    `${Object.entries(fields)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`
  );
}

function writeWindowsAjaxArtifact(filePath: string, overrides: Record<string, unknown> = {}) {
  writeJson(filePath, {
    success: true,
    failureBoundary: { id: 'none', message: 'success' },
    diagnosticPhases: [
      { id: 'firefox-extension-ready', status: 'passed' },
      { id: 'external-allowlisted-navigation', status: 'passed' },
      { id: 'artifact-written', status: 'passed' },
    ],
    allowlistedNavigation: {
      url: 'https://example.com/',
      expectedHosts: ['example.com'],
      finalHost: 'example.com',
      href: 'https://example.com/',
      title: 'Example Domain',
      success: true,
      blockedByOpenPath: false,
      timedOut: false,
      errors: [],
    },
    redditDiagnostics: {
      page: {
        completedRedditDiagnosticEvents: {
          'reddit-emoji-image': true,
          'reddit-external-preview-image': true,
          'reddit-i-image': true,
          'reddit-stylesheet': true,
          'reddit-static-script': true,
        },
      },
      whitelist: {
        global: {
          containsExpectedHosts: {
            'emoji.redditmedia.com': true,
            'external-preview.redd.it': true,
            'i.redd.it': true,
            'styles.redditmedia.com': true,
            'www.redditstatic.com': true,
          },
        },
        native: {
          containsExpectedHosts: {
            'emoji.redditmedia.com': true,
            'external-preview.redd.it': true,
            'i.redd.it': true,
            'styles.redditmedia.com': true,
            'www.redditstatic.com': true,
          },
        },
      },
    },
    ...overrides,
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('prepromotion runner rehearsal', () => {
  test('reads staging verification evidence from the shell snapshot', () => {
    const tempDir = createTempDir('classroompath-prepromotion-env-');
    const stagingVerificationPath = resolve(tempDir, 'staging-verification.env');
    writeStagingVerification(stagingVerificationPath, 'true');

    const stagingVerification = readStagingVerificationEnv(stagingVerificationPath);

    assert.equal(stagingVerification.STAGING_WINDOWS_FIREFOX_HIGH_RISK, 'true');
    assert.equal(stagingVerification.STAGING_WINDOWS_BOOTSTRAP_RESULT, 'success');
  });

  test('returns not_required when staging evidence says Windows Firefox risk is false', () => {
    const tempDir = createTempDir('classroompath-prepromotion-not-required-');
    const stagingVerificationPath = resolve(tempDir, 'staging-verification.env');
    writeStagingVerification(stagingVerificationPath, 'false');

    const result = classifyPrepromotionRequirement({
      artifactPath: resolve(tempDir, 'production-windows-ajax-auto-allow-canary.json'),
      stagingVerification: readStagingVerificationEnv(stagingVerificationPath),
    });

    assert.equal(result.state, 'not_required');
    assert.equal(result.missingHosts.length, 0);
  });

  test('returns passed when current high-risk staging evidence is present and no artifact exists', () => {
    const tempDir = createTempDir('classroompath-prepromotion-required-');
    const stagingVerificationPath = resolve(tempDir, 'staging-verification.env');
    writeStagingVerification(stagingVerificationPath, 'true');

    const result = classifyPrepromotionRequirement({
      artifactPath: resolve(tempDir, 'production-windows-ajax-auto-allow-canary.json'),
      stagingVerification: readStagingVerificationEnv(stagingVerificationPath),
    });

    assert.equal(result.state, 'passed');
    assert.match(result.reason, /preproduction runner evidence passed/i);
  });

  test('diagnoses missing Windows canary result with the direct diagnostic command', () => {
    const tempDir = createTempDir('classroompath-prepromotion-missing-canary-result-');
    const stagingVerificationPath = resolve(tempDir, 'staging-verification.env');
    writeStagingVerification(stagingVerificationPath, 'true', {
      STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT: '',
    });

    const result = resolveWindowsPrepromotionRequirement({
      artifactDir: '',
      openpathRoot: '',
      stagingVerification: readStagingVerificationEnv(stagingVerificationPath),
    });

    assert.equal(result.required, true);
    assert.equal(result.state, 'failed');
    assert.match(result.reason, /STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT/);
    assert.equal(
      result.command,
      'npm run diagnostics:windows-ajax:direct -- --environment staging'
    );
  });

  test('loads local staging SSH config for prepromotion persistence without overriding exports', () => {
    const tempDir = createTempDir('classroompath-prepromotion-env-local-');
    writeText(
      resolve(tempDir, '.env.local'),
      [
        'STAGING_HOST=192.168.1.114',
        'STAGING_SSH_KEY=~/.ssh/classroompath_staging',
        'EXPORTED_VALUE=from-file',
        '',
      ].join('\n')
    );

    const env = buildPrepromotionProcessEnv({
      cwd: tempDir,
      env: { EXPORTED_VALUE: 'from-process' },
    });

    assert.equal(env.STAGING_HOST, '192.168.1.114');
    assert.equal(env.STAGING_SSH_KEY, '~/.ssh/classroompath_staging');
    assert.equal(env.EXPORTED_VALUE, 'from-process');
  });

  test('adds prepromotion rehearsal success only for successful canary evidence on the staged SHA', () => {
    const persistEnv = buildWindowsPrepromotionPersistEnv({
      artifact: {
        success: true,
        failureBoundary: { id: 'none', message: 'success' },
      },
      appSha: 'abc123',
      targetSha: 'abc123',
      stagingVerification: { STAGING_VERIFIED_APP_SHA: 'abc123' },
      runId: 'direct-staging-test',
      env: {},
    });

    assert.equal(persistEnv.STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT, 'success');
    assert.equal(persistEnv.STAGING_WINDOWS_BOOTSTRAP_CANARY_APP_SHA, 'abc123');
    assert.equal(persistEnv.STAGING_PREPROMOTION_REHEARSAL_RESULT, 'success');
  });

  test('does not add prepromotion rehearsal success when canary evidence failed', () => {
    const persistEnv = buildWindowsPrepromotionPersistEnv({
      artifact: {
        success: false,
        failureBoundary: { id: 'firefox-extension-ready', message: 'failed' },
      },
      appSha: 'abc123',
      targetSha: 'abc123',
      stagingVerification: { STAGING_VERIFIED_APP_SHA: 'abc123' },
      runId: 'direct-staging-test',
      env: {},
    });

    assert.equal(persistEnv.STAGING_WINDOWS_BOOTSTRAP_CANARY_RESULT, 'failed');
    assert.equal(
      persistEnv.STAGING_WINDOWS_BOOTSTRAP_CANARY_FAILURE_BOUNDARY_ID,
      'firefox-extension-ready'
    );
    assert.equal('STAGING_PREPROMOTION_REHEARSAL_RESULT' in persistEnv, false);
  });

  test('refuses to persist prepromotion success when target SHA mismatches staging', () => {
    assert.throws(
      () =>
        buildWindowsPrepromotionPersistEnv({
          artifact: {
            success: true,
            failureBoundary: { id: 'none', message: 'success' },
          },
          appSha: 'new-sha',
          targetSha: 'new-sha',
          stagingVerification: { STAGING_VERIFIED_APP_SHA: 'old-sha' },
          env: {},
        }),
      /does not match staging verification SHA/
    );
  });

  test('run-and-persist passes rehearsal success through the existing canary persistence env', () => {
    const tempDir = createTempDir('classroompath-prepromotion-persist-');
    const artifactPath = resolve(tempDir, 'production-windows-ajax-auto-allow-canary.json');
    writeWindowsAjaxArtifact(artifactPath);
    const calls: Array<{ command: string; args: string[]; env?: Record<string, string> }> = [];

    const result = runAndPersistWindowsPrepromotionEvidence({
      artifactDir: tempDir,
      openpathRoot: '',
      targetSha: 'abc123',
      stagingVerification: { STAGING_VERIFIED_APP_SHA: 'abc123' },
      env: { STAGING_SSH_KEY: '/tmp/classroompath_staging_key' },
      cwd: projectRoot,
      spawnCommand(command, args, options) {
        calls.push({ command, args, env: options?.env });
        return { status: 0 };
      },
    });

    assert.equal(result.persisted.STAGING_PREPROMOTION_REHEARSAL_RESULT, 'success');
    assert.equal(calls.length, 3);
    assert.equal(calls[1].command, 'bash');
    assert.equal(calls[1].env?.STAGING_PREPROMOTION_REHEARSAL_RESULT, 'success');
    assert.equal(calls[2].command, 'ssh');
    assert.equal(calls[2].args.includes('/tmp/classroompath_staging_key'), true);
  });

  test('accepts LAN staging Linux bootstrap skip with the matching boundary', () => {
    const tempDir = createTempDir('classroompath-prepromotion-linux-lan-skip-');
    const stagingVerificationPath = resolve(tempDir, 'staging-verification.env');
    writeStagingVerification(stagingVerificationPath, 'true', {
      STAGING_LINUX_BOOTSTRAP_RESULT: 'skipped-lan-staging',
      STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID: 'skipped-lan-staging',
    });

    const result = classifyPrepromotionRequirement({
      artifactPath: resolve(tempDir, 'production-windows-ajax-auto-allow-canary.json'),
      stagingVerification: readStagingVerificationEnv(stagingVerificationPath),
    });

    assert.equal(result.state, 'passed');
    assert.match(result.reason, /preproduction runner evidence passed/i);
  });

  test('rejects LAN staging Linux bootstrap skip without the matching boundary', () => {
    const tempDir = createTempDir('classroompath-prepromotion-linux-lan-boundary-');
    const stagingVerificationPath = resolve(tempDir, 'staging-verification.env');
    writeStagingVerification(stagingVerificationPath, 'true', {
      STAGING_LINUX_BOOTSTRAP_RESULT: 'skipped-lan-staging',
      STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID: 'different-boundary',
    });

    const result = classifyPrepromotionRequirement({
      artifactPath: resolve(tempDir, 'production-windows-ajax-auto-allow-canary.json'),
      stagingVerification: readStagingVerificationEnv(stagingVerificationPath),
    });

    assert.equal(result.state, 'failed');
    assert.match(result.reason, /STAGING_LINUX_BOOTSTRAP_RESULT=skipped-lan-staging/);
    assert.match(result.reason, /STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID=different-boundary/);
  });

  test('does not require self-update or persisted prepromotion results yet', () => {
    const tempDir = createTempDir('classroompath-prepromotion-optional-future-fields-');
    const stagingVerificationPath = resolve(tempDir, 'staging-verification.env');
    writeStagingVerification(stagingVerificationPath, 'true', {
      STAGING_WINDOWS_SELF_UPDATE_RESULT: 'failed',
      STAGING_LINUX_SELF_UPDATE_RESULT: 'missing',
      STAGING_PREPROMOTION_REHEARSAL_RESULT: '',
    });

    const result = classifyPrepromotionRequirement({
      artifactPath: resolve(tempDir, 'production-windows-ajax-auto-allow-canary.json'),
      stagingVerification: readStagingVerificationEnv(stagingVerificationPath),
    });

    assert.equal(result.state, 'passed');
  });

  test('returns passed when the artifact proves failureBoundary none and every expected host', () => {
    const tempDir = createTempDir('classroompath-prepromotion-passed-');
    const artifactPath = resolve(tempDir, 'production-windows-ajax-auto-allow-canary.json');

    writeWindowsAjaxArtifact(artifactPath);

    const result = verifyWindowsAjaxArtifact({ artifactPath });

    assert.equal(result.state, 'passed');
    assert.deepEqual(result.missingHosts, []);
  });

  test('returns failed when an expected host is missing from the artifact evidence', () => {
    const tempDir = createTempDir('classroompath-prepromotion-missing-host-');
    const artifactPath = resolve(tempDir, 'production-windows-ajax-auto-allow-canary.json');

    writeWindowsAjaxArtifact(artifactPath, {
      redditDiagnostics: {
        page: {
          completedRedditDiagnosticEvents: {
            'reddit-emoji-image': true,
            'reddit-external-preview-image': true,
            'reddit-i-image': true,
            'reddit-stylesheet': true,
            'reddit-static-script': false,
          },
        },
        whitelist: {
          global: {
            containsExpectedHosts: {
              'emoji.redditmedia.com': true,
              'external-preview.redd.it': true,
              'i.redd.it': true,
              'styles.redditmedia.com': true,
              'www.redditstatic.com': false,
            },
          },
          native: {
            containsExpectedHosts: {
              'emoji.redditmedia.com': true,
              'external-preview.redd.it': true,
              'i.redd.it': true,
              'styles.redditmedia.com': true,
              'www.redditstatic.com': false,
            },
          },
        },
      },
    });

    const result = verifyWindowsAjaxArtifact({ artifactPath });

    assert.equal(result.state, 'failed');
    assert.deepEqual(result.missingHosts, ['www.redditstatic.com']);
  });

  test('returns failed when external allowlisted navigation evidence is missing', () => {
    const tempDir = createTempDir('classroompath-prepromotion-missing-navigation-');
    const artifactPath = resolve(tempDir, 'production-windows-ajax-auto-allow-canary.json');

    writeWindowsAjaxArtifact(artifactPath, {
      allowlistedNavigation: null,
      diagnosticPhases: [
        { id: 'firefox-extension-ready', status: 'passed' },
        { id: 'external-allowlisted-navigation', status: 'pending' },
        { id: 'artifact-written', status: 'passed' },
      ],
    });

    const result = verifyWindowsAjaxArtifact({ artifactPath });

    assert.equal(result.state, 'failed');
    assert.match(result.reason, /external allowlisted navigation/i);
  });

  test('returns failed when external allowlisted navigation was blocked', () => {
    const tempDir = createTempDir('classroompath-prepromotion-blocked-navigation-');
    const artifactPath = resolve(tempDir, 'production-windows-ajax-auto-allow-canary.json');

    writeWindowsAjaxArtifact(artifactPath, {
      allowlistedNavigation: {
        url: 'https://example.com/',
        expectedHosts: ['example.com'],
        finalHost: 'example.com',
        href: 'https://example.com/',
        success: false,
        blockedByOpenPath: true,
        timedOut: false,
        errors: [],
      },
    });

    const result = verifyWindowsAjaxArtifact({ artifactPath });

    assert.equal(result.state, 'failed');
    assert.match(result.reason, /external allowlisted navigation/i);
  });

  test('returns failed when failureBoundary is not none', () => {
    const tempDir = createTempDir('classroompath-prepromotion-boundary-');
    const artifactPath = resolve(tempDir, 'production-windows-ajax-auto-allow-canary.json');

    writeWindowsAjaxArtifact(artifactPath, {
      failureBoundary: { id: 'page-resource-candidates', message: 'missing page evidence' },
    });

    const result = verifyWindowsAjaxArtifact({ artifactPath });

    assert.equal(result.state, 'failed');
    assert.match(result.reason, /failureBoundary/i);
  });

  test('returns failed when staging verification omits the risk field', () => {
    const tempDir = createTempDir('classroompath-prepromotion-missing-risk-');
    const stagingVerificationPath = resolve(tempDir, 'staging-verification.env');
    writeText(
      stagingVerificationPath,
      ['STAGING_VERIFIED_AT=2026-04-30T10:00:00Z', 'STAGING_SMOKE_RESULT=success', ''].join('\n')
    );

    const result = classifyPrepromotionRequirement({
      artifactPath: resolve(tempDir, 'production-windows-ajax-auto-allow-canary.json'),
      stagingVerification: readStagingVerificationEnv(stagingVerificationPath),
    });

    assert.equal(result.state, 'failed');
    assert.match(result.reason, /STAGING_WINDOWS_FIREFOX_HIGH_RISK/);
  });

  test('returns failed when staging verification has ambiguous risk evidence', () => {
    const tempDir = createTempDir('classroompath-prepromotion-unknown-risk-');
    const stagingVerificationPath = resolve(tempDir, 'staging-verification.env');
    writeText(
      stagingVerificationPath,
      [
        'STAGING_VERIFIED_AT=2026-04-30T10:00:00Z',
        'STAGING_WINDOWS_FIREFOX_HIGH_RISK=unknown',
        '',
      ].join('\n')
    );

    const result = classifyPrepromotionRequirement({
      artifactPath: resolve(tempDir, 'production-windows-ajax-auto-allow-canary.json'),
      stagingVerification: readStagingVerificationEnv(stagingVerificationPath),
    });

    assert.equal(result.state, 'failed');
    assert.match(result.reason, /must be true or false/);
  });

  test('CLI plan prints the direct runner command when rehearsal is required', () => {
    const tempDir = createTempDir('classroompath-prepromotion-cli-plan-');
    const stagingVerificationPath = resolve(tempDir, 'staging-verification.env');
    writeStagingVerification(stagingVerificationPath, 'true');

    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        'plan',
        '--staging-verification',
        stagingVerificationPath,
        '--artifact-dir',
        tempDir,
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /state=passed/);
    assert.doesNotMatch(result.stdout, /npm run diagnostics:windows-ajax:direct/);
  });

  test('CLI selective plan prints path-aware recommendations without staging evidence', () => {
    const tempDir = createTempDir('classroompath-prepromotion-selective-plan-');
    const changedFilesPath = resolve(tempDir, 'changed-files.txt');
    writeText(changedFilesPath, 'linux/lib/runtime-cli-system.sh\n');

    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        'plan',
        '--staging-verification',
        resolve(tempDir, 'missing-staging-verification.env'),
        '--changed-files',
        changedFilesPath,
        '--target-sha',
        'abc1234',
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Prepromotion runner rehearsal plan for abc1234/);
    assert.match(result.stdout, /linux\/lib\/runtime-cli-system\.sh -> linux-bootstrap/);
    assert.match(
      result.stdout,
      /scripts\/validate-hypothesis\.sh classroompath linux-ajax-gh --integration/
    );
    assert.match(result.stdout, /Required before promotion: yes/);
  });

  test('CLI selective plan does not require rehearsal for ClassroomPath docs-only changes', () => {
    const tempDir = createTempDir('classroompath-prepromotion-selective-noop-');
    const changedFilesPath = resolve(tempDir, 'changed-files.txt');
    writeText(changedFilesPath, 'docs/runbooks/deploy-production.md\n');

    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        'plan',
        '--staging-verification',
        resolve(tempDir, 'missing-staging-verification.env'),
        '--changed-files',
        changedFilesPath,
        '--target-sha',
        'abc1234',
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Recommended lanes:\n  - \(none\)/);
    assert.match(result.stdout, /Required before promotion: no/);
    assert.match(result.stdout, /Reason: no OpenPath platform-sensitive files changed/);
  });

  test('CLI plan preserves artifact paths with spaces in the result summary', () => {
    const tempDir = createTempDir('classroompath prepromotion cli quote ');
    const stagingVerificationPath = resolve(tempDir, 'staging-verification.env');
    writeStagingVerification(stagingVerificationPath, 'true');

    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        'plan',
        '--staging-verification',
        stagingVerificationPath,
        '--artifact-dir',
        tempDir,
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /artifact_path=\/tmp\/classroompath prepromotion cli quote/);
  });

  test('CLI verify passes from current staging evidence without requiring its own artifact', () => {
    const tempDir = createTempDir('classroompath-prepromotion-cli-verify-');
    const stagingVerificationPath = resolve(tempDir, 'staging-verification.env');
    writeStagingVerification(stagingVerificationPath, 'true');

    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        'verify',
        '--staging-verification',
        stagingVerificationPath,
        '--artifact-dir',
        tempDir,
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /state=passed/);
  });
});
