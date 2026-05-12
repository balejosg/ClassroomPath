import {
  buildAutoAllowArtifactFailureSummary,
  buildAutoAllowDiagnosticPhase,
  buildAutoAllowEvidenceModel,
  classifyAutoAllowFailureBoundary,
  enrichProbeEvidenceWithRemoteDiagnostics,
  hasCandidateEvidence,
  hasLocalWhitelistEvidence,
  hasNoAutomaticRuleCreationEvidence,
  hasProbeTrafficEvidence,
  hasRemoteRuleEvidence,
} from './auto-allow-boundary-evidence.mjs';

export const WINDOWS_AUTO_ALLOW_ORIGIN_HOST = 'ajax-auto-allow-origin.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_TARGET_HOST = 'ajax-auto-allow-target.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_XHR_HOST = 'ajax-auto-allow-xhr.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_ASSET_HOST = 'ajax-auto-allow-asset.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_SCRIPT_HOST = 'ajax-auto-allow-script.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_STYLESHEET_HOST = 'ajax-auto-allow-stylesheet.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_FONT_HOST = 'ajax-auto-allow-font.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_STYLESHEET_FONT_HOST =
  'ajax-auto-allow-stylesheet-font.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_OBSERVED_FETCH_HOST = 'ajax-observe-fetch.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_OBSERVED_XHR_HOST = 'ajax-observe-xhr.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_OBSERVED_IMAGE_HOST = 'ajax-observe-image.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_OBSERVED_SCRIPT_HOST = 'ajax-observe-script.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_OBSERVED_STYLESHEET_HOST =
  'ajax-observe-stylesheet.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_OBSERVED_FONT_HOST = 'ajax-observe-font.127.0.0.1.sslip.io';

export const REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS = Object.freeze([
  'emoji.redditmedia.com',
  'external-preview.redd.it',
  'i.redd.it',
  'styles.redditmedia.com',
  'www.redditstatic.com',
]);

export const REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES = Object.freeze([
  {
    id: 'reddit-emoji-image',
    kind: 'image',
    host: 'emoji.redditmedia.com',
    url: 'https://emoji.redditmedia.com/favicon.ico',
  },
  {
    id: 'reddit-external-preview-image',
    kind: 'image',
    host: 'external-preview.redd.it',
    url: 'https://external-preview.redd.it/reddit-preview-diagnostic.png',
  },
  {
    id: 'reddit-i-image',
    kind: 'image',
    host: 'i.redd.it',
    url: 'https://i.redd.it/reddit-image-diagnostic.png',
  },
  {
    id: 'reddit-stylesheet',
    kind: 'stylesheet',
    host: 'styles.redditmedia.com',
    url: 'https://styles.redditmedia.com/reddit-style-diagnostic.css',
  },
  {
    id: 'reddit-static-script',
    kind: 'script',
    host: 'www.redditstatic.com',
    url: 'https://www.redditstatic.com/reddit-static-diagnostic.js',
  },
]);

export const WINDOWS_AUTO_ALLOW_PROBES = Object.freeze([
  {
    id: 'ajax-fetch',
    kind: 'fetch',
    host: WINDOWS_AUTO_ALLOW_TARGET_HOST,
    path: '/data.json',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_TARGET_HOST,
    failureMessage: 'Explicit AJAX target was not written to whitelist',
  },
  {
    id: 'xhr-subresource',
    kind: 'xhr',
    host: WINDOWS_AUTO_ALLOW_XHR_HOST,
    path: '/xhr.json',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_XHR_HOST,
    failureMessage: 'Explicit XHR target was not written to whitelist',
  },
  {
    id: 'image-subresource',
    kind: 'image',
    host: WINDOWS_AUTO_ALLOW_ASSET_HOST,
    path: '/pixel.png',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_ASSET_HOST,
    failureMessage: 'Explicit image target was not written to whitelist',
  },
  {
    id: 'script-subresource',
    kind: 'script',
    host: WINDOWS_AUTO_ALLOW_SCRIPT_HOST,
    path: '/asset.js',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_SCRIPT_HOST,
    failureMessage: 'Explicit script target was not written to whitelist',
  },
  {
    id: 'stylesheet-subresource',
    kind: 'stylesheet',
    host: WINDOWS_AUTO_ALLOW_STYLESHEET_HOST,
    path: '/style.css',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_STYLESHEET_HOST,
    failureMessage: 'Explicit stylesheet target was not written to whitelist',
  },
  {
    id: 'font-subresource',
    kind: 'font',
    host: WINDOWS_AUTO_ALLOW_FONT_HOST,
    path: '/font.woff2',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_FONT_HOST,
    failureMessage: 'Explicit font target was not written to whitelist',
  },
  {
    id: 'stylesheet-font-subresource',
    kind: 'stylesheet-font',
    host: WINDOWS_AUTO_ALLOW_STYLESHEET_FONT_HOST,
    path: '/font-from-stylesheet.woff2',
    stylesheetHost: WINDOWS_AUTO_ALLOW_STYLESHEET_HOST,
    stylesheetPath: '/font-chain.css',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_STYLESHEET_FONT_HOST,
    expectsPageResourceCandidate: false,
    failureMessage: 'Explicit stylesheet-discovered font target was not written to whitelist',
  },
]);

