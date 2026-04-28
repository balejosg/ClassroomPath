import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readProjectJson, readProjectText } from './helpers/ops-contracts.ts';

type PackageDefinition = {
  scripts?: Record<string, string>;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');
const scriptPath = resolve(projectRoot, 'scripts/run-runner-diagnostic.mjs');
const directScriptPath = resolve(projectRoot, 'scripts/run-windows-ajax-direct.mjs');
const linuxStudentDirectScriptPath = resolve(
  projectRoot,
  'scripts/run-linux-student-diagnostic.mjs'
);
const linuxAjaxDirectScriptPath = resolve(projectRoot, 'scripts/run-linux-ajax-direct.mjs');

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

function runDirectDiagnostic(args: string[]) {
  return spawnSync(process.execPath, [directScriptPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      WINDOWS_AJAX_DIRECT_DRY_RUN: '1',
    },
  });
}

function runLinuxStudentDirectDiagnostic(args: string[]) {
  return spawnSync(process.execPath, [linuxStudentDirectScriptPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      LINUX_STUDENT_DIRECT_DRY_RUN: '1',
    },
  });
}

function runLinuxAjaxDirectDiagnostic(args: string[]) {
  return spawnSync(process.execPath, [linuxAjaxDirectScriptPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      LINUX_AJAX_DIRECT_DRY_RUN: '1',
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

  test('package.json exposes the direct Windows AJAX runner diagnostic', () => {
    const packageJson = readProjectJson<PackageDefinition>('package.json');

    assert.equal(
      packageJson.scripts?.['diagnostics:windows-ajax:direct'],
      'node scripts/run-windows-ajax-direct.mjs'
    );
  });

  test('package.json exposes the direct Linux student-policy diagnostic', () => {
    const packageJson = readProjectJson<PackageDefinition>('package.json');

    assert.equal(
      packageJson.scripts?.['diagnostics:linux-student:direct'],
      'node scripts/run-linux-student-diagnostic.mjs'
    );
  });

  test('package.json exposes the direct Linux AJAX runner diagnostic', () => {
    const packageJson = readProjectJson<PackageDefinition>('package.json');

    assert.equal(
      packageJson.scripts?.['diagnostics:linux-ajax:direct'],
      'node scripts/run-linux-ajax-direct.mjs'
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

  test('dispatches the Linux bootstrap AJAX diagnostic against staging', () => {
    const result = runDiagnostic([
      '--suite',
      'linux-bootstrap-ajax',
      '--wait',
      '--download-artifacts',
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /gh workflow run linux-production-bootstrap-canary\.yml/);
    assert.match(result.stdout, /--repo balejosg\/ClassroomPath/);
    assert.match(result.stdout, /-f target_environment=staging/);
    assert.match(result.stdout, /-f diagnostic_mode=true/);
    assert.match(result.stdout, /gh run watch/);
    assert.match(result.stdout, /gh run download/);
  });

  test('collects runner evidence when watch and artifact download fail', () => {
    const result = spawnSync(
      process.execPath,
      [scriptPath, '--suite', 'linux-bootstrap-ajax', '--wait', '--download-artifacts'],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          RUNNER_DIAGNOSTIC_DRY_RUN: '1',
          RUNNER_DIAGNOSTIC_FAKE_WATCH_FAILURE: '1',
          RUNNER_DIAGNOSTIC_FAKE_ARTIFACT_DOWNLOAD_FAILURE: '1',
        },
      }
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /gh run view "?<latest-run-id>"? --repo balejosg\/ClassroomPath --json/
    );
    assert.match(
      result.stdout,
      /gh api "?repos\/balejosg\/ClassroomPath\/actions\/runs\/<latest-run-id>\/artifacts"?/
    );
    assert.match(
      result.stdout,
      /gh run view "?<latest-run-id>"? --repo balejosg\/ClassroomPath --log/
    );
    assert.match(result.stdout, /\.opencode\/tmp\/runner-diagnostics\/<latest-run-id>/);
    assert.match(result.stderr, /artifact-download-error\.txt/);
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

  test('plans a direct Windows AJAX staging diagnostic through the Proxmox guest agent', () => {
    const result = runDirectDiagnostic([]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /target_environment=staging/);
    assert.match(
      result.stdout,
      /PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_URL=https:\/\/classroompath-staging\.duckdns\.org/
    );
    assert.match(result.stdout, /ssh whitelist-proxmox qm guest exec 103 -- powershell\.exe/);
    assert.match(result.stdout, /--pass-stdin 1/);
    assert.match(result.stdout, /C:\\OpenPath\\scripts\\Start-SSEListener\.ps1/);
    assert.match(result.stdout, /C:\\OpenPath\\scripts\\Update-OpenPath\.ps1/);
    assert.match(result.stdout, /C:\\OpenPath\\lib\\Update\.Runtime\.psm1/);
    assert.match(result.stdout, /C:\\OpenPath\\lib\\internal\\NativeHost\.Actions\.ps1/);
    assert.match(
      result.stdout,
      /C:\\OpenPath\\browser-extension\\firefox\\native\\NativeHost\.Actions\.ps1/
    );
    assert.match(result.stdout, /scripts\/windows-ajax-auto-allow-canary\.mjs/);
    assert.match(result.stdout, /scripts\/lib\/auto-allow-observation\.mjs/);
    assert.match(result.stdout, /scripts\/lib\/auto-allow-boundary-evidence\.mjs/);
    assert.match(result.stdout, /scripts\/lib\/windows-auto-allow-canary-evidence\.mjs/);
    assert.match(result.stdout, /scripts\/summarize-windows-ajax-auto-allow-evidence\.mjs/);
    assert.match(
      result.stdout,
      /WINDOWS_AJAX_AUTO_ALLOW_CANARY_API_URL=https:\/\/classroompath-staging\.duckdns\.org/
    );
  });

  test('refuses direct production diagnostics without explicit confirmation', () => {
    const result = runDirectDiagnostic(['--environment', 'production']);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--confirm-production/);
  });

  test('direct Linux AJAX diagnostic is staging-first and preserves local evidence', () => {
    const result = runLinuxAjaxDirectDiagnostic([
      '--confirm-local-state-reset',
      '--base-url',
      'https://classroompath-staging.duckdns.org',
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /target_environment=staging/);
    assert.match(
      result.stdout,
      /PRODUCTION_LINUX_BOOTSTRAP_CANARY_URL=https:\/\/classroompath-staging\.duckdns\.org/
    );
    assert.match(
      result.stdout,
      /PRODUCTION_LINUX_BOOTSTRAP_CANARY_ARTIFACT_PATH=.*production-linux-bootstrap-canary\.json/
    );
    assert.match(result.stdout, /curl -fsSL -H "Authorization: Bearer \[redacted\]"/);
    assert.match(result.stdout, /sudo bash .*install-openpath\.sh/);
    assert.match(
      result.stdout,
      /LINUX_AJAX_AUTO_ALLOW_CANARY_ARTIFACT=.*production-linux-ajax-auto-allow-canary\.json/
    );
    assert.match(result.stdout, /scripts\/linux-ajax-auto-allow-canary\.mjs/);
    assert.match(result.stdout, /scripts\/summarize-linux-ajax-auto-allow-evidence\.mjs/);
  });

  test('direct Linux AJAX diagnostic refuses state reset without explicit confirmation', () => {
    const result = runLinuxAjaxDirectDiagnostic([]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--confirm-local-state-reset/);
  });

  test('direct Linux AJAX diagnostic refuses production without explicit confirmation', () => {
    const result = runLinuxAjaxDirectDiagnostic([
      '--environment',
      'production',
      '--confirm-local-state-reset',
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--confirm-production/);
  });

  test('direct Windows AJAX diagnostic pins DNS before downloading enrollment scripts', () => {
    const script = readProjectText('scripts/run-windows-ajax-direct.mjs');

    assert.match(script, /Set-DnsClientServerAddress/);
    assert.match(script, /1\.1\.1\.1/);
    assert.match(script, /8\.8\.8\.8/);
    assert.match(script, /Resolve-DnsName/);
  });

  test('direct Windows AJAX diagnostic refreshes integrity after overlaying local OpenPath files', () => {
    const script = readProjectText('scripts/run-windows-ajax-direct.mjs');

    assert.match(script, /function refreshOpenPathIntegrity/);
    assert.match(script, /Save-OpenPathIntegrityBackup/);
    assert.match(script, /New-OpenPathIntegrityBaseline/);
    assert.match(script, /refreshOpenPathIntegrity\(options\)/);
  });

  test('direct Windows AJAX diagnostic extends the browser canary timeout for local runner feedback', () => {
    const script = readProjectText('scripts/run-windows-ajax-direct.mjs');

    assert.match(script, /WINDOWS_AJAX_AUTO_ALLOW_CANARY_TIMEOUT_MS/);
    assert.match(script, /DEFAULT_CANARY_TIMEOUT_MS = '180000'/);
    assert.match(script, /--canary-timeout-ms/);
  });

  test('direct Windows AJAX diagnostic captures late local sync after canary failure', () => {
    const directScript = readProjectText('scripts/run-windows-ajax-direct.mjs');
    const canaryScript = readProjectText('scripts/windows-ajax-auto-allow-canary.mjs');

    assert.match(directScript, /WINDOWS_AJAX_AUTO_ALLOW_POST_FAILURE_OBSERVATION_MS/);
    assert.match(directScript, /DEFAULT_POST_FAILURE_OBSERVATION_MS = '60000'/);
    assert.match(directScript, /--post-failure-observation-ms/);
    assert.match(canaryScript, /POST_FAILURE_OBSERVATION_MS/);
    assert.match(canaryScript, /postFailureObservation/);
    assert.match(canaryScript, /waitForLocalWhitelistObservation/);
  });

  test('direct Windows AJAX diagnostic waits for a fresh SSE connection before launching Firefox', () => {
    const script = readProjectText('scripts/run-windows-ajax-direct.mjs');

    assert.match(script, /Wait for the restarted SSE task to connect/);
    assert.match(script, /SSE: Connected to API - listening for rule changes/);
  });

  test('Windows AJAX canary reports observed page-resource candidate messages', () => {
    const script = readProjectText('scripts/windows-ajax-auto-allow-canary.mjs');

    assert.match(script, /pageResourceCandidateEvents/);
    assert.match(script, /openpath-page-resource-candidate/);
    assert.match(script, /completedCandidateEvents/);
    assert.match(script, /pageObserverInstalled/);
    assert.match(script, /__openpathPageResourceObserverInstalled/);
  });

  test('Windows AJAX canary keeps probing until the configured timeout deadline', () => {
    const script = readProjectText('scripts/windows-ajax-auto-allow-canary.mjs');

    assert.match(script, /CANARY_TIMEOUT_MS/);
    assert.match(script, /Date\.now\(\) < deadline/);
    assert.doesNotMatch(script, /attempt <= 40/);
  });

  test('direct Windows AJAX diagnostic passes server diagnostics context to the canary', () => {
    const script = readProjectText('scripts/run-windows-ajax-direct.mjs');

    assert.match(script, /WINDOWS_AJAX_AUTO_ALLOW_CANARY_GROUP_ID/);
    assert.match(script, /WINDOWS_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN/);
    assert.match(script, /summary\.groupId/);
    assert.match(script, /billingContext\.adminToken/);
  });

  test('direct Windows AJAX diagnostic preserves boundary-enriched artifacts locally', () => {
    const script = readProjectText('scripts/run-windows-ajax-direct.mjs');

    assert.match(script, /summarize-windows-ajax-auto-allow-evidence\.mjs/);
    assert.match(script, /production-windows-ajax-auto-allow-canary\.json/);
    assert.match(script, /failureBoundary/);
    assert.match(script, /diagnosticPhases/);
  });

  test('direct Windows AJAX diagnostic keeps bootstrap canary artifacts inside its evidence directory', () => {
    const directScript = readProjectText('scripts/run-windows-ajax-direct.mjs');
    const bootstrapScript = readProjectText(
      'scripts/create-production-windows-bootstrap-canary.mjs'
    );

    assert.match(directScript, /PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_ARTIFACT_PATH/);
    assert.match(
      directScript,
      /resolve\(artifactDir, 'production-windows-bootstrap-canary\.json'\)/
    );
    assert.doesNotMatch(
      directScript,
      /resolve\(projectRoot, 'production-windows-bootstrap-canary\.json'\)/
    );
    assert.match(bootstrapScript, /PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_ARTIFACT_PATH/);
  });

  test('direct Linux student diagnostic runs OpenPath locally with an isolated artifact directory', () => {
    const result = runLinuxStudentDirectDiagnostic([]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /openpath_root=.*\/OpenPath/);
    assert.match(result.stdout, /artifact_dir=.*\.opencode\/tmp\/linux-student-direct/);
    assert.match(result.stdout, /OPENPATH_STUDENT_ARTIFACTS_DIR=/);
    assert.match(result.stdout, /npm run test:student-policy:linux/);
    assert.match(result.stdout, /scripts\/summarize-linux-student-policy-evidence\.mjs/);
    assert.match(result.stdout, /linux-auto-allow-boundary\.json/);
  });

  test('direct Linux student diagnostic accepts explicit OpenPath root and artifact directory', () => {
    const result = runLinuxStudentDirectDiagnostic([
      '--openpath-root',
      '/tmp/openpath-checkout',
      '--artifact-dir',
      '/tmp/linux-student-artifacts',
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /openpath_root=\/tmp\/openpath-checkout/);
    assert.match(result.stdout, /artifact_dir=\/tmp\/linux-student-artifacts/);
  });

  test('direct Windows AJAX diagnostic can run Firefox with the local extension build', () => {
    const result = runDirectDiagnostic(['--firefox-extension-source', 'local']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /firefox_extension_source=local/);
    assert.match(result.stdout, /local: npm run build --workspace=@openpath\/firefox-extension/);
    assert.match(
      result.stdout,
      /guest-upload-binary: .*openpath-firefox-extension\.xpi -> C:\\Windows\\Temp\\openpath-ajax-direct\\openpath-firefox-extension\.xpi/
    );
    assert.match(
      result.stdout,
      /guest-upload-binary: .*selenium-node-modules\.zip -> C:\\Windows\\Temp\\openpath-ajax-direct\\selenium-node-modules\.zip/
    );
    assert.match(result.stdout, /guest-env: WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_MODE=selenium/);
    assert.match(
      result.stdout,
      /guest-env: WINDOWS_AJAX_AUTO_ALLOW_LOCAL_ADDON_PATH=C:\\Windows\\Temp\\openpath-ajax-direct\\openpath-firefox-extension\.xpi/
    );
  });

  test('direct Windows AJAX diagnostic runs managed signed Firefox through Selenium', () => {
    const result = runDirectDiagnostic(['--firefox-extension-source', 'managed']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /firefox_extension_source=managed/);
    assert.match(
      result.stdout,
      /guest-upload-binary: .*selenium-node-modules\.zip -> C:\\Windows\\Temp\\openpath-ajax-direct\\selenium-node-modules\.zip/
    );
    assert.match(result.stdout, /guest-env: WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_MODE=selenium/);
    assert.doesNotMatch(result.stdout, /WINDOWS_AJAX_AUTO_ALLOW_LOCAL_ADDON_PATH=/);
  });

  test('direct Windows AJAX local extension mode does not require npm inside the runner', () => {
    const script = readProjectText('scripts/run-windows-ajax-direct.mjs');

    assert.match(script, /selenium-node-modules\.zip/);
    assert.match(script, /Expand-Archive/);
    assert.doesNotMatch(script, /npm install selenium-webdriver/);
  });

  test('direct Windows AJAX diagnostic chunks binary uploads under guest-agent stdin limits', () => {
    const script = readProjectText('scripts/run-windows-ajax-direct.mjs');

    assert.match(script, /BINARY_UPLOAD_CHUNK_CHARS/);
    assert.match(script, /FileMode\]::Append/);
    assert.match(script, /base64\.slice\(offset, offset \+ BINARY_UPLOAD_CHUNK_CHARS\)/);
  });

  test('Windows AJAX canary supports Selenium-installed local Firefox addons', () => {
    const script = readProjectText('scripts/windows-ajax-auto-allow-canary.mjs');

    assert.match(script, /WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_MODE/);
    assert.match(script, /WINDOWS_AJAX_AUTO_ALLOW_LOCAL_ADDON_PATH/);
    assert.match(script, /selenium-webdriver/);
    assert.match(script, /addExtensions\(LOCAL_ADDON_PATH\)/);
    assert.match(script, /setFirefoxService/);
  });

  test('Windows AJAX canary supports Selenium with enterprise-managed Firefox addons', () => {
    const script = readProjectText('scripts/windows-ajax-auto-allow-canary.mjs');

    assert.match(script, /USE_LOCAL_FIREFOX_ADDON/);
    assert.match(script, /launchFirefoxWithSelenium/);
    assert.match(
      script,
      /mode: USE_LOCAL_FIREFOX_ADDON \? 'selenium-local-addon' : 'selenium-managed'/
    );
    assert.doesNotMatch(script, /WINDOWS_AJAX_AUTO_ALLOW_LOCAL_ADDON_PATH is required/);
  });

  test('Windows AJAX local addon mode suspends managed Firefox policy during Selenium', () => {
    const script = readProjectText('scripts/windows-ajax-auto-allow-canary.mjs');

    assert.match(script, /suspendFirefoxEnterprisePolicy/);
    assert.match(script, /restoreFirefoxEnterprisePolicy/);
    assert.match(script, /policies\.json/);
    assert.match(script, /managedPolicySuspension/);
  });

  test('direct Windows AJAX local extension mode uses an unsigned-addon Firefox channel', () => {
    const directScript = readProjectText('scripts/run-windows-ajax-direct.mjs');
    const canaryScript = readProjectText('scripts/windows-ajax-auto-allow-canary.mjs');

    assert.match(directScript, /firefox-dev/);
    assert.match(directScript, /Firefox Developer Edition/);
    assert.match(canaryScript, /Firefox Developer Edition/);
    assert.match(canaryScript, /Firefox Nightly/);
  });

  test('Windows AJAX canary waits for post-success rule propagation before asserting whitelist state', () => {
    const script = readProjectText('scripts/windows-ajax-auto-allow-canary.mjs');

    assert.match(script, /WINDOWS_AJAX_AUTO_ALLOW_POST_SUCCESS_OBSERVATION_MS/);
    assert.match(script, /waitForRemoteRuleObservation/);
    assert.match(script, /postSuccessObservation/);
    assert.match(script, /waitForLocalWhitelistObservation\(expectedHosts, remaining/);
  });
});
