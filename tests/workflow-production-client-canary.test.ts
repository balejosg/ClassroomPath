import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readProjectText, readProjectWorkflow } from './helpers/ops-contracts.ts';
import {
  REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS,
  WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_HOST,
  WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_URL,
  WINDOWS_AUTO_ALLOW_OBSERVATION_PROBES,
  WINDOWS_AUTO_ALLOW_PROBES,
  assertWindowsAutoAllowCanarySuccess,
  buildWindowsAutoAllowCanarySummary,
  redactWindowsCanaryObject,
} from '../scripts/lib/windows-auto-allow-canary-evidence.mjs';

const windowsRunnerDnsActionPath = '.github/actions/restore-windows-runner-dns/action.yml';
const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');
const windowsAutoAllowExpectedHosts = WINDOWS_AUTO_ALLOW_PROBES.map(
  (probe) => probe.expectedWhitelistHost
);
const windowsObservedHosts = WINDOWS_AUTO_ALLOW_OBSERVATION_PROBES.map(
  (probe) => probe.expectedWhitelistHost
);

function buildContainsExpectedHosts(value: boolean, hosts = windowsAutoAllowExpectedHosts) {
  return Object.fromEntries(hosts.map((host) => [host, value]));
}

function buildProbeEvidence({
  hits = 1,
  whitelistContainsExpectedHost = true,
  probes = WINDOWS_AUTO_ALLOW_PROBES,
}: {
  hits?: number;
  whitelistContainsExpectedHost?: boolean;
  probes?: typeof WINDOWS_AUTO_ALLOW_PROBES | typeof WINDOWS_AUTO_ALLOW_OBSERVATION_PROBES;
} = {}) {
  return probes.map((probe) => ({
    id: probe.id,
    kind: probe.kind,
    host: probe.host,
    url: `http://${probe.host}:18088${probe.path}`,
    hits,
    expectedWhitelistHost: probe.expectedWhitelistHost,
    whitelistContainsExpectedHost,
  }));
}

function buildProbeMap(value: boolean) {
  return Object.fromEntries(WINDOWS_AUTO_ALLOW_PROBES.map((probe) => [probe.id, value]));
}

function buildCandidateEvents() {
  return WINDOWS_AUTO_ALLOW_PROBES.map((probe) => ({
    kind: probe.kind,
    url: `http://${probe.host}:18088${probe.path}`,
    matchedProbeId: probe.id,
    seenAt: '2026-04-27T10:00:00.000Z',
  }));
}

function buildServerExpectedHostState(value: boolean) {
  return Object.fromEntries(
    windowsAutoAllowExpectedHosts.map((host) => [host, { whitelistRulePresent: value }])
  );
}

function buildDiagnosticSummary(
  overrides: {
    success?: boolean;
    firefoxReady?: boolean;
    originHits?: number;
    pageObserverInstalled?: boolean;
    completedCandidateEvents?: Record<string, boolean>;
    pageResourceCandidateEvents?: Array<Record<string, unknown>>;
    remoteWhitelistContainsExpectedHosts?: boolean;
    localWhitelistContainsExpectedHost?: boolean;
    automaticRuleCreated?: boolean;
    probeHits?: number;
    observedProbeHits?: number;
    allowlistedNavigation?: Record<string, unknown>;
    blockedPageUnblockRequest?: Record<string, unknown>;
    redditNavigation?: Record<string, unknown>;
  } = {}
) {
  const remoteWhitelistContainsExpectedHosts =
    overrides.remoteWhitelistContainsExpectedHosts ?? true;
  const observedHostsPresent = overrides.automaticRuleCreated ?? false;

  return buildWindowsAutoAllowCanarySummary({
    result: {
      success: overrides.success ?? true,
      pageObserverInstalled: overrides.pageObserverInstalled ?? true,
    },
    probeEvidence: [
      ...buildProbeEvidence({
        hits: overrides.probeHits ?? 1,
        whitelistContainsExpectedHost: overrides.localWhitelistContainsExpectedHost ?? true,
      }),
      ...buildProbeEvidence({
        hits: overrides.observedProbeHits ?? 1,
        whitelistContainsExpectedHost: false,
        probes: WINDOWS_AUTO_ALLOW_OBSERVATION_PROBES,
      }),
    ],
    originHits: overrides.originHits ?? 1,
    attempts: [{ ok: true }],
    completedProbes: buildProbeMap(true),
    completedCandidateEvents:
      overrides.completedCandidateEvents ??
      ({
        ...buildProbeMap(true),
        ...Object.fromEntries(
          WINDOWS_AUTO_ALLOW_OBSERVATION_PROBES.map((probe) => [probe.id, true])
        ),
      } as Record<string, boolean>),
    pageResourceCandidateEvents: overrides.pageResourceCandidateEvents ?? [
      ...buildCandidateEvents(),
      ...WINDOWS_AUTO_ALLOW_OBSERVATION_PROBES.map((probe) => ({
        kind: probe.kind,
        url: `http://${probe.host}:18088${probe.path}`,
        matchedProbeId: probe.id,
        seenAt: '2026-04-27T10:00:00.000Z',
      })),
    ],
    ...(overrides.redditNavigation
      ? {
          redditDiagnostics: {
            navigation: overrides.redditNavigation,
          },
        }
      : {}),
    allowlistedNavigation:
      'allowlistedNavigation' in overrides
        ? overrides.allowlistedNavigation
        : ({
            url: WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_URL,
            expectedHosts: [WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_HOST],
            finalHost: WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_HOST,
            href: WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_URL,
            title: 'Example Domain',
            success: true,
            blockedByOpenPath: false,
            timedOut: false,
            errors: [],
          } as Record<string, unknown>),
    blockedPageUnblockRequest:
      'blockedPageUnblockRequest' in overrides
        ? overrides.blockedPageUnblockRequest
        : ({
            success: true,
            permissionsMonkeypatch: false,
            permissionStrategy: 'required-data-collection',
            extensionSource: 'managed',
            firefoxMode: 'selenium-managed',
            blockedPageDomain: 'blocked-page-unblock-request.127.0.0.1.sslip.io',
            blockedPageUrl:
              'moz-extension://canary/blocked/blocked.html?domain=blocked-page-unblock-request.127.0.0.1.sslip.io',
            statusText: 'Solicitud enviada. Quedara pendiente hasta que la revisen.',
            errorText: '',
          } as Record<string, unknown>),
    lastAttemptAt: '2026-04-27T10:00:00.000Z',
    whitelistPath: 'C:\\OpenPath\\data\\whitelist.txt',
    firefoxExtensionWarmup: { ready: overrides.firefoxReady ?? true },
    firefoxOutput: 'ready',
    diagnostics: {
      preflight: {},
      postAttempt: {
        remoteWhitelist: {
          containsExpectedHosts: {
            ...buildContainsExpectedHosts(remoteWhitelistContainsExpectedHosts),
            ...buildContainsExpectedHosts(observedHostsPresent, windowsObservedHosts),
          },
        },
        whitelist: {
          local: {
            containsExpectedHosts: buildContainsExpectedHosts(
              observedHostsPresent,
              windowsObservedHosts
            ),
          },
          remoteWhitelist: {
            containsExpectedHosts: buildContainsExpectedHosts(remoteWhitelistContainsExpectedHosts),
          },
        },
        server: {
          canaryGroup: {
            body: {
              expectedHostState: buildServerExpectedHostState(remoteWhitelistContainsExpectedHosts),
            },
          },
        },
      },
    },
  });
}