export const WINDOWS_AUTO_ALLOW_OBSERVATION_PROBES = Object.freeze([
  {
    id: 'observed-fetch',
    kind: 'fetch',
    host: WINDOWS_AUTO_ALLOW_OBSERVED_FETCH_HOST,
    path: '/data.json',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_OBSERVED_FETCH_HOST,
    automaticRuleCreationExpected: false,
    requiresTraffic: false,
  },
  {
    id: 'observed-xhr',
    kind: 'xhr',
    host: WINDOWS_AUTO_ALLOW_OBSERVED_XHR_HOST,
    path: '/xhr.json',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_OBSERVED_XHR_HOST,
    automaticRuleCreationExpected: false,
    requiresTraffic: false,
  },
  {
    id: 'observed-image',
    kind: 'image',
    host: WINDOWS_AUTO_ALLOW_OBSERVED_IMAGE_HOST,
    path: '/pixel.png',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_OBSERVED_IMAGE_HOST,
    automaticRuleCreationExpected: false,
    requiresTraffic: false,
  },
  {
    id: 'observed-script',
    kind: 'script',
    host: WINDOWS_AUTO_ALLOW_OBSERVED_SCRIPT_HOST,
    path: '/asset.js',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_OBSERVED_SCRIPT_HOST,
    automaticRuleCreationExpected: false,
    requiresTraffic: false,
  },
  {
    id: 'observed-stylesheet',
    kind: 'stylesheet',
    host: WINDOWS_AUTO_ALLOW_OBSERVED_STYLESHEET_HOST,
    path: '/style.css',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_OBSERVED_STYLESHEET_HOST,
    automaticRuleCreationExpected: false,
    requiresTraffic: false,
  },
  {
    id: 'observed-font',
    kind: 'font',
    host: WINDOWS_AUTO_ALLOW_OBSERVED_FONT_HOST,
    path: '/font.woff2',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_OBSERVED_FONT_HOST,
    automaticRuleCreationExpected: false,
    requiresTraffic: false,
  },
]);

export const WINDOWS_AUTO_ALLOW_ALL_PROBES = Object.freeze([
  ...WINDOWS_AUTO_ALLOW_OBSERVATION_PROBES,
  ...WINDOWS_AUTO_ALLOW_PROBES,
]);

export const WINDOWS_AUTO_ALLOW_DIAGNOSTIC_PHASE_IDS = Object.freeze([
  'firefox-extension-ready',
  'origin-page-load',
  'page-observer',
  'page-resource-candidates',
  'no-automatic-rule-creation',
  'explicit-whitelist-apply',
  'explicit-probe-traffic',
  'artifact-written',
]);

