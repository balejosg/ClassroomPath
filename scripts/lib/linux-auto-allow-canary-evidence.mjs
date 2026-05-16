import {
  buildAutoAllowArtifactFailureSummary,
  buildAutoAllowEvidenceModel,
  classifyAutoAllowFailureBoundary,
  enrichProbeEvidenceWithRemoteDiagnostics,
  hasCandidateEvidence,
  hasLocalWhitelistEvidence,
  hasNoAutomaticRuleCreationEvidence,
  hasProbeTrafficEvidence,
  hasRemoteRuleEvidence,
} from './auto-allow-boundary-evidence.mjs';

export const LINUX_AUTO_ALLOW_ORIGIN_HOST = 'ajax-auto-allow-origin.127.0.0.1.sslip.io';
export const LINUX_AUTO_ALLOW_TARGET_HOST = 'ajax-auto-allow-target.127.0.0.1.sslip.io';
export const LINUX_AUTO_ALLOW_XHR_HOST = 'ajax-auto-allow-xhr.127.0.0.1.sslip.io';
export const LINUX_AUTO_ALLOW_ASSET_HOST = 'ajax-auto-allow-asset.127.0.0.1.sslip.io';
export const LINUX_AUTO_ALLOW_SCRIPT_HOST = 'ajax-auto-allow-script.127.0.0.1.sslip.io';
export const LINUX_AUTO_ALLOW_STYLESHEET_HOST = 'ajax-auto-allow-stylesheet.127.0.0.1.sslip.io';
export const LINUX_AUTO_ALLOW_FONT_HOST = 'ajax-auto-allow-font.127.0.0.1.sslip.io';
export const LINUX_AUTO_ALLOW_OBSERVED_FETCH_HOST = 'ajax-observe-fetch.127.0.0.1.sslip.io';
export const LINUX_AUTO_ALLOW_OBSERVED_XHR_HOST = 'ajax-observe-xhr.127.0.0.1.sslip.io';
export const LINUX_AUTO_ALLOW_OBSERVED_IMAGE_HOST = 'ajax-observe-image.127.0.0.1.sslip.io';
export const LINUX_AUTO_ALLOW_OBSERVED_SCRIPT_HOST = 'ajax-observe-script.127.0.0.1.sslip.io';
export const LINUX_AUTO_ALLOW_OBSERVED_STYLESHEET_HOST =
  'ajax-observe-stylesheet.127.0.0.1.sslip.io';
export const LINUX_AUTO_ALLOW_OBSERVED_FONT_HOST = 'ajax-observe-font.127.0.0.1.sslip.io';

export const LINUX_AUTO_ALLOW_PROBES = Object.freeze([
  {
    id: 'ajax-fetch',
    kind: 'fetch',
    host: LINUX_AUTO_ALLOW_TARGET_HOST,
    path: '/data.json',
    expectedWhitelistHost: LINUX_AUTO_ALLOW_TARGET_HOST,
    failureMessage: 'Explicit AJAX target was not written to the Linux whitelist',
    requiresTraffic: false,
  },
  {
    id: 'xhr-subresource',
    kind: 'xhr',
    host: LINUX_AUTO_ALLOW_XHR_HOST,
    path: '/xhr.json',
    expectedWhitelistHost: LINUX_AUTO_ALLOW_XHR_HOST,
    failureMessage: 'Explicit XHR target was not written to the Linux whitelist',
  },
  {
    id: 'image-subresource',
    kind: 'image',
    host: LINUX_AUTO_ALLOW_ASSET_HOST,
    path: '/pixel.png',
    expectedWhitelistHost: LINUX_AUTO_ALLOW_ASSET_HOST,
    failureMessage: 'Explicit image target was not written to the Linux whitelist',
    requiresTraffic: false,
  },
  {
    id: 'script-subresource',
    kind: 'script',
    host: LINUX_AUTO_ALLOW_SCRIPT_HOST,
    path: '/asset.js',
    expectedWhitelistHost: LINUX_AUTO_ALLOW_SCRIPT_HOST,
    failureMessage: 'Explicit script target was not written to the Linux whitelist',
  },
  {
    id: 'stylesheet-subresource',
    kind: 'stylesheet',
    host: LINUX_AUTO_ALLOW_STYLESHEET_HOST,
    path: '/style.css',
    expectedWhitelistHost: LINUX_AUTO_ALLOW_STYLESHEET_HOST,
    failureMessage: 'Explicit stylesheet target was not written to the Linux whitelist',
  },
  {
    id: 'font-subresource',
    kind: 'font',
    host: LINUX_AUTO_ALLOW_FONT_HOST,
    path: '/font.woff2',
    expectedWhitelistHost: LINUX_AUTO_ALLOW_FONT_HOST,
    failureMessage: 'Explicit font target was not written to the Linux whitelist',
  },
]);

