export const WINDOWS_AUTO_ALLOW_ORIGIN_HOST = 'ajax-auto-allow-origin.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_TARGET_HOST = 'ajax-auto-allow-target.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_ASSET_HOST = 'ajax-auto-allow-asset.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_SCRIPT_HOST = 'ajax-auto-allow-script.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_STYLESHEET_HOST = 'ajax-auto-allow-stylesheet.127.0.0.1.sslip.io';

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

function allExpectedHostsPresent(containsExpectedHosts, expectedHosts) {
  if (!containsExpectedHosts || typeof containsExpectedHosts !== 'object') {
    return false;
  }

  return expectedHosts.every((host) => containsExpectedHosts[host] === true);
}

function allExpectedHostStatePresent(expectedHostState, expectedHosts) {
  if (!expectedHostState || typeof expectedHostState !== 'object') {
    return false;
  }

  return expectedHosts.every((host) => {
    const state = expectedHostState[host];
    if (typeof state === 'boolean') {
      return state;
    }
    return (
      state?.whitelistRulePresent === true ||
      state?.rulePresent === true ||
      state?.present === true ||
      state?.inWhitelist === true
    );
  });
}

function collectDiagnosticSnapshots(summary) {
  const diagnostics = summary?.diagnostics ?? {};
  return [
    diagnostics.postAttempt,
    diagnostics.postSuccess,
    diagnostics.postFailure,
    diagnostics.postFailureObservation?.diagnostics,
    diagnostics.preflight,
  ].filter(Boolean);
}

function hasRemoteRuleEvidence(summary, expectedHosts) {
  for (const diagnostics of collectDiagnosticSnapshots(summary)) {
    if (
      allExpectedHostsPresent(diagnostics.remoteWhitelist?.containsExpectedHosts, expectedHosts)
    ) {
      return true;
    }
    if (
      allExpectedHostsPresent(
        diagnostics.whitelist?.remoteWhitelist?.containsExpectedHosts,
        expectedHosts
      )
    ) {
      return true;
    }
    if (
      allExpectedHostStatePresent(
        diagnostics.server?.canaryGroup?.body?.expectedHostState,
        expectedHosts
      )
    ) {
      return true;
    }
  }

  return false;
}

function hasLocalWhitelistEvidence(summary, probes) {
  const probeEvidence = Array.isArray(summary.probeEvidence) ? summary.probeEvidence : [];
  if (
    probes.every((probe) => {
      const evidence = probeEvidence.find((item) => item.id === probe.id);
      return evidence?.whitelistContainsExpectedHost === true;
    })
  ) {
    return true;
  }

  const expectedHosts = probes.map((probe) => probe.expectedWhitelistHost);
  for (const diagnostics of collectDiagnosticSnapshots(summary)) {
    if (
      allExpectedHostsPresent(
        diagnostics.whitelist?.global?.containsExpectedHosts,
        expectedHosts
      ) ||
      allExpectedHostsPresent(diagnostics.whitelist?.native?.containsExpectedHosts, expectedHosts)
    ) {
      return true;
    }
  }

  return false;
}

function hasProbeTrafficEvidence(summary, probes) {
  const probeEvidence = Array.isArray(summary.probeEvidence) ? summary.probeEvidence : [];

  return probes.every((probe) => {
    const evidence = probeEvidence.find((item) => item.id === probe.id);
    return Number(evidence?.hits ?? 0) > 0;
  });
}

function hasCandidateEvidence(summary, probes) {
  const completedCandidateEvents = summary?.completedCandidateEvents ?? {};
  if (probes.every((probe) => completedCandidateEvents[probe.id] === true)) {
    return true;
  }

  const matchedProbeIds = new Set(
    (Array.isArray(summary?.pageResourceCandidateEvents) ? summary.pageResourceCandidateEvents : [])
      .map((event) => event?.matchedProbeId)
      .filter(Boolean)
  );

  return probes.every((probe) => matchedProbeIds.has(probe.id));
}

function phase(id, status, evidence = {}) {
  const details = WINDOWS_AUTO_ALLOW_FAILURE_BOUNDARIES[id];
  return {
    id,
    status,
    message: details.message,
    evidence,
  };
}

