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
    assert.match(result.stdout, /scripts\/lib\/windows-auto-allow-canary-evidence\.mjs/);
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
});