export const WINDOWS_AUTO_ALLOW_FAILURE_BOUNDARIES = Object.freeze({
  'firefox-extension-ready': {
    label: 'Firefox extension ready',
    message: 'Firefox did not report the OpenPath extension as ready before the canary page ran.',
    recommendedNextAction:
      'Inspect Firefox enterprise policy, profile extension registry, XPI delivery, and warmup logs.',
  },
  'origin-page-load': {
    label: 'Origin page load',
    message: 'The allowed origin page did not reach the local canary server.',
    recommendedNextAction:
      'Inspect Firefox launch/navigation, local DNS for the origin host, and local server reachability.',
  },
  'page-observer': {
    label: 'Page observer',
    message:
      'Neither Firefox page-resource observer installation nor observed probe traffic was confirmed for the origin page.',
    recommendedNextAction:
      'Inspect extension content-script injection, page observer registration, webRequest observation, and local canary server hit evidence.',
  },
  'page-resource-candidates': {
    label: 'Page resource candidates',
    message:
      'The page did not emit resource-candidate events and the local canary server did not see every observed probe.',
    recommendedNextAction:
      'Inspect extension page-resource detection, candidate matching, webRequest observation, and browser console evidence.',
  },
  'no-automatic-rule-creation': {
    label: 'No automatic rule creation',
    message:
      'Observed page-resource candidates appeared in whitelist state even though automatic rule creation is not expected.',
    recommendedNextAction:
      'Inspect Firefox/Core runtime and server-side request automation before treating this as a valid canary success.',
  },
  'explicit-whitelist-apply': {
    label: 'Explicit whitelist apply',
    message:
      'The explicit ClassroomPath/OpenPath whitelist state did not contain every expected probe host.',
    recommendedNextAction:
      'Inspect canary provisioning seed rules, remote whitelist publication, native-host update-whitelist, and local whitelist files.',
  },
  'explicit-probe-traffic': {
    label: 'Explicit probe traffic',
    message: 'Explicitly whitelisted browser probes still did not reach the canary server.',
    recommendedNextAction:
      'Inspect Windows DNS/firewall application, Acrylic state, Firefox DNS cache, and native protocol check output.',
  },
  'artifact-written': {
    label: 'Evidence artifact written',
    message: 'The Windows AJAX canary did not write a usable evidence artifact.',
    recommendedNextAction:
      'Inspect runner filesystem state and the canary process output before treating functional evidence as complete.',
  },
  'artifact-upload': {
    label: 'Evidence artifact upload',
    message: 'Functional canary evidence was produced but GitHub artifact upload failed.',
    recommendedNextAction:
      'Inspect runner DNS/connectivity to the GitHub artifact service and rerun the diagnostic lane if needed.',
  },
  none: {
    label: 'No failure boundary',
    message:
      'Windows dependency observation completed without automatic rule creation and explicit allowlist probes succeeded.',
    recommendedNextAction: 'No follow-up required for this canary run.',
  },
});

export function buildWindowsAutoAllowProbeUrl(probe, port) {
  return `http://${probe.host}:${port}${probe.path}`;
}

export function redactSensitiveWindowsCanaryValue(value) {
  return String(value)
    .replace(/\/w\/[^/?#]+\/whitelist\.txt/gi, '/w/[redacted]/whitelist.txt')
    .replace(/("?(?:machineToken|token)"?\s*[:=]\s*)"?[^",\s}]+"?/gi, '$1"[redacted]"');
}

export function redactWindowsCanaryObject(value) {
  if (typeof value === 'string') {
    return redactSensitiveWindowsCanaryValue(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactWindowsCanaryObject(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /token/i.test(key) && typeof item === 'string'
          ? '[redacted]'
          : redactWindowsCanaryObject(item),
      ])
    );
  }

  return value;
}

function findProbeEvidence(probeEvidence, id) {
  return probeEvidence.find((probe) => probe.id === id);
}

function hasObservedProbeTrafficEvidence(summary) {
  const probeEvidence = Array.isArray(summary?.probeEvidence) ? summary.probeEvidence : [];
  return WINDOWS_AUTO_ALLOW_OBSERVATION_PROBES.every(
    (probe) => Number(findProbeEvidence(probeEvidence, probe.id)?.hits ?? 0) > 0
  );
}

function phase(id, status, evidence = {}) {
  return buildAutoAllowDiagnosticPhase({
    id,
    status,
    evidence,
    boundaries: WINDOWS_AUTO_ALLOW_FAILURE_BOUNDARIES,
  });
}