export function buildWindowsAutoAllowDiagnosticPhases(summary, probes = WINDOWS_AUTO_ALLOW_PROBES) {
  const expectedHosts = probes.map((probe) => probe.expectedWhitelistHost);
  const checks = [
    {
      id: 'firefox-extension-ready',
      passed: summary?.firefoxExtensionWarmup?.ready === true,
      evidence: summary?.firefoxExtensionWarmup ?? null,
    },
    {
      id: 'origin-page-load',
      passed: Number(summary?.originHits ?? 0) > 0,
      evidence: { originHits: Number(summary?.originHits ?? 0) },
    },
    {
      id: 'page-observer',
      passed: summary?.pageObserverInstalled === true,
      evidence: { pageObserverInstalled: summary?.pageObserverInstalled ?? null },
    },
    {
      id: 'page-resource-candidates',
      passed: hasCandidateEvidence(summary, probes),
      evidence: {
        completedCandidateEvents: summary?.completedCandidateEvents ?? null,
        candidateEventsCount: Array.isArray(summary?.pageResourceCandidateEvents)
          ? summary.pageResourceCandidateEvents.length
          : 0,
      },
    },
    {
      id: 'remote-rule-creation',
      passed: hasRemoteRuleEvidence(summary, expectedHosts),
      evidence: { expectedHosts },
    },
    {
      id: 'local-whitelist-apply',
      passed: hasLocalWhitelistEvidence(summary, probes),
      evidence: {
        expectedHosts,
        probeEvidence: summary?.probeEvidence ?? [],
      },
    },
    {
      id: 'probe-traffic',
      passed: hasProbeTrafficEvidence(summary, probes),
      evidence: {
        probeEvidence: (summary?.probeEvidence ?? []).map((item) => ({
          id: item.id,
          hits: item.hits ?? 0,
        })),
      },
    },
    {
      id: 'artifact-written',
      passed: summary?.artifactWritten !== false && summary?.artifact?.written !== false,
      evidence: {
        artifactWritten: summary?.artifactWritten ?? summary?.artifact?.written ?? true,
      },
    },
  ];

  let failed = false;
  return checks.map((check) => {
    if (failed) {
      return phase(check.id, 'pending', check.evidence);
    }
    if (check.passed) {
      return phase(check.id, 'passed', check.evidence);
    }
    failed = true;
    return phase(check.id, 'failed', check.evidence);
  });
}

export function classifyWindowsAutoAllowFailureBoundary(
  summary,
  probes = WINDOWS_AUTO_ALLOW_PROBES
) {
  const diagnosticPhases =
    summary?.diagnosticPhases ?? buildWindowsAutoAllowDiagnosticPhases(summary, probes);
  const failedPhase = diagnosticPhases.find((candidate) => candidate.status === 'failed');
  const boundaryId = failedPhase?.id ?? 'none';
  const details = WINDOWS_AUTO_ALLOW_FAILURE_BOUNDARIES[boundaryId];

  return {
    id: boundaryId,
    label: details.label,
    message: details.message,
    recommendedNextAction: details.recommendedNextAction,
  };
}

export function withWindowsAutoAllowDiagnostics(summary, probes = WINDOWS_AUTO_ALLOW_PROBES) {
  const diagnosticPhases = buildWindowsAutoAllowDiagnosticPhases(summary, probes);
  const failureBoundary = classifyWindowsAutoAllowFailureBoundary(
    { ...summary, diagnosticPhases },
    probes
  );

  return {
    ...summary,
    diagnosticPhases,
    failureBoundary,
  };
}

export function buildWindowsAutoAllowArtifactFailureSummary({ id, message, artifactPath, error }) {
  const details =
    WINDOWS_AUTO_ALLOW_FAILURE_BOUNDARIES[id] ??
    WINDOWS_AUTO_ALLOW_FAILURE_BOUNDARIES['artifact-written'];
  const failureBoundary = {
    id,
    label: details.label,
    message: message || details.message,
    recommendedNextAction: details.recommendedNextAction,
  };

  return {
    success: false,
    error: failureBoundary.message,
    artifactPath,
    artifactError: error,
    diagnosticPhases: WINDOWS_AUTO_ALLOW_DIAGNOSTIC_PHASE_IDS.map((phaseId) =>
      phase(phaseId, phaseId === 'artifact-written' ? 'failed' : 'pending', {
        artifactPath,
      })
    ),
    failureBoundary,
  };
}

export function buildWindowsAutoAllowCanarySummary({
  result,
  probeEvidence,
  originHits,
  attempts,
  completedProbes,
  completedCandidateEvents,
  pageResourceCandidateEvents,
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

  const summary = {
    ...result,
    originHost: WINDOWS_AUTO_ALLOW_ORIGIN_HOST,
    targetHost: WINDOWS_AUTO_ALLOW_TARGET_HOST,
    assetHost: WINDOWS_AUTO_ALLOW_ASSET_HOST,
    scriptHost: WINDOWS_AUTO_ALLOW_SCRIPT_HOST,
    stylesheetHost: WINDOWS_AUTO_ALLOW_STYLESHEET_HOST,
    targetUrl: ajaxEvidence?.url ?? result?.targetUrl,
    assetUrl: imageEvidence?.url ?? result?.assetUrl,
    originHits,
    targetHits: ajaxEvidence?.hits ?? 0,
    assetHits: imageEvidence?.hits ?? 0,
    scriptHits: scriptEvidence?.hits ?? 0,
    stylesheetHits: stylesheetEvidence?.hits ?? 0,
    attempts: result?.attempts ?? attempts,
    completedProbes: result?.completedProbes ?? completedProbes,
    completedCandidateEvents: result?.completedCandidateEvents ?? completedCandidateEvents,
    pageResourceCandidateEvents:
      result?.pageResourceCandidateEvents ?? pageResourceCandidateEvents ?? [],
    lastAttemptAt: result?.lastAttemptAt ?? lastAttemptAt,
    probeEvidence,
    whitelistPath,
    whitelistContainsTarget: ajaxEvidence?.whitelistContainsExpectedHost ?? false,
    whitelistContainsAsset: imageEvidence?.whitelistContainsExpectedHost ?? false,
    firefoxExtensionWarmup,
    firefoxOutput,
    diagnostics,
  };

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
}
