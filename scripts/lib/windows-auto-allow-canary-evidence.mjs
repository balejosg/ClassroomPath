import {
  buildAutoAllowArtifactFailureSummary,
  buildAutoAllowDiagnosticPhase,
  buildAutoAllowEvidenceModel,
  classifyAutoAllowFailureBoundary,
  enrichProbeEvidenceWithRemoteDiagnostics,
  hasCandidateEvidence,
  hasLocalWhitelistEvidence,
  hasProbeTrafficEvidence,
  hasRemoteRuleEvidence,
} from './auto-allow-boundary-evidence.mjs';

export const WINDOWS_AUTO_ALLOW_ORIGIN_HOST = 'ajax-auto-allow-origin.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_TARGET_HOST = 'ajax-auto-allow-target.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_ASSET_HOST = 'ajax-auto-allow-asset.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_SCRIPT_HOST = 'ajax-auto-allow-script.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_STYLESHEET_HOST = 'ajax-auto-allow-stylesheet.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_FONT_HOST = 'ajax-auto-allow-font.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_STYLESHEET_FONT_HOST =
  'ajax-auto-allow-stylesheet-font.127.0.0.1.sslip.io';

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
    failureMessage: 'Auto-allow AJAX target was not written to whitelist',
  },
  {
    id: 'image-subresource',
    kind: 'image',
    host: WINDOWS_AUTO_ALLOW_ASSET_HOST,
    path: '/pixel.png',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_ASSET_HOST,
    failureMessage: 'Auto-allow image target was not written to whitelist',
  },
  {
    id: 'script-subresource',
    kind: 'script',
    host: WINDOWS_AUTO_ALLOW_SCRIPT_HOST,
    path: '/asset.js',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_SCRIPT_HOST,
    failureMessage: 'Auto-allow script target was not written to whitelist',
  },
  {
    id: 'stylesheet-subresource',
    kind: 'stylesheet',
    host: WINDOWS_AUTO_ALLOW_STYLESHEET_HOST,
    path: '/style.css',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_STYLESHEET_HOST,
    failureMessage: 'Auto-allow stylesheet target was not written to whitelist',
  },
  {
    id: 'font-subresource',
    kind: 'font',
    host: WINDOWS_AUTO_ALLOW_FONT_HOST,
    path: '/font.woff2',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_FONT_HOST,
    failureMessage: 'Auto-allow font target was not written to whitelist',
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
    failureMessage: 'Auto-allow stylesheet-discovered font target was not written to whitelist',
  },
]);

export const WINDOWS_AUTO_ALLOW_DIAGNOSTIC_PHASE_IDS = Object.freeze([
  'firefox-extension-ready',
  'origin-page-load',
  'page-observer',
  'page-resource-candidates',
  'remote-rule-creation',
  'local-whitelist-apply',
  'probe-traffic',
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
    message: 'The Firefox page-resource observer was not installed in the origin page.',
    recommendedNextAction:
      'Inspect extension content-script injection and the page observer registration path.',
  },
  'page-resource-candidates': {
    label: 'Page resource candidates',
    message: 'The page did not emit resource-candidate events for every AJAX/subresource probe.',
    recommendedNextAction:
      'Inspect extension page-resource detection, candidate matching, and browser console evidence.',
  },
  'remote-rule-creation': {
    label: 'Remote rule creation',
    message:
      'The remote ClassroomPath/OpenPath whitelist state did not contain every expected probe host.',
    recommendedNextAction:
      'Inspect server-side auto-allow diagnostics, group rules, and remote whitelist publication.',
  },
  'local-whitelist-apply': {
    label: 'Local whitelist apply',
    message:
      'Remote rules were present but the local Windows whitelist did not contain every expected probe host.',
    recommendedNextAction:
      'Inspect native-host update-whitelist, Update-OpenPath.ps1, local whitelist files, and task logs.',
  },
  'probe-traffic': {
    label: 'Probe traffic',
    message:
      'The local whitelist contained expected hosts but browser probes still did not reach the canary server.',
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
    message: 'Windows AJAX auto-allow canary completed successfully.',
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
    passed: (summary) => summary?.pageObserverInstalled === true,
    evidence: (summary) => ({ pageObserverInstalled: summary?.pageObserverInstalled ?? null }),
  },
  {
    id: 'page-resource-candidates',
    passed: (summary, probes) => hasCandidateEvidence(summary, probes),
    evidence: (summary) => ({
      completedCandidateEvents: summary?.completedCandidateEvents ?? null,
      candidateEventsCount: Array.isArray(summary?.pageResourceCandidateEvents)
        ? summary.pageResourceCandidateEvents.length
        : 0,
    }),
  },
  {
    id: 'remote-rule-creation',
    passed: (summary, probes) =>
      hasRemoteRuleEvidence(
        summary,
        probes.map((probe) => probe.expectedWhitelistHost)
      ),
    evidence: (_summary, probes) => ({
      expectedHosts: probes.map((probe) => probe.expectedWhitelistHost),
    }),
  },
  {
    id: 'local-whitelist-apply',
    passed: (summary, probes) => hasLocalWhitelistEvidence(summary, probes),
    evidence: (summary, probes) => ({
      expectedHosts: probes.map((probe) => probe.expectedWhitelistHost),
      probeEvidence: summary?.probeEvidence ?? [],
    }),
  },
  {
    id: 'probe-traffic',
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
    targetHost: WINDOWS_AUTO_ALLOW_TARGET_HOST,
    assetHost: WINDOWS_AUTO_ALLOW_ASSET_HOST,
    scriptHost: WINDOWS_AUTO_ALLOW_SCRIPT_HOST,
    stylesheetHost: WINDOWS_AUTO_ALLOW_STYLESHEET_HOST,
    fontHost: WINDOWS_AUTO_ALLOW_FONT_HOST,
    stylesheetFontHost: WINDOWS_AUTO_ALLOW_STYLESHEET_FONT_HOST,
    targetUrl: ajaxEvidence?.url ?? result?.targetUrl,
    assetUrl: imageEvidence?.url ?? result?.assetUrl,
    fontUrl: fontEvidence?.url ?? result?.fontUrl,
    originHits,
    targetHits: ajaxEvidence?.hits ?? 0,
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
      throw new Error(`Auto-allow ${probe.kind} probe did not reach canary server: ${probe.id}`);
    }
  }
}
