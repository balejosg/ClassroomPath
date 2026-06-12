/**
 * Builds and validates the auto-allow boundary evidence record that separates pre- and post-allow probe observations.
 *
 * Invoked by: Imported by canary runtime libraries and tested by `auto-allow-boundary-evidence.test.ts`.
 * Usage: (library module, not invoked directly)
 */
export function allExpectedHostsPresent(value, expectedHosts) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return expectedHosts.every((host) => value[host] === true);
}

export function allExpectedHostStatePresent(value, expectedHosts) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return expectedHosts.every((host) => {
    const state = value[host];
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

export function allExpectedRuleValuesPresent(rules, expectedHosts) {
  if (!Array.isArray(rules)) {
    return false;
  }

  const values = new Set(
    rules
      .map((rule) => (typeof rule?.value === 'string' ? rule.value.toLowerCase() : ''))
      .filter(Boolean)
  );

  return expectedHosts.every((host) => values.has(String(host).toLowerCase()));
}

export function allExpectedHostsAbsent(value, expectedHosts) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return expectedHosts.every((host) => {
    const state = value[host];
    if (typeof state === 'boolean') {
      return state === false;
    }
    if (!state || typeof state !== 'object') {
      return false;
    }
    if (
      state.whitelistRulePresent === true ||
      state.rulePresent === true ||
      state.present === true ||
      state.inWhitelist === true
    ) {
      return false;
    }
    return (
      state.whitelistRulePresent === false ||
      state.rulePresent === false ||
      state.present === false ||
      state.inWhitelist === false
    );
  });
}

export function collectDiagnosticSnapshots(summary) {
  const diagnostics = summary?.diagnostics ?? {};
  return [
    diagnostics.postAttempt,
    diagnostics.postSuccess,
    diagnostics.postFailure,
    diagnostics.postFailureObservation?.diagnostics,
    diagnostics.postSuccessObservation?.diagnostics,
    diagnostics.postSuccessObservation?.remoteRules?.diagnostics,
    diagnostics.postSuccessObservation?.localWhitelist,
    diagnostics.preflight,
  ].filter(Boolean);
}

function collectContainsExpectedHostMaps(summary) {
  const maps = [];
  for (const diagnostics of collectDiagnosticSnapshots(summary)) {
    const candidates = [
      diagnostics.remoteWhitelist?.containsExpectedHosts,
      diagnostics.whitelist?.remoteWhitelist?.containsExpectedHosts,
      diagnostics.whitelist?.global?.containsExpectedHosts,
      diagnostics.whitelist?.native?.containsExpectedHosts,
      diagnostics.whitelist?.local?.containsExpectedHosts,
      diagnostics.global?.containsExpectedHosts,
      diagnostics.native?.containsExpectedHosts,
      diagnostics.local?.containsExpectedHosts,
      diagnostics.server?.canaryGroup?.body?.expectedHostState,
      diagnostics.body?.expectedHostState,
    ];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object') {
        maps.push(candidate);
      }
    }
  }
  return maps;
}

export function hasRemoteRuleEvidence(summary, expectedHosts) {
  const hosts = expectedHosts.filter(Boolean);
  for (const diagnostics of collectDiagnosticSnapshots(summary)) {
    if (allExpectedHostsPresent(diagnostics.remoteWhitelist?.containsExpectedHosts, hosts)) {
      return true;
    }
    if (
      allExpectedHostsPresent(diagnostics.whitelist?.remoteWhitelist?.containsExpectedHosts, hosts)
    ) {
      return true;
    }
    if (
      allExpectedHostStatePresent(diagnostics.server?.canaryGroup?.body?.expectedHostState, hosts)
    ) {
      return true;
    }
    if (allExpectedHostStatePresent(diagnostics.body?.expectedHostState, hosts)) {
      return true;
    }
    if (allExpectedRuleValuesPresent(diagnostics.server?.canaryGroup?.body?.rules, hosts)) {
      return true;
    }
    if (allExpectedRuleValuesPresent(diagnostics.body?.rules, hosts)) {
      return true;
    }
  }

  return false;
}