describe('Windows AJAX auto-allow canary evidence contracts', () => {
  test('production client canary declares signal class and safe duplicate suppression', () => {
    const workflow = readProjectWorkflow('.github/workflows/production-client-update-canary.yml');
    const workflowText = readProjectText('.github/workflows/production-client-update-canary.yml');
    const guardJob = workflow.jobs?.['ci-signal-policy'];
    const downloadJob = workflow.jobs?.['production-enrollment-download-canary'];
    const windowsJob = workflow.jobs?.['windows-client-self-update-canary'];
    const linuxJob = workflow.jobs?.['linux-client-self-update-canary'];
    const duplicateStep = guardJob?.steps?.find(
      (step) => step.name === 'Evaluate scheduled duplicate policy'
    );
    const hygieneStep = guardJob?.steps?.find(
      (step) => step.name === 'Report stale scheduled workflow runs'
    );
    const uploadPolicyEvidenceStep = guardJob?.steps?.find(
      (step) => step.name === 'Upload CI signal policy evidence'
    );
    const uploadHygieneEvidenceStep = guardJob?.steps?.find(
      (step) => step.name === 'Upload CI workflow hygiene report'
    );

    assert.equal(workflow.on?.schedule?.[0]?.cron, '*/15 * * * *');
    assert.equal(workflow.permissions?.actions, 'read');
    assert.equal(guardJob?.['runs-on'], 'ubuntu-latest');
    assert.equal(guardJob?.outputs?.should_skip, '${{ steps.duplicate.outputs.should_skip }}');
    assert.equal(
      guardJob?.outputs?.last_live_tested_at,
      '${{ steps.duplicate.outputs.last_live_tested_at }}'
    );
    assert.equal(
      guardJob?.outputs?.evidence_state,
      '${{ steps.duplicate.outputs.evidence_state }}'
    );
    assert.equal(guardJob?.outputs?.evidenceLevel, '${{ steps.duplicate.outputs.evidenceLevel }}');
    assert.match(String(duplicateStep?.run ?? ''), /ci-signal-policy\.mjs duplicate-suppression/);
    assert.equal(duplicateStep?.env?.CI_SIGNAL_CLASS, 'post-release health');
    assert.equal(duplicateStep?.env?.CI_DUPLICATE_FRESHNESS_WINDOW, '60m');
    assert.equal(duplicateStep?.env?.CI_WORKFLOW_NAME, 'Production Client Update Canary');
    assert.equal(
      duplicateStep?.env?.CI_SIGNAL_POLICY_EVIDENCE_PATH,
      'ci-signal-policy-evidence.json'
    );
    assert.match(String(hygieneStep?.run ?? ''), /ci-workflow-hygiene\.mjs report-stale-runs/);
    assert.equal(hygieneStep?.env?.CI_WORKFLOW_HYGIENE_MODE, 'dry-run');
    assert.equal(hygieneStep?.env?.CI_WORKFLOW_HYGIENE_STALE_AFTER, '90m');
    assert.equal(
      hygieneStep?.env?.CI_WORKFLOW_HYGIENE_WORKFLOWS,
      'Production Client Update Canary,Sync OpenPath'
    );
    assert.equal(
      hygieneStep?.env?.CI_WORKFLOW_HYGIENE_EVIDENCE_PATH,
      'ci-workflow-hygiene-report.json'
    );
    assert.doesNotMatch(String(hygieneStep?.run ?? ''), /--cancel/);
    assert.equal(uploadPolicyEvidenceStep?.uses, 'actions/upload-artifact@v7');
    assert.equal(uploadPolicyEvidenceStep?.with?.name, 'ci-signal-policy-evidence');
    assert.equal(uploadPolicyEvidenceStep?.with?.path, 'ci-signal-policy-evidence.json');
    assert.equal(uploadPolicyEvidenceStep?.with?.['if-no-files-found'], 'error');
    assert.equal(uploadHygieneEvidenceStep?.uses, 'actions/upload-artifact@v7');
    assert.equal(uploadHygieneEvidenceStep?.with?.name, 'ci-workflow-hygiene-report');
    assert.equal(uploadHygieneEvidenceStep?.with?.path, 'ci-workflow-hygiene-report.json');
    assert.equal(uploadHygieneEvidenceStep?.with?.['if-no-files-found'], 'error');
    assert.match(
      String(downloadJob?.if ?? ''),
      /needs\.ci-signal-policy\.outputs\.should_skip != 'true'/
    );
    assert.equal(workflow.on?.workflow_run, undefined);
    assert.match(String(windowsJob?.if ?? ''), /github\.event_name == 'workflow_dispatch'/);
    assert.match(String(linuxJob?.if ?? ''), /github\.event_name == 'workflow_dispatch'/);
    assert.doesNotMatch(String(windowsJob?.if ?? ''), /workflow_run/);
    assert.doesNotMatch(String(linuxJob?.if ?? ''), /workflow_run/);
    assert.ok(
      workflowText.includes(
        'CI_DUPLICATE_POLICY: same workflow success or deploy evidence + same SHA within 60m'
      ),
      'workflow summary should expose the duplicate-run policy'
    );
    assert.ok(workflowText.includes('skipped-duplicate'));
    assert.ok(workflowText.includes('manual-dispatch-required'));
    assert.ok(workflowText.includes('ci-signal-policy-evidence.json'));
    assert.ok(workflowText.includes('name: ci-signal-policy-evidence'));
    assert.ok(workflowText.includes('ci-workflow-hygiene-report.json'));
    assert.ok(workflowText.includes('name: ci-workflow-hygiene-report'));
  });

  test('ci/cd signal inventory classifies schedules and duplicate-run policy', () => {
    const inventory = readProjectText('docs/ci-cd-signal-inventory.md');

    for (const token of [
      '`production-client-update-canary.yml`',
      '`sync-openpath.yml`',
      '`self-hosted-windows-runner-smoke.yml`',
      '`cleanup-staging.yml`',
      '`security.yml`',
      'blocking release gate',
      'post-release health',
      'advisory drift detection',
      'maintenance',
      'same workflow already passed on the same SHA within 60 minutes',
      'Manual dispatch is never suppressed',
      'Do not suppress by SHA; environment drift can change without a commit',
      'Tag production deploys are non-cancelable',
      'Blocks release?',
    ]) {
      assert.ok(inventory.includes(token), `inventory should include ${token}`);
    }
  });

  test('ci/cd signal inventory covers scheduled and post-deploy workflows', () => {
    const inventory = readProjectText('docs/ci-cd-signal-inventory.md');
    const workflowDir = resolve(projectRoot, '.github/workflows');
    const signalWorkflows = readdirSync(workflowDir)
      .filter((entry) => /\.ya?ml$/.test(entry))
      .filter((entry) => {
        const text = readProjectText(`.github/workflows/${entry}`);
        return (
          text.includes('schedule:') ||
          text.includes('workflow_run:') ||
          text.includes('advisory') ||
          entry.includes('cleanup') ||
          entry.includes('security')
        );
      })
      .sort();

    for (const workflow of signalWorkflows) {
      const rowPattern = new RegExp(
        `\\| \`${workflow.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\`\\s+\\|[^\\n]+\\|[^\\n]+\\|[^\\n]+\\|[^\\n]+\\|[^\\n]+\\|[^\\n]+\\|[^\\n]+\\|`
      );
      assert.match(inventory, rowPattern, `${workflow} must declare its CI signal policy`);
    }
  });

  test('successful scheduled download canary uses short retention without weakening failures', () => {
    const workflow = readProjectWorkflow('.github/workflows/production-client-update-canary.yml');
    const downloadJob = workflow.jobs?.['production-enrollment-download-canary'];
    const routineUploadStep = downloadJob?.steps?.find(
      (step) => step.name === 'Upload routine production enrollment download canary artifact'
    );
    const diagnosticUploadStep = downloadJob?.steps?.find(
      (step) => step.name === 'Upload diagnostic production enrollment download canary artifact'
    );

    assert.match(String(routineUploadStep?.if ?? ''), /github\.event_name == 'schedule'/);
    assert.match(String(routineUploadStep?.if ?? ''), /success\(\)/);
    assert.equal(routineUploadStep?.with?.['retention-days'], 7);
    assert.equal(routineUploadStep?.with?.overwrite, true);

    assert.match(String(diagnosticUploadStep?.if ?? ''), /always\(\)/);
    assert.match(String(diagnosticUploadStep?.if ?? ''), /github\.event_name != 'schedule'/);
    assert.match(String(diagnosticUploadStep?.if ?? ''), /!success\(\)/);
    assert.equal(diagnosticUploadStep?.with?.['retention-days'], 14);
    assert.equal(diagnosticUploadStep?.with?.overwrite, true);
  });

  test('keeps probe metadata and failure messages in one importable table', () => {
    assert.deepEqual(
      WINDOWS_AUTO_ALLOW_PROBES.map((probe) => probe.id),
      [
        'ajax-fetch',
        'xhr-subresource',
        'image-subresource',
        'script-subresource',
        'stylesheet-subresource',
        'font-subresource',
        'stylesheet-font-subresource',
      ]
    );
    assert.ok(
      WINDOWS_AUTO_ALLOW_PROBES.every(
        (probe) => probe.expectedWhitelistHost && probe.failureMessage
      )
    );
    assert.ok(
      WINDOWS_AUTO_ALLOW_PROBES.some(
        (probe) => probe.failureMessage === 'Explicit AJAX target was not written to whitelist'
      )
    );
    assert.deepEqual(
      WINDOWS_AUTO_ALLOW_OBSERVATION_PROBES.map((probe) => probe.id),
      [
        'observed-fetch',
        'observed-xhr',
        'observed-image',
        'observed-script',
        'observed-stylesheet',
        'observed-font',
      ]
    );
    assert.ok(
      WINDOWS_AUTO_ALLOW_OBSERVATION_PROBES.every(
        (probe) => probe.automaticRuleCreationExpected === false && probe.requiresTraffic !== false
      )
    );
    assert.deepEqual(REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS, [
      'emoji.redditmedia.com',
      'external-preview.redd.it',
      'i.redd.it',
      'styles.redditmedia.com',
      'www.redditstatic.com',
    ]);
    assert.equal(WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_HOST, 'example.com');
  });

  test('classifies canary summary from probe evidence without live side effects', () => {
    const successfulSummary = buildDiagnosticSummary();

    assert.equal(successfulSummary.success, true);
    assert.equal(successfulSummary.whitelistContainsTarget, true);
    assert.equal(successfulSummary.whitelistContainsAsset, true);
    assert.equal(successfulSummary.targetHits, 1);
    assert.equal(successfulSummary.assetHits, 1);
    assert.equal(successfulSummary.scriptHits, 1);
    assert.equal(successfulSummary.stylesheetHits, 1);
    assert.equal(successfulSummary.fontHits, 1);
    assert.doesNotThrow(() => assertWindowsAutoAllowCanarySuccess(successfulSummary));

    const failedSummary = buildWindowsAutoAllowCanarySummary({
      result: { success: true },
      probeEvidence: WINDOWS_AUTO_ALLOW_PROBES.map((probe) => ({
        id: probe.id,
        kind: probe.kind,
        host: probe.host,
        url: `http://${probe.host}:18088${probe.path}`,
        hits: 0,
        expectedWhitelistHost: probe.expectedWhitelistHost,
        whitelistContainsExpectedHost: false,
      })),
      originHits: 1,
      attempts: [],
      completedProbes: {},
      lastAttemptAt: '',
      whitelistPath: 'C:\\OpenPath\\data\\whitelist.txt',
      firefoxExtensionWarmup: { success: true },
      firefoxOutput: '',
      diagnostics: { preflight: {}, postAttempt: {} },
      allowlistedNavigation: { success: true },
      blockedPageUnblockRequest: {
        success: true,
        permissionsMonkeypatch: false,
        permissionStrategy: 'required-data-collection',
      },
    });

    assert.throws(
      () => assertWindowsAutoAllowCanarySuccess(failedSummary),
      /Explicit AJAX target was not written to whitelist/
    );

    const noTrafficSummary = buildWindowsAutoAllowCanarySummary({
      result: { success: true },
      probeEvidence: WINDOWS_AUTO_ALLOW_PROBES.map((probe) => ({
        id: probe.id,
        kind: probe.kind,
        host: probe.host,
        url: `http://${probe.host}:18088${probe.path}`,
        hits: probe.id === 'font-subresource' ? 0 : 1,
        expectedWhitelistHost: probe.expectedWhitelistHost,
        whitelistContainsExpectedHost: true,
      })),
      originHits: 1,
      attempts: [],
      completedProbes: buildProbeMap(true),
      completedCandidateEvents: buildProbeMap(true),
      lastAttemptAt: '2026-04-27T10:00:00.000Z',
      whitelistPath: 'C:\\OpenPath\\data\\whitelist.txt',
      firefoxExtensionWarmup: { success: true },
      firefoxOutput: '',
      diagnostics: { preflight: {}, postAttempt: {} },
      allowlistedNavigation: { success: true },
      blockedPageUnblockRequest: {
        success: true,
        permissionsMonkeypatch: false,
        permissionStrategy: 'required-data-collection',
      },
    });

    assert.throws(
      () => assertWindowsAutoAllowCanarySuccess(noTrafficSummary),
      /Explicit font probe did not reach canary server/
    );
  });

  test('fails Windows AJAX canary success without real external allowlisted navigation', () => {
    const missingNavigationSummary = buildDiagnosticSummary({
      allowlistedNavigation: null as unknown as Record<string, unknown>,
    });

    assert.equal(missingNavigationSummary.success, false);
    assert.equal(missingNavigationSummary.failureBoundary?.id, 'external-allowlisted-navigation');
    assert.throws(
      () => assertWindowsAutoAllowCanarySuccess(missingNavigationSummary),
      /external-allowlisted-navigation/
    );

    const blockedNavigationSummary = buildDiagnosticSummary({
      allowlistedNavigation: {
        url: WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_URL,
        expectedHosts: [WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_HOST],
        finalHost: WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_HOST,
        success: false,
        blockedByOpenPath: true,
        timedOut: false,
        errors: [],
      },
      blockedPageUnblockRequest: {
        success: true,
        permissionsMonkeypatch: false,
        permissionStrategy: 'required-data-collection',
        extensionSource: 'managed',
        firefoxMode: 'selenium-managed',
        blockedPageDomain: 'blocked-page-unblock-request.127.0.0.1.sslip.io',
        blockedPageUrl:
          'moz-extension://canary/blocked/blocked.html?domain=blocked-page-unblock-request.127.0.0.1.sslip.io',
        statusText: 'Solicitud enviada. Quedara pendiente hasta que la revisen.',
        errorText: '',
      },
    });

    assert.equal(blockedNavigationSummary.failureBoundary?.id, 'external-allowlisted-navigation');
    assert.equal(blockedNavigationSummary.success, false);
    assert.throws(
      () => assertWindowsAutoAllowCanarySuccess(blockedNavigationSummary),
      /external-allowlisted-navigation/
    );
  });

  test('fails Windows AJAX canary success without blocked-page unblock request evidence', () => {
    const missingBlockedPageSummary = buildDiagnosticSummary({
      blockedPageUnblockRequest: null as unknown as Record<string, unknown>,
    });

    assert.equal(missingBlockedPageSummary.success, false);
    assert.equal(missingBlockedPageSummary.failureBoundary?.id, 'blocked-page-unblock-request');
    assert.throws(
      () => assertWindowsAutoAllowCanarySuccess(missingBlockedPageSummary),
      /blocked-page-unblock-request/
    );
  });

  test('fails Windows AJAX canary success when page-resource diagnostics did not complete', () => {
    const pageObserverFailure = buildDiagnosticSummary({
      pageObserverInstalled: false,
      observedProbeHits: 0,
    });

    assert.equal(pageObserverFailure.success, true);
    assert.equal(pageObserverFailure.failureBoundary?.id, 'page-observer');
    assert.throws(() => assertWindowsAutoAllowCanarySuccess(pageObserverFailure), /page-observer/);
  });

  test('fails Windows AJAX canary success when observed probes have no controlled traffic', () => {
    const observedTrafficFailure = buildDiagnosticSummary({
      pageObserverInstalled: true,
      observedProbeHits: 0,
    });

    assert.equal(observedTrafficFailure.success, true);
    assert.equal(observedTrafficFailure.failureBoundary?.id, 'observed-probe-traffic');
    assert.throws(
      () => assertWindowsAutoAllowCanarySuccess(observedTrafficFailure),
      /observed-probe-traffic|Observed .* probe did not reach canary server/
    );
  });

  test('accepts observed probe traffic when page-resource observer telemetry is unavailable', () => {
    const observedTrafficFallback = buildDiagnosticSummary({
      pageObserverInstalled: false,
      completedCandidateEvents: {
        ...buildProbeMap(false),
        ...Object.fromEntries(
          WINDOWS_AUTO_ALLOW_OBSERVATION_PROBES.map((probe) => [probe.id, false])
        ),
      },
      pageResourceCandidateEvents: [],
    });

    assert.equal(observedTrafficFallback.success, true);
    assert.equal(observedTrafficFallback.failureBoundary?.id, 'none');
    assert.doesNotThrow(() => assertWindowsAutoAllowCanarySuccess(observedTrafficFallback));
  });

  test('adds ordered diagnostic phases and failure boundaries to canary summaries', () => {
    const cases = [
      {
        name: 'extension Firefox no lista',
        expectedBoundary: 'firefox-extension-ready',
        summary: buildDiagnosticSummary({ success: false, firefoxReady: false }),
      },
      {
        name: 'origin no carga',
        expectedBoundary: 'origin-page-load',
        summary: buildDiagnosticSummary({ success: false, originHits: 0 }),
      },
      {
        name: 'observer no instalado',
        expectedBoundary: 'page-observer',
        summary: buildDiagnosticSummary({
          success: false,
          pageObserverInstalled: false,
          observedProbeHits: 0,
        }),
      },
      {
        name: 'candidatos de página ausentes',
        expectedBoundary: 'page-resource-candidates',
        summary: buildDiagnosticSummary({
          success: false,
          completedCandidateEvents: buildProbeMap(false),
          pageResourceCandidateEvents: [],
          observedProbeHits: 0,
        }),
      },
      {
        name: 'creación automática inesperada',
        expectedBoundary: 'no-automatic-rule-creation',
        summary: buildDiagnosticSummary({
          success: false,
          automaticRuleCreated: true,
        }),
      },
      {
        name: 'allowlist explícita ausente',
        expectedBoundary: 'explicit-whitelist-apply',
        summary: buildDiagnosticSummary({
          success: false,
          localWhitelistContainsExpectedHost: false,
          probeHits: 0,
        }),
      },
      {
        name: 'allowlist explícita presente pero probes sin hits',
        expectedBoundary: 'explicit-probe-traffic',
        summary: buildDiagnosticSummary({
          success: false,
          probeHits: 0,
        }),
      },
      {
        name: 'success completo',
        expectedBoundary: 'none',
        summary: buildDiagnosticSummary(),
      },
    ];

    for (const { name, expectedBoundary, summary } of cases) {
      assert.equal(summary.failureBoundary?.id, expectedBoundary, name);
      assert.ok(Array.isArray(summary.diagnosticPhases), `${name} should include phases`);
      assert.deepEqual(
        summary.diagnosticPhases.map((phase) => phase.id),
        [
          'firefox-extension-ready',
          'origin-page-load',
          'page-observer',
          'page-resource-candidates',
          'observed-probe-traffic',
          'no-automatic-rule-creation',
          'explicit-whitelist-apply',
          'explicit-probe-traffic',
          'blocked-page-unblock-request',
          'external-allowlisted-navigation',
          'artifact-written',
        ],
        `${name} should keep the fixed phase order`
      );

      if (expectedBoundary === 'none') {
        assert.ok(
          summary.diagnosticPhases.every((phase) => phase.status === 'passed'),
          `${name} should mark all phases as passed`
        );
      } else {
        const failedPhase = summary.diagnosticPhases.find((phase) => phase.id === expectedBoundary);
        assert.equal(failedPhase?.status, 'failed', name);
      }
      assert.ok(summary.failureBoundary?.message, `${name} should include a boundary message`);
      assert.ok(
        summary.failureBoundary?.recommendedNextAction,
        `${name} should include an operator next action`
      );
    }
  });

  test('redacts machine tokens and remote whitelist URLs in evidence objects', () => {
    assert.deepEqual(
      redactWindowsCanaryObject({
        machineToken: 'secret-token',
        whitelistUrl: 'https://classroompath.eu/w/group-secret/whitelist.txt',
        native: { raw: 'machineToken=another-secret' },
      }),
      {
        machineToken: '[redacted]',
        whitelistUrl: 'https://classroompath.eu/w/[redacted]/whitelist.txt',
        native: { raw: 'machineToken="[redacted]"' },
      }
    );
  });

  test('preserves reddit page and server diagnostics in the same summary', () => {
    const summary = buildWindowsAutoAllowCanarySummary({
      result: {
        success: true,
        redditDiagnostics: {
          firstPass: {
            'reddit-emoji-image': { ok: false, passLabel: 'firstPass' },
          },
          secondPass: {
            'reddit-emoji-image': { ok: false, passLabel: 'secondPass' },
          },
          probes: {
            'reddit-emoji-image': { ok: false, error: 'image load failed' },
          },
          completedRedditDiagnosticEvents: {
            'reddit-emoji-image': true,
          },
        },
      },
      probeEvidence: [
        ...buildProbeEvidence(),
        ...buildProbeEvidence({
          probes: WINDOWS_AUTO_ALLOW_OBSERVATION_PROBES,
          whitelistContainsExpectedHost: false,
        }),
      ],
      originHits: 1,
      attempts: [],
      completedProbes: buildProbeMap(true),
      completedCandidateEvents: {
        ...buildProbeMap(true),
        ...Object.fromEntries(
          WINDOWS_AUTO_ALLOW_OBSERVATION_PROBES.map((probe) => [probe.id, true])
        ),
      },
      completedRedditDiagnosticEvents: { 'reddit-emoji-image': true },
      pageResourceCandidateEvents: [
        ...buildCandidateEvents(),
        ...WINDOWS_AUTO_ALLOW_OBSERVATION_PROBES.map((probe) => ({
          kind: probe.kind,
          url: `http://${probe.host}:18088${probe.path}`,
          matchedProbeId: probe.id,
          seenAt: '2026-04-27T10:00:00.000Z',
        })),
      ],
      redditDiagnostics: {
        whitelist: {
          global: {
            containsExpectedHosts: {
              'emoji.redditmedia.com': true,
            },
          },
        },
        server: {
          canaryGroup: {
            body: {
              expectedHostState: {
                'emoji.redditmedia.com': { whitelistRulePresent: true },
              },
            },
          },
        },
        navigation: {
          mode: 'diagnostic',
          url: 'https://www.reddit.com/',
          success: false,
          blockedByOpenPath: false,
          timedOut: true,
          metrics: null,
          resourceHosts: [],
          errors: [{ message: 'navigation timed out' }],
        },
      },
      allowlistedNavigation: {
        url: WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_URL,
        expectedHosts: [WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_HOST],
        finalHost: WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_HOST,
        href: WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_URL,
        title: 'Example Domain',
        success: true,
        blockedByOpenPath: false,
        timedOut: false,
        errors: [],
      },
      blockedPageUnblockRequest: {
        success: true,
        permissionsMonkeypatch: false,
        permissionStrategy: 'required-data-collection',
        extensionSource: 'managed',
        firefoxMode: 'selenium-managed',
        blockedPageDomain: 'blocked-page-unblock-request.127.0.0.1.sslip.io',
        blockedPageUrl:
          'moz-extension://canary/blocked/blocked.html?domain=blocked-page-unblock-request.127.0.0.1.sslip.io',
        statusText: 'Solicitud enviada. Quedara pendiente hasta que la revisen.',
        errorText: '',
      },
      lastAttemptAt: '2026-04-27T10:00:00.000Z',
      whitelistPath: 'C:\\OpenPath\\data\\whitelist.txt',
      firefoxExtensionWarmup: { ready: true },
      firefoxOutput: 'ready',
      diagnostics: {
        preflight: {},
        postAttempt: {
          remoteWhitelist: {
            containsExpectedHosts: buildContainsExpectedHosts(false, windowsObservedHosts),
          },
          whitelist: {
            local: {
              containsExpectedHosts: buildContainsExpectedHosts(false, windowsObservedHosts),
            },
            remoteWhitelist: {
              containsExpectedHosts: buildContainsExpectedHosts(true),
            },
          },
          server: {
            canaryGroup: {
              body: {
                expectedHostState: {
                  ...buildServerExpectedHostState(true),
                  ...Object.fromEntries(
                    windowsObservedHosts.map((host) => [host, { whitelistRulePresent: false }])
                  ),
                },
              },
            },
          },
        },
      },
    });

    assert.equal(
      summary.redditDiagnostics.page.completedRedditDiagnosticEvents['reddit-emoji-image'],
      true
    );
    assert.equal(
      summary.redditDiagnostics.whitelist.global.containsExpectedHosts['emoji.redditmedia.com'],
      true
    );
    assert.equal(
      summary.redditDiagnostics.server.canaryGroup.body.expectedHostState['emoji.redditmedia.com']
        .whitelistRulePresent,
      true
    );
    assert.equal(summary.redditDiagnostics.navigation.mode, 'diagnostic');
    assert.equal(summary.redditDiagnostics.navigation.success, false);
    assert.equal(summary.failureBoundary?.id, 'none');
    assert.equal(
      summary.redditDiagnostics.navigation.firstPass['reddit-emoji-image'].passLabel,
      'firstPass'
    );
    assert.equal(
      summary.redditDiagnostics.navigation.secondPass['reddit-emoji-image'].passLabel,
      'secondPass'
    );
  });

  test('diagnostic reddit navigation does not change the failure boundary but gate mode can fail', () => {
    const diagnosticSummary = buildDiagnosticSummary({
      redditNavigation: {
        mode: 'diagnostic',
        url: 'https://www.reddit.com/',
        success: false,
        blockedByOpenPath: false,
        timedOut: true,
        metrics: null,
        resourceHosts: [],
        errors: [{ message: 'timeout' }],
      },
    });
    const gateSummary = buildDiagnosticSummary({
      redditNavigation: {
        mode: 'gate',
        url: 'https://www.reddit.com/',
        success: false,
        blockedByOpenPath: true,
        timedOut: false,
        metrics: null,
        resourceHosts: ['www.reddit.com'],
        errors: [],
      },
    });

    assert.equal(diagnosticSummary.failureBoundary?.id, 'none');
    assert.equal(gateSummary.failureBoundary?.id, 'reddit-real-navigation');
    assert.equal(
      gateSummary.diagnosticPhases.at(-1)?.id,
      'reddit-real-navigation',
      'gate mode should add the optional reddit navigation phase after controlled gates'
    );
  });
});