export const LINUX_AUTO_ALLOW_OBSERVATION_PROBES = Object.freeze([
  {
    id: 'observed-fetch',
    kind: 'fetch',
    host: LINUX_AUTO_ALLOW_OBSERVED_FETCH_HOST,
    path: '/data.json',
    expectedWhitelistHost: LINUX_AUTO_ALLOW_OBSERVED_FETCH_HOST,
    automaticRuleCreationExpected: false,
    requiresTraffic: false,
  },
  {
    id: 'observed-xhr',
    kind: 'xhr',
    host: LINUX_AUTO_ALLOW_OBSERVED_XHR_HOST,
    path: '/xhr.json',
    expectedWhitelistHost: LINUX_AUTO_ALLOW_OBSERVED_XHR_HOST,
    automaticRuleCreationExpected: false,
    requiresTraffic: false,
  },
  {
    id: 'observed-image',
    kind: 'image',
    host: LINUX_AUTO_ALLOW_OBSERVED_IMAGE_HOST,
    path: '/pixel.png',
    expectedWhitelistHost: LINUX_AUTO_ALLOW_OBSERVED_IMAGE_HOST,
    automaticRuleCreationExpected: false,
    requiresTraffic: false,
  },
  {
    id: 'observed-script',
    kind: 'script',
    host: LINUX_AUTO_ALLOW_OBSERVED_SCRIPT_HOST,
    path: '/asset.js',
    expectedWhitelistHost: LINUX_AUTO_ALLOW_OBSERVED_SCRIPT_HOST,
    automaticRuleCreationExpected: false,
    requiresTraffic: false,
  },
  {
    id: 'observed-stylesheet',
    kind: 'stylesheet',
    host: LINUX_AUTO_ALLOW_OBSERVED_STYLESHEET_HOST,
    path: '/style.css',
    expectedWhitelistHost: LINUX_AUTO_ALLOW_OBSERVED_STYLESHEET_HOST,
    automaticRuleCreationExpected: false,
    requiresTraffic: false,
  },
  {
    id: 'observed-font',
    kind: 'font',
    host: LINUX_AUTO_ALLOW_OBSERVED_FONT_HOST,
    path: '/font.woff2',
    expectedWhitelistHost: LINUX_AUTO_ALLOW_OBSERVED_FONT_HOST,
    automaticRuleCreationExpected: false,
    requiresTraffic: false,
  },
]);

export const LINUX_AUTO_ALLOW_ALL_PROBES = Object.freeze([
  ...LINUX_AUTO_ALLOW_OBSERVATION_PROBES,
  ...LINUX_AUTO_ALLOW_PROBES,
]);

export const LINUX_AUTO_ALLOW_DIAGNOSTIC_PHASE_IDS = Object.freeze([
  'firefox-extension-ready',
  'origin-page-load',
  'page-observer',
  'page-resource-candidates',
  'no-automatic-rule-creation',
  'explicit-whitelist-apply',
  'explicit-probe-traffic',
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
  'no-automatic-rule-creation': {
    message:
      'Observed Linux page-resource candidates appeared in whitelist state even though automatic rule creation is not expected.',
    recommendedNextAction:
      'Inspect Firefox/Core runtime and server-side request automation before treating this as a valid canary success.',
  },
  'explicit-whitelist-apply': {
    message: 'Explicit Linux rules were missing from remote or local whitelist state.',
    recommendedNextAction:
      'Inspect canary provisioning seed rules, openpath-update.service, openpath-sse-listener.service, and /var/lib/openpath/whitelist.txt.',
  },
  'explicit-probe-traffic': {
    message: 'Explicitly whitelisted Linux browser probes still did not reach the canary server.',
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
    message:
      'Linux page-resource observation completed without automatic rule creation and explicit allowlist probes succeeded.',
    recommendedNextAction: 'No follow-up required for this canary run.',
  },
});

