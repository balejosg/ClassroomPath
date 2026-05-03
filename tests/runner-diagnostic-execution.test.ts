import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';

import {
  buildRunnerDiagnosticPlan,
  summarizeRunnerDiagnosticPlan,
  validateRunnerDiagnosticPlan,
} from '../scripts/lib/runner-diagnostic-execution.mjs';

describe('runner diagnostic execution plan', () => {
  test('builds the Windows staging AJAX diagnostic plan', () => {
    const plan = buildRunnerDiagnosticPlan({
      platform: 'windows',
      suite: 'ajax-auto-allow',
      environment: 'staging',
      baseUrl: 'https://classroompath-staging.duckdns.org',
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
      baseUrl: 'https://classroompath-staging.duckdns.org',
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
});