export function hasNoAutomaticRuleCreationEvidence(summary, probes) {
  const observedHosts = probes
    .filter((probe) => probe.automaticRuleCreationExpected === false)
    .map((probe) => probe.expectedWhitelistHost ?? probe.host)
    .filter(Boolean);

  if (observedHosts.length === 0) {
    return true;
  }

  if (summary?.noAutomaticRuleCreation === true) {
    return true;
  }

  const maps = collectContainsExpectedHostMaps(summary).filter((map) =>
    observedHosts.every((host) => Object.hasOwn(map, host))
  );
  return maps.length > 0 && maps.every((map) => allExpectedHostsAbsent(map, observedHosts));
}

export function hasLocalWhitelistEvidence(summary, probes, paths = ['global', 'native', 'local']) {
  const probeEvidence = Array.isArray(summary?.probeEvidence) ? summary.probeEvidence : [];
  const explicitProbes = probes.filter((probe) => probe.automaticRuleCreationExpected !== false);
  if (
    explicitProbes.every(
      (probe) =>
        probeEvidence.find((item) => item.id === probe.id)?.whitelistContainsExpectedHost === true
    )
  ) {
    return true;
  }

  const expectedHosts = explicitProbes.map((probe) => probe.expectedWhitelistHost).filter(Boolean);
  for (const diagnostics of collectDiagnosticSnapshots(summary)) {
    for (const path of paths) {
      if (
        allExpectedHostsPresent(diagnostics.whitelist?.[path]?.containsExpectedHosts, expectedHosts)
      ) {
        return true;
      }
      if (allExpectedHostsPresent(diagnostics[path]?.containsExpectedHosts, expectedHosts)) {
        return true;
      }
    }
  }

  return false;
}

export function hasDnsEvidence(summary, expectedHosts) {
  const hosts = expectedHosts.filter(Boolean);
  for (const diagnostics of collectDiagnosticSnapshots(summary)) {
    if (allExpectedHostsPresent(diagnostics.dns?.containsExpectedHosts, hosts)) {
      return true;
    }
  }

  return false;
}

export function hasProbeTrafficEvidence(summary, probes) {
  const probeEvidence = Array.isArray(summary?.probeEvidence) ? summary.probeEvidence : [];
  const explicitProbes = probes.filter((probe) => probe.requiresTraffic !== false);
  return explicitProbes.every(
    (probe) => Number(probeEvidence.find((item) => item.id === probe.id)?.hits ?? 0) > 0
  );
}

export function hasCandidateEvidence(summary, probes) {
  const completedCandidateEvents = summary?.completedCandidateEvents ?? {};
  const probesExpectingPageCandidates = probes.filter(
    (probe) => probe.expectsPageResourceCandidate !== false
  );

  if (probesExpectingPageCandidates.every((probe) => completedCandidateEvents[probe.id] === true)) {
    return true;
  }

  const matchedProbeIds = new Set(
    (Array.isArray(summary?.pageResourceCandidateEvents) ? summary.pageResourceCandidateEvents : [])
      .map((event) => event?.matchedProbeId)
      .filter(Boolean)
  );

  return probesExpectingPageCandidates.every((probe) => matchedProbeIds.has(probe.id));
}

function extractDiagnosticContextFromComment(comment) {
  if (typeof comment !== 'string') {
    return '';
  }
  const match = /\bdiagnostic \(([^)]{1,500})\)/.exec(comment);
  return match?.[1]?.trim() ?? '';
}

function collectRemoteRules(summary) {
  const rules = [];
  for (const diagnostics of collectDiagnosticSnapshots(summary)) {
    if (Array.isArray(diagnostics.rules)) {
      rules.push(...diagnostics.rules);
    }
    if (Array.isArray(diagnostics.body?.rules)) {
      rules.push(...diagnostics.body.rules);
    }
    if (Array.isArray(diagnostics.server?.canaryGroup?.body?.rules)) {
      rules.push(...diagnostics.server.canaryGroup.body.rules);
    }
  }
  return rules;
}