export function buildLinuxAutoAllowProbeUrl(probe, port) {
  return `http://${probe.host}:${port}${probe.path}`;
}

function hasBrowserObservedPageObserver(summary) {
  return (
    summary?.browserNavigation?.beforeAttempts?.openpathObserverInstalled === true ||
    summary?.browserNavigation?.afterAttempts?.openpathObserverInstalled === true
  );
}

export const LINUX_AUTO_ALLOW_DIAGNOSTIC_PHASES = Object.freeze([
  {
    id: 'firefox-extension-ready',
    passed: (summary) => summary?.firefoxExtensionWarmup?.ready === true,
    evidence: (summary) => summary?.firefoxExtensionWarmup ?? null,
  },
  {
    id: 'origin-page-load',
    passed: (summary) => Number(summary?.originPageHits ?? summary?.originHits ?? 0) > 0,
    evidence: (summary) => ({
      originHits: Number(summary?.originHits ?? 0),
      originPageHits: Number(summary?.originPageHits ?? summary?.originHits ?? 0),
      attemptHits: Number(summary?.attemptHits ?? 0),
      browserNavigation: summary?.browserNavigation ?? null,
    }),
  },
  {
    id: 'page-observer',
    passed: (summary) =>
      summary?.pageObserverInstalled === true || hasBrowserObservedPageObserver(summary),
    evidence: (summary) => ({
      pageObserverInstalled: summary?.pageObserverInstalled ?? null,
      pageObserverState: summary?.pageObserverState ?? null,
      browserNavigation: summary?.browserNavigation ?? null,
    }),
  },
  {
    id: 'page-resource-candidates',
    passed: (summary) => hasCandidateEvidence(summary, LINUX_AUTO_ALLOW_ALL_PROBES),
    evidence: (summary) => ({
      completedCandidateEvents: summary?.completedCandidateEvents ?? null,
      pageObserverState: summary?.pageObserverState ?? null,
    }),
  },
  {
    id: 'no-automatic-rule-creation',
    passed: (summary) =>
      hasNoAutomaticRuleCreationEvidence(summary, LINUX_AUTO_ALLOW_OBSERVATION_PROBES),
    evidence: () => ({
      automaticRuleCreationExpected: false,
      observedHosts: LINUX_AUTO_ALLOW_OBSERVATION_PROBES.map(
        (probe) => probe.expectedWhitelistHost
      ),
    }),
  },
  {
    id: 'explicit-whitelist-apply',
    passed: (summary, probes) =>
      hasRemoteRuleEvidence(
        summary,
        probes.map((probe) => probe.expectedWhitelistHost)
      ) && hasLocalWhitelistEvidence(summary, probes),
    evidence: (summary, probes) => ({
      explicitHosts: probes.map((probe) => probe.expectedWhitelistHost),
      probeEvidence: summary?.probeEvidence ?? [],
    }),
  },
  {
    id: 'explicit-probe-traffic',
    passed: (summary, probes) => hasProbeTrafficEvidence(summary, probes),
    evidence: (summary) => ({ probeEvidence: summary?.probeEvidence ?? [] }),
  },
  {
    id: 'artifact-written',
    passed: (summary) => summary?.artifactWritten !== false && summary?.artifact?.written !== false,
    evidence: (summary) => ({ artifactWritten: summary?.artifactWritten ?? true }),
  },
]);

export function buildLinuxAutoAllowDiagnosticPhases(summary, probes = LINUX_AUTO_ALLOW_PROBES) {
  return buildAutoAllowEvidenceModel({
    phases: LINUX_AUTO_ALLOW_DIAGNOSTIC_PHASES,
    summary,
    probes,
    boundaries: LINUX_AUTO_ALLOW_FAILURE_BOUNDARIES,
  }).diagnosticPhases;
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
  return buildAutoAllowEvidenceModel({
    phases: LINUX_AUTO_ALLOW_DIAGNOSTIC_PHASES,
    summary: {
      contract: 'page-resource-observation-no-auto-allow',
      automaticRuleCreationExpected: false,
      ...summary,
    },
    probes,
    boundaries: LINUX_AUTO_ALLOW_FAILURE_BOUNDARIES,
    enrichProbeEvidence: enrichProbeEvidenceWithRemoteDiagnostics,
  });
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
