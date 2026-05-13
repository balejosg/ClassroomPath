import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS,
  REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES,
  WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_HOSTS,
} from './windows-auto-allow-canary-evidence.mjs';

export const WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_ARTIFACT = 'windows-production-bootstrap-canary';
export const LINUX_PRODUCTION_BOOTSTRAP_CANARY_ARTIFACT = 'linux-production-bootstrap-canary';
export const WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_JSON =
  'production-windows-ajax-auto-allow-canary.json';
export const LINUX_PRODUCTION_BOOTSTRAP_CANARY_JSON =
  'production-linux-ajax-auto-allow-canary.json';

export const RELEASE_EVIDENCE_REQUIRED_RESULTS = new Set([
  'success',
  'live-tested',
  'failure',
  'failed',
]);
export const RELEASE_EVIDENCE_REQUIRED_IMAGE_FIELDS = [
  'gateway',
  'migrations',
  'openPathApi',
  'spa',
  'verifier',
];
export const RELEASE_EVIDENCE_REQUIRED_STAGING_FIELDS = [
  'smokeResult',
  'smokeStatus',
  'releaseGateResult',
  'windowsFirefoxHighRisk',
  'verifiedAt',
];
export const RELEASE_EVIDENCE_REQUIRED_ARTIFACT_FIELDS = [
  'releaseImageMetadata',
  'stagingReleaseState',
  'productionSmokeResults',
  'releaseEvidence',
];
export const RELEASE_EVIDENCE_ACCEPTED_ARTIFACT_INTEGRITY_STATUSES = new Set([
  'ok',
  'not_applicable',
  'missing',
  'invalid',
  'failed_to_download',
  'unknown',
]);
export const RELEASE_EVIDENCE_CANARY_ARTIFACTS = {
  windows: {
    artifactName: WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_ARTIFACT,
    jsonFileName: WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_JSON,
    integrityName: 'windowsProductionBootstrapCanary',
  },
  linux: {
    artifactName: LINUX_PRODUCTION_BOOTSTRAP_CANARY_ARTIFACT,
    jsonFileName: LINUX_PRODUCTION_BOOTSTRAP_CANARY_JSON,
    integrityName: 'linuxProductionBootstrapCanary',
  },
};
export const RELEASE_EVIDENCE_ARTIFACT_STATUS_LABELS = {
  windowsProductionBootstrapCanary: WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_ARTIFACT,
  linuxProductionBootstrapCanary: LINUX_PRODUCTION_BOOTSTRAP_CANARY_ARTIFACT,
};

