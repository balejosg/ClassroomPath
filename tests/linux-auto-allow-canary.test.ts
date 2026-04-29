import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { readProjectText } from './helpers/ops-contracts.ts';
import {
  LINUX_AUTO_ALLOW_PROBES,
  buildLinuxAutoAllowProbeUrl,
  withLinuxAutoAllowDiagnostics,
} from '../scripts/lib/linux-auto-allow-canary-evidence.mjs';

describe('Linux AJAX auto-allow canary contracts', () => {
  test('declares the production Linux AJAX/subresource probe table and artifact path', () => {
    const canaryScript = readProjectText('scripts/linux-ajax-auto-allow-canary.mjs');

    assert.deepEqual(
      LINUX_AUTO_ALLOW_PROBES.map((probe) => probe.id),
      [
        'ajax-fetch',
        'image-subresource',
        'script-subresource',
        'stylesheet-subresource',
        'font-subresource',
      ]
    );
    assert.equal(
      buildLinuxAutoAllowProbeUrl(LINUX_AUTO_ALLOW_PROBES[4], 18088),
      'http://ajax-auto-allow-font.127.0.0.1.sslip.io:18088/font.woff2'
    );

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

  test('Linux workflow runs the AJAX canary on the HTTP port allowed by the firewall', () => {
    const workflow = readProjectText('.github/workflows/linux-production-bootstrap-canary.yml');
    const ajaxStep =
      /name: Verify Linux AJAX auto-allow canary[\s\S]*?(?=\n      - name: Summarize Linux AJAX auto-allow evidence)/.exec(
        workflow
      )?.[0] ?? '';

    assert.match(ajaxStep, /sudo sysctl -w net\.ipv4\.ip_unprivileged_port_start=0/);
    assert.match(ajaxStep, /LINUX_AJAX_AUTO_ALLOW_CANARY_PORT=80/);
    assert.match(
      ajaxStep,
      /timeout --kill-after=30s 10m node scripts\/linux-ajax-auto-allow-canary\.mjs/
    );
  });

  test('Linux canary bounds Firefox page-load waits before probing', () => {
    const canaryScript = readProjectText('scripts/linux-ajax-auto-allow-canary.mjs');

    assert.ok(canaryScript.includes('LINUX_AJAX_AUTO_ALLOW_PAGE_LOAD_TIMEOUT_MS'));
    assert.ok(canaryScript.includes('await driver.manage().setTimeouts'));
    assert.ok(canaryScript.includes('pageLoad: PAGE_LOAD_TIMEOUT_MS'));
    assert.ok(canaryScript.includes('Linux AJAX canary page load did not complete'));
  });

  test('summarizer enriches Linux AJAX evidence with failure boundary outputs', () => {
    const summarizer = readProjectText('scripts/summarize-linux-ajax-auto-allow-evidence.mjs');

    assert.ok(summarizer.includes('production-linux-ajax-auto-allow-canary.json'));
    assert.ok(summarizer.includes('withLinuxAutoAllowDiagnostics'));
    assert.ok(summarizer.includes("writeGithubOutput('canary_result'"));
    assert.ok(summarizer.includes("writeGithubOutput('failure_boundary_id'"));
    assert.ok(summarizer.includes("writeGithubOutput('failure_boundary_message'"));
  });

  test('Linux canary emits failure boundary outputs before exiting non-zero', () => {
    const canaryScript = readProjectText('scripts/linux-ajax-auto-allow-canary.mjs');

    assert.ok(canaryScript.includes('withLinuxAutoAllowDiagnostics'));
    assert.ok(canaryScript.includes("writeGithubOutput('failure_boundary_id'"));
    assert.ok(canaryScript.includes("writeGithubOutput('failure_boundary_message'"));
    assert.match(
      canaryScript,
      /const summary = withLinuxAutoAllowDiagnostics\(\{[\s\S]*writeGithubOutput\('linux_ajax_auto_allow_result'/
    );
  });

  test('Linux canary preserves artifacts and raw log on functional failure', () => {
    const workflow = readProjectText('.github/workflows/linux-production-bootstrap-canary.yml');

    assert.match(
      workflow,
      /name: Checkout\s+uses: actions\/checkout@v6\s+with:\s+persist-credentials: false/
    );
    assert.match(
      workflow,
      /name: Verify Linux AJAX auto-allow canary[\s\S]*timeout --kill-after=30s 10m node scripts\/linux-ajax-auto-allow-canary\.mjs 2>&1 \| tee linux-ajax-auto-allow-canary\.log[\s\S]*ajax_status="\$\{PIPESTATUS\[0\]\}"/
    );
    assert.match(
      workflow,
      /name: Upload production bootstrap canary artifacts[\s\S]*if: \$\{\{ always\(\) \}\}/
    );
    assert.match(
      workflow,
      /name: Prepare Linux canary artifact bundle[\s\S]*tar -czf linux-production-bootstrap-canary-evidence\.tgz[\s\S]*production-linux-ajax-auto-allow-canary\.json[\s\S]*linux-ajax-auto-allow-canary\.log/
    );
    assert.match(
      workflow,
      /path: linux-production-bootstrap-canary-evidence\.tgz[\s\S]*compression-level: 0/
    );
    assert.match(
      workflow,
      /name: Cleanup Linux canary runtime[\s\S]*if: \$\{\{ always\(\) \}\}[\s\S]*timeout-minutes: 2[\s\S]*timeout --kill-after=5s 20s sudo systemctl stop openpath-sse-listener\.service openpath-update\.timer openpath-update\.service dnsmasq[\s\S]*timeout --kill-after=5s 20s pkill -TERM -f 'firefox|geckodriver|linux-ajax-auto-allow-canary\.mjs'/
    );
    assert.match(
      workflow,
      /if \[ "\$UPLOAD_OUTCOME" = "failure" \]; then[\s\S]*failure_boundary_id=artifact-upload/
    );
  });

  test('Linux bootstrap canary restores runner connectivity before the AJAX step exits', () => {
    const workflow = readProjectText('.github/workflows/linux-production-bootstrap-canary.yml');
    const downloadStep =
      /name: Download live linux\/install-openpath\.sh enrollment script[\s\S]*?(?=\n      - name: Verify Linux AJAX auto-allow canary)/.exec(
        workflow
      )?.[0] ?? '';
    const ajaxStep =
      /name: Verify Linux AJAX auto-allow canary[\s\S]*?(?=\n      - name: Summarize Linux AJAX auto-allow evidence)/.exec(
        workflow
      )?.[0] ?? '';

    assert.ok(downloadStep.includes('$PRODUCTION_BASE_URL/api/enroll/$CLASSROOM_ID"'));
    assert.doesNotMatch(
      downloadStep,
      /sudo bash "\$workspace\/install-openpath\.sh"/,
      'download step must not activate OpenPath before the AJAX step can restore runner DNS'
    );
    assert.match(
      ajaxStep,
      /trap restore_linux_bootstrap_canary_external_dns EXIT[\s\S]*sudo bash "\$workspace\/install-openpath\.sh" 2>&1 \| tee linux-install-openpath\.log[\s\S]*install_status="\$\{PIPESTATUS\[0\]\}"/,
      'AJAX step must install OpenPath, preserve the installer log, and always restore runner DNS before exiting'
    );
    assert.match(
      ajaxStep,
      /failure_boundary_id=linux-install-openpath[\s\S]*exit "\$install_status"/,
      'installer failures should be recorded as an installation boundary, not as missing artifacts'
    );
    assert.doesNotMatch(
      ajaxStep,
      /node <<'NODE'/,
      'AJAX step must avoid heredocs in nested failure branches because YAML indentation breaks Bash delimiters'
    );
    assert.match(
      ajaxStep,
      /FAILURE_MESSAGE='Linux enrollment script failed before the AJAX auto-allow canary could run\.' node -e/,
      'installer failure artifact should be written without an indentation-sensitive heredoc'
    );
    assert.match(
      ajaxStep,
      /sudo systemctl stop openpath-sse-listener\.service openpath-update\.timer openpath-update\.service dnsmasq[\s\S]*sudo systemctl reset-failed dnsmasq[\s\S]*sudo apt-get purge -y openpath-dnsmasq[\s\S]*\/etc\/systemd\/system\/dnsmasq\.service\.d\/openpath-override\.conf[\s\S]*\/etc\/dnsmasq\.d\/openpath\.conf[\s\S]*raw\.githubusercontent\.com/,
      'AJAX step restoration should remove OpenPath DNS state and verify external GitHub DNS'
    );
    assert.match(
      workflow,
      /name: Prepare Linux canary artifact bundle[\s\S]*linux-install-openpath\.log[\s\S]*linux-ajax-auto-allow-canary\.log/
    );
  });

  test('Linux canary workflow emits recoverable evidence summary in logs', () => {
    const workflow = readProjectText('.github/workflows/linux-production-bootstrap-canary.yml');

    assert.match(
      workflow,
      /name: Emit Linux canary evidence summary[\s\S]*GITHUB_STEP_SUMMARY[\s\S]*canary_result[\s\S]*failure_boundary_id[\s\S]*failure_boundary_message[\s\S]*diagnosticPhases[\s\S]*originPreflight[\s\S]*whitelistSeed[\s\S]*dns[\s\S]*bundle_status[\s\S]*bundle_size/
    );
    assert.match(
      workflow,
      /name: Prepare Linux canary artifact bundle[\s\S]*ls -lh linux-production-bootstrap-canary-evidence\.tgz[\s\S]*tar -tzf linux-production-bootstrap-canary-evidence\.tgz/
    );
    assert.match(
      workflow,
      /BUNDLE_OUTCOME: \$\{\{ steps\.bundle\.outcome \}\}[\s\S]*failure_boundary_id=artifact-bundle/
    );
  });

  test('Linux canary workflow records boundary even when summary rendering stalls', () => {
    const workflow = readProjectText('.github/workflows/linux-production-bootstrap-canary.yml');

    assert.match(
      workflow,
      /name: Summarize Linux AJAX auto-allow evidence[\s\S]*timeout-minutes: 2[\s\S]*continue-on-error: true/
    );
    assert.ok(
      workflow.includes(
        "FUNCTIONAL_BOUNDARY_ID: ${{ steps.ajax.outputs.failure_boundary_id || steps.ajax-summary.outputs.failure_boundary_id || 'artifact-written' }}"
      )
    );
    assert.ok(
      workflow.includes(
        "FUNCTIONAL_BOUNDARY_MESSAGE: ${{ steps.ajax.outputs.failure_boundary_message || steps.ajax-summary.outputs.failure_boundary_message || 'Linux AJAX evidence artifact was not written.' }}"
      )
    );
  });

  test('Linux staging diagnostics can run when staging SSH is not reachable from GitHub', () => {
    const workflow = readProjectText('.github/workflows/linux-production-bootstrap-canary.yml');

    assert.match(
      workflow,
      /if \[ "\$TARGET_ENVIRONMENT" = "staging" \] && \[ "\$DIAGNOSTIC_MODE" = "true" \]; then[\s\S]*billing_mode="manual_only"/
    );
    assert.match(
      workflow,
      /FALLBACK_CLIENT_CANARY_ADMIN_TOKEN: \$\{\{ secrets\.CP_CLIENT_CANARY_ADMIN_TOKEN \}\}/
    );
    assert.match(
      workflow,
      /if \[ "\$TARGET_ENVIRONMENT" = "staging" \] && \[ "\$DIAGNOSTIC_MODE" = "true" \] && \[ -n "\$FALLBACK_CLIENT_CANARY_ADMIN_TOKEN" \]; then[\s\S]*client_canary_admin_token="\$FALLBACK_CLIENT_CANARY_ADMIN_TOKEN"/
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

  test('Linux canary records pre-Firefox origin reachability and DNS evidence', () => {
    const canaryScript = readProjectText('scripts/linux-ajax-auto-allow-canary.mjs');

    assert.match(canaryScript, /import dns from 'node:dns\/promises';/);
    assert.match(canaryScript, /async function collectOriginPreflight/);
    assert.match(canaryScript, /Host: `\$\{ORIGIN_HOST\}:\$\{PORT\}`/);
    assert.match(canaryScript, /dns\s*\.\s*lookup\(ORIGIN_HOST/);
    assert.match(canaryScript, /originPreflight/);
    assert.match(canaryScript, /dns: \{[\s\S]*originHost/);
  });

  test('Linux canary distinguishes browser page load from in-page probe attempts', () => {
    const canaryScript = readProjectText('scripts/linux-ajax-auto-allow-canary.mjs');
    const evidenceHelper = readProjectText('scripts/lib/linux-auto-allow-canary-evidence.mjs');

    assert.match(canaryScript, /originPageHits: 0/);
    assert.match(canaryScript, /attemptHits: 0/);
    assert.match(
      canaryScript,
      /if \(host === ORIGIN_HOST && req\.method === 'GET' && url\.pathname === '\/'\) \{[\s\S]*state\.originPageHits \+= 1/
    );
    assert.match(
      canaryScript,
      /if \(host === ORIGIN_HOST && req\.method === 'POST' && url\.pathname === '\/attempt'\) \{[\s\S]*state\.attemptHits \+= 1/
    );
    assert.match(canaryScript, /async function collectBrowserNavigationDiagnostics/);
    assert.match(canaryScript, /browserNavigation/);
    assert.match(canaryScript, /__openpathLinuxAjaxCanaryState/);
    assert.match(canaryScript, /window\.addEventListener\('error'/);
    assert.match(canaryScript, /canaryState\.lastPhase = 'probe:' \+ probe\.id/);
    assert.match(canaryScript, /originHits: state\.originPageHits/);
    assert.match(evidenceHelper, /originPageHits: Number\(summary\?\.originPageHits/);
  });

  test('Linux canary accepts browser-observed page observer evidence', () => {
    const summary = withLinuxAutoAllowDiagnostics({
      success: false,
      firefoxExtensionWarmup: { ready: true },
      originHits: 1,
      originPageHits: 1,
      attemptHits: 0,
      pageObserverInstalled: false,
      browserNavigation: {
        afterAttempts: {
          ok: true,
          openpathObserverInstalled: true,
        },
      },
      completedCandidateEvents: {},
      probeEvidence: [],
      artifactWritten: true,
    });

    assert.equal(
      summary.diagnosticPhases.find((phase) => phase.id === 'page-observer')?.status,
      'passed'
    );
    assert.equal(summary.failureBoundary.id, 'page-resource-candidates');
  });

  test('Linux canary captures page-world observer patch diagnostics', () => {
    const canaryScript = readProjectText('scripts/linux-ajax-auto-allow-canary.mjs');

    assert.match(canaryScript, /__openpathPageResourceObserverState/);
    assert.match(canaryScript, /openpathObserverState/);
    assert.match(canaryScript, /pageObserverState/);
  });

  test('Linux canary listens for page resource candidate DOM events', () => {
    const canaryScript = readProjectText('scripts/linux-ajax-auto-allow-canary.mjs');

    assert.match(canaryScript, /openpath-page-resource-candidate/);
    assert.match(canaryScript, /window\.addEventListener\('openpath-page-resource-candidate'/);
  });

  test('Linux canary waits for the enrollment seed before launching Firefox', () => {
    const canaryScript = readProjectText('scripts/linux-ajax-auto-allow-canary.mjs');

    assert.match(canaryScript, /LINUX_AJAX_AUTO_ALLOW_ENROLLMENT_WAIT_MS/);
    assert.match(canaryScript, /async function waitForEnrollmentSeed/);
    assert.match(canaryScript, /expectedHosts = \[\s*ORIGIN_HOST,[\s\S]*\.\.\.AUTO_ALLOW_PROBES/);
    assert.match(canaryScript, /collectLinuxFailureDebugSnapshot/);
    assert.match(
      canaryScript,
      /systemctl status openpath-sse-listener\.service openpath-update\.service/
    );
    assert.match(
      canaryScript,
      /journalctl -u openpath-sse-listener\.service -u openpath-update\.service/
    );
    assert.match(canaryScript, /\/etc\/openpath\/api-url\.conf/);
    assert.match(canaryScript, /openpath-native-host\.log/);
    assert.match(canaryScript, /whitelist_native_host\.json/);
    assert.match(
      canaryScript,
      /const failureDebug = success \? null : await collectLinuxFailureDebugSnapshot\(\);/
    );
    assert.match(canaryScript, /failureDebug,/);
    assert.match(canaryScript, /cat \/etc\/resolv\.conf/);
    assert.match(canaryScript, /getent hosts \$\{ORIGIN_HOST\}/);
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
    assert.ok(script.includes('PRODUCTION_LINUX_BOOTSTRAP_CANARY_ARTIFACT_PATH'));
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

  test('Linux bootstrap provisioning seeds the request API host for extension auto-allow', () => {
    const script = readProjectText('scripts/create-production-linux-bootstrap-canary.mjs');

    assert.match(script, /const requestApiHost = new URL\(apiUrl\)\.hostname;/);
    assert.match(
      script,
      /value: requestApiHost,[\s\S]*comment: 'Production Linux bootstrap canary request API seed rule'/
    );
  });
});
