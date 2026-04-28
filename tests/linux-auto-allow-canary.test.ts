import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { readProjectText } from './helpers/ops-contracts.ts';

describe('Linux AJAX auto-allow canary contracts', () => {
  test('declares the production Linux AJAX/subresource probe table and artifact path', () => {
    const evidenceModule = readProjectText('scripts/lib/linux-auto-allow-canary-evidence.mjs');
    const canaryScript = readProjectText('scripts/linux-ajax-auto-allow-canary.mjs');

    for (const probeId of [
      'ajax-fetch',
      'image-subresource',
      'script-subresource',
      'stylesheet-subresource',
      'font-subresource',
    ]) {
      assert.ok(evidenceModule.includes(`id: '${probeId}'`), `missing ${probeId}`);
    }

    assert.ok(evidenceModule.includes('LINUX_AUTO_ALLOW_PROBES = Object.freeze'));
    assert.ok(canaryScript.includes('production-linux-ajax-auto-allow-canary.json'));
    assert.ok(canaryScript.includes('/cp/internal/client-canary/group/'));
    assert.ok(canaryScript.includes('LINUX_AJAX_AUTO_ALLOW_CANARY_GROUP_ID'));
    assert.ok(canaryScript.includes('LINUX_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN'));
    assert.ok(canaryScript.includes('__openpathPageResourceObserverInstalled'));
    assert.ok(canaryScript.includes('openpath-page-resource-candidate'));
    assert.ok(canaryScript.includes('font/woff2'));
  });

  test('summarizer enriches Linux AJAX evidence with failure boundary outputs', () => {
    const summarizer = readProjectText('scripts/summarize-linux-ajax-auto-allow-evidence.mjs');

    assert.ok(summarizer.includes('production-linux-ajax-auto-allow-canary.json'));
    assert.ok(summarizer.includes('withLinuxAutoAllowDiagnostics'));
    assert.ok(summarizer.includes("writeGithubOutput('canary_result'"));
    assert.ok(summarizer.includes("writeGithubOutput('failure_boundary_id'"));
    assert.ok(summarizer.includes("writeGithubOutput('failure_boundary_message'"));
  });

  test('production bootstrap provisioning has a Linux-specific wrapper artifact', () => {
    const script = readProjectText('scripts/create-production-linux-bootstrap-canary.mjs');

    assert.ok(script.includes('production-linux-bootstrap-canary.json'));
    assert.ok(script.includes('linux-production-bootstrap-canary'));
    assert.ok(script.includes('/cp/internal/client-canary/manual-request/'));
    assert.ok(
      !script.includes('/api/agent/linux/latest.json'),
      'Linux provisioning should not preflight the agent manifest with an enrollment token before installation'
    );
    assert.ok(
      script.includes('linuxScriptUrl: `${apiUrl}/api/enroll/${classroom.id}`'),
      'Linux provisioning should publish the canonical Linux enrollment URL'
    );
    assert.ok(script.includes('ajax-auto-allow-origin.127.0.0.1.sslip.io'));
    assert.ok(script.includes('ajax-auto-allow-font.127.0.0.1.sslip.io'));
  });
});
