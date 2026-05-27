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
    assert.equal(
      runHelper('staging_gate_results_file linux-bootstrap-gate'),
      '/tmp/linux-bootstrap-gate.env'
    );
    assert.equal(
      runHelper('staging_gate_results_file enrollment-download-gate'),
      '/tmp/staging-enrollment-download.env'
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
      'STAGING_WINDOWS_FIREFOX_HIGH_RISK',
      'STAGING_FIREFOX_RELEASE_ARTIFACTS',
      'STAGING_FIREFOX_EXTENSION_ID',
      'STAGING_FIREFOX_RELEASE_VERSION',
      'STAGING_FIREFOX_SIGNATURE_SOURCE',
      'STAGING_FIREFOX_SIGNATURE_STATE',
      'STAGING_FIREFOX_METADATA_SHA256',
      'STAGING_FIREFOX_XPI_SHA256',
    ]);
    assert.deepEqual(runHelper('staging_gate_state_fields windows-bootstrap-gate').split('\n'), [
      'STAGING_WINDOWS_BOOTSTRAP_RESULT',
      'STAGING_FIREFOX_POLICY_RESULT',
    ]);
    assert.deepEqual(runHelper('staging_gate_state_fields linux-bootstrap-gate').split('\n'), [
      'STAGING_LINUX_BOOTSTRAP_RESULT',
      'STAGING_LINUX_BOOTSTRAP_RUN_ID',
      'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID',
      'STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE',
      'STAGING_WINDOWS_SELF_UPDATE_RESULT',
      'STAGING_LINUX_SELF_UPDATE_RESULT',
      'STAGING_PREPROMOTION_REHEARSAL_RESULT',
    ]);
    assert.deepEqual(runHelper('staging_gate_state_fields enrollment-download-gate').split('\n'), [
      'STAGING_ENROLLMENT_DOWNLOAD_RESULT',
      'STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT',
      'STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT',
    ]);
  });

  test('staging smoke gate requires push notification readiness', () => {
    const result = spawnSync(
      'bash',
      [
        '-lc',
        [
          'source scripts/lib/staging-gates.sh',
          'resolve_target_address() { printf ""; }',
          'run_gate_command() { printf "%s\\n" "$@"; return 0; }',
          'run_staging_smoke_gate staging-host https://staging.classroompath.example.invalid',
        ].join('; '),
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^smoke$/m);
    assert.match(result.stdout, /^SMOKE_REQUIRE_PUSH=1$/m);
    assert.match(result.stdout, /^SMOKE_ALLOW_MUTATIONS=1$/m);
  });

  test('records fallback smoke status for direct-IP smoke targets', () => {
    const result = spawnSync(
      'bash',
      [
        '-lc',
        [
          'source scripts/lib/staging-gates.sh',
          'resolve_target_address() { printf ""; }',
          'run_gate_command() { return 0; }',
          'run_staging_smoke_gate staging-host http://192.168.1.114:3001',
          'printf "%s|%s" "$STAGING_SMOKE_RESULT" "$STAGING_SMOKE_STATUS"',
        ].join('; '),
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'success|PASS_WITH_FALLBACK');
  });

  test('runs enrollment download canary as a blocking staging gate', () => {
    const helper = readFileSync(helperPath, 'utf8');
    const runner = readFileSync(runnerPath, 'utf8');
    const bootstrapGate = readFileSync(windowsBootstrapGatePath, 'utf8');

    assert.match(helper, /run_staging_enrollment_download_gate\(\)/);
    assert.match(helper, /WINDOWS_BOOTSTRAP_GATE_ENROLLMENT_DOWNLOAD_OUTPUT=/);
    assert.match(helper, /STAGING_ENROLLMENT_DOWNLOAD_RESULT/);
    assert.match(helper, /STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT/);
    assert.match(helper, /STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT/);
    assert.match(runner, /run_staging_enrollment_download_gate/);
    assert.match(bootstrapGate, /runEnrollmentDownloadCanary/);
    assert.match(bootstrapGate, /WINDOWS_BOOTSTRAP_GATE_ENROLLMENT_DOWNLOAD_OUTPUT/);
  });

  test('prints compact staging canary failure boundary blocks', () => {
    const result = spawnSync(
      'bash',
      [
        '-lc',
        [
          'source scripts/lib/staging-gates.sh',
          "print_staging_canary_failure_boundary linux-bootstrap failure linux-install-openpath 'Linux enrollment script failed before AJAX canary.' 123456",
        ].join('; '),
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Staging canary failure boundary:/);
    assert.match(result.stderr, /canary: linux-bootstrap/);
    assert.match(result.stderr, /result: failure/);
    assert.match(result.stderr, /boundary: linux-install-openpath/);
    assert.match(result.stderr, /message: Linux enrollment script failed before AJAX canary\./);
    assert.match(result.stderr, /run: 123456/);
  });

  test('staging canary failure boundary blocks are one-line and redact credentials', () => {
    const result = spawnSync(
      'bash',
      [
        '-lc',
        [
          'source scripts/lib/staging-gates.sh',
          "print_staging_canary_failure_boundary '' failure '' 'failed with Bearer abc123 and token=secret-value\nsecond line' ''",
        ].join('; '),
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /canary: unknown/);
    assert.match(result.stderr, /boundary: unknown/);
    assert.match(
      result.stderr,
      /message: failed with Bearer \[redacted\] and token=\[redacted\] second line/
    );
    assert.match(result.stderr, /run: unknown/);
    assert.doesNotMatch(result.stderr, /abc123|secret-value/);
    assert.doesNotMatch(result.stderr, /message: .*\nsecond line/);
  });

  test('detects private LAN staging targets for hosted-gate routing', () => {
    const privateLanUrl = 'http://lan.local:3000';

    assert.equal(
      runHelper(`staging_gate_target_is_private_lan ${privateLanUrl} && printf private`),
      'private'
    );
    assert.equal(
      runHelper(
        'if staging_gate_target_is_private_lan https://classroompath.example.invalid; then printf private; else printf public; fi'
      ),
      'public'
    );
  });

  test('accepts explicit staging resolved address overrides before DNS fallback', () => {
    assert.equal(
      runHelper(
        'STAGING_RESOLVED_ADDRESS=192.168.1.114 resolve_target_address classroompath-staging.example.invalid 443'
      ),
      '192.168.1.114'
    );
    assert.equal(
      runHelper(
        'CLASSROOMPATH_STAGING_RESOLVED_ADDRESS=10.0.0.24 resolve_target_address classroompath-staging.example.invalid 443'
      ),
      '10.0.0.24'
    );
  });

  test('rejects invalid explicit staging resolved address overrides', () => {
    const result = spawnSync(
      'bash',
      [
        '-lc',
        [
          'source scripts/lib/staging-gates.sh',
          'STAGING_RESOLVED_ADDRESS=not-an-ip',
          'resolve_target_address classroompath-staging.example.invalid 443',
        ].join('; '),
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid staging resolved address override/);
    assert.doesNotMatch(result.stderr, /Target host does not resolve locally/);
  });

  test('skips hosted Linux bootstrap gate for LAN staging targets', () => {
    const privateLanUrl = 'http://lan.local:3000';
    const result = spawnSync(
      'bash',
      [
        '-lc',
        [
          `PRIVATE_LAN_URL=${privateLanUrl}`,
          'source scripts/lib/staging-gates.sh',
          'STAGING_REQUIRE_LIVE_WINDOWS_FIREFOX_EVIDENCE=1',
          'run_staging_linux_bootstrap_gate "$PRIVATE_LAN_URL"',
          'printf "%s|%s|%s" "$STAGING_LINUX_BOOTSTRAP_RESULT" "$STAGING_LINUX_BOOTSTRAP_RUN_ID" "$STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID"',
        ].join('; '),
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stderr,
      /Skipping Linux bootstrap gate because LAN staging is not reachable from GitHub-hosted runners/
    );
    assert.equal(result.stdout, 'skipped-lan-staging||skipped-lan-staging');
  });

  test('skips hosted Linux bootstrap gate for explicit LAN staging resolution', () => {
    const publicStagingUrl = 'https://classroompath-staging.example.invalid';
    const result = spawnSync(
      'bash',
      [
        '-lc',
        [
          `PUBLIC_STAGING_URL=${publicStagingUrl}`,
          'source scripts/lib/staging-gates.sh',
          'STAGING_REQUIRE_LIVE_WINDOWS_FIREFOX_EVIDENCE=1',
          'STAGING_RESOLVED_ADDRESS=192.168.1.114',
          'run_staging_linux_bootstrap_gate "$PUBLIC_STAGING_URL"',
          'printf "%s|%s|%s|%s" "$STAGING_LINUX_BOOTSTRAP_RESULT" "$STAGING_LINUX_BOOTSTRAP_RUN_ID" "$STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID" "$STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE"',
        ].join('; '),
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stderr,
      /Skipping Linux bootstrap gate because explicit LAN staging resolution is not reachable from GitHub-hosted runners/
    );
    assert.match(result.stdout, /^skipped-lan-staging\|\|skipped-lan-staging\|/);
    assert.match(result.stdout, /explicit LAN staging resolution/);
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
        content.includes('run_staging_windows_bootstrap_gate') &&
        content.includes('run_staging_enrollment_download_gate') &&
        content.includes('run_staging_linux_bootstrap_gate'),
      'run-staging-verification.sh should delegate smoke, release-gate, enrollment download, windows bootstrap, and linux bootstrap execution to the helper'
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
      'refresh teacher session',
      'poll onboarding status',
      'create classroom',
      'create enrollment ticket',
      'read bootstrap manifest',
      'download runtime policy spec',
      'download private Firefox metadata',
      'download private Firefox XPI',
      'download public Firefox XPI',
      'download enrollment scripts',
    ]) {
      assert.match(
        content,
        new RegExp(`timedBootstrapGateStep\\(\\s*'${stage}'`),
        `missing timed stage: ${stage}`
      );
    }

    assert.doesNotMatch(
      content,
      /timedBootstrapGateStep\(\s*'relogin teacher'/,
      'windows bootstrap gate should not use a second full login on the hot path'
    );
    assert.match(
      content,
      /timedBootstrapGateStep\(\s*'fallback relogin teacher'/,
      'windows bootstrap gate should keep the slower login path as explicit fallback evidence'
    );
  });
});