describe('Production client update canary workflow contracts', () => {
  test('Windows canaries share the runner DNS restoration action', () => {
    const actionText = readProjectText(windowsRunnerDnsActionPath);

    assert.ok(actionText.includes('Set-DnsClientServerAddress'));
    assert.ok(actionText.includes('Clear-DnsClientCache'));
    assert.ok(actionText.includes('Test-NetConnection $connectivityHost -Port 443'));
    assert.ok(actionText.includes('pipelines.actions.githubusercontent.com'));
    assert.ok(
      actionText.includes("Get-NetFirewallRule -DisplayName 'OpenPath-*'") &&
        actionText.includes('Remove-NetFirewallRule'),
      'Windows runner DNS restore must remove OpenPath firewall rules that can block artifact-service DNS after canaries'
    );

    for (const [workflowPath, jobName] of [
      [
        '.github/workflows/production-client-update-canary.yml',
        'windows-client-self-update-canary',
      ],
      [
        '.github/workflows/windows-production-bootstrap-canary.yml',
        'windows-production-bootstrap-canary',
      ],
    ] as const) {
      const workflow = readProjectWorkflow(workflowPath);
      const steps = workflow.jobs?.[jobName]?.steps ?? [];
      const resetDnsStep = steps.find(
        (step) => step.name === 'Restore Windows runner DNS after reset'
      );
      const checkoutStepIndex = steps.findIndex((step) => step.name === 'Checkout');
      const preCheckoutDnsStepIndex = steps.findIndex(
        (step) => step.name === 'Restore Windows runner DNS before checkout'
      );
      const preCheckoutDnsStep =
        preCheckoutDnsStepIndex >= 0 ? steps[preCheckoutDnsStepIndex] : undefined;
      const artifactDnsStep = steps.find((step) =>
        String(step.name ?? '').includes('Restore Windows runner DNS before artifact upload')
      );
      const guardStepIndex = steps.findIndex(
        (step) => step.name === 'Assert destructive Windows runner is available'
      );
      const resetStepIndex = steps.findIndex(
        (step) => step.name === 'Reset persistent Windows canary state'
      );
      const guardStep = guardStepIndex >= 0 ? steps[guardStepIndex] : undefined;
      const healthBeforeResetStep = steps.find(
        (step) => step.name === 'Record Windows runner health before reset'
      );
      const healthAfterResetStep = steps.find(
        (step) => step.name === 'Record Windows runner health after reset'
      );
      const healthBeforeUploadStep = steps.find(
        (step) => step.name === 'Record Windows runner health before artifact upload'
      );

      assert.ok(
        preCheckoutDnsStepIndex >= 0 &&
          checkoutStepIndex >= 0 &&
          preCheckoutDnsStepIndex < checkoutStepIndex,
        `${workflowPath} must restore DNS before checkout because local actions are unavailable before checkout`
      );
      assert.equal(preCheckoutDnsStep?.shell, 'pwsh');
      assert.match(String(preCheckoutDnsStep?.run ?? ''), /Set-DnsClientServerAddress/);
      assert.match(String(preCheckoutDnsStep?.run ?? ''), /Clear-DnsClientCache/);
      assert.match(
        String(preCheckoutDnsStep?.run ?? ''),
        /Test-NetConnection github\.com -Port 443/
      );
      assert.equal(resetDnsStep?.uses, './.github/actions/restore-windows-runner-dns');
      assert.equal(artifactDnsStep?.uses, './.github/actions/restore-windows-runner-dns');
      assert.equal(artifactDnsStep?.if, 'always()');
      assert.equal(artifactDnsStep?.['continue-on-error'], true);
      assert.ok(
        guardStepIndex >= 0 && resetStepIndex >= 0 && guardStepIndex < resetStepIndex,
        `${workflowPath} must fail before mutating runner state when another destructive Windows job is active`
      );
      assert.equal(guardStep?.env?.GITHUB_TOKEN, '${{ github.token }}');
      assert.match(String(guardStep?.run ?? ''), /assert-destructive-runner-available\.mjs/);
      assert.match(
        String(healthBeforeResetStep?.run ?? ''),
        /write-runner-health-evidence\.mjs[\s\S]*--phase pre-reset/
      );
      assert.match(
        String(healthAfterResetStep?.run ?? ''),
        /write-runner-health-evidence\.mjs[\s\S]*--phase post-reset/
      );
      assert.match(
        String(healthBeforeUploadStep?.run ?? ''),
        /pipelines\.actions\.githubusercontent\.com[\s\S]*--phase pre-upload/
      );
      assert.equal(healthBeforeUploadStep?.['continue-on-error'], true);
    }

    const firefoxWorkflow = readProjectWorkflow('.github/workflows/windows-firefox-canary.yml');
    const firefoxSteps = firefoxWorkflow.jobs?.['windows-firefox-canary']?.steps ?? [];
    const firefoxSetupNodeStepIndex = firefoxSteps.findIndex(
      (step) => step.name === 'Setup Node.js'
    );
    const firefoxGuardStepIndex = firefoxSteps.findIndex(
      (step) => step.name === 'Assert destructive Windows runner is available'
    );
    const firefoxPolicyStepIndex = firefoxSteps.findIndex(
      (step) => step.name === 'Run Firefox policy canary'
    );
    assert.equal(firefoxWorkflow.permissions?.actions, 'read');
    assert.ok(
      firefoxSetupNodeStepIndex >= 0 &&
        firefoxGuardStepIndex >= 0 &&
        firefoxSetupNodeStepIndex < firefoxGuardStepIndex,
      'Windows Firefox canary must install Node before running the JavaScript runner guard'
    );
    assert.ok(
      firefoxGuardStepIndex >= 0 &&
        firefoxPolicyStepIndex >= 0 &&
        firefoxGuardStepIndex < firefoxPolicyStepIndex,
      'Windows Firefox canary must guard the shared destructive runner before mutating browser policy'
    );
  });

  test('scheduled production enrollment download canary checks live scripts without consuming client runners', () => {
    const workflowText = readProjectText('.github/workflows/production-client-update-canary.yml');
    const helperText = readProjectText('scripts/production-enrollment-download-canary.mjs');
    const genericHelperText = readProjectText('scripts/enrollment-download-canary.mjs');
    const workflow = readProjectWorkflow('.github/workflows/production-client-update-canary.yml');
    const jobs = workflow.jobs ?? {};
    const downloadJob = jobs['production-enrollment-download-canary'];
    const existingWindowsJob = jobs['windows-client-self-update-canary'];
    const existingLinuxJob = jobs['linux-client-self-update-canary'];

    assert.ok(
      workflow.on?.schedule?.some((entry) => entry.cron === '*/15 * * * *'),
      'production enrollment download canary should run every 15 minutes'
    );
    assert.equal(downloadJob?.['runs-on'], 'ubuntu-latest');
    assert.ok(
      String(existingWindowsJob?.if ?? '').includes("github.event_name == 'workflow_dispatch'"),
      'scheduled download checks must not consume the persistent Windows runner'
    );
    assert.ok(
      String(existingWindowsJob?.if ?? '').includes(
        "github.event.inputs.target_platform != 'download'"
      ),
      'manual download-only canary runs must not consume the persistent Windows runner'
    );
    assert.ok(
      String(existingLinuxJob?.if ?? '').includes("github.event_name == 'workflow_dispatch'"),
      'scheduled download checks must not run the full Linux install canary'
    );
    assert.ok(
      String(existingLinuxJob?.if ?? '').includes(
        "github.event.inputs.target_platform != 'download'"
      ),
      'manual download-only canary runs must not run the full Linux install canary'
    );
    assert.ok(workflowText.includes('scripts/production-enrollment-download-canary.mjs'));
    assert.ok(workflowText.includes('production-enrollment-download-canary.json'));
    assert.ok(workflowText.includes('production-enrollment-download-canary'));
    assert.ok(helperText.includes('runEnrollmentDownloadCanary'));
    assert.ok(genericHelperText.includes('/api/enroll/'));
    assert.ok(genericHelperText.includes('/windows.ps1'));
    assert.ok(workflowText.includes('Production Enrollment Download Canary Failed'));
    assert.ok(workflowText.includes('close-smoke-recovery.mjs'));
    assert.ok(workflowText.includes('Read production Linux enrollment runtime'));
    assert.ok(workflowText.includes('OPENPATH_LINUX_AGENT_VERSION'));
    assert.ok(
      workflowText.includes(
        'OPENPATH_LINUX_AGENT_VERSION: ${{ steps.read-linux-runtime.outputs.linux_agent_version }}'
      ),
      'download canary should validate the production Linux runtime pin, not the Windows bootstrap manifest version'
    );
    assert.ok(
      !workflowText.includes(
        'OPENPATH_LINUX_AGENT_VERSION: ${{ steps.provision.outputs.bootstrap_manifest_version }}'
      ),
      'Windows bootstrap manifest versions must not be used as Linux package pins'
    );
  });

  test('production client update canary remains scheduled/manual and decoupled from deploy completion', () => {
    const workflowText = readProjectText('.github/workflows/production-client-update-canary.yml');
    const workflow = readProjectWorkflow('.github/workflows/production-client-update-canary.yml');
    const jobs = workflow.jobs ?? {};
    const windowsJob = jobs['windows-client-self-update-canary'];
    const linuxJob = jobs['linux-client-self-update-canary'];
    const workflowDispatchInputs = workflow.on?.workflow_dispatch?.inputs ?? {};

    assert.equal(workflow.on?.workflow_run, undefined);
    assert.ok(workflowText.includes('workflow_dispatch:'));
    assert.equal(workflowDispatchInputs.target_platform?.default, 'both');
    assert.deepEqual(workflowDispatchInputs.target_platform?.options, [
      'both',
      'download',
      'linux',
      'windows',
    ]);
    assert.ok(!workflowText.includes('workflow_call:'));
    assert.match(String(windowsJob?.if ?? ''), /github\.event_name == 'workflow_dispatch'/);
    assert.match(String(linuxJob?.if ?? ''), /github\.event_name == 'workflow_dispatch'/);
    assert.doesNotMatch(String(windowsJob?.if ?? ''), /workflow_run/);
    assert.doesNotMatch(String(linuxJob?.if ?? ''), /workflow_run/);
    assert.deepEqual(windowsJob?.['runs-on'], [
      'self-hosted',
      'Windows',
      'X64',
      'proxmox',
      'classroompath',
    ]);
    assert.deepEqual(linuxJob?.['runs-on'], [
      'self-hosted',
      'Linux',
      'X64',
      'proxmox',
      'classroompath',
    ]);
    assert.ok(workflowText.includes('Reset persistent Windows canary state'));
    assert.ok(workflowText.includes('Reset persistent Linux canary state'));
    assert.ok(workflowText.includes("Get-ScheduledTask -TaskName 'OpenPath-*'"));
    assert.ok(workflowText.includes("Remove-Item -LiteralPath 'C:\\OpenPath'"));
    assert.ok(workflowText.includes('Acrylic DNS Proxy'));
    assert.ok(
      workflowText.includes('Restore Windows runner DNS after reset') &&
        workflowText.includes('./.github/actions/restore-windows-runner-dns'),
      'Windows canary reset must restore external DNS after removing Acrylic/OpenPath'
    );
    assert.ok(workflowText.includes('create-production-windows-bootstrap-canary.mjs'));
    assert.ok(
      workflowText.includes('github_actions_remote_read_env_key') &&
        workflowText.includes('CP_CLIENT_CANARY_ADMIN_TOKEN') &&
        workflowText.includes('PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_STRIPE_WEBHOOK_SECRET') &&
        workflowText.includes('classroompath-production-release')
    );
    assert.ok(
      !workflowText.includes('Skip production client update canary when billing is manual-only')
    );
    assert.ok(workflowText.includes('client_canary_admin_token'));
    assert.ok(workflowText.includes('PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_BILLING_MODE'));
    assert.ok(workflowText.includes('Write Windows client canary evidence'));
    assert.ok(workflowText.includes('Write Linux client canary evidence'));
    assert.ok(workflowText.includes('Verify Linux Firefox blocked page canary'));
    assert.ok(workflowText.includes('production-client-canary-evidence-windows.json'));
    assert.ok(workflowText.includes('production-client-canary-evidence-linux.json'));
    assert.ok(workflowText.includes('production-linux-firefox-block-page-canary.json'));
    assert.ok(workflowText.includes('live-tested'));
    assert.ok(workflowText.includes('failed'));
    assert.ok(
      workflowText.includes('OpenPath.ps1') && workflowText.includes('self-update --silent')
    );
    assert.ok(workflowText.includes('config.json') && workflowText.includes('lastAgentUpdateAt'));
    assert.ok(
      workflowText.includes('/api/enroll/$CLASSROOM_ID') &&
        workflowText.includes(
          'sudo timeout --kill-after=30s 10m bash "$enroll_script" 2>&1 | tee -a "$enrollment_log"'
        )
    );
    assert.ok(workflowText.includes('/usr/local/bin/openpath-agent-update.sh --force'));
    assert.ok(workflowText.includes('openpath-agent-update.timer'));
    assert.ok(workflowText.includes('/usr/local/lib/openpath/uninstall.sh --auto-yes'));
    assert.ok(workflowText.includes('sudo apt-get purge -y openpath-dnsmasq'));
    assert.ok(workflowText.includes('scripts/linux-firefox-block-page-canary.mjs'));
    assert.ok(String(windowsJob?.if ?? '').includes("github.event_name == 'workflow_dispatch'"));
    assert.ok(String(linuxJob?.if ?? '').includes("github.event_name == 'workflow_dispatch'"));
    assert.ok(
      String(windowsJob?.if ?? '').includes("github.event.inputs.target_platform != 'linux'"),
      'Manual Linux-only production canary runs must not wait for the Windows runner'
    );
    assert.ok(
      String(linuxJob?.if ?? '').includes("github.event.inputs.target_platform != 'windows'"),
      'Manual Windows-only production canary runs must not consume Linux runner time'
    );
  });

  test('production client canary artifact archives are required and uploads are best effort', () => {
    const workflow = readProjectWorkflow('.github/workflows/production-client-update-canary.yml');
    const jobs = workflow.jobs ?? {};

    for (const [jobName, platform, shell, logFile, archiveFile, archiveCommand] of [
      [
        'windows-client-self-update-canary',
        'Windows',
        'pwsh',
        'windows-client-self-update.log',
        'production-windows-client-self-update-canary.zip',
        'Compress-Archive',
      ],
      [
        'linux-client-self-update-canary',
        'Linux',
        'bash',
        'linux-client-self-update.log',
        'production-linux-client-self-update-canary.tar.gz',
        'tar -czf',
      ],
    ] as const) {
      const job = jobs[jobName];
      const ensureStepIndex =
        job?.steps?.findIndex((step) =>
          String(step.name ?? '').includes(`Ensure ${platform} self-update artifact files`)
        ) ?? -1;
      const uploadStepIndex =
        job?.steps?.findIndex((step) =>
          String(step.name ?? '').includes(`Upload ${platform} self-update artifacts`)
        ) ?? -1;
      const restoreDnsStepIndex =
        job?.steps?.findIndex((step) =>
          String(step.name ?? '').includes(`Restore ${platform} runner DNS before artifact upload`)
        ) ?? -1;
      const uploadStep = uploadStepIndex >= 0 ? job?.steps?.[uploadStepIndex] : undefined;
      const checkoutStep = job?.steps?.find((step) => step.name === 'Checkout');
      const ensureStep = ensureStepIndex >= 0 ? job?.steps?.[ensureStepIndex] : undefined;
      const restoreDnsStep =
        restoreDnsStepIndex >= 0 ? job?.steps?.[restoreDnsStepIndex] : undefined;

      assert.equal(job?.['timeout-minutes'], 35, `${jobName} must not hang indefinitely`);
      assert.equal(checkoutStep?.with?.['persist-credentials'], false);
      assert.ok(ensureStepIndex >= 0, `${jobName} must create missing log artifacts`);
      assert.ok(
        ensureStepIndex < uploadStepIndex,
        `${jobName} must create missing log artifacts before upload`
      );
      assert.ok(
        ensureStepIndex < restoreDnsStepIndex && restoreDnsStepIndex < uploadStepIndex,
        `${platform} canary should restore runner DNS after functional evidence and before artifact upload`
      );
      assert.equal(restoreDnsStep?.if, 'always()');
      assert.equal(restoreDnsStep?.['continue-on-error'], true);
      if (platform === 'Windows') {
        assert.equal(restoreDnsStep?.uses, './.github/actions/restore-windows-runner-dns');
      } else {
        assert.ok(
          String(restoreDnsStep?.run ?? '').includes('sudo openpath disable') &&
            String(restoreDnsStep?.run ?? '').includes('sudo systemctl stop dnsmasq') &&
            String(restoreDnsStep?.run ?? '').includes(
              '/usr/local/lib/openpath/uninstall.sh --auto-yes'
            ) &&
            String(restoreDnsStep?.run ?? '').includes('sudo apt-get purge -y openpath-dnsmasq')
        );
      }
      assert.equal(
        job?.steps?.some((step) =>
          String(step.name ?? '').includes(`Retry ${platform} self-update artifact upload`)
        ),
        false,
        `${jobName} must not hang on artifact-service transport retries`
      );
      assert.equal(ensureStep?.if, 'always()');
      assert.equal(ensureStep?.shell, shell);
      assert.ok(String(ensureStep?.run ?? '').includes(logFile));
      assert.ok(String(ensureStep?.run ?? '').includes(archiveFile));
      assert.ok(String(ensureStep?.run ?? '').includes(archiveCommand));
      assert.equal(uploadStep?.uses, 'actions/upload-artifact@v7');
      assert.equal(
        uploadStep?.['continue-on-error'],
        true,
        `${jobName} artifact transport failures must not mask functional canary results`
      );
      assert.equal(uploadStep?.['timeout-minutes'], 10);
      if (platform === 'Windows') {
        assert.match(
          String(uploadStep?.with?.path ?? ''),
          /production-windows-client-self-update-canary\.zip/
        );
        assert.match(
          String(uploadStep?.with?.path ?? ''),
          /production-windows-runner-health\.json/
        );
      } else {
        assert.equal(uploadStep?.with?.path, archiveFile);
      }
      assert.equal(uploadStep?.with?.['if-no-files-found'], 'error');
      assert.equal(uploadStep?.with?.['retention-days'], 14);
      assert.equal(uploadStep?.with?.overwrite, true);
    }

    const linuxEnsureStep = jobs['linux-client-self-update-canary']?.steps?.find((step) =>
      String(step.name ?? '').includes('Ensure Linux self-update artifact files')
    );
    assert.ok(
      String(linuxEnsureStep?.run ?? '').includes('linux-client-enrollment.log'),
      'Linux canary artifacts must include the live enrollment log'
    );
    assert.ok(
      String(linuxEnsureStep?.run ?? '').includes('linux-client-enrollment-download.json'),
      'Linux canary artifacts must include enrollment download diagnostics'
    );
    assert.ok(
      String(linuxEnsureStep?.run ?? '').includes('linux-client-enrollment-download.headers'),
      'Linux canary artifacts must include enrollment download headers'
    );
    assert.ok(
      String(linuxEnsureStep?.run ?? '').includes('linux-client-enrollment-download.body'),
      'Linux canary artifacts must include enrollment download body'
    );
    assert.ok(
      String(linuxEnsureStep?.run ?? '').includes(
        'production-linux-firefox-block-page-canary.json'
      ),
      'Linux canary artifacts must include Firefox blocked-page evidence'
    );
    assert.ok(
      String(linuxEnsureStep?.run ?? '').includes('linux-firefox-block-page-canary.log'),
      'Linux canary artifacts must include Firefox blocked-page diagnostics'
    );
  });

  test('linux enrollment canary retries transient registration failures', () => {
    const workflow = readProjectWorkflow('.github/workflows/production-client-update-canary.yml');
    const linuxJob = workflow.jobs?.['linux-client-self-update-canary'];
    const enrollmentStep = linuxJob?.steps?.find((step) =>
      String(step.name ?? '').includes('Download and run live Linux enrollment script')
    );
    const enrollmentScript = String(enrollmentStep?.run ?? '');

    assert.ok(enrollmentStep, 'Linux enrollment step must exist');
    assert.ok(
      enrollmentScript.includes('for attempt in 1 2 3'),
      'Linux enrollment should retry transient setup failures'
    );
    assert.ok(
      enrollmentScript.includes('linux-client-enrollment-download.json') &&
        enrollmentScript.includes('Linux enrollment script download returned HTTP $http_status'),
      'Linux enrollment should persist HTTP diagnostics when script download fails'
    );
    assert.ok(
      enrollmentScript.includes('body.slice(0, 4000)'),
      'Linux enrollment diagnostics should include a bounded response body preview'
    );
    assert.ok(
      enrollmentScript.includes('Linux enrollment attempt $attempt failed'),
      'Linux enrollment should log retry attempts'
    );
    assert.ok(
      enrollmentScript.includes('systemctl status dnsmasq') &&
        enrollmentScript.includes('journalctl -u dnsmasq') &&
        enrollmentScript.includes('dnsmasq --test') &&
        enrollmentScript.includes('ss -tulpn'),
      'Linux enrollment should capture dnsmasq diagnostics before retrying or failing'
    );
    assert.ok(
      /if sudo timeout --kill-after=30s 10m bash "\$enroll_script" 2>&1 \| tee -a "\$enrollment_log"; then[\s\S]*else\s+enrollment_status="\$\{PIPESTATUS\[0\]\}"/m.test(
        enrollmentScript
      ),
      'Linux enrollment should hard-bound the root installer process tree while teeing diagnostics'
    );
    assert.ok(
      enrollmentScript.includes('linux-client-enrollment.log'),
      'Linux enrollment should persist its output for failed canary diagnosis'
    );
    assert.ok(
      enrollmentScript.includes('exit "$enrollment_status"'),
      'Linux enrollment should preserve final setup failure status'
    );
  });

  test('linux canary repairs persistent runner DNS before live enrollment', () => {
    const workflow = readProjectWorkflow('.github/workflows/production-client-update-canary.yml');
    const linuxJob = workflow.jobs?.['linux-client-self-update-canary'];
    const steps = linuxJob?.steps ?? [];
    const resetStepIndex = steps.findIndex((step) =>
      String(step.name ?? '').includes('Reset persistent Linux canary state')
    );
    const dependencyStepIndex = steps.findIndex((step) =>
      String(step.name ?? '').includes('Install Linux Firefox canary dependencies')
    );
    const dnsHealthStepIndex = steps.findIndex(
      (step) => step.name === 'Verify Linux runner DNS before enrollment'
    );
    const enrollmentStepIndex = steps.findIndex((step) =>
      String(step.name ?? '').includes('Download and run live Linux enrollment script')
    );
    const restoreStepIndex = steps.findIndex((step) =>
      String(step.name ?? '').includes('Restore Linux runner DNS before artifact upload')
    );
    const resetScript = String(steps[resetStepIndex]?.run ?? '');
    const dnsHealthScript = String(steps[dnsHealthStepIndex]?.run ?? '');
    const restoreScript = String(steps[restoreStepIndex]?.run ?? '');

    assert.ok(resetStepIndex >= 0, 'Linux canary reset step must exist');
    assert.ok(dnsHealthStepIndex >= 0, 'Linux canary must verify runner DNS before enrollment');
    assert.ok(restoreStepIndex >= 0, 'Linux canary restore step must exist');
    assert.ok(
      resetStepIndex < dnsHealthStepIndex &&
        dnsHealthStepIndex < dependencyStepIndex &&
        dependencyStepIndex < enrollmentStepIndex,
      'Linux canary must repair and verify runner DNS before network-dependent setup and live enrollment'
    );

    for (const [label, script] of [
      ['reset', resetScript],
      ['restore', restoreScript],
    ] as const) {
      assert.ok(
        script.includes('sudo systemctl reset-failed dnsmasq'),
        `${label} step must clear dnsmasq start-limit-hit state`
      );
      assert.ok(
        script.includes('/etc/systemd/system/dnsmasq.service.d/openpath-override.conf') &&
          script.includes('/etc/systemd/system/dnsmasq.service.d/whitelist-override.conf') &&
          script.includes('/etc/dnsmasq.d/openpath.conf'),
        `${label} step must remove stale OpenPath dnsmasq overrides`
      );
      assert.ok(
        script.includes('restore_linux_canary_external_dns'),
        `${label} step must restore external DNS after OpenPath cleanup`
      );
      assert.ok(
        script.includes('sudo systemctl daemon-reload'),
        `${label} step must reload systemd after removing dnsmasq drop-ins`
      );
    }

    assert.ok(
      dnsHealthScript.includes('raw.githubusercontent.com') &&
        dnsHealthScript.includes('getent hosts') &&
        dnsHealthScript.includes('Linux canary runner DNS is not healthy before enrollment'),
      'Linux canary should fail with explicit DNS diagnostics before downloading enrollment scripts'
    );
    assert.ok(
      dnsHealthScript.includes('/etc/resolv.conf') &&
        dnsHealthScript.includes('systemctl status dnsmasq'),
      'Linux canary DNS health failure should include resolver and dnsmasq diagnostics'
    );
  });

  test('linux client canary verifies Firefox renders the extension blocked page', () => {
    const workflow = readProjectWorkflow('.github/workflows/production-client-update-canary.yml');
    const linuxJob = workflow.jobs?.['linux-client-self-update-canary'];
    const firefoxStepIndex =
      linuxJob?.steps?.findIndex(
        (step) => step.name === 'Verify Linux Firefox blocked page canary'
      ) ?? -1;
    const enrollmentStepIndex =
      linuxJob?.steps?.findIndex((step) =>
        String(step.name ?? '').includes('Download and run live Linux enrollment script')
      ) ?? -1;
    const evidenceStepIndex =
      linuxJob?.steps?.findIndex((step) =>
        String(step.name ?? '').includes('Write Linux client canary evidence')
      ) ?? -1;
    const dependencyStepIndex =
      linuxJob?.steps?.findIndex((step) =>
        String(step.name ?? '').includes('Install Linux Firefox canary dependencies')
      ) ?? -1;
    const resetStepIndex =
      linuxJob?.steps?.findIndex((step) =>
        String(step.name ?? '').includes('Reset persistent Linux canary state')
      ) ?? -1;
    const firefoxStep = firefoxStepIndex >= 0 ? linuxJob?.steps?.[firefoxStepIndex] : undefined;
    const dependencyStep =
      dependencyStepIndex >= 0 ? linuxJob?.steps?.[dependencyStepIndex] : undefined;
    const firefoxScript = readProjectText('scripts/linux-firefox-block-page-canary.mjs');

    assert.ok(firefoxStep, 'Linux canary must exercise Firefox blocked-page rendering');
    assert.ok(
      enrollmentStepIndex >= 0 && enrollmentStepIndex < firefoxStepIndex,
      'Firefox blocked-page canary must run after live enrollment installs the client'
    );
    assert.ok(
      dependencyStepIndex >= 0 && dependencyStepIndex < firefoxStepIndex,
      'Firefox blocked-page canary must install npm dependencies before loading selenium-webdriver'
    );
    assert.ok(
      resetStepIndex >= 0 && resetStepIndex < enrollmentStepIndex,
      'persistent Linux canary runner must be reset before live enrollment mutates it'
    );
    assert.ok(
      firefoxStepIndex < evidenceStepIndex,
      'Firefox blocked-page canary must run before Linux evidence is written'
    );
    assert.equal(dependencyStep?.shell, 'bash');
    assert.ok(String(dependencyStep?.run ?? '').includes('npm ci --ignore-scripts'));
    assert.equal(firefoxStep?.shell, 'bash');
    assert.ok(String(firefoxStep?.run ?? '').includes('linux-firefox-block-page-canary.mjs'));
    assert.ok(
      String(firefoxStep?.run ?? '').includes('timeout --kill-after=30s'),
      'Linux Firefox blocked-page canary must have an external watchdog timeout'
    );
    assert.ok(
      String(firefoxStep?.run ?? '').includes('PIPESTATUS[0]'),
      'Linux Firefox blocked-page canary must preserve the node exit status through tee'
    );
    assert.ok(String(firefoxStep?.env?.EXPECTED_EXTENSION_ID ?? '').includes('extension_id'));
    assert.ok(
      String(firefoxStep?.env?.LINUX_FIREFOX_BLOCK_PAGE_CANARY_URL ?? '').includes(
        'www.mozilla.org'
      ),
      'Linux Firefox canary should use a real resolvable domain outside the seeded whitelist'
    );

    assert.ok(firefoxScript.includes('selenium-webdriver'));
    assert.ok(firefoxScript.includes('monitor-bloqueos@openpath'));
    assert.ok(firefoxScript.includes('/blocked/blocked.html'));
    assert.ok(
      firefoxScript.includes("setPageLoadStrategy('none')"),
      'Linux Firefox canary must not depend on Marionette normal page-load completion for moz-extension pages'
    );
    assert.ok(
      firefoxScript.includes('getOpenPathDiagnostics'),
      'Linux Firefox canary should query extension/native diagnostics before navigating'
    );
    assert.ok(
      firefoxScript.includes('whitelist_native_host.json'),
      'Linux Firefox canary should report native host manifest state inline'
    );
    assert.ok(
      firefoxScript.includes('writeInlineDiagnosticsSummary'),
      'Linux Firefox canary should print enough diagnostics before artifact upload'
    );
    assert.ok(firefoxScript.includes('production-linux-firefox-block-page-canary.json'));
    assert.ok(firefoxScript.includes('LINUX_FIREFOX_BLOCK_PAGE_CANARY_URL'));
    assert.ok(firefoxScript.includes('::error title=Linux Firefox blocked-page canary::'));
  });

  test('production provisioning helper supports Stripe and manual-only live canary activation', () => {
    const scriptText = readProjectText('scripts/create-production-windows-bootstrap-canary.mjs');

    assert.ok(scriptText.includes('PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_BILLING_MODE'));
    assert.ok(scriptText.includes('billing.createCheckout'));
    assert.ok(scriptText.includes('/cp/stripe/webhook'));
    assert.ok(scriptText.includes('billing.createManualRequest'));
    assert.ok(
      scriptText.includes('/cp/internal/client-canary/manual-request/') &&
        scriptText.includes('/approve')
    );
    assert.ok(scriptText.includes('PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_ADMIN_TOKEN'));
    assert.ok(scriptText.includes("'auth.refresh'"));
    assert.ok(scriptText.includes("'onboarding.status'"));
    assert.ok(scriptText.includes('fallback relogin teacher'));
    assert.ok(
      scriptText.includes('ajax-auto-allow-origin.127.0.0.1.sslip.io'),
      'production Windows bootstrap canary should seed the AJAX origin in the initial whitelist'
    );
    assert.ok(scriptText.includes('billingMode'));
    assert.ok(scriptText.includes('::add-mask::'));
    assert.ok(scriptText.includes('maskGithubSecret(ticketPayload.enrollmentToken)'));
    assert.ok(scriptText.includes('sanitizeSummaryForArtifact'));
    assert.ok(scriptText.includes("enrollmentToken: summary.enrollmentToken ? '[redacted]' : ''"));
    assert.ok(scriptText.includes('enrollment_token: summary.enrollmentToken'));
  });

  test('windows bootstrap canary can seed reversible reddit diagnostic allowlist hosts', () => {
    const scriptText = readProjectText('scripts/create-production-windows-bootstrap-canary.mjs');

    assert.ok(scriptText.includes('WINDOWS_AJAX_REDDIT_EXPLICIT_ALLOWLIST_HOSTS'));
    assert.ok(scriptText.includes('WINDOWS_AJAX_REDDIT_EXPLICIT_ALLOWLIST_HOSTS.includes(host)'));
    assert.ok(
      scriptText.includes('Windows AJAX Reddit staging diagnostic explicit allowlist experiment')
    );
  });

  test('windows bootstrap canary exposes a staging-first manual diagnostic dispatch', () => {
    const workflowText = readProjectText(
      '.github/workflows/windows-production-bootstrap-canary.yml'
    );
    const workflow = readProjectWorkflow(
      '.github/workflows/windows-production-bootstrap-canary.yml'
    );
    const dispatchInputs = workflow.on?.workflow_dispatch?.inputs ?? {};
    const job = workflow.jobs?.['windows-production-bootstrap-canary'];

    assert.equal(dispatchInputs.target_environment?.default, 'staging');
    assert.deepEqual(dispatchInputs.target_environment?.options, ['staging', 'production']);
    assert.equal(dispatchInputs.base_url?.required, false);
    assert.equal(dispatchInputs.diagnostic_mode?.default, 'true');
    assert.ok(
      String(job?.env?.TARGET_ENVIRONMENT ?? '').includes("inputs.target_environment || 'staging'"),
      'manual bootstrap diagnostics should default to staging, while deploy passes production explicitly'
    );
    assert.ok(workflowText.includes('Resolve diagnostic target'));
    assert.ok(
      workflowText.includes('node scripts/deploy-targets.mjs get "$TARGET_ENVIRONMENT" publicUrl')
    );
    assert.ok(workflowText.includes('PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_URL=${base_url%/}'));
    assert.ok(workflowText.includes('WINDOWS_AJAX_AUTO_ALLOW_CANARY_API_URL=${base_url%/}'));
    assert.ok(
      !workflowText.includes(
        'PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_URL: ${{ env.PRODUCTION_BASE_URL }}'
      )
    );
    assert.ok(
      !workflowText.includes(
        'WINDOWS_AJAX_AUTO_ALLOW_CANARY_API_URL: ${{ env.PRODUCTION_BASE_URL }}'
      )
    );
    assert.ok(workflowText.includes('STAGING_DEPLOY_HOST'));
    assert.ok(workflowText.includes('DEPLOY_HOST'));
    assert.ok(workflowText.includes('TARGET_SSH_KEY_PATH'));
    assert.ok(workflowText.includes('RUNNER_DIAGNOSTIC_MODE'));
  });

  test('windows production bootstrap canary proves AJAX auto-allow on manual-only production', () => {
    const workflowText = readProjectText(
      '.github/workflows/windows-production-bootstrap-canary.yml'
    );
    const workflow = readProjectWorkflow(
      '.github/workflows/windows-production-bootstrap-canary.yml'
    );
    const job = workflow.jobs?.['windows-production-bootstrap-canary'];
    const steps = job?.steps ?? [];
    const provisionStep = steps.find(
      (step) => step.name === 'Provision production enrollment canary'
    );
    const installStepIndex = steps.findIndex((step) =>
      String(step.name ?? '').includes('Re-run Update-OpenPath.ps1')
    );
    const setupNodeStepIndex = steps.findIndex((step) => step.name === 'Setup Node.js');
    const restoreDependencyDnsStepIndex = steps.findIndex(
      (step) => step.name === 'Restore Windows runner DNS before dependency install'
    );
    const dependencyStepIndex = steps.findIndex(
      (step) => step.name === 'Install Windows AJAX canary dependencies'
    );
    const ajaxStepIndex = steps.findIndex(
      (step) => step.name === 'Verify Windows AJAX auto-allow canary'
    );
    const uploadStepIndex = steps.findIndex((step) =>
      String(step.name ?? '').includes('Upload production bootstrap canary artifacts')
    );
    const restoreDnsStepIndex = steps.findIndex((step) =>
      String(step.name ?? '').includes('Restore Windows runner DNS before artifact upload')
    );
    const ajaxStep = ajaxStepIndex >= 0 ? steps[ajaxStepIndex] : undefined;
    const ajaxScript = String(ajaxStep?.run ?? '');
    const dependencyStep = dependencyStepIndex >= 0 ? steps[dependencyStepIndex] : undefined;
    const dependencyScript = String(dependencyStep?.run ?? '');
    const resetStep = steps.find((step) => step.name === 'Reset persistent Windows canary state');
    const ajaxCanaryScript = readProjectText('scripts/lib/windows-ajax-auto-allow-runtime.mjs');
    const ajaxCanaryEvidenceModule = readProjectText(
      'scripts/lib/windows-auto-allow-canary-evidence.mjs'
    );
    const ajaxCanaryEvidenceText = `${ajaxCanaryScript}\n${ajaxCanaryEvidenceModule}`;

    assert.ok(
      workflow.on?.workflow_call,
      'Windows bootstrap canary should be reusable from deploy'
    );
    assert.equal(
      workflow.on.workflow_call.outputs?.canary_result?.value,
      '${{ jobs.windows-production-bootstrap-canary.outputs.canary_result }}'
    );
    assert.equal(
      workflow.on.workflow_call.outputs?.failure_boundary_id?.value,
      '${{ jobs.windows-production-bootstrap-canary.outputs.failure_boundary_id }}'
    );
    assert.equal(
      workflow.on.workflow_call.outputs?.failure_boundary_message?.value,
      '${{ jobs.windows-production-bootstrap-canary.outputs.failure_boundary_message }}'
    );
    assert.equal(
      job?.outputs?.failure_boundary_id,
      '${{ steps.result.outputs.failure_boundary_id }}'
    );
    assert.equal(
      job?.outputs?.failure_boundary_message,
      '${{ steps.result.outputs.failure_boundary_message }}'
    );
    assert.ok(!workflowText.includes('Skip bootstrap canary when production is manual-only'));
    assert.ok(workflowText.includes('Read target client canary admin token'));
    assert.ok(workflowText.includes('PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_ADMIN_TOKEN'));
    assert.ok(resetStep, 'Windows bootstrap canary must reset persistent state');
    assert.equal(
      steps.find((step) => step.name === 'Restore Windows runner DNS after reset')?.uses,
      './.github/actions/restore-windows-runner-dns'
    );
    assert.ok(
      String(provisionStep?.env?.PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_BILLING_MODE ?? '').includes(
        'steps.read-billing-mode.outputs.billing_mode'
      ),
      'production bootstrap canary should exercise manual_only via the provisioning helper'
    );
    assert.ok(ajaxStep, 'Windows bootstrap canary must include an AJAX auto-allow proof');
    assert.ok(
      installStepIndex >= 0 && installStepIndex < ajaxStepIndex && ajaxStepIndex < uploadStepIndex,
      'AJAX proof should run after live Windows enrollment/Firefox install and before artifacts'
    );
    assert.ok(
      setupNodeStepIndex >= 0 &&
        setupNodeStepIndex < restoreDependencyDnsStepIndex &&
        restoreDependencyDnsStepIndex < dependencyStepIndex &&
        setupNodeStepIndex < dependencyStepIndex &&
        dependencyStepIndex < ajaxStepIndex,
      'Windows AJAX canary must restore DNS and install Selenium dependencies after Node setup and before loading the canary script'
    );
    assert.equal(
      steps[restoreDependencyDnsStepIndex]?.uses,
      './.github/actions/restore-windows-runner-dns'
    );
    assert.equal(dependencyStep?.shell, 'bash');
    assert.ok(dependencyScript.includes('npm ci --ignore-scripts'));
    assert.ok(
      dependencyScript.includes('for attempt in 1 2 3'),
      'Windows AJAX canary dependency install should retry transient registry DNS failures'
    );
    assert.ok(dependencyScript.includes('npm cache verify'));
    assert.match(dependencyScript, /import\('selenium-webdriver'\)/);
    assert.match(dependencyScript, /import\('selenium-webdriver\/firefox\.js'\)/);
    assert.ok(
      ajaxStepIndex < restoreDnsStepIndex && restoreDnsStepIndex < uploadStepIndex,
      'Windows bootstrap canary should restore runner DNS before uploading artifacts'
    );
    assert.equal(ajaxStep?.shell, 'pwsh');
    assert.equal(
      ajaxStep?.env?.WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_MODE,
      'selenium',
      'Windows AJAX canary should use the runner-validated Selenium Firefox launcher'
    );
    assert.ok(
      String(ajaxStep?.env?.EXPECTED_EXTENSION_ID ?? '').includes(
        'steps.provision.outputs.extension_id'
      ),
      'Windows AJAX canary should validate the same Firefox extension id provisioned by the live bootstrap'
    );
    assert.equal(
      ajaxStep?.env?.WINDOWS_AJAX_AUTO_ALLOW_LOCAL_ADDON_PATH,
      undefined,
      'Windows AJAX canary must exercise the enterprise-managed Firefox extension from the live bootstrap, not a Selenium sideload'
    );
    assert.ok(ajaxScript.includes('node scripts/windows-ajax-auto-allow-canary.mjs'));
    assert.ok(ajaxCanaryEvidenceText.includes('ajax-auto-allow-origin.127.0.0.1.sslip.io'));
    assert.ok(ajaxCanaryEvidenceText.includes('ajax-auto-allow-target.127.0.0.1.sslip.io'));
    assert.ok(
      ajaxCanaryEvidenceText.includes('ajax-auto-allow-asset.127.0.0.1.sslip.io'),
      'Windows AJAX canary must cover non-XHR page subresources'
    );
    assert.ok(
      ajaxCanaryEvidenceText.includes('ajax-auto-allow-script.127.0.0.1.sslip.io'),
      'Windows AJAX canary must cover script subresources'
    );
    assert.ok(
      ajaxCanaryEvidenceText.includes('ajax-auto-allow-stylesheet.127.0.0.1.sslip.io'),
      'Windows AJAX canary must cover stylesheet subresources'
    );
    assert.ok(
      ajaxCanaryEvidenceText.includes('ajax-auto-allow-font.127.0.0.1.sslip.io'),
      'Windows AJAX canary must cover CSS-discovered font subresources'
    );
    assert.ok(ajaxCanaryScript.includes('Access-Control-Allow-Origin'));
    assert.ok(ajaxCanaryScript.includes('fetch('));
    assert.ok(ajaxCanaryScript.includes('new Image()'));
    assert.ok(ajaxCanaryScript.includes("document.createElement('script')"));
    assert.ok(ajaxCanaryScript.includes("document.createElement('link')"));
    assert.ok(ajaxCanaryScript.includes('loadFont'));
    assert.ok(ajaxCanaryScript.includes('@font-face'));
    assert.ok(ajaxCanaryScript.includes('fontFamily'));
    assert.ok(ajaxCanaryScript.includes('/probe-state?probe='));
    assert.ok(ajaxCanaryScript.includes('font/woff2'));
    assert.ok(
      ajaxCanaryScript.includes('waitForFirefoxExtensionReady'),
      'Windows AJAX canary must warm the same Firefox profile before navigating'
    );
    assert.ok(
      ajaxCanaryScript.includes('FIREFOX_EXTENSION_WARMUP_TIMEOUT_MS'),
      'Windows AJAX canary should fail explicitly when the forced extension is not ready'
    );
    assert.ok(
      ajaxCanaryScript.includes('firefoxExtensionWarmup'),
      'Windows AJAX canary artifacts should preserve extension readiness evidence'
    );
    assert.ok(
      ajaxCanaryScript.includes('waitForProcessExit(warmup)'),
      'Windows AJAX canary should wait for the warmup browser to release the profile'
    );
    assert.ok(
      ajaxCanaryScript.includes('originHits'),
      'Windows AJAX canary artifacts should show whether the allowed origin loaded'
    );
    assert.ok(
      ajaxCanaryScript.includes('Firefox exited before AJAX auto-allow result'),
      'Windows AJAX canary should fail explicitly when Firefox exits before reporting'
    );
    assert.ok(
      ajaxCanaryScript.includes('PROBE_TIMEOUT_MS'),
      'Windows AJAX canary should not let one blocked request starve the remaining probes'
    );
    assert.ok(
      ajaxCanaryScript.includes('withTimeout(runProbeOnce(probe)'),
      'Windows AJAX canary should retry all probe kinds even when fetch hangs'
    );
    assert.ok(
      ajaxCanaryScript.includes('WINDOWS_AJAX_AUTO_ALLOW_CANARY_SUMMARY'),
      'Windows AJAX canary should print functional evidence before artifact upload'
    );
    assert.ok(
      ajaxCanaryEvidenceModule.includes('WINDOWS_AUTO_ALLOW_PROBES = Object.freeze'),
      'Windows AJAX canary should declare subresource probes in one importable table'
    );
    assert.ok(
      ajaxCanaryEvidenceModule.includes("id: 'ajax-fetch'") &&
        ajaxCanaryEvidenceModule.includes("id: 'image-subresource'") &&
        ajaxCanaryEvidenceModule.includes("id: 'script-subresource'") &&
        ajaxCanaryEvidenceModule.includes("id: 'stylesheet-subresource'") &&
        ajaxCanaryEvidenceModule.includes("id: 'font-subresource'") &&
        ajaxCanaryEvidenceModule.includes("id: 'stylesheet-font-subresource'"),
      'Windows AJAX canary should identify each probe in evidence artifacts'
    );
    assert.ok(
      ajaxCanaryScript.includes('loadStylesheetFont'),
      'Windows AJAX canary should cover fonts discovered through a cross-origin stylesheet'
    );
    assert.ok(
      ajaxCanaryEvidenceModule.includes('Explicit font target was not written to whitelist'),
      'Windows AJAX canary should expose the font whitelist failure boundary'
    );
    assert.ok(
      ajaxCanaryEvidenceModule.includes('expectedWhitelistHost'),
      'Windows AJAX canary should validate whitelist writes from probe metadata'
    );
    assert.ok(
      ajaxCanaryScript.includes('collectWindowsAutoAllowDiagnostics'),
      'Windows AJAX canary should collect native-host diagnostics on success and failure'
    );
    assert.ok(
      ajaxCanaryScript.includes('redditDiagnostics') &&
        ajaxCanaryScript.includes('REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES') &&
        ajaxCanaryScript.includes('collectRedditDiagnostics'),
      'Windows AJAX canary should preserve real reddit host diagnostics when synthetic probes pass'
    );
    assert.ok(
      ajaxCanaryScript.includes('redactSensitiveWindowsCanaryValue'),
      'Windows AJAX canary diagnostics must redact machine tokens before writing artifacts'
    );
    assert.ok(
      ajaxCanaryScript.includes('nativeProtocol') &&
        ajaxCanaryScript.includes('tokenPresent') &&
        ajaxCanaryScript.includes('OpenPath-Update') &&
        ajaxCanaryScript.includes('OpenPath-SSE') &&
        ajaxCanaryScript.includes('native-host.log') &&
        ajaxCanaryScript.includes('openpath.log') &&
        ajaxCanaryScript.includes('whitelistMtimeMs'),
      'Windows AJAX canary artifacts should expose native protocol, task, log, and whitelist state'
    );
    assert.ok(
      ajaxCanaryScript.includes("req.url === '/attempt'") &&
        ajaxCanaryScript.includes('browserAttempts') &&
        ajaxCanaryScript.includes('completedProbes') &&
        ajaxCanaryScript.includes('lastAttemptAt') &&
        ajaxCanaryScript.includes('reportAttempt(attemptResult, completed)'),
      'Windows AJAX canary timeout artifacts should preserve incremental browser attempt evidence'
    );
    assert.ok(
      ajaxCanaryScript.includes('collectRemoteWhitelistEvidence') &&
        ajaxCanaryScript.includes('remoteWhitelist') &&
        ajaxCanaryScript.includes('containsExpectedHosts') &&
        ajaxCanaryScript.includes('redactSensitiveWindowsCanaryValue(whitelistUrl)'),
      'Windows AJAX canary diagnostics should compare redacted remote whitelist state against expected hosts'
    );
    assert.ok(
      ajaxCanaryScript.includes('collectCanaryGroupDiagnostics') &&
        ajaxCanaryScript.includes('/cp/internal/client-canary/group/') &&
        ajaxCanaryScript.includes('WINDOWS_AJAX_AUTO_ALLOW_CANARY_GROUP_ID') &&
        ajaxCanaryScript.includes('WINDOWS_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN'),
      'Windows AJAX canary diagnostics should capture protected server-side request/rule state for the canary group'
    );
    assert.ok(
      workflowText.includes('WINDOWS_AJAX_AUTO_ALLOW_CANARY_API_URL=${base_url%/}') &&
        String(ajaxStep?.env?.WINDOWS_AJAX_AUTO_ALLOW_CANARY_GROUP_ID ?? '').includes(
          'steps.provision.outputs.group_id'
        ) &&
        String(ajaxStep?.env?.WINDOWS_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN ?? '').includes(
          'PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_ADMIN_TOKEN'
        ),
      'Windows AJAX canary workflow should pass base URL, canary group, and protected diagnostics token into the diagnostic script'
    );
    assert.ok(
      workflowText.includes('WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_MODE') &&
        ajaxCanaryEvidenceText.includes('firefox-extension-ready'),
      'Windows bootstrap canary must leave runtime extension readiness to the Selenium firefox-extension-ready gate'
    );
    assert.ok(
      !workflowText.includes(
        'Firefox neither registered the force-installed extension nor emitted enterprise policy logs'
      ),
      'Windows bootstrap canary must not accept logs-only extension evidence'
    );
    assert.ok(ajaxCanaryScript.includes('C:\\\\OpenPath\\\\data\\\\whitelist.txt'));
    assert.ok(ajaxCanaryEvidenceText.includes('Explicit AJAX target was not written to whitelist'));
    assert.ok(
      ajaxCanaryEvidenceText.includes('Explicit image target was not written to whitelist')
    );
    assert.ok(
      ajaxCanaryEvidenceText.includes('Explicit script target was not written to whitelist')
    );
    assert.ok(
      ajaxCanaryEvidenceText.includes('Explicit stylesheet target was not written to whitelist')
    );
    assert.ok(ajaxCanaryScript.includes('production-windows-ajax-auto-allow-canary.json'));
    const summaryStepIndex = steps.findIndex(
      (step) => step.name === 'Summarize Windows AJAX auto-allow evidence'
    );
    const summaryStep = summaryStepIndex >= 0 ? steps[summaryStepIndex] : undefined;
    const resultStepIndex = steps.findIndex((step) => step.name === 'Record canary result');
    const resultStep = resultStepIndex >= 0 ? steps[resultStepIndex] : undefined;
    assert.ok(workflowText.includes('Record canary result'));
    assert.ok(summaryStep, 'Windows bootstrap canary should summarize functional evidence');
    assert.equal(summaryStep?.id, 'ajax-summary');
    assert.equal(summaryStep?.if, 'always()');
    assert.match(
      String(summaryStep?.run ?? ''),
      /scripts\/summarize-windows-ajax-auto-allow-evidence\.mjs/
    );
    assert.ok(
      ajaxStepIndex < summaryStepIndex && summaryStepIndex < uploadStepIndex,
      'AJAX evidence summary should run after the canary and before artifact upload'
    );
    const restoreDnsStep = restoreDnsStepIndex >= 0 ? steps[restoreDnsStepIndex] : undefined;
    assert.equal(restoreDnsStep?.if, 'always()');
    assert.equal(restoreDnsStep?.['continue-on-error'], true);
    assert.equal(restoreDnsStep?.uses, './.github/actions/restore-windows-runner-dns');
    const uploadStep = uploadStepIndex >= 0 ? steps[uploadStepIndex] : undefined;
    assert.equal(uploadStep?.id, 'upload-artifacts');
    assert.equal(
      uploadStep?.['continue-on-error'],
      true,
      'artifact transport failures should be converted into an explicit artifact-upload boundary'
    );
    assert.equal(uploadStep?.with?.['if-no-files-found'], 'error');
    assert.equal(uploadStep?.with?.['retention-days'], 14);
    assert.match(String(uploadStep?.with?.path ?? ''), /production-windows-bootstrap-canary\.json/);
    assert.match(
      String(uploadStep?.with?.path ?? ''),
      /production-windows-ajax-auto-allow-canary\.json/
    );
    assert.match(String(uploadStep?.with?.path ?? ''), /production-windows-runner-health\.json/);
    assert.ok(
      uploadStepIndex < resultStepIndex,
      'final canary result should run after artifact upload so upload failures are visible'
    );
    assert.equal(resultStep?.id, 'result');
    assert.equal(resultStep?.if, 'always()');
    assert.match(String(resultStep?.run ?? ''), /failure_boundary_id=artifact-upload/);
    assert.match(String(resultStep?.run ?? ''), /steps\.upload-artifacts\.outcome/);
  });

  test('Windows canary uploads diagnostic artifacts even after functional failure', () => {
    const workflow = readProjectText('.github/workflows/windows-production-bootstrap-canary.yml');

    assert.match(workflow, /name: Initialize Windows canary evidence files/);
    assert.match(
      workflow,
      /name: Initialize Windows canary evidence files[\s\S]*production-windows-bootstrap-canary\.json[\s\S]*production-windows-ajax-auto-allow-canary\.json[\s\S]*production-windows-runner-health\.json/
    );
    assert.match(
      workflow,
      /name: Upload production bootstrap canary artifacts[\s\S]*if: always\(\)/
    );
    assert.match(workflow, /production-windows-bootstrap-canary\.json/);
    assert.match(workflow, /production-windows-ajax-auto-allow-canary\.json/);
    assert.match(workflow, /production-windows-runner-health\.json/);
    assert.match(
      workflow,
      /if \[ "\$ARTIFACT_UPLOAD_OUTCOME" != "success" \]; then[\s\S]*failure_boundary_id=artifact-upload/
    );
    assert.match(
      workflow,
      /name: Upload production bootstrap canary artifacts[\s\S]*retention-days: 14/
    );
  });
});
