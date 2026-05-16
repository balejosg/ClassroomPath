import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';

import {
  buildLinuxAjaxCanaryEnvironment,
  buildRunnerDiagnosticPlan,
  buildWindowsAjaxCanaryGuestEnvironment,
  emitRunnerDiagnosticEnvironment,
  summarizeRunnerDiagnosticPlan,
  summarizeRunnerDiagnosticArtifact,
  uploadRunnerDiagnosticPlanFiles,
  validateRunnerDiagnosticPlan,
} from '../scripts/lib/runner-diagnostic-execution.mjs';

describe('runner diagnostic execution plan', () => {
  test('builds the Windows staging AJAX diagnostic plan', () => {
    const plan = buildRunnerDiagnosticPlan({
      platform: 'windows',
      suite: 'ajax-auto-allow',
      environment: 'staging',
      baseUrl: 'http://192.168.1.114:3000',
      artifactDir: '/tmp/windows-direct',
      openpathRoot: '/repo/OpenPath',
    });

    assert.equal(plan.runnerTarget.vmid, '103');
    assert.equal(plan.safety.requiresProductionConfirmation, false);
    assert.equal(plan.firefox.mode, 'selenium');
    assert.ok(
      plan.canaryScriptUploads.some(
        (upload) => upload.source === 'scripts/windows-ajax-auto-allow-canary.mjs'
      )
    );
    assert.ok(
      plan.canaryScriptUploads.some(
        (upload) =>
          upload.source === 'scripts/lib/windows-ajax-auto-allow-runtime.mjs' &&
          upload.destination ===
            'C:\\Windows\\Temp\\openpath-ajax-direct\\scripts\\lib\\windows-ajax-auto-allow-runtime.mjs'
      )
    );
    assert.ok(
      plan.canaryScriptUploads.some(
        (upload) =>
          upload.source === 'scripts/lib/canary-progress.mjs' &&
          upload.destination ===
            'C:\\Windows\\Temp\\openpath-ajax-direct\\scripts\\lib\\canary-progress.mjs'
      )
    );
    assert.ok(
      plan.canaryScriptUploads.some(
        (upload) => upload.source === 'scripts/lib/auto-allow-boundary-evidence.mjs'
      )
    );
    assert.ok(
      plan.canaryScriptUploads.some(
        (upload) => upload.source === 'scripts/lib/windows-auto-allow-canary-evidence.mjs'
      )
    );
    assert.ok(
      plan.canaryScriptUploads.some(
        (upload) => upload.source === 'scripts/summarize-windows-ajax-auto-allow-evidence.mjs'
      )
    );
    assert.ok(
      plan.openpathOverlays.some((upload) => upload.source === 'windows/lib/Update.Runtime.psm1')
    );
    assert.ok(
      plan.openpathOverlays.some(
        (upload) => upload.source === 'windows/scripts/Apply-RuntimeDependencyQueue.ps1'
      )
    );
    assert.ok(
      plan.openpathOverlays.some(
        (upload) => upload.source === 'windows/scripts/OpenPath-NativeHost.ps1'
      )
    );
    assert.ok(plan.openpathOverlays.some((upload) => upload.source === 'windows/lib/DNS.psm1'));
    assert.ok(
      plan.openpathOverlays.some((upload) => upload.source === 'windows/lib/Services.psm1')
    );
    assert.ok(
      plan.openpathOverlays.some(
        (upload) => upload.source === 'windows/lib/internal/Update.Script.Apply.ps1'
      )
    );
    assert.ok(
      plan.openpathOverlays.some(
        (upload) => upload.source === 'windows/lib/internal/Services.TaskBuilders.ps1'
      )
    );
    assert.ok(
      plan.openpathOverlays.some(
        (upload) => upload.source === 'windows/lib/internal/DNS.Acrylic.Config.ps1'
      )
    );
    assert.ok(
      plan.openpathOverlays.some(
        (upload) => upload.source === 'windows/lib/internal/NativeHost.Actions.ps1'
      )
    );
    assert.equal(
      plan.artifacts.windowsAjaxCanary,
      resolve('/tmp/windows-direct', 'production-windows-ajax-auto-allow-canary.json')
    );

    assert.deepEqual(validateRunnerDiagnosticPlan(plan), []);
    assert.match(summarizeRunnerDiagnosticPlan(plan).join('\n'), /firefox_mode=selenium/);
  });

  test('requires explicit confirmation for production Windows diagnostics', () => {
    const plan = buildRunnerDiagnosticPlan({
      platform: 'windows',
      suite: 'ajax-auto-allow',
      environment: 'production',
      baseUrl: 'https://classroompath.eu',
      artifactDir: '/tmp/windows-direct',
      openpathRoot: '/repo/OpenPath',
    });

    assert.deepEqual(validateRunnerDiagnosticPlan(plan), [
      'Direct production diagnostics require --confirm-production.',
    ]);

    const confirmed = buildRunnerDiagnosticPlan({
      platform: 'windows',
      suite: 'ajax-auto-allow',
      environment: 'production',
      baseUrl: 'https://classroompath.eu',
      artifactDir: '/tmp/windows-direct',
      openpathRoot: '/repo/OpenPath',
      confirmProduction: true,
    });

    assert.deepEqual(validateRunnerDiagnosticPlan(confirmed), []);
  });

  test('builds the Linux AJAX diagnostic plan', () => {
    const plan = buildRunnerDiagnosticPlan({
      platform: 'linux',
      suite: 'ajax-auto-allow',
      environment: 'staging',
      baseUrl: 'http://192.168.1.114:3000',
      artifactDir: '/tmp/linux-direct',
    });

    assert.equal(
      plan.artifacts.linuxAjaxCanary,
      resolve('/tmp/linux-direct', 'production-linux-ajax-auto-allow-canary.json')
    );
    assert.equal(plan.canary.command, 'scripts/linux-ajax-auto-allow-canary.mjs');
    assert.equal(plan.safety.requiresLocalStateResetConfirmation, true);
    assert.deepEqual(validateRunnerDiagnosticPlan(plan), [
      'Direct Linux AJAX diagnostics reset local OpenPath state; pass --confirm-local-state-reset.',
    ]);
  });

  test('builds Windows AJAX guest environment from the diagnostic plan', () => {
    const plan = buildRunnerDiagnosticPlan({
      platform: 'windows',
      suite: 'ajax-auto-allow',
      environment: 'staging',
      baseUrl: 'http://192.168.1.114:3000',
      artifactDir: '/tmp/windows-direct',
      openpathRoot: '/repo/OpenPath',
    });

    const env = buildWindowsAjaxCanaryGuestEnvironment({
      plan,
      summary: {
        apiUrl: 'http://192.168.1.114:3000',
        classroomId: 'classroom_abc-123',
        groupId: 'group-123',
        extensionId: 'openpath-block-monitor@openpath',
      },
      billingContext: {
        adminToken: 'admin-token',
      },
      canaryTimeoutMs: '180000',
      postFailureObservationMs: '60000',
      localFirefoxExtension: {
        remotePath: 'C:\\Windows\\Temp\\openpath-ajax-direct\\openpath-firefox-extension.xpi',
        version: '9999.123.0',
      },
    });

    assert.equal(env.OPENPATH_ROOT, 'C:\\OpenPath');
    assert.equal(env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_API_URL, 'http://192.168.1.114:3000');
    assert.equal(env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_GROUP_ID, 'group-123');
    assert.equal(env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN, 'admin-token');
    assert.equal(
      env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_ARTIFACT,
      'C:\\Windows\\Temp\\openpath-ajax-direct\\production-windows-ajax-auto-allow-canary.json'
    );
    assert.equal(env.WINDOWS_AJAX_AUTO_ALLOW_CANARY_TIMEOUT_MS, '180000');
    assert.equal(env.WINDOWS_AJAX_AUTO_ALLOW_POST_FAILURE_OBSERVATION_MS, '60000');
    assert.equal(env.WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_MODE, 'selenium');
    assert.equal(
      env.WINDOWS_BLOCKED_PAGE_UNBLOCK_REQUEST_DOMAIN,
      'blocked-page-unblock-request-classroom-abc-123.127.0.0.1.sslip.io'
    );
    assert.equal(env.WINDOWS_AJAX_REDDIT_NAVIGATION_MODE, 'off');
    assert.equal(env.EXPECTED_EXTENSION_ID, 'openpath-block-monitor@openpath');
    assert.equal(
      env.WINDOWS_AJAX_AUTO_ALLOW_LOCAL_ADDON_PATH,
      'C:\\Windows\\Temp\\openpath-ajax-direct\\openpath-firefox-extension.xpi'
    );
    assert.equal(env.WINDOWS_AJAX_AUTO_ALLOW_LOCAL_ADDON_VERSION, '9999.123.0');
  });

  test('builds Linux AJAX canary environment from the diagnostic plan', () => {
    const plan = buildRunnerDiagnosticPlan({
      platform: 'linux',
      suite: 'ajax-auto-allow',
      environment: 'staging',
      baseUrl: 'http://192.168.1.114:3000',
      artifactDir: '/tmp/linux-direct',
      confirmLocalStateReset: true,
    });

    const env = buildLinuxAjaxCanaryEnvironment({
      plan,
      groupId: 'group-123',
      adminToken: 'admin-token',
      extensionId: 'monitor-bloqueos@openpath',
    });

    assert.equal(env.LINUX_AJAX_AUTO_ALLOW_CANARY_API_URL, 'http://192.168.1.114:3000');
    assert.equal(env.LINUX_AJAX_AUTO_ALLOW_CANARY_GROUP_ID, 'group-123');
    assert.equal(env.LINUX_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN, 'admin-token');
    assert.equal(
      env.LINUX_AJAX_AUTO_ALLOW_CANARY_ARTIFACT,
      resolve('/tmp/linux-direct', 'production-linux-ajax-auto-allow-canary.json')
    );
    assert.equal(env.EXPECTED_EXTENSION_ID, 'monitor-bloqueos@openpath');
  });

  test('uploads plan-declared files through an execution adapter', () => {
    const plan = buildRunnerDiagnosticPlan({
      platform: 'windows',
      suite: 'ajax-auto-allow',
      environment: 'staging',
      baseUrl: 'http://192.168.1.114:3000',
      artifactDir: '/tmp/windows-direct',
      openpathRoot: '/repo/OpenPath',
    });
    const uploads = [];

    uploadRunnerDiagnosticPlanFiles(plan, {
      projectRoot: '/repo/ClassroomPath',
      openpathRoot: '/repo/OpenPath',
      writeText: (sourcePath, destinationPath) => {
        uploads.push({ sourcePath, destinationPath });
      },
    });

    assert.equal(
      uploads[0].sourcePath,
      resolve('/repo/OpenPath', 'windows/scripts/Start-SSEListener.ps1')
    );
    assert.ok(
      uploads.some(
        (upload) =>
          upload.sourcePath ===
            resolve('/repo/ClassroomPath', 'scripts/lib/ajax-auto-allow-canary-runtime.mjs') &&
          upload.destinationPath ===
            'C:\\Windows\\Temp\\openpath-ajax-direct\\scripts\\lib\\ajax-auto-allow-canary-runtime.mjs'
      )
    );
  });

  test('emits plan environment variables through a shared formatter', () => {
    const plan = buildRunnerDiagnosticPlan({
      platform: 'windows',
      suite: 'ajax-auto-allow',
      environment: 'staging',
      baseUrl: 'http://192.168.1.114:3000',
      artifactDir: '/tmp/windows-direct',
      openpathRoot: '/repo/OpenPath',
    });
    const lines = [];

    emitRunnerDiagnosticEnvironment(plan, {
      emit: (line) => lines.push(line),
      prefix: 'guest-env: ',
      environment: {
        WINDOWS_AJAX_AUTO_ALLOW_CANARY_API_URL: 'http://192.168.1.114:3000',
        WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_MODE: 'selenium',
      },
    });

    assert.deepEqual(lines, [
      'guest-env: WINDOWS_AJAX_AUTO_ALLOW_CANARY_API_URL=http://192.168.1.114:3000',
      'guest-env: WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_MODE=selenium',
    ]);
  });

  test('summarizes runner diagnostic artifacts from the plan', () => {
    const windowsPlan = buildRunnerDiagnosticPlan({
      platform: 'windows',
      suite: 'ajax-auto-allow',
      environment: 'staging',
      baseUrl: 'http://192.168.1.114:3000',
      artifactDir: '/tmp/windows-direct',
      openpathRoot: '/repo/OpenPath',
    });
    const dryRunLines = [];

    summarizeRunnerDiagnosticArtifact(windowsPlan, {
      dryRun: true,
      emit: (line) => dryRunLines.push(line),
      outputFields: ['failureBoundary', 'diagnosticPhases'],
    });

    assert.deepEqual(dryRunLines, [
      'local: node scripts/summarize-windows-ajax-auto-allow-evidence.mjs --artifact /tmp/windows-direct/production-windows-ajax-auto-allow-canary.json --summary /tmp/windows-direct/windows-ajax-auto-allow-canary-summary.md',
      'local-artifact-fields: failureBoundary diagnosticPhases',
    ]);

    const linuxPlan = buildRunnerDiagnosticPlan({
      platform: 'linux',
      suite: 'ajax-auto-allow',
      environment: 'staging',
      baseUrl: 'http://192.168.1.114:3000',
      artifactDir: '/tmp/linux-direct',
      confirmLocalStateReset: true,
    });
    let commandCall;

    summarizeRunnerDiagnosticArtifact(linuxPlan, {
      env: { EXISTING: '1' },
      runCommand: (call) => {
        commandCall = call;
        return 0;
      },
      allowFailure: true,
      logDir: '/tmp/linux-direct',
      logName: 'summarize-linux-ajax-auto-allow-evidence',
    });

    assert.equal(commandCall?.command, process.execPath);
    assert.deepEqual(commandCall?.args, [
      'scripts/summarize-linux-ajax-auto-allow-evidence.mjs',
      '--artifact',
      resolve('/tmp/linux-direct', 'production-linux-ajax-auto-allow-canary.json'),
      '--summary',
      resolve('/tmp/linux-direct', 'linux-ajax-auto-allow-canary-summary.md'),
    ]);
    assert.equal(
      commandCall?.env.GITHUB_OUTPUT,
      resolve('/tmp/linux-direct', 'linux-ajax-auto-allow-canary-summary.env')
    );
    assert.equal(commandCall?.allowFailure, true);
    assert.equal(commandCall?.logName, 'summarize-linux-ajax-auto-allow-evidence');
  });
});