export function valueOrNull(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isTrueFlag(value) {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function findArtifactFile(artifactDir, fileName) {
  const pending = [artifactDir];

  while (pending.length > 0) {
    const currentDir = pending.shift();
    const entries = readdirSync(currentDir, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name)
    );

    for (const entry of entries) {
      const entryPath = resolve(currentDir, entry.name);
      if (entry.isFile() && entry.name === fileName) {
        return entryPath;
      }
      if (entry.isDirectory()) {
        pending.push(entryPath);
      }
    }
  }

  return null;
}

function assertArtifactFileExists(artifactDir, fileName) {
  const artifactPath = resolve(artifactDir, fileName);
  if (existsSync(artifactPath)) {
    return artifactPath;
  }

  const nestedArtifactPath = findArtifactFile(artifactDir, fileName);
  if (!nestedArtifactPath) {
    throw new Error(`Missing required artifact file ${fileName} in ${artifactDir}`);
  }

  return nestedArtifactPath;
}

function requireNonEmpty(value, fieldName) {
  if (!valueOrNull(value)) {
    throw new Error(`${fieldName} missing`);
  }
}

export function normalizeFailureBoundary(boundary) {
  return {
    id: valueOrNull(boundary?.id),
    message: valueOrNull(boundary?.message),
  };
}

export function normalizeDiagnosticPhases(phases) {
  return Array.isArray(phases) ? phases : [];
}

function assertCanaryBoundaryContract({ artifact, platform, artifactPath }) {
  const failureBoundary = normalizeFailureBoundary(artifact?.failureBoundary);
  const diagnosticPhases = normalizeDiagnosticPhases(artifact?.diagnosticPhases);

  requireNonEmpty(failureBoundary.id, `${platform}.failureBoundary.id`);
  requireNonEmpty(failureBoundary.message, `${platform}.failureBoundary.message`);

  if (diagnosticPhases.length === 0) {
    throw new Error(`${platform}.diagnosticPhases missing`);
  }

  for (const [index, phase] of diagnosticPhases.entries()) {
    requireNonEmpty(phase?.id, `${platform}.diagnosticPhases[${index}].id`);
    requireNonEmpty(phase?.status, `${platform}.diagnosticPhases[${index}].status`);
  }

  if (!diagnosticPhases.some((phase) => phase?.id === 'artifact-written')) {
    throw new Error(`${platform}.diagnosticPhases artifact-written missing`);
  }

  return {
    failureBoundary,
    diagnosticPhases,
    artifactPath,
  };
}

function getRedditPageEventByHost(pageDiagnostics, host) {
  const probe = REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES.find((candidate) => candidate.host === host);
  if (!probe) {
    return false;
  }

  return pageDiagnostics?.completedRedditDiagnosticEvents?.[probe.id] === true;
}

function parseHostname(value) {
  try {
    return new URL(String(value)).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function hostMatchesExpected(host, expectedHost) {
  const normalizedHost = String(host ?? '')
    .trim()
    .toLowerCase();
  const normalizedExpectedHost = String(expectedHost ?? '')
    .trim()
    .toLowerCase();
  return (
    normalizedHost === normalizedExpectedHost ||
    normalizedHost.endsWith(`.${normalizedExpectedHost}`)
  );
}

function parseWindowsAllowlistedNavigation(artifact) {
  const navigation = artifact?.allowlistedNavigation;
  if (
    navigation?.success !== true ||
    navigation.blockedByOpenPath === true ||
    navigation.timedOut === true
  ) {
    throw new Error('windows.allowlistedNavigation.success missing or false');
  }

  const observedHosts = [
    navigation.finalHost,
    parseHostname(navigation.href),
    parseHostname(navigation.url),
    ...(Array.isArray(navigation.expectedHosts) ? navigation.expectedHosts : []),
  ].filter(Boolean);

  for (const expectedHost of WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_HOSTS) {
    if (!observedHosts.some((host) => hostMatchesExpected(host, expectedHost))) {
      throw new Error(`windows.allowlistedNavigation missing expected host ${expectedHost}`);
    }
  }

  return {
    success: true,
    url: valueOrNull(navigation.url),
    href: valueOrNull(navigation.href),
    finalHost: valueOrNull(navigation.finalHost),
    expectedHosts: WINDOWS_EXTERNAL_NAVIGATION_ALLOWLIST_HOSTS,
    blockedByOpenPath: false,
    timedOut: false,
  };
}

export function buildFallbackWindowsRedditHosts() {
  return Object.fromEntries(
    REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS.map((host) => [
      host,
      {
        globalWhitelist: false,
        nativeWhitelist: false,
        pageEvent: false,
      },
    ])
  );
}

export function parseWindowsBootstrapCanaryArtifact(artifactDir) {
  const artifactPath = assertArtifactFileExists(
    artifactDir,
    RELEASE_EVIDENCE_CANARY_ARTIFACTS.windows.jsonFileName
  );
  const artifact = readJsonFile(artifactPath);
  const boundaryContract = assertCanaryBoundaryContract({
    artifact,
    platform: 'windows',
    artifactPath,
  });
  const whitelist = artifact?.redditDiagnostics?.whitelist ?? {};
  const pageDiagnostics = artifact?.redditDiagnostics?.page ?? {};
  const allowlistedNavigation = parseWindowsAllowlistedNavigation(artifact);

  return {
    ...boundaryContract,
    allowlistedNavigation,
    redditHosts: Object.fromEntries(
      REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS.map((host) => [
        host,
        {
          globalWhitelist: whitelist?.global?.containsExpectedHosts?.[host] === true,
          nativeWhitelist: whitelist?.native?.containsExpectedHosts?.[host] === true,
          pageEvent: getRedditPageEventByHost(pageDiagnostics, host),
        },
      ])
    ),
  };
}

export function parseLinuxBootstrapCanaryArtifact(artifactDir) {
  const artifactPath = assertArtifactFileExists(
    artifactDir,
    RELEASE_EVIDENCE_CANARY_ARTIFACTS.linux.jsonFileName
  );
  const artifact = readJsonFile(artifactPath);
  const boundaryContract = assertCanaryBoundaryContract({
    artifact,
    platform: 'linux',
    artifactPath,
  });
  const whitelist = artifact?.redditDiagnostics?.whitelist ?? {};
  const pageDiagnostics = artifact?.redditDiagnostics?.page ?? {};

  return {
    ...boundaryContract,
    redditHosts: Object.fromEntries(
      REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS.map((host) => [
        host,
        {
          globalWhitelist: whitelist?.local?.containsExpectedHosts?.[host] === true,
          nativeWhitelist: whitelist?.native?.containsExpectedHosts?.[host] === true,
          pageEvent: getRedditPageEventByHost(pageDiagnostics, host),
        },
      ])
    ),
  };
}

export function normalizeArtifactIntegrityStatus(status) {
  const normalized = valueOrNull(status) ?? 'unknown';
  return RELEASE_EVIDENCE_ACCEPTED_ARTIFACT_INTEGRITY_STATUSES.has(normalized)
    ? normalized
    : 'invalid';
}

export function shouldRequireCanaryArtifact({ highRisk, result }) {
  return highRisk && RELEASE_EVIDENCE_REQUIRED_RESULTS.has(String(result ?? ''));
}

export function evaluateCanaryArtifactIntegrity({
  highRisk,
  result,
  listed,
  artifactDir,
  downloadError,
  parser,
}) {
  if (!highRisk) {
    return { status: 'not_applicable' };
  }

  if (!shouldRequireCanaryArtifact({ highRisk, result })) {
    return { status: 'not_applicable' };
  }

  if (downloadError) {
    return { status: 'failed_to_download' };
  }

  if (!listed || !artifactDir) {
    return { status: 'missing' };
  }

  try {
    parser(artifactDir);
    return { status: 'ok' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: message.startsWith('Missing required artifact file') ? 'missing' : 'invalid',
      message,
    };
  }
}

export function verifyArtifactIntegrity({
  releaseEvidence,
  windowsProductionBootstrapCanary = {},
  linuxProductionBootstrapCanary = {},
}) {
  const highRisk = isTrueFlag(releaseEvidence?.stagingVerification?.windowsFirefoxHighRisk);

  return {
    windowsProductionBootstrapCanary: evaluateCanaryArtifactIntegrity({
      highRisk,
      result: valueOrNull(releaseEvidence?.jobs?.windowsProductionBootstrapCanary),
      listed: windowsProductionBootstrapCanary.listed === true,
      artifactDir: windowsProductionBootstrapCanary.artifactDir ?? null,
      downloadError: windowsProductionBootstrapCanary.downloadError === true,
      parser: parseWindowsBootstrapCanaryArtifact,
    }),
    linuxProductionBootstrapCanary: evaluateCanaryArtifactIntegrity({
      highRisk,
      result: valueOrNull(releaseEvidence?.jobs?.linuxProductionBootstrapCanary),
      listed: linuxProductionBootstrapCanary.listed === true,
      artifactDir: linuxProductionBootstrapCanary.artifactDir ?? null,
      downloadError: linuxProductionBootstrapCanary.downloadError === true,
      parser: parseLinuxBootstrapCanaryArtifact,
    }),
  };
}

export function buildCanaryEvidenceFallback({ failureBoundary, diagnosticPhases, redditHosts }) {
  const normalizedDiagnosticPhases = normalizeDiagnosticPhases(diagnosticPhases);

  return {
    failureBoundary: normalizeFailureBoundary(failureBoundary),
    diagnosticPhases:
      normalizedDiagnosticPhases.length > 0
        ? normalizedDiagnosticPhases
        : [
            {
              id: 'preproduction-installed-client-evidence',
              status: 'not_applicable',
            },
            {
              id: 'artifact-written',
              status: 'passed',
            },
          ],
    ...(redditHosts ? { redditHosts } : {}),
  };
}

export function withReleaseTargetMetadata(canary, { targetUrl, targetSha, targetTag }) {
  return {
    ...canary,
    targetUrl: valueOrNull(targetUrl),
    targetSha: valueOrNull(targetSha),
    targetTag: valueOrNull(targetTag),
  };
}

export function validateReleaseEvidenceChecklist(releaseEvidence) {
  const failures = [];

  for (const [fieldName, value] of [
    ['release.classroomPathSha', releaseEvidence?.release?.classroomPathSha],
    ['release.openPathSha', releaseEvidence?.release?.openPathSha],
    ['release.tagName', releaseEvidence?.release?.tagName],
    ['targets.staging.publicUrl', releaseEvidence?.targets?.staging?.publicUrl],
    ['targets.production.publicUrl', releaseEvidence?.targets?.production?.publicUrl],
  ]) {
    if (!valueOrNull(value)) {
      failures.push(`${fieldName} missing`);
    }
  }

  for (const fieldName of RELEASE_EVIDENCE_REQUIRED_IMAGE_FIELDS) {
    if (!valueOrNull(releaseEvidence?.immutableImages?.[fieldName])) {
      failures.push(`immutableImages.${fieldName} missing`);
    }
  }

  for (const fieldName of RELEASE_EVIDENCE_REQUIRED_STAGING_FIELDS) {
    if (!valueOrNull(releaseEvidence?.stagingVerification?.[fieldName])) {
      failures.push(`stagingVerification.${fieldName} missing`);
    }
  }

  for (const fieldName of RELEASE_EVIDENCE_REQUIRED_ARTIFACT_FIELDS) {
    if (!valueOrNull(releaseEvidence?.artifacts?.[fieldName])) {
      failures.push(`artifacts.${fieldName} missing`);
    }
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

export function assertReleaseEvidenceBundleCompleteness(bundle) {
  const failures = [];
  failures.push(...validateReleaseEvidenceChecklist(bundle).failures);

  if (bundle.production?.health?.status === undefined) {
    failures.push('production.health.status missing');
  }
  if (bundle.production?.ready?.ready === undefined) {
    failures.push('production.ready.ready missing');
  }

  for (const [artifactName, integrity] of Object.entries(bundle.artifactIntegrity ?? {})) {
    const status = normalizeArtifactIntegrityStatus(integrity?.status);
    if (status !== 'ok' && status !== 'not_applicable') {
      failures.push(
        `${RELEASE_EVIDENCE_ARTIFACT_STATUS_LABELS[artifactName] ?? artifactName} ${status}`
      );
    }
  }

  for (const [platform, canary] of Object.entries(bundle.canaries ?? {})) {
    if (!valueOrNull(canary?.failureBoundary?.id)) {
      failures.push(`${platform}.failureBoundary.id missing`);
    }
    if (!valueOrNull(canary?.failureBoundary?.message)) {
      failures.push(`${platform}.failureBoundary.message missing`);
    }
    if (!Array.isArray(canary?.diagnosticPhases) || canary.diagnosticPhases.length === 0) {
      failures.push(`${platform}.diagnosticPhases missing`);
    }
    if (!valueOrNull(canary?.targetUrl)) {
      failures.push(`${platform}.targetUrl missing`);
    }
    if (!valueOrNull(canary?.targetSha)) {
      failures.push(`${platform}.targetSha missing`);
    }
    if (!valueOrNull(canary?.targetTag)) {
      failures.push(`${platform}.targetTag missing`);
    }
    const integrityName = `${platform}ProductionBootstrapCanary`;
    if (
      bundle.artifactIntegrity?.[integrityName]?.status === 'ok' &&
      !valueOrNull(canary?.artifactPath)
    ) {
      failures.push(`${platform}.artifactPath missing`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Release evidence bundle incomplete: ${failures.join('; ')}`);
  }
}

function assertEqual({ actual, expected, label, failures }) {
  if (expected && actual !== expected) {
    failures.push(`${label} expected ${expected} but found ${actual ?? 'missing'}`);
  }
}

export function collectProductionPromotionDryRunFailures({
  releaseEvidence,
  expectedClassroomSha,
  expectedOpenPathSha,
  tag,
  windowsCanaryDir,
  linuxCanaryDir,
}) {
  const failures = [...validateReleaseEvidenceChecklist(releaseEvidence).failures];

  assertEqual({
    actual: releaseEvidence?.release?.classroomPathSha,
    expected: expectedClassroomSha,
    label: 'release.classroomPathSha',
    failures,
  });
  assertEqual({
    actual: releaseEvidence?.release?.openPathSha,
    expected: expectedOpenPathSha,
    label: 'release.openPathSha',
    failures,
  });
  assertEqual({
    actual: releaseEvidence?.release?.tagName,
    expected: tag,
    label: 'release.tagName',
    failures,
  });

  const integrity = verifyArtifactIntegrity({
    releaseEvidence,
    windowsProductionBootstrapCanary: {
      listed: Boolean(windowsCanaryDir),
      artifactDir: windowsCanaryDir,
    },
    linuxProductionBootstrapCanary: {
      listed: Boolean(linuxCanaryDir),
      artifactDir: linuxCanaryDir,
    },
  });

  for (const [name, result] of Object.entries(integrity)) {
    if (result.status !== 'ok' && result.status !== 'not_applicable') {
      failures.push(`${name} ${result.status}${result.message ? `: ${result.message}` : ''}`);
    }
  }

  if (windowsCanaryDir) {
    parseWindowsBootstrapCanaryArtifact(windowsCanaryDir);
  }
  if (linuxCanaryDir) {
    parseLinuxBootstrapCanaryArtifact(linuxCanaryDir);
  }

  return {
    ok: failures.length === 0,
    failures,
    integrity,
  };
}