export const WINDOWS_AUTO_ALLOW_DIAGNOSTIC_PHASES = Object.freeze([
  {
    id: 'firefox-extension-ready',
    passed: (summary) => summary?.firefoxExtensionWarmup?.ready === true,
    evidence: (summary) => summary?.firefoxExtensionWarmup ?? null,
  },
  {
    id: 'origin-page-load',
    passed: (summary) => Number(summary?.originHits ?? 0) > 0,
    evidence: (summary) => ({ originHits: Number(summary?.originHits ?? 0) }),
  },
  {
    id: 'page-observer',
    passed: (summary) =>
      summary?.pageObserverInstalled === true || hasObservedProbeTrafficEvidence(summary),
    evidence: (summary) => ({
      pageObserverInstalled: summary?.pageObserverInstalled ?? null,
      observedProbeTraffic: hasObservedProbeTrafficEvidence(summary),
    }),
  },
  {
    id: 'page-resource-candidates',
    passed: (summary) =>
      hasCandidateEvidence(summary, WINDOWS_AUTO_ALLOW_ALL_PROBES) ||
      hasObservedProbeTrafficEvidence(summary),
    evidence: (summary) => ({
      completedCandidateEvents: summary?.completedCandidateEvents ?? null,
      candidateEventsCount: Array.isArray(summary?.pageResourceCandidateEvents)
        ? summary.pageResourceCandidateEvents.length
        : 0,
      observedProbeTraffic: hasObservedProbeTrafficEvidence(summary),
    }),
  },
  {
    id: 'no-automatic-rule-creation',
    passed: (summary) =>
      hasNoAutomaticRuleCreationEvidence(summary, WINDOWS_AUTO_ALLOW_OBSERVATION_PROBES),
    evidence: () => ({
      automaticRuleCreationExpected: false,
      observedHosts: WINDOWS_AUTO_ALLOW_OBSERVATION_PROBES.map(
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
    evidence: (summary) => ({
      probeEvidence: (summary?.probeEvidence ?? []).map((item) => ({
        id: item.id,
        hits: item.hits ?? 0,
      })),
    }),
  },
  {
    id: 'artifact-written',
    passed: (summary) => summary?.artifactWritten !== false && summary?.artifact?.written !== false,
    evidence: (summary) => ({
      artifactWritten: summary?.artifactWritten ?? summary?.artifact?.written ?? true,
    }),
  },
]);

export function buildWindowsAutoAllowDiagnosticPhases(summary, probes = WINDOWS_AUTO_ALLOW_PROBES) {
  return buildAutoAllowEvidenceModel({
    phases: WINDOWS_AUTO_ALLOW_DIAGNOSTIC_PHASES,
    summary,
    probes,
    boundaries: WINDOWS_AUTO_ALLOW_FAILURE_BOUNDARIES,
  }).diagnosticPhases;
}

export function classifyWindowsAutoAllowFailureBoundary(
  summary,
  probes = WINDOWS_AUTO_ALLOW_PROBES
) {
  const diagnosticPhases =
    summary?.diagnosticPhases ?? buildWindowsAutoAllowDiagnosticPhases(summary, probes);
  return classifyAutoAllowFailureBoundary({
    diagnosticPhases,
    boundaries: WINDOWS_AUTO_ALLOW_FAILURE_BOUNDARIES,
  });
}

export function withWindowsAutoAllowDiagnostics(summary, probes = WINDOWS_AUTO_ALLOW_PROBES) {
  return buildAutoAllowEvidenceModel({
    phases: WINDOWS_AUTO_ALLOW_DIAGNOSTIC_PHASES,
    summary,
    probes,
    boundaries: WINDOWS_AUTO_ALLOW_FAILURE_BOUNDARIES,
  });
}

export function buildWindowsAutoAllowArtifactFailureSummary({ id, message, artifactPath, error }) {
  const summary = buildAutoAllowArtifactFailureSummary({
    id,
    message,
    artifactPath,
    error,
    phaseIds: WINDOWS_AUTO_ALLOW_DIAGNOSTIC_PHASE_IDS,
    boundaries: WINDOWS_AUTO_ALLOW_FAILURE_BOUNDARIES,
  });

  return {
    ...summary,
    diagnosticPhases: WINDOWS_AUTO_ALLOW_DIAGNOSTIC_PHASE_IDS.map((phaseId) =>
      phase(phaseId, phaseId === 'artifact-written' ? 'failed' : 'pending', { artifactPath })
    ),
  };
}

export function buildWindowsAutoAllowCanarySummary({
  result,
  probeEvidence,
  originHits,
  attempts,
  completedProbes,
  completedCandidateEvents,
  completedRedditDiagnosticEvents,
  pageResourceCandidateEvents,
  redditDiagnostics,
  lastAttemptAt,
  whitelistPath,
  firefoxExtensionWarmup,
  firefoxOutput,
  diagnostics,
}) {
  const ajaxEvidence = findProbeEvidence(probeEvidence, 'ajax-fetch');
  const xhrEvidence = findProbeEvidence(probeEvidence, 'xhr-subresource');
  const imageEvidence = findProbeEvidence(probeEvidence, 'image-subresource');
  const scriptEvidence = findProbeEvidence(probeEvidence, 'script-subresource');
  const stylesheetEvidence = findProbeEvidence(probeEvidence, 'stylesheet-subresource');
  const fontEvidence = findProbeEvidence(probeEvidence, 'font-subresource');
  const stylesheetFontEvidence = findProbeEvidence(probeEvidence, 'stylesheet-font-subresource');
  const mergedRedditDiagnostics = redditDiagnostics
    ? {
        ...redditDiagnostics,
        page: result?.redditDiagnostics ?? redditDiagnostics.page ?? null,
      }
    : (result?.redditDiagnostics ?? null);

  const summary = {
    ...result,
    originHost: WINDOWS_AUTO_ALLOW_ORIGIN_HOST,
    contract: 'page-resource-observation-no-auto-allow',
    automaticRuleCreationExpected: false,
    targetHost: WINDOWS_AUTO_ALLOW_TARGET_HOST,
    xhrHost: WINDOWS_AUTO_ALLOW_XHR_HOST,
    assetHost: WINDOWS_AUTO_ALLOW_ASSET_HOST,
    scriptHost: WINDOWS_AUTO_ALLOW_SCRIPT_HOST,
    stylesheetHost: WINDOWS_AUTO_ALLOW_STYLESHEET_HOST,
    fontHost: WINDOWS_AUTO_ALLOW_FONT_HOST,
    stylesheetFontHost: WINDOWS_AUTO_ALLOW_STYLESHEET_FONT_HOST,
    targetUrl: ajaxEvidence?.url ?? result?.targetUrl,
    xhrUrl: xhrEvidence?.url ?? result?.xhrUrl,
    assetUrl: imageEvidence?.url ?? result?.assetUrl,
    fontUrl: fontEvidence?.url ?? result?.fontUrl,
    originHits,
    targetHits: ajaxEvidence?.hits ?? 0,
    xhrHits: xhrEvidence?.hits ?? 0,
    assetHits: imageEvidence?.hits ?? 0,
    scriptHits: scriptEvidence?.hits ?? 0,
    stylesheetHits: stylesheetEvidence?.hits ?? 0,
    fontHits: fontEvidence?.hits ?? 0,
    stylesheetFontHits: stylesheetFontEvidence?.hits ?? 0,
    attempts: result?.attempts ?? attempts,
    completedProbes: result?.completedProbes ?? completedProbes,
    completedCandidateEvents: result?.completedCandidateEvents ?? completedCandidateEvents,
    completedRedditDiagnosticEvents:
      result?.completedRedditDiagnosticEvents ?? completedRedditDiagnosticEvents,
    pageResourceCandidateEvents:
      result?.pageResourceCandidateEvents ?? pageResourceCandidateEvents ?? [],
    redditDiagnostics: mergedRedditDiagnostics,
    lastAttemptAt: result?.lastAttemptAt ?? lastAttemptAt,
    probeEvidence,
    whitelistPath,
    whitelistContainsTarget: ajaxEvidence?.whitelistContainsExpectedHost ?? false,
    whitelistContainsAsset: imageEvidence?.whitelistContainsExpectedHost ?? false,
    firefoxExtensionWarmup,
    firefoxOutput,
    diagnostics,
  };
  summary.probeEvidence = enrichProbeEvidenceWithRemoteDiagnostics(
    probeEvidence,
    summary,
    WINDOWS_AUTO_ALLOW_PROBES
  );

  return withWindowsAutoAllowDiagnostics(summary);
}

export function assertWindowsAutoAllowCanarySuccess(summary, probes = WINDOWS_AUTO_ALLOW_PROBES) {
  if (!summary.success) {
    throw new Error(`Windows AJAX auto-allow canary failed: ${JSON.stringify(summary)}`);
  }

  for (const probe of probes) {
    const evidence = summary.probeEvidence?.find((item) => item.id === probe.id);
    if (!evidence?.whitelistContainsExpectedHost) {
      throw new Error(probe.failureMessage);
    }
  }

  for (const probe of probes) {
    const evidence = summary.probeEvidence?.find((item) => item.id === probe.id);
    if (Number(evidence?.hits ?? 0) <= 0) {
      throw new Error(`Explicit ${probe.kind} probe did not reach canary server: ${probe.id}`);
    }
  }

  const failureBoundaryId = summary.failureBoundary?.id;
  if (failureBoundaryId && failureBoundaryId !== 'none') {
    const message = summary.failureBoundary?.message ?? 'diagnostic flow did not complete';
    throw new Error(`Windows AJAX auto-allow canary stopped at ${failureBoundaryId}: ${message}`);
  }
}
