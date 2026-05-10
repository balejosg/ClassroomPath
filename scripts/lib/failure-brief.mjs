// @ts-check

import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { withLinuxAutoAllowDiagnostics } from './linux-auto-allow-canary-evidence.mjs';
import { withWindowsAutoAllowDiagnostics } from './windows-auto-allow-canary-evidence.mjs';

const KNOWN_KINDS = new Set([
  'auto',
  'windows-ajax',
  'linux-ajax',
  'linux-firefox',
  'release-evidence',
  'unknown',
]);

const BOUNDARY_META = Object.freeze({
  'artifact-written': {
    probableLayer: 'artifact',
    safeToRetry: 'unknown',
    nextCommand: 'Inspect the canary process output and artifact upload step',
  },
  'artifact-upload': {
    probableLayer: 'artifact',
    safeToRetry: 'yes',
    nextCommand: 'Rerun the diagnostic lane after checking GitHub artifact connectivity',
  },
  'artifact-integrity': {
    probableLayer: 'release-gate',
    safeToRetry: 'unknown',
    nextCommand: 'npm run ops:deploy-brief -- --run <github-run-id>',
  },
  'firefox-extension-ready': {
    probableLayer: 'extension',
    safeToRetry: 'after-cleanup',
  },
  'firefox-extension-warmup': {
    probableLayer: 'extension',
    safeToRetry: 'after-cleanup',
  },
  'origin-page-load': {
    probableLayer: 'browser',
    safeToRetry: 'yes',
  },
  'first-page-load': {
    probableLayer: 'browser',
    safeToRetry: 'yes',
  },
  'page-observer': {
    probableLayer: 'extension',
    safeToRetry: 'after-cleanup',
  },
  'page-resource-candidates': {
    probableLayer: 'extension',
    safeToRetry: 'no',
  },
  'no-automatic-rule-creation': {
    probableLayer: 'server',
    safeToRetry: 'no',
  },
  'explicit-whitelist-apply': {
    probableLayer: 'native-host',
    safeToRetry: 'after-cleanup',
  },
  'whitelist-seed': {
    probableLayer: 'native-host',
    safeToRetry: 'after-cleanup',
  },
  'native-host-state-sync': {
    probableLayer: 'native-host',
    safeToRetry: 'after-cleanup',
  },
  dns: {
    probableLayer: 'dns',
    safeToRetry: 'no',
  },
  'dns-policy-apply': {
    probableLayer: 'dns',
    safeToRetry: 'no',
  },
  'explicit-probe-traffic': {
    probableLayer: 'dns',
    safeToRetry: 'no',
  },
  none: {
    probableLayer: 'none',
    safeToRetry: 'not-needed',
    nextCommand: 'No action required',
  },
  unknown: {
    probableLayer: 'unknown',
    safeToRetry: 'unknown',
  },
});

const NEXT_COMMANDS_BY_KIND_AND_LAYER = Object.freeze({
  'windows-ajax': {
    browser: 'npm run diagnostics:windows-ajax:direct -- --environment staging',
    extension: 'npm run diagnostics:windows-ajax:direct -- --environment staging',
    'native-host': 'npm run diagnostics:windows-ajax:direct -- --environment staging',
    server: 'npm run diagnostics:windows-ajax:direct -- --environment staging',
    artifact: 'npm run diagnostics:windows-ajax:direct -- --environment staging',
    unknown: 'npm run diagnostics:windows-ajax:direct -- --environment staging',
  },
  'linux-ajax': {
    browser: 'npm run diagnostics:linux-ajax:direct -- --environment staging',
    extension: 'npm run diagnostics:linux-ajax:direct -- --environment staging',
    'native-host': 'npm run diagnostics:linux-ajax:direct -- --environment staging',
    dns: 'network_check=1 npm run diagnostics:linux-ajax:direct -- --environment staging',
    server: 'npm run diagnostics:linux-ajax:direct -- --environment staging',
    artifact: 'npm run diagnostics:linux-ajax:direct -- --environment staging',
    unknown: 'npm run diagnostics:linux-ajax:direct -- --environment staging',
  },
  'linux-firefox': {
    browser: 'node scripts/linux-firefox-block-page-canary.mjs',
    extension: 'node scripts/linux-firefox-block-page-canary.mjs',
    artifact: 'node scripts/linux-firefox-block-page-canary.mjs',
    unknown: 'node scripts/linux-firefox-block-page-canary.mjs',
  },
  'release-evidence': {
    'release-gate': 'npm run ops:deploy-brief -- --run <github-run-id>',
    artifact: 'npm run ops:deploy-brief -- --run <github-run-id>',
    unknown: 'npm run ops:deploy-brief -- --run <github-run-id>',
  },
});

function valueOrNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function readJsonArtifact(artifactPath) {
  if (!existsSync(artifactPath)) {
    return {
      artifact: null,
      error: `Could not read artifact at ${artifactPath}: file does not exist`,
    };
  }

  try {
    return {
      artifact: JSON.parse(readFileSync(artifactPath, 'utf8')),
      error: null,
    };
  } catch (error) {
    return {
      artifact: null,
      error: `Could not read artifact at ${artifactPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function inferKind({ artifactPath, artifact, kind }) {
  if (kind && kind !== 'auto') return kind;
  const name = basename(String(artifactPath ?? '')).toLowerCase();
  if (name.includes('windows') && name.includes('ajax')) return 'windows-ajax';
  if (name.includes('linux') && name.includes('ajax')) return 'linux-ajax';
  if (name.includes('firefox') && name.includes('block')) return 'linux-firefox';
  if (name.includes('release-evidence')) return 'release-evidence';
  if (artifact?.release && artifact?.jobs) return 'release-evidence';
  return 'unknown';
}

function enrichArtifact(kind, artifact) {
  if (!artifact || typeof artifact !== 'object') return artifact;
  if (kind === 'windows-ajax' && !artifact.failureBoundary) {
    return withWindowsAutoAllowDiagnostics(artifact);
  }
  if (kind === 'linux-ajax' && !artifact.failureBoundary) {
    return withLinuxAutoAllowDiagnostics(artifact);
  }
  return artifact;
}

function firstFailedPhase(artifact) {
  const phases = Array.isArray(artifact?.diagnosticPhases) ? artifact.diagnosticPhases : [];
  return phases.find((phase) => phase?.status === 'failed') ?? null;
}

function releaseBoundary(artifact) {
  const windowsBoundary =
    artifact?.canaries?.windows?.failureBoundary ??
    artifact?.diagnostics?.windowsProductionBootstrapFailureBoundary;
  const linuxBoundary =
    artifact?.canaries?.linux?.failureBoundary ??
    artifact?.diagnostics?.linuxProductionBootstrapFailureBoundary;
  const failedIntegrity = Object.values(artifact?.artifactIntegrity ?? {}).find((item) =>
    ['missing', 'invalid', 'failed_to_download'].includes(String(item?.status ?? ''))
  );

  if (windowsBoundary?.id && windowsBoundary.id !== 'none') return windowsBoundary;
  if (linuxBoundary?.id && linuxBoundary.id !== 'none') return linuxBoundary;
  if (failedIntegrity) {
    return {
      id: 'artifact-integrity',
      message: failedIntegrity.message ?? 'Release evidence artifact integrity failed.',
    };
  }
  return { id: 'none', message: 'Release evidence completed without a failure boundary.' };
}

function artifactBoundary(kind, artifact, readError) {
  if (readError) {
    return {
      id: 'artifact-written',
      message: readError,
    };
  }

  if (kind === 'release-evidence') {
    return releaseBoundary(artifact);
  }

  const boundary = artifact?.failureBoundary;
  if (boundary?.id) return boundary;

  const failedPhase = firstFailedPhase(artifact);
  if (failedPhase?.id) {
    return {
      id: failedPhase.id,
      message: failedPhase.message ?? `${failedPhase.id} failed`,
    };
  }

  if (artifact?.success === true || artifact?.ok === true) {
    return {
      id: 'none',
      message: 'Artifact reports success.',
    };
  }

  return {
    id: 'unknown',
    message: 'Artifact did not expose a known failure boundary.',
  };
}

function statusFromArtifact({ artifact, boundary, readError }) {
  if (readError) return 'unknown';
  if (boundary.id === 'none' || artifact?.success === true || artifact?.ok === true) return 'pass';
  if (artifact?.success === false || artifact?.ok === false) return 'fail';
  if (firstFailedPhase(artifact)) return 'fail';
  if (boundary.id !== 'unknown' && boundary.id !== 'artifact-written') return 'fail';
  return 'unknown';
}

function collectHosts(value, hosts = new Set()) {
  if (!value || typeof value !== 'object') return hosts;
  if (Array.isArray(value)) {
    for (const item of value) collectHosts(item, hosts);
    return hosts;
  }

  for (const [key, item] of Object.entries(value)) {
    if (
      /(^|_|-)(host|hostname|expectedWhitelistHost|targetHost|originHost|assetHost|scriptHost|stylesheetHost|fontHost)$/i.test(
        key
      ) &&
      typeof item === 'string'
    ) {
      hosts.add(item);
    } else {
      collectHosts(item, hosts);
    }
  }

  return hosts;
}

function requiredEvidence(artifact, readError) {
  if (readError) {
    return {
      present: 'no',
      missingEvidence: ['artifact'],
    };
  }

  const missing = [];
  if (!artifact?.failureBoundary) missing.push('failureBoundary');
  if (!Array.isArray(artifact?.diagnosticPhases)) missing.push('diagnosticPhases');
  return {
    present: missing.length === 0 ? 'yes' : missing.length === 2 ? 'no' : 'partial',
    missingEvidence: missing,
  };
}

function hasCleanupProcessEvidence(artifact) {
  const text = JSON.stringify(artifact ?? {}).toLowerCase();
  if (!/(cleanup|leftover|stale|stopped)/.test(text)) return false;
  return /(firefox(?:\.exe)?|geckodriver(?:\.exe)?|browser process|driver process)/.test(text);
}

function metadataForBoundary(boundaryId) {
  return BOUNDARY_META[boundaryId] ?? BOUNDARY_META.unknown;
}

function nextCommandFor({ kind, probableLayer, boundaryId }) {
  const direct = BOUNDARY_META[boundaryId]?.nextCommand;
  if (direct) return direct;
  return (
    NEXT_COMMANDS_BY_KIND_AND_LAYER[kind]?.[probableLayer] ??
    NEXT_COMMANDS_BY_KIND_AND_LAYER[kind]?.unknown ??
    'Inspect the source artifact'
  );
}

function escalationCondition({ status, probableLayer, boundaryId }) {
  if (status === 'pass') return 'no escalation';
  if (boundaryId === 'artifact-written') return 'artifact is missing, unreadable, or incomplete';
  if (probableLayer === 'unknown')
    return 'brief reports unknown layer or missing required evidence';
  return `the next command does not reproduce or narrow the ${probableLayer} boundary`;
}

export function buildFailureBrief({ artifactPath, kind = 'auto' }) {
  if (!KNOWN_KINDS.has(kind)) {
    throw new Error(`Unknown failure brief kind: ${kind}`);
  }

  const { artifact: rawArtifact, error: readError } = readJsonArtifact(artifactPath);
  const inferredKind = inferKind({ artifactPath, artifact: rawArtifact, kind });
  const artifact = enrichArtifact(inferredKind, rawArtifact);
  const boundary = artifactBoundary(inferredKind, artifact, readError);
  const status = statusFromArtifact({ artifact, boundary, readError });
  const meta = metadataForBoundary(boundary.id);
  const cleanupEvidence = hasCleanupProcessEvidence(artifact);
  const safeToRetry =
    cleanupEvidence && status !== 'pass' ? 'after-cleanup' : (meta.safeToRetry ?? 'unknown');
  const probableLayer = meta.probableLayer ?? 'unknown';
  const required = requiredEvidence(artifact, readError);
  const messageBase = valueOrNull(boundary.message) ?? 'No boundary message was provided.';
  const message =
    cleanupEvidence && status !== 'pass'
      ? `${messageBase} Windows cleanup evidence found leftover browser or driver processes.`
      : messageBase;

  return {
    kind: inferredKind,
    status,
    failureBoundary: {
      id: boundary.id,
      message,
      ...(boundary.recommendedNextAction
        ? { recommendedNextAction: boundary.recommendedNextAction }
        : {}),
    },
    probableLayer,
    safeToRetry,
    nextCommand: nextCommandFor({ kind: inferredKind, probableLayer, boundaryId: boundary.id }),
    requiredEvidence: {
      present: required.present,
    },
    missingEvidence: required.missingEvidence,
    sourceArtifact: artifactPath,
    relevantHosts: unique([...collectHosts(artifact)]).slice(0, 12),
    message,
    escalationCondition: escalationCondition({ status, probableLayer, boundaryId: boundary.id }),
  };
}

function listLabel(values) {
  return values.length > 0 ? values.join(', ') : 'none';
}

export function renderFailureBriefMarkdown(brief) {
  return [
    '# Failure Brief',
    '',
    `Kind: ${brief.kind}`,
    `Status: ${brief.status}`,
    `Boundary: ${brief.failureBoundary.id}`,
    `Message: ${brief.message}`,
    `Probable layer: ${brief.probableLayer}`,
    `Safe to retry: ${brief.safeToRetry}`,
    `Next command: ${brief.nextCommand}`,
    '',
    '## Evidence',
    `- Artifact: ${brief.sourceArtifact}`,
    `- Required evidence present: ${brief.requiredEvidence.present}`,
    `- Missing evidence: ${listLabel(brief.missingEvidence)}`,
    `- Relevant hosts: ${listLabel(brief.relevantHosts)}`,
    '',
    '## Escalation',
    `- Read full artifact only if: ${brief.escalationCondition}`,
    '',
  ].join('\n');
}

export function renderFailureBriefJson(brief) {
  return `${JSON.stringify(
    {
      kind: brief.kind,
      status: brief.status,
      failureBoundary: brief.failureBoundary,
      probableLayer: brief.probableLayer,
      safeToRetry: brief.safeToRetry,
      nextCommand: brief.nextCommand,
      requiredEvidence: brief.requiredEvidence,
      missingEvidence: brief.missingEvidence,
      sourceArtifact: brief.sourceArtifact,
      relevantHosts: brief.relevantHosts,
    },
    null,
    2
  )}\n`;
}
