import {
  buildAutoAllowArtifactFailureSummary,
  buildAutoAllowDiagnosticPhase,
  buildAutoAllowDiagnosticPhases,
  classifyAutoAllowFailureBoundary,
  enrichProbeEvidenceWithRemoteDiagnostics,
  hasCandidateEvidence,
  hasDnsEvidence,
  hasLocalWhitelistEvidence,
  hasProbeTrafficEvidence,
  hasRemoteRuleEvidence,
} from './auto-allow-boundary-evidence.mjs';

export const LINUX_AUTO_ALLOW_ORIGIN_HOST = 'ajax-auto-allow-origin.127.0.0.1.sslip.io';
export const LINUX_AUTO_ALLOW_TARGET_HOST = 'ajax-auto-allow-target.127.0.0.1.sslip.io';
export const LINUX_AUTO_ALLOW_ASSET_HOST = 'ajax-auto-allow-asset.127.0.0.1.sslip.io';
export const LINUX_AUTO_ALLOW_SCRIPT_HOST = 'ajax-auto-allow-script.127.0.0.1.sslip.io';
export const LINUX_AUTO_ALLOW_STYLESHEET_HOST = 'ajax-auto-allow-stylesheet.127.0.0.1.sslip.io';
export const LINUX_AUTO_ALLOW_FONT_HOST = 'ajax-auto-allow-font.127.0.0.1.sslip.io';

export const LINUX_AUTO_ALLOW_PROBES = Object.freeze([
  {
    id: 'ajax-fetch',
    kind: 'fetch',
    host: LINUX_AUTO_ALLOW_TARGET_HOST,
    path: '/data.json',
    expectedWhitelistHost: LINUX_AUTO_ALLOW_TARGET_HOST,
    failureMessage: 'Auto-allow AJAX target was not written to the Linux whitelist',
  },
  {
    id: 'image-subresource',
    kind: 'image',
    host: LINUX_AUTO_ALLOW_ASSET_HOST,
    path: '/pixel.png',
    expectedWhitelistHost: LINUX_AUTO_ALLOW_ASSET_HOST,
    failureMessage: 'Auto-allow image target was not written to the Linux whitelist',
  },
  {
    id: 'script-subresource',
    kind: 'script',
    host: LINUX_AUTO_ALLOW_SCRIPT_HOST,
    path: '/asset.js',
    expectedWhitelistHost: LINUX_AUTO_ALLOW_SCRIPT_HOST,
    failureMessage: 'Auto-allow script target was not written to the Linux whitelist',
  },
  {
    id: 'stylesheet-subresource',
    kind: 'stylesheet',
    host: LINUX_AUTO_ALLOW_STYLESHEET_HOST,
    path: '/style.css',
    expectedWhitelistHost: LINUX_AUTO_ALLOW_STYLESHEET_HOST,
    failureMessage: 'Auto-allow stylesheet target was not written to the Linux whitelist',
  },
  {
    id: 'font-subresource',
    kind: 'font',
    host: LINUX_AUTO_ALLOW_FONT_HOST,
    path: '/font.woff2',
    expectedWhitelistHost: LINUX_AUTO_ALLOW_FONT_HOST,
    failureMessage: 'Auto-allow font target was not written to the Linux whitelist',
  },
]);

export const LINUX_AUTO_ALLOW_DIAGNOSTIC_PHASE_IDS = Object.freeze([
  'firefox-extension-ready',
  'origin-page-load',
  'page-observer',
  'page-resource-candidates',
  'remote-rule-creation',
  'local-whitelist-apply',
  'dns-policy-apply',
  'probe-traffic',
  'artifact-written',
]);

export const LINUX_AUTO_ALLOW_FAILURE_BOUNDARIES = Object.freeze({
  'firefox-extension-ready': {
    message: 'Firefox did not report the OpenPath extension as ready before the canary page ran.',
    recommendedNextAction:
      'Inspect Linux Firefox policy, managed extension payload, and Selenium startup.',
  },
  'origin-page-load': {
    message: 'The allowed origin page did not reach the local Linux canary server.',
    recommendedNextAction:
      'Inspect Linux runner DNS, Firefox launch, and local canary server reachability.',
  },
  'page-observer': {
    message: 'The Firefox page-resource observer was not installed in the origin page.',
    recommendedNextAction: 'Inspect Linux Firefox extension content-script injection.',
  },
  'page-resource-candidates': {
    message: 'The Linux page did not emit resource-candidate events for every probe.',
    recommendedNextAction:
      'Inspect page-resource detection and candidate matching in the Firefox extension.',
  },
  'remote-rule-creation': {
    message:
      'The remote ClassroomPath/OpenPath whitelist state did not contain every expected Linux probe host.',
    recommendedNextAction:
      'Inspect protected canary group diagnostics and remote whitelist publication.',
  },
  'local-whitelist-apply': {
    message:
      'Remote rules were present but the local Linux whitelist did not contain every expected probe host.',
    recommendedNextAction:
      'Inspect openpath-update.service, openpath-sse-listener.service, and /var/lib/openpath/whitelist.txt.',
  },
  'dns-policy-apply': {
    message: 'The Linux DNS policy did not allow every expected auto-allowed probe host.',
    recommendedNextAction: 'Inspect dnsmasq state, /etc/resolv.conf, and local dig evidence.',
  },
  'probe-traffic': {
    message:
      'The local Linux whitelist contained expected hosts but browser probes still did not reach the canary server.',
    recommendedNextAction:
      'Inspect Firefox DNS cache, dnsmasq application, and extension/native-host visibility.',
  },
  'artifact-written': {
    message: 'The Linux AJAX canary did not write a usable evidence artifact.',
    recommendedNextAction: 'Inspect runner filesystem state and canary process output.',
  },
  'artifact-upload': {
    message: 'Functional canary evidence was produced but GitHub artifact upload failed.',
    recommendedNextAction: 'Inspect runner connectivity to the GitHub artifact service.',
  },
  none: {
    message: 'Linux AJAX auto-allow canary completed successfully.',
    recommendedNextAction: 'No follow-up required for this canary run.',
  },
});

