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

export function hasRemoteRuleEvidence(summary, expectedHosts) {
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
    if (allExpectedHostStatePresent(diagnostics.body?.expectedHostState, expectedHosts)) {
      return true;
    }
  }

  return false;
}

export function hasLocalWhitelistEvidence(summary, probes, paths = ['global', 'native', 'local']) {
  const probeEvidence = Array.isArray(summary?.probeEvidence) ? summary.probeEvidence : [];
  if (
    probes.every(
      (probe) =>
        probeEvidence.find((item) => item.id === probe.id)?.whitelistContainsExpectedHost === true
    )
  ) {
    return true;
  }

  const expectedHosts = probes.map((probe) => probe.expectedWhitelistHost);
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
  for (const diagnostics of collectDiagnosticSnapshots(summary)) {
    if (allExpectedHostsPresent(diagnostics.dns?.containsExpectedHosts, expectedHosts)) {
      return true;
    }
  }

  return false;
}

export function hasProbeTrafficEvidence(summary, probes) {
  const probeEvidence = Array.isArray(summary?.probeEvidence) ? summary.probeEvidence : [];
  return probes.every(
    (probe) => Number(probeEvidence.find((item) => item.id === probe.id)?.hits ?? 0) > 0
  );
}

export function hasCandidateEvidence(summary, probes) {
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
