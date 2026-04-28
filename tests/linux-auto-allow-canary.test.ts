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

  test('Linux font probe is validated by server traffic instead of font decode success', () => {
    const canaryScript = readProjectText('scripts/linux-ajax-auto-allow-canary.mjs');

    assert.ok(
      canaryScript.includes("url.pathname === '/probe-state'"),
      'Linux canary should expose per-probe hit counts to the browser page'
    );
    assert.ok(
      canaryScript.includes('const hits = await readProbeHits(probe.id).catch(() => 0);'),
      'Linux font probe should use server hit evidence like the Windows canary'
    );
    assert.ok(
      /const loadFont = \(probe\) =>[\s\S]*resolve\(hits > 0\);[\s\S]*?\}\)\);/.test(canaryScript),
      'Linux font success must not depend on Firefox accepting the synthetic woff2 payload'
    );
    assert.ok(
      canaryScript.includes(
        'pageResourceCandidateEvents.splice(0, pageResourceCandidateEvents.length - 100)'
      ),
      'Linux canary should cap candidate events so artifact upload cannot grow unbounded'
    );
  });

  test('Linux canary disables Firefox DNS cache between auto-allow retries', () => {
    const canaryScript = readProjectText('scripts/linux-ajax-auto-allow-canary.mjs');

    assert.ok(canaryScript.includes("options.setPreference('network.trr.uri', '');"));
    assert.ok(canaryScript.includes("options.setPreference('network.dnsCacheExpiration', 0);"));
    assert.ok(
      canaryScript.includes("options.setPreference('network.dnsCacheExpirationGracePeriod', 0);")
    );
  });

  test('summarizer enriches Linux AJAX evidence with failure boundary outputs', () => {
    const summarizer = readProjectText('scripts/summarize-linux-ajax-auto-allow-evidence.mjs');

    assert.ok(summarizer.includes('production-linux-ajax-auto-allow-canary.json'));
    assert.ok(summarizer.includes('withLinuxAutoAllowDiagnostics'));
    assert.ok(summarizer.includes("writeGithubOutput('canary_result'"));
    assert.ok(summarizer.includes("writeGithubOutput('failure_boundary_id'"));
    assert.ok(summarizer.includes("writeGithubOutput('failure_boundary_message'"));
  });

  test('Linux canary skips artifact upload for diagnostic or functional-failure runs', () => {
    const workflow = readProjectText('.github/workflows/linux-production-bootstrap-canary.yml');

    assert.match(
      workflow,
      /name: Upload production bootstrap canary artifacts[\s\S]*if: \${{ always\(\) && steps\.inputs\.outputs\.diagnostic_mode != 'true' && steps\.ajax-summary\.outputs\.canary_result == 'success' }}/
    );
    assert.match(
      workflow,
      /if \[ "\$UPLOAD_OUTCOME" = "failure" \]; then[\s\S]*failure_boundary_id=artifact-upload/
    );
  });

  test('Linux canary preserves rich evidence artifacts on functional failure', () => {
    const canaryScript = readProjectText('scripts/linux-ajax-auto-allow-canary.mjs');

    assert.ok(
      canaryScript.includes('class LinuxAjaxAutoAllowFunctionalFailure extends Error'),
      'functional canary failures should be distinguishable from infrastructure errors'
    );
    assert.ok(
      canaryScript.includes('throw new LinuxAjaxAutoAllowFunctionalFailure(summary.error);'),
      'the already-written rich summary should drive the non-zero exit'
    );
    assert.ok(
      /if \(!\(error instanceof LinuxAjaxAutoAllowFunctionalFailure\)\)[\s\S]*writeFile\(/.test(
        canaryScript
      ),
      'catch handler should not overwrite rich evidence for normal canary failures'
    );
  });

  test('Linux canary concurrency is scoped by ref so stale runs cannot block diagnostics', () => {
    const workflow = readProjectText('.github/workflows/linux-production-bootstrap-canary.yml');

    assert.ok(workflow.includes('group: linux-production-bootstrap-canary-${{ github.ref }}-'));
    assert.ok(
      workflow.includes("${{ inputs.diagnostic_mode == 'true' && github.run_id || 'release' }}")
    );
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