export function buildLinuxAutoAllowProbeUrl(probe, port) {
  return `http://${probe.host}:${port}${probe.path}`;
}

function phase(id, status, evidence = {}) {
  return buildAutoAllowDiagnosticPhase({
    id,
    status,
    evidence,
    boundaries: LINUX_AUTO_ALLOW_FAILURE_BOUNDARIES,
  });
}

function hasBrowserObservedPageObserver(summary) {
  return (
    summary?.browserNavigation?.beforeAttempts?.openpathObserverInstalled === true ||
    summary?.browserNavigation?.afterAttempts?.openpathObserverInstalled === true
  );
}

export function buildLinuxAutoAllowDiagnosticPhases(summary, probes = LINUX_AUTO_ALLOW_PROBES) {
  const expectedHosts = probes.map((probe) => probe.expectedWhitelistHost);
  const checks = [
    {
      id: 'firefox-extension-ready',
      passed: summary?.firefoxExtensionWarmup?.ready === true,
      evidence: summary?.firefoxExtensionWarmup ?? null,
    },
    {
      id: 'origin-page-load',
      passed: Number(summary?.originPageHits ?? summary?.originHits ?? 0) > 0,
      evidence: {
        originHits: Number(summary?.originHits ?? 0),
        originPageHits: Number(summary?.originPageHits ?? summary?.originHits ?? 0),
        attemptHits: Number(summary?.attemptHits ?? 0),
        browserNavigation: summary?.browserNavigation ?? null,
      },
    },
    {
      id: 'page-observer',
      passed: summary?.pageObserverInstalled === true || hasBrowserObservedPageObserver(summary),
      evidence: {
        pageObserverInstalled: summary?.pageObserverInstalled ?? null,
        browserNavigation: summary?.browserNavigation ?? null,
      },
    },
    {
      id: 'page-resource-candidates',
      passed: hasCandidateEvidence(summary, probes),
      evidence: { completedCandidateEvents: summary?.completedCandidateEvents ?? null },
    },
    {
      id: 'remote-rule-creation',
      passed: hasRemoteRuleEvidence(summary, expectedHosts),
      evidence: { expectedHosts },
    },
    {
      id: 'local-whitelist-apply',
      passed: hasLocalWhitelistEvidence(summary, probes),
      evidence: { expectedHosts, probeEvidence: summary?.probeEvidence ?? [] },
    },
    {
      id: 'dns-policy-apply',
      passed: hasDnsEvidence(summary, expectedHosts),
      evidence: { expectedHosts },
    },
    {
      id: 'probe-traffic',
      passed: hasProbeTrafficEvidence(summary, probes),
      evidence: { probeEvidence: summary?.probeEvidence ?? [] },
    },
    {
      id: 'artifact-written',
      passed: summary?.artifactWritten !== false && summary?.artifact?.written !== false,
      evidence: { artifactWritten: summary?.artifactWritten ?? true },
    },
  ];

  return buildAutoAllowDiagnosticPhases({
    checks,
    boundaries: LINUX_AUTO_ALLOW_FAILURE_BOUNDARIES,
  });
}

export function classifyLinuxAutoAllowFailureBoundary(summary, probes = LINUX_AUTO_ALLOW_PROBES) {
  const diagnosticPhases =
    summary?.diagnosticPhases ?? buildLinuxAutoAllowDiagnosticPhases(summary, probes);
  return classifyAutoAllowFailureBoundary({
    diagnosticPhases,
    boundaries: LINUX_AUTO_ALLOW_FAILURE_BOUNDARIES,
  });
}

export function withLinuxAutoAllowDiagnostics(summary, probes = LINUX_AUTO_ALLOW_PROBES) {
  const enrichedSummary = Array.isArray(summary?.probeEvidence)
    ? {
        ...summary,
        probeEvidence: enrichProbeEvidenceWithRemoteDiagnostics(
          summary.probeEvidence,
          summary,
          probes
        ),
      }
    : summary;
  const diagnosticPhases = buildLinuxAutoAllowDiagnosticPhases(enrichedSummary, probes);
  return {
    ...enrichedSummary,
    diagnosticPhases,
    failureBoundary: classifyLinuxAutoAllowFailureBoundary(
      { ...enrichedSummary, diagnosticPhases },
      probes
    ),
  };
}

export function buildLinuxAutoAllowArtifactFailureSummary({ id, artifactPath, error, message }) {
  return buildAutoAllowArtifactFailureSummary({
    id,
    message,
    artifactPath,
    error,
    phaseIds: LINUX_AUTO_ALLOW_DIAGNOSTIC_PHASE_IDS,
    boundaries: LINUX_AUTO_ALLOW_FAILURE_BOUNDARIES,
  });
}
