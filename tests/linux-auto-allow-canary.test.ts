import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, test } from 'node:test';

import { readProjectText, runProjectCommand } from './helpers/ops-contracts.ts';
import {
  buildAjaxAutoAllowCanaryPage,
  waitForAjaxAutoAllowPageObserver,
} from '../scripts/lib/ajax-auto-allow-canary-harness.mjs';
import { collectCanaryGroupDiagnostics } from '../scripts/lib/canary-group-diagnostics.mjs';
import {
  LINUX_AUTO_ALLOW_PROBES,
  buildLinuxAutoAllowProbeUrl,
  withLinuxAutoAllowDiagnostics,
} from '../scripts/lib/linux-auto-allow-canary-evidence.mjs';
import { evaluateLinuxAjaxBrowserPageOutcome } from '../scripts/linux-ajax-canary-result.mjs';

const runtimeScriptPath = 'scripts/run-linux-bootstrap-ajax-canary-runtime.sh';

function createLinuxCanaryRuntimeHarness(
  options: {
    installer?: 'missing' | 'success' | 'failure';
    nodeCanaryExitCode?: number;
  } = {}
) {
  const tempDir = mkdtempSync(join(tmpdir(), 'linux-bootstrap-ajax-runtime-'));
  const binDir = join(tempDir, 'bin');
  const runnerTemp = join(tempDir, 'runner-temp');
  const workspace = join(runnerTemp, 'linux-production-bootstrap-canary');
  const outputPath = join(tempDir, 'github-output');
  const callsPath = join(tempDir, 'calls.log');
  const nodeCallsPath = join(tempDir, 'node-calls.log');
  mkdirSync(binDir, { recursive: true });
  mkdirSync(workspace, { recursive: true });

  const shim = (name: string, body: string) => {
    const path = join(binDir, name);
    writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
    chmodSync(path, 0o755);
  };

  shim(
    'sudo',
    `echo "sudo $*" >> "${callsPath}"; if [ "$1" = "bash" ]; then shift; exec bash "$@"; fi; exit 0`
  );
  shim(
    'sysctl',
    `echo "sysctl $*" >> "${callsPath}"; if [ "$1" = "-n" ]; then echo 1024; exit 0; fi; exit 0`
  );
  shim('systemctl', `echo "systemctl $*" >> "${callsPath}"; exit 0`);
  shim('apt-get', `echo "apt-get $*" >> "${callsPath}"; exit 0`);
  shim('resolvectl', `echo "resolvectl $*" >> "${callsPath}"; exit 0`);
  shim('ip', `echo "ip $*" >> "${callsPath}"; echo "default via 192.0.2.1 dev eth0"; exit 0`);
  shim(
    'getent',
    `echo "getent $*" >> "${callsPath}"; if [ "$1" = "ahostsv4" ]; then echo "203.0.113.7 STREAM $2"; fi; exit 0`
  );
  shim('rmdir', `echo "rmdir $*" >> "${callsPath}"; exit 0`);
  shim(
    'timeout',
    `echo "timeout $*" >> "${callsPath}"; while [ "$#" -gt 0 ]; do case "$1" in --kill-after=*) shift ;; [0-9]*s|[0-9]*m) shift; break ;; *) break ;; esac; done; exec "$@"`
  );
  shim('tee', `cat > "$1"`);
  shim(
    'node',
    `echo "node $*" >> "${nodeCallsPath}"; if [ "$1" = "-e" ]; then exec /usr/bin/node "$@"; fi; echo '{"ok":false,"failureBoundary":{"id":"node-rich","message":"rich artifact"}}' > production-linux-ajax-auto-allow-canary.json; exit ${options.nodeCanaryExitCode ?? 0}`
  );

  if (options.installer !== 'missing') {
    const installerPath = join(workspace, 'install-openpath.sh');
    writeFileSync(
      installerPath,
      `#!/usr/bin/env bash\necho installer-ran\nexit ${options.installer === 'failure' ? 27 : 0}\n`
    );
    chmodSync(installerPath, 0o755);
  }

  return {
    tempDir,
    outputPath,
    callsPath,
    nodeCallsPath,
    installerPath: join(workspace, 'install-openpath.sh'),
    env: {
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      RUNNER_TEMP: runnerTemp,
      GITHUB_OUTPUT: outputPath,
      LINUX_BOOTSTRAP_CANARY_ARTIFACT_DIR: tempDir,
      LINUX_AJAX_AUTO_ALLOW_CANARY_API_URL: 'https://classroompath.example',
      LINUX_AJAX_AUTO_ALLOW_CANARY_GROUP_ID: 'group-linux',
      LINUX_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN: 'protected-admin-token',
      EXPECTED_EXTENSION_ID: 'expected-extension',
    },
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

describe('Linux AJAX auto-allow canary contracts', () => {
  test('declares the production Linux AJAX/subresource probe table and artifact path', () => {
    const canaryScript = readProjectText('scripts/linux-ajax-auto-allow-canary.mjs');
    const sharedHarness = readProjectText('scripts/lib/ajax-auto-allow-canary-harness.mjs');
    const diagnosticsHelper = readProjectText('scripts/lib/canary-group-diagnostics.mjs');

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
    assert.ok(diagnosticsHelper.includes('/cp/internal/client-canary/group/'));
    assert.ok(canaryScript.includes('LINUX_AJAX_AUTO_ALLOW_CANARY_GROUP_ID'));
    assert.ok(canaryScript.includes('LINUX_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN'));
    assert.ok(canaryScript.includes('REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS'));
    assert.ok(canaryScript.includes('REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES'));
    assert.ok(canaryScript.includes('redditDiagnostics'));
    assert.ok(canaryScript.includes('completedRedditDiagnosticEvents'));
    assert.ok(canaryScript.includes('__openpathPageResourceObserverInstalled'));
    assert.ok(sharedHarness.includes('openpath-page-resource-candidate'));
    assert.ok(sharedHarness.includes('font/woff2'));
  });

  test('Linux font probe is validated by server traffic instead of font decode success', () => {
    const page = buildAjaxAutoAllowCanaryPage({
      platform: 'Linux',
      probes: LINUX_AUTO_ALLOW_PROBES,
      originHost: 'ajax-auto-allow-origin.127.0.0.1.sslip.io',
      port: 18088,
      timeoutMs: 5000,
      probeTimeoutMs: 1000,
    });

    assert.ok(
      page.includes("fetch('/probe-state?probe=' + encodeURIComponent(probeId)"),
      'Linux canary should expose per-probe hit counts to the browser page'
    );
    assert.ok(
      page.includes('const hits = await readProbeHits(probeId).catch(() => 0);'),
      'Linux font probe should use server hit evidence like the Windows canary'
    );
    assert.ok(
      page.includes('hits > 0 ? { ok: true, hits }'),
      'Linux font success must not depend on Firefox accepting the synthetic woff2 payload'
    );
    assert.ok(
      page.includes(
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

  test('Linux canary performs real Firefox extension warmup before origin navigation', () => {
    const canaryScript = readProjectText('scripts/linux-ajax-auto-allow-canary.mjs');

    assert.match(canaryScript, /async function waitForFirefoxExtensionRuntimeReady/);
    assert.match(canaryScript, /async function resolveFirefoxCanaryExtensionPath/);
    assert.match(
      canaryScript,
      /\/usr\/share\/openpath\/firefox-release\/openpath-firefox-extension\.xpi/
    );
    assert.match(canaryScript, /options\.addExtensions\(seleniumExtensionPath\);/);
    assert.match(canaryScript, /extensions\\.webextensions\\.uuids/);
    assert.match(canaryScript, /moz-extension:\/\/\$\{extensionUuid\}\/popup\/popup\.html/);
    assert.match(canaryScript, /const capabilities = await driver\.getCapabilities\(\);/);
    assert.match(canaryScript, /const profileDir = capabilities\.get\('moz:profile'\);/);
    assert.match(
      canaryScript,
      /firefoxExtensionWarmup = await waitForFirefoxExtensionRuntimeReady/
    );
    assert.doesNotMatch(canaryScript, /firefoxExtensionWarmup:\s*\{\s*ready:\s*true/);
  });

  test('Linux workflow runs the AJAX canary on the HTTP port allowed by the firewall', () => {
    const workflow = readProjectText('.github/workflows/linux-production-bootstrap-canary.yml');
    const ajaxStep =
      /name: Verify Linux AJAX auto-allow canary[\s\S]*?(?=\n      - name: Summarize Linux AJAX auto-allow evidence)/.exec(
        workflow
      )?.[0] ?? '';

    assert.match(ajaxStep, new RegExp(`bash ${runtimeScriptPath}`));
    assert.match(ajaxStep, /LINUX_BOOTSTRAP_CANARY_INSTALLER_PATH:/);
    assert.doesNotMatch(ajaxStep, /restore_linux_bootstrap_canary_external_dns\(\)/);
    assert.doesNotMatch(ajaxStep, /node scripts\/linux-ajax-auto-allow-canary\.mjs/);
  });

  test('Linux bootstrap runtime dry-run succeeds, restores DNS, and writes outputs', () => {
    const harness = createLinuxCanaryRuntimeHarness({ installer: 'success' });
    try {
      const result = runProjectCommand('bash', [runtimeScriptPath], { env: harness.env });

      assert.equal(result.status, 0, result.stderr);
      assert.match(readFileSync(harness.outputPath, 'utf8'), /canary_result=success/);
      assert.match(
        readFileSync(harness.nodeCallsPath, 'utf8'),
        /node scripts\/linux-ajax-auto-allow-canary\.mjs/
      );
      assert.match(
        readFileSync(harness.callsPath, 'utf8'),
        /sysctl -w net\.ipv4\.ip_unprivileged_port_start=0/
      );
      assert.match(
        readFileSync(harness.callsPath, 'utf8'),
        /sysctl -w net\.ipv4\.ip_unprivileged_port_start=1024/
      );
      assert.match(
        readFileSync(harness.callsPath, 'utf8'),
        /getent ahostsv4 classroompath\.example/
      );
      assert.match(readFileSync(harness.callsPath, 'utf8'), /sudo tee -a \/etc\/hosts/);
      assert.match(
        readFileSync(harness.callsPath, 'utf8'),
        /getent hosts raw\.githubusercontent\.com/
      );
      assert.match(
        readFileSync(join(harness.tempDir, 'linux-install-openpath.log'), 'utf8'),
        /installer-ran/
      );
    } finally {
      harness.cleanup();
    }
  });

  test('Linux bootstrap runtime records install boundary when installer is missing', () => {
    const harness = createLinuxCanaryRuntimeHarness({ installer: 'missing' });
    try {
      const result = runProjectCommand('bash', [runtimeScriptPath], { env: harness.env });

      assert.equal(result.status, 1);
      assert.match(readFileSync(harness.outputPath, 'utf8'), /canary_result=failure/);
      assert.match(
        readFileSync(harness.outputPath, 'utf8'),
        /failure_boundary_id=linux-install-openpath/
      );
      assert.match(
        readFileSync(join(harness.tempDir, 'production-linux-ajax-auto-allow-canary.json'), 'utf8'),
        /Linux enrollment script was not downloaded/
      );
      assert.match(
        readFileSync(harness.callsPath, 'utf8'),
        /getent hosts raw\.githubusercontent\.com/
      );
    } finally {
      harness.cleanup();
    }
  });

  test('Linux bootstrap runtime preserves installer log and status on install failure', () => {
    const harness = createLinuxCanaryRuntimeHarness({ installer: 'failure' });
    try {
      const result = runProjectCommand('bash', [runtimeScriptPath], { env: harness.env });

      assert.equal(result.status, 27);
      assert.match(
        readFileSync(harness.outputPath, 'utf8'),
        /failure_boundary_id=linux-install-openpath/
      );
      assert.match(
        readFileSync(join(harness.tempDir, 'linux-install-openpath.log'), 'utf8'),
        /installer-ran/
      );
      assert.match(
        readFileSync(join(harness.tempDir, 'production-linux-ajax-auto-allow-canary.json'), 'utf8'),
        /Linux enrollment script failed before the AJAX auto-allow canary could run/
      );
      assert.equal(
        JSON.parse(
          readFileSync(
            join(harness.tempDir, 'production-linux-ajax-auto-allow-canary.json'),
            'utf8'
          )
        ).boundarySource,
        'infrastructure'
      );
    } finally {
      harness.cleanup();
    }
  });

  test('Linux bootstrap runtime does not overwrite rich Node artifact on functional failure', () => {
    const harness = createLinuxCanaryRuntimeHarness({
      installer: 'success',
      nodeCanaryExitCode: 19,
    });
    try {
      const result = runProjectCommand('bash', [runtimeScriptPath], { env: harness.env });

      assert.equal(result.status, 19);
      assert.match(
        readFileSync(join(harness.tempDir, 'production-linux-ajax-auto-allow-canary.json'), 'utf8'),
        /node-rich/
      );
      assert.doesNotMatch(
        readFileSync(join(harness.tempDir, 'production-linux-ajax-auto-allow-canary.json'), 'utf8'),
        /linux-install-openpath/
      );
    } finally {
      harness.cleanup();
    }
  });

  test('Linux canary bounds Firefox page-load waits before probing', () => {
    const canaryScript = readProjectText('scripts/linux-ajax-auto-allow-canary.mjs');

    assert.ok(canaryScript.includes('LINUX_AJAX_AUTO_ALLOW_PAGE_LOAD_TIMEOUT_MS'));
    assert.ok(canaryScript.includes('await driver.manage().setTimeouts'));
    assert.ok(canaryScript.includes('pageLoad: PAGE_LOAD_TIMEOUT_MS'));
    assert.ok(canaryScript.includes('Linux AJAX canary page load did not complete'));
  });

  test('Linux diagnostics accept page-load timeout when browser evidence and probes converge', () => {
    const summary = withLinuxAutoAllowDiagnostics({
      firefoxExtensionWarmup: { ready: true },
      originHits: 1,
      originPageHits: 1,
      pageObserverInstalled: true,
      completedCandidateEvents: Object.fromEntries(
        LINUX_AUTO_ALLOW_PROBES.map((probe) => [probe.id, true])
      ),
      probeEvidence: LINUX_AUTO_ALLOW_PROBES.map((probe) => ({
        id: probe.id,
        expectedWhitelistHost: probe.expectedWhitelistHost,
        hits: 1,
        whitelistContainsExpectedHost: true,
      })),
      firstPageLoadCompleted: false,
      firstPageLoadError: 'Navigation timed out after 15000 ms',
      browserNavigation: {
        beforeAttempts: { ok: true },
      },
      diagnostics: {
        postAttempt: {
          server: {
            canaryGroup: {
              body: {
                rules: LINUX_AUTO_ALLOW_PROBES.map((probe) => ({
                  type: 'whitelist',
                  value: probe.expectedWhitelistHost,
                })),
              },
            },
          },
          whitelist: {
            local: {
              containsExpectedHosts: Object.fromEntries(
                LINUX_AUTO_ALLOW_PROBES.map((probe) => [probe.expectedWhitelistHost, true])
              ),
            },
          },
          dns: {
            containsExpectedHosts: Object.fromEntries(
              LINUX_AUTO_ALLOW_PROBES.map((probe) => [probe.expectedWhitelistHost, true])
            ),
          },
        },
      },
    });

    assert.equal(summary.failureBoundary.id, 'none');
  });

  test('Linux AJAX canary rejects eventual server hits when browser page probes timed out', () => {
    const outcome = evaluateLinuxAjaxBrowserPageOutcome({
      firstPageLoadCompleted: false,
      firstPageLoadError: 'Navigation timed out after 15000 ms',
      browserNavigation: {
        afterAttempts: {
          ok: true,
          canaryState: {
            attempts: [
              {
                probes: Object.fromEntries(
                  LINUX_AUTO_ALLOW_PROBES.map((probe) => [
                    probe.id,
                    { ok: false, error: `${probe.id} timed out after 5000ms` },
                  ])
                ),
              },
            ],
          },
        },
      },
      expectedProbeIds: LINUX_AUTO_ALLOW_PROBES.map((probe) => probe.id),
    });

    assert.equal(outcome.success, false);
    assert.equal(outcome.firstPageLoadCompleted, false);
    assert.deepEqual(
      outcome.failedProbeIds,
      LINUX_AUTO_ALLOW_PROBES.map((probe) => probe.id)
    );
    assert.deepEqual(
      outcome.timedOutProbeIds,
      LINUX_AUTO_ALLOW_PROBES.map((probe) => probe.id)
    );
  });

  test('Linux canary waits for managed Firefox content-script injection before counting probes', async () => {
    let diagnosticsCalls = 0;
    const visited: string[] = [];
    const driver = {
      get: async (url: string) => {
        visited.push(url);
      },
    };

    const diagnostics = await waitForAjaxAutoAllowPageObserver({
      driver,
      originUrl: 'http://ajax-auto-allow-origin.127.0.0.1.sslip.io:18088/',
      timeoutMs: 100,
      reloadEveryMs: 1,
      pollMs: 1,
      collectBrowserNavigationDiagnostics: async () => {
        diagnosticsCalls += 1;
        return {
          ok: true,
          openpathObserverInstalled: diagnosticsCalls >= 3,
          openpathObserverState: { patched: diagnosticsCalls >= 3 },
        };
      },
    });

    assert.equal(diagnostics.openpathObserverInstalled, true);
    assert.deepEqual(visited, ['http://ajax-auto-allow-origin.127.0.0.1.sslip.io:18088/']);
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

  test('Linux canary runs probe attempts in parallel so diagnostics are not delayed by serial timeouts', () => {
    const sharedHarness = readProjectText('scripts/lib/ajax-auto-allow-canary-harness.mjs');

    assert.match(sharedHarness, /const results = await Promise\.all\(/);
    assert.match(sharedHarness, /probes\.map\(async \(probe\) => \{/);
    assert.doesNotMatch(
      sharedHarness,
      /for \(const probe of probes\) \{[\s\S]*await timeout\(runProbeOnce\(probe\)\)/
    );
  });

  test('Linux canary retries protected diagnostics when the server returns a rate limit', async () => {
    const requests: string[] = [];
    const sleeps: number[] = [];
    const responses = [
      { status: 429, body: { error: { data: { retryAfterMs: 25 } } } },
      { status: 200, body: { ok: true } },
    ];

    const diagnostics = await collectCanaryGroupDiagnostics({
      apiUrl: 'https://classroompath.example/',
      groupId: 'group-linux',
      adminToken: 'protected-admin-token',
      fetchImpl: async (url: string) => {
        requests.push(url);
        const response = responses.shift();
        return {
          status: response?.status ?? 500,
          json: async () => response?.body ?? null,
        };
      },
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });

    assert.equal(diagnostics.available, true);
    assert.equal(diagnostics.status, 200);
    assert.equal(diagnostics.attempt, 2);
    assert.deepEqual(sleeps, [25]);
    assert.deepEqual(requests, [
      'https://classroompath.example/cp/internal/client-canary/group/group-linux/diagnostics',
      'https://classroompath.example/cp/internal/client-canary/group/group-linux/diagnostics',
    ]);
  });

  test('Linux canary preserves artifacts and raw log on functional failure', () => {
    const workflow = readProjectText('.github/workflows/linux-production-bootstrap-canary.yml');
    const runtimeScript = readProjectText(runtimeScriptPath);

    assert.match(
      workflow,
      /name: Checkout\s+uses: actions\/checkout@v6\s+with:\s+persist-credentials: false/
    );
    assert.match(
      runtimeScript,
      /timeout --kill-after=30s 10m node scripts\/linux-ajax-auto-allow-canary\.mjs 2>&1 \| tee linux-ajax-auto-allow-canary\.log[\s\S]*ajax_status="\$\{PIPESTATUS\[0\]\}"/
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
      /name: Initialize Linux canary evidence files[\s\S]*production-linux-bootstrap-canary\.json[\s\S]*production-linux-ajax-auto-allow-canary\.json[\s\S]*linux-install-openpath\.log[\s\S]*linux-ajax-auto-allow-canary\.log/,
      'workflow should create placeholder artifacts before remote SSH reads can fail'
    );
    assert.match(
      workflow,
      /Could not read CP_BILLING_MODE from the target host over SSH\./,
      'billing-mode SSH failures should be preserved in the canary JSON artifact'
    );
    assert.match(
      workflow,
      /Could not read CP_CLIENT_CANARY_ADMIN_TOKEN from the target host over SSH\./,
      'admin-token SSH failures should be preserved in the canary JSON artifact'
    );
    assert.match(
      workflow,
      /FAILURE_BOUNDARY_MESSAGE='Could not read CP_BILLING_MODE from the target host over SSH\.'[\s\S]*node scripts\/write-linux-bootstrap-canary-failure\.mjs remote-env-read/,
      'billing-mode SSH failures should be written without indentation-sensitive heredocs'
    );
    assert.match(
      workflow,
      /FAILURE_BOUNDARY_MESSAGE='Could not read CP_CLIENT_CANARY_ADMIN_TOKEN from the target host over SSH\.'[\s\S]*node scripts\/write-linux-bootstrap-canary-failure\.mjs remote-env-read/,
      'admin-token SSH failures should be written without indentation-sensitive heredocs'
    );
    assert.match(
      workflow,
      /if ! node scripts\/create-production-linux-bootstrap-canary\.mjs; then[\s\S]*FAILURE_BOUNDARY_MESSAGE='Linux bootstrap canary provisioning failed before the client install step\.'[\s\S]*node scripts\/write-linux-bootstrap-canary-failure\.mjs provisioning/,
      'provisioning failures should be preserved as infrastructure boundaries'
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
    const runtimeScript = readProjectText(runtimeScriptPath);
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
      new RegExp(`bash ${runtimeScriptPath}`),
      'AJAX step should delegate runtime behavior to the repo script'
    );
    assert.match(
      runtimeScript,
      /trap restore_linux_bootstrap_canary_external_dns EXIT[\s\S]*sudo bash "\$installer_path" 2>&1 \| tee linux-install-openpath\.log[\s\S]*install_status="\$\{PIPESTATUS\[0\]\}"/,
      'runtime script must install OpenPath, preserve the installer log, and always restore runner DNS before exiting'
    );
    assert.match(
      runtimeScript,
      /write_github_output failure_boundary_id linux-install-openpath[\s\S]*exit "\$install_status"/,
      'installer failures should be recorded as an installation boundary, not as missing artifacts'
    );
    assert.doesNotMatch(
      runtimeScript,
      /node <<'NODE'/,
      'AJAX step must avoid heredocs in nested failure branches because YAML indentation breaks Bash delimiters'
    );
    assert.match(
      runtimeScript,
      /FAILURE_MESSAGE="\$message" node -e/,
      'installer failure artifact should be written without an indentation-sensitive heredoc'
    );
    assert.match(
      runtimeScript,
      /pin_linux_bootstrap_canary_api_host[\s\S]*getent ahostsv4 "\$api_host"[\s\S]*sudo tee -a \/etc\/hosts[\s\S]*pin_linux_bootstrap_canary_api_host/,
      'runtime should pin the ClassroomPath API host before OpenPath changes runner DNS'
    );
    assert.match(
      runtimeScript,
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

  test('Linux bootstrap canary failure helper writes a boundary artifact', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'linux-bootstrap-canary-failure-'));
    const artifactPath = join(tempDir, 'production-linux-ajax-auto-allow-canary.json');

    const result = runProjectCommand(
      'node',
      ['scripts/write-linux-bootstrap-canary-failure.mjs', 'remote-env-read'],
      {
        env: {
          LINUX_AJAX_AUTO_ALLOW_CANARY_ARTIFACT: artifactPath,
          FAILURE_BOUNDARY_MESSAGE: 'Could not read CP_BILLING_MODE from the target host over SSH.',
        },
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(artifactPath, 'utf8')), {
      success: false,
      boundarySource: 'infrastructure',
      failureBoundary: {
        id: 'remote-env-read',
        message: 'Could not read CP_BILLING_MODE from the target host over SSH.',
      },
      diagnosticPhases: [
        {
          id: 'remote-env-read',
          status: 'failed',
          message: 'Could not read CP_BILLING_MODE from the target host over SSH.',
          evidence: {
            artifactWritten: true,
          },
        },
      ],
      artifactWritten: true,
    });
  });

  test('Linux bootstrap canary summarizer preserves infrastructure boundaries', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'linux-bootstrap-canary-summary-'));
    const artifactPath = join(tempDir, 'production-linux-ajax-auto-allow-canary.json');
    const summaryPath = join(tempDir, 'linux-ajax-auto-allow-canary-summary.md');
    writeFileSync(
      artifactPath,
      `${JSON.stringify({
        success: false,
        boundarySource: 'infrastructure',
        failureBoundary: {
          id: 'remote-env-read',
          message: 'Could not read CP_BILLING_MODE from the target host over SSH.',
        },
        diagnosticPhases: [
          {
            id: 'remote-env-read',
            status: 'failed',
            message: 'Could not read CP_BILLING_MODE from the target host over SSH.',
            evidence: { artifactWritten: true },
          },
        ],
        artifactWritten: true,
      })}\n`
    );

    const result = runProjectCommand(
      'node',
      [
        'scripts/summarize-linux-ajax-auto-allow-evidence.mjs',
        '--artifact',
        artifactPath,
        '--summary',
        summaryPath,
      ],
      {}
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Failure boundary: `remote-env-read`/);
    assert.doesNotMatch(result.stdout, /firefox-extension-ready/);
    assert.match(readFileSync(summaryPath, 'utf8'), /remote-env-read \| failed/);
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
    const sharedHarness = readProjectText('scripts/lib/ajax-auto-allow-canary-harness.mjs');
    const evidenceHelper = readProjectText('scripts/lib/linux-auto-allow-canary-evidence.mjs');

    assert.match(sharedHarness, /originPageHits: 0/);
    assert.match(sharedHarness, /attemptHits: 0/);
    assert.match(sharedHarness, /if \(host === originHost\) \{[\s\S]*state\.originPageHits \+= 1/);
    assert.match(sharedHarness, /function mergeAttemptState[\s\S]*state\.attemptHits \+= 1/);
    assert.match(canaryScript, /async function collectBrowserNavigationDiagnostics/);
    assert.match(canaryScript, /browserNavigation/);
    assert.match(canaryScript, /__openpathLinuxAjaxCanaryState/);
    assert.match(sharedHarness, /window\.addEventListener\('error'/);
    assert.match(sharedHarness, /canaryState\.lastPhase = 'read-probe-hits:' \+ probeId/);
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
    const sharedHarness = readProjectText('scripts/lib/ajax-auto-allow-canary-harness.mjs');

    assert.match(sharedHarness, /openpath-page-resource-candidate/);
    assert.match(sharedHarness, /window\.addEventListener\('openpath-page-resource-candidate'/);
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
    assert.match(script, /async function fetchWithRetry\(input, init = \{\}, attempts = 6\)/);
    assert.match(script, /Fetch attempt \$\{attempt\}\/\$\{attempts\} failed/);
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