export function enrichProbeEvidenceWithRemoteDiagnostics(probeEvidence, summary, probes) {
  const contextByHost = new Map();
  for (const rule of collectRemoteRules(summary)) {
    const value = typeof rule?.value === 'string' ? rule.value.toLowerCase() : '';
    const diagnosticContext = extractDiagnosticContextFromComment(rule?.comment);
    if (value && diagnosticContext) {
      contextByHost.set(value, diagnosticContext);
    }
  }

  return probeEvidence.map((evidence) => {
    const probe = probes.find((candidate) => candidate.id === evidence.id);
    const expectedHost = probe?.expectedWhitelistHost ?? evidence.expectedWhitelistHost;
    const diagnosticContext =
      typeof expectedHost === 'string' ? contextByHost.get(expectedHost.toLowerCase()) : '';
    return diagnosticContext ? { ...evidence, diagnosticContext } : evidence;
  });
}

export function buildAutoAllowDiagnosticPhase({ id, status, evidence = {}, boundaries }) {
  const details = boundaries[id] ?? {};
  return {
    id,
    status,
    message: details.message ?? `${id} failed`,
    evidence,
  };
}

export function buildAutoAllowDiagnosticPhases({ checks, boundaries }) {
  let failed = false;
  return checks.map((check) => {
    if (failed) {
      return buildAutoAllowDiagnosticPhase({
        id: check.id,
        status: 'pending',
        evidence: check.evidence,
        boundaries,
      });
    }
    if (check.passed) {
      return buildAutoAllowDiagnosticPhase({
        id: check.id,
        status: 'passed',
        evidence: check.evidence,
        boundaries,
      });
    }
    failed = true;
    return buildAutoAllowDiagnosticPhase({
      id: check.id,
      status: 'failed',
      evidence: check.evidence,
      boundaries,
    });
  });
}

export function buildAutoAllowEvidenceModel({
  phases,
  summary,
  probes,
  boundaries,
  enrichProbeEvidence,
}) {
  const modelSummary =
    typeof enrichProbeEvidence === 'function' && Array.isArray(summary?.probeEvidence)
      ? {
          ...summary,
          probeEvidence: enrichProbeEvidence(summary.probeEvidence, summary, probes),
        }
      : summary;

  const checks = phases.map((spec) => ({
    id: spec.id,
    evidence:
      typeof spec.evidence === 'function'
        ? spec.evidence(modelSummary, probes)
        : (spec.evidence ?? {}),
    passed: spec.passed(modelSummary, probes),
  }));
  const diagnosticPhases = buildAutoAllowDiagnosticPhases({ checks, boundaries });
  const failureBoundary = classifyAutoAllowFailureBoundary({ diagnosticPhases, boundaries });

  return {
    ...modelSummary,
    diagnosticPhases,
    failureBoundary,
  };
}

export function classifyAutoAllowFailureBoundary({ diagnosticPhases, boundaries }) {
  const failedPhase = diagnosticPhases.find((candidate) => candidate.status === 'failed');
  const id = failedPhase?.id ?? 'none';
  const details = boundaries[id] ?? boundaries['artifact-written'];
  return {
    id,
    ...(details.label ? { label: details.label } : {}),
    message: details.message,
    recommendedNextAction: details.recommendedNextAction,
  };
}

export function buildAutoAllowArtifactFailureSummary({
  id,
  message,
  artifactPath,
  error,
  phaseIds,
  boundaries,
}) {
  const details = boundaries[id] ?? boundaries['artifact-written'];
  const failureBoundary = {
    id,
    ...(details.label ? { label: details.label } : {}),
    message: message || details.message,
    recommendedNextAction: details.recommendedNextAction,
  };

  return {
    success: false,
    error: failureBoundary.message,
    artifactPath,
    artifactError: error,
    diagnosticPhases: phaseIds.map((phaseId) =>
      buildAutoAllowDiagnosticPhase({
        id: phaseId,
        status: phaseId === id ? 'failed' : 'pending',
        evidence: { artifactPath },
        boundaries,
      })
    ),
    failureBoundary,
  };
}
