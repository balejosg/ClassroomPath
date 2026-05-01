import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  REDDIT_AUTO_ALLOW_DIAGNOSTIC_HOSTS,
  REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES,
} from './windows-auto-allow-canary-evidence.mjs';
import { renderReleaseEvidenceMarkdown } from './release-evidence.mjs';

const WINDOWS_ARTIFACT_NAME = 'windows-production-bootstrap-canary';
const LINUX_ARTIFACT_NAME = 'linux-production-bootstrap-canary';
const WINDOWS_ARTIFACT_JSON = 'production-windows-ajax-auto-allow-canary.json';
const LINUX_ARTIFACT_JSON = 'production-linux-ajax-auto-allow-canary.json';
const REQUIRED_EVIDENCE_RESULTS = new Set(['success', 'live-tested', 'failure', 'failed']);
const REQUIRED_IMAGE_FIELDS = ['gateway', 'migrations', 'openPathApi', 'spa', 'verifier'];
const REQUIRED_STAGING_FIELDS = [
  'smokeResult',
  'smokeStatus',
  'releaseGateResult',
  'windowsFirefoxHighRisk',
  'verifiedAt',
];
const REQUIRED_ARTIFACT_FIELDS = [
  'releaseImageMetadata',
  'stagingReleaseState',
  'productionSmokeResults',
  'releaseEvidence',
];
const ARTIFACT_STATUS_LABELS = {
  windowsProductionBootstrapCanary: WINDOWS_ARTIFACT_NAME,
  linuxProductionBootstrapCanary: LINUX_ARTIFACT_NAME,
};

function valueOrNull(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isTrueFlag(value) {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function ensureOutputDir(outputDir) {
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(resolve(outputDir, 'canary-evidence'), { recursive: true });
}

function assertArtifactFileExists(artifactDir, fileName) {
  const artifactPath = resolve(artifactDir, fileName);
  if (!existsSync(artifactPath)) {
    throw new Error(`Missing required artifact file ${fileName} in ${artifactDir}`);
  }

  return artifactPath;
}

function requireNonEmpty(value, fieldName) {
  if (!valueOrNull(value)) {
    throw new Error(`${fieldName} missing`);
  }
}

function normalizeFailureBoundary(boundary) {
  return {
    id: valueOrNull(boundary?.id),
    message: valueOrNull(boundary?.message),
  };
}

function normalizeDiagnosticPhases(phases) {
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

function buildFallbackWindowsRedditHosts() {
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

function getRedditPageEventByHost(pageDiagnostics, host) {
  const probe = REDDIT_AUTO_ALLOW_DIAGNOSTIC_PROBES.find((candidate) => candidate.host === host);
  if (!probe) {
    return false;
  }

  return pageDiagnostics?.completedRedditDiagnosticEvents?.[probe.id] === true;
}

export function parseWindowsBootstrapCanaryArtifact(artifactDir) {
  const artifactPath = assertArtifactFileExists(artifactDir, WINDOWS_ARTIFACT_JSON);
  const artifact = readJsonFile(artifactPath);
  const boundaryContract = assertCanaryBoundaryContract({
    artifact,
    platform: 'windows',
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
          globalWhitelist: whitelist?.global?.containsExpectedHosts?.[host] === true,
          nativeWhitelist: whitelist?.native?.containsExpectedHosts?.[host] === true,
          pageEvent: getRedditPageEventByHost(pageDiagnostics, host),
        },
      ])
    ),
  };
}

export function parseLinuxBootstrapCanaryArtifact(artifactDir) {
  const artifactPath = assertArtifactFileExists(artifactDir, LINUX_ARTIFACT_JSON);
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

function verifySingleArtifact({ highRisk, result, listed, artifactDir, downloadError, parser }) {
  if (!highRisk) {
    return { status: 'not_applicable' };
  }

  if (!REQUIRED_EVIDENCE_RESULTS.has(String(result ?? ''))) {
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
    windowsProductionBootstrapCanary: verifySingleArtifact({
      highRisk,
      result: valueOrNull(releaseEvidence?.jobs?.windowsProductionBootstrapCanary),
      listed: windowsProductionBootstrapCanary.listed === true,
      artifactDir: windowsProductionBootstrapCanary.artifactDir ?? null,
      downloadError: windowsProductionBootstrapCanary.downloadError === true,
      parser: parseWindowsBootstrapCanaryArtifact,
    }),
    linuxProductionBootstrapCanary: verifySingleArtifact({
      highRisk,
      result: valueOrNull(releaseEvidence?.jobs?.linuxProductionBootstrapCanary),
      listed: linuxProductionBootstrapCanary.listed === true,
      artifactDir: linuxProductionBootstrapCanary.artifactDir ?? null,
      downloadError: linuxProductionBootstrapCanary.downloadError === true,
      parser: parseLinuxBootstrapCanaryArtifact,
    }),
  };
}

function buildCanaryEvidenceFallback({ failureBoundary, diagnosticPhases, redditHosts }) {
  return {
    failureBoundary: normalizeFailureBoundary(failureBoundary),
    diagnosticPhases: normalizeDiagnosticPhases(diagnosticPhases),
    ...(redditHosts ? { redditHosts } : {}),
  };
}

function withReleaseTargetMetadata(canary, { targetUrl, targetSha, targetTag }) {
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

  for (const fieldName of REQUIRED_IMAGE_FIELDS) {
    if (!valueOrNull(releaseEvidence?.immutableImages?.[fieldName])) {
      failures.push(`immutableImages.${fieldName} missing`);
    }
  }

  for (const fieldName of REQUIRED_STAGING_FIELDS) {
    if (!valueOrNull(releaseEvidence?.stagingVerification?.[fieldName])) {
      failures.push(`stagingVerification.${fieldName} missing`);
    }
  }

  for (const fieldName of REQUIRED_ARTIFACT_FIELDS) {
    if (!valueOrNull(releaseEvidence?.artifacts?.[fieldName])) {
      failures.push(`artifacts.${fieldName} missing`);
    }
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function assertBundleCompleteness(bundle) {
  const failures = [];
  failures.push(...validateReleaseEvidenceChecklist(bundle).failures);

  if (bundle.production?.health?.status === undefined) {
    failures.push('production.health.status missing');
  }
  if (bundle.production?.ready?.ready === undefined) {
    failures.push('production.ready.ready missing');
  }

  for (const [artifactName, integrity] of Object.entries(bundle.artifactIntegrity ?? {})) {
    if (integrity?.status !== 'ok' && integrity?.status !== 'not_applicable') {
      failures.push(
        `${ARTIFACT_STATUS_LABELS[artifactName] ?? artifactName} ${integrity?.status ?? 'unknown'}`
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

export function buildReleaseEvidenceBundle({
  releaseEvidence,
  productionHealth,
  outputDir,
  windowsProductionBootstrapCanary = {},
  linuxProductionBootstrapCanary = {},
}) {
  const artifactIntegrity = verifyArtifactIntegrity({
    releaseEvidence,
    windowsProductionBootstrapCanary,
    linuxProductionBootstrapCanary,
  });

  const windowsCanary =
    artifactIntegrity.windowsProductionBootstrapCanary.status === 'ok'
      ? parseWindowsBootstrapCanaryArtifact(windowsProductionBootstrapCanary.artifactDir)
      : buildCanaryEvidenceFallback({
          failureBoundary: releaseEvidence?.diagnostics?.windowsProductionBootstrapFailureBoundary,
          redditHosts: buildFallbackWindowsRedditHosts(),
        });

  const linuxCanary =
    artifactIntegrity.linuxProductionBootstrapCanary.status === 'ok'
      ? parseLinuxBootstrapCanaryArtifact(linuxProductionBootstrapCanary.artifactDir)
      : buildCanaryEvidenceFallback({
          failureBoundary: releaseEvidence?.diagnostics?.linuxProductionBootstrapFailureBoundary,
        });

  const bundle = {
    ...releaseEvidence,
    artifactIntegrity,
    canaries: {
      windows: withReleaseTargetMetadata(windowsCanary, {
        targetUrl: releaseEvidence?.targets?.production?.publicUrl,
        targetSha: releaseEvidence?.release?.classroomPathSha,
        targetTag: releaseEvidence?.release?.tagName,
      }),
      linux: withReleaseTargetMetadata(linuxCanary, {
        targetUrl: releaseEvidence?.targets?.production?.publicUrl,
        targetSha: releaseEvidence?.release?.classroomPathSha,
        targetTag: releaseEvidence?.release?.tagName,
      }),
    },
    production: {
      health: productionHealth?.health ?? null,
      ready: productionHealth?.ready ?? null,
    },
  };

  if (outputDir) {
    ensureOutputDir(outputDir);
    writeJsonFile(resolve(outputDir, 'release-evidence.json'), bundle);
    writeFileSync(
      resolve(outputDir, 'release-evidence.md'),
      `${renderReleaseEvidenceMarkdown(bundle)}\n`,
      'utf8'
    );
    writeJsonFile(resolve(outputDir, 'artifact-integrity.json'), artifactIntegrity);
    writeJsonFile(resolve(outputDir, 'production-health.json'), productionHealth ?? {});
    writeJsonFile(
      resolve(outputDir, 'canary-evidence/windows-production-bootstrap.json'),
      bundle.canaries.windows
    );
    writeJsonFile(
      resolve(outputDir, 'canary-evidence/linux-production-bootstrap.json'),
      bundle.canaries.linux
    );
  }

  return bundle;
}

function runGh(args) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `gh ${args.join(' ')} failed`);
  }

  return result.stdout;
}

function listRunArtifacts({ repo, runId }) {
  const output = runGh(['api', `repos/${repo}/actions/runs/${runId}/artifacts`]).trim();
  const payload = JSON.parse(output || '{"artifacts":[]}');
  return Array.isArray(payload.artifacts) ? payload.artifacts : [];
}

function tryDownloadRunArtifact({ repo, runId, artifactName, outputDir }) {
  const result = spawnSync(
    'gh',
    ['run', 'download', String(runId), '--repo', repo, '--name', artifactName, '--dir', outputDir],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  return {
    success: result.status === 0,
    error:
      result.status === 0
        ? null
        : (valueOrNull(result.stderr) ?? valueOrNull(result.stdout) ?? 'download failed'),
  };
}

export async function collectProductionHealth(productionUrl) {
  const [healthResponse, readyResponse] = await Promise.all([
    fetch(`${productionUrl}/cp/health`),
    fetch(`${productionUrl}/cp/ready`),
  ]);
  const [healthBody, readyBody] = await Promise.all([healthResponse.text(), readyResponse.text()]);

  if (!healthResponse.ok) {
    throw new Error(
      `Failed to fetch production health from ${productionUrl}/cp/health: ${healthBody}`
    );
  }
  if (!readyResponse.ok) {
    throw new Error(
      `Failed to fetch production ready from ${productionUrl}/cp/ready: ${readyBody}`
    );
  }

  return {
    checkedAt: new Date().toISOString(),
    productionUrl,
    health: JSON.parse(healthBody),
    ready: JSON.parse(readyBody),
  };
}

function loadReleaseEvidenceFromCwd() {
  const releaseEvidencePath = resolve(process.cwd(), 'release-evidence.json');
  if (!existsSync(releaseEvidencePath)) {
    throw new Error(
      'release-evidence.json not found in the current directory. Run scripts/write-release-evidence.mjs first.'
    );
  }

  return readJsonFile(releaseEvidencePath);
}

function selectArtifactRunId(preferredRunId, deployRunId) {
  return preferredRunId ?? deployRunId;
}

function resolveArtifactEvidence({ repo, runId, artifactName, outputDir }) {
  const listedArtifacts = listRunArtifacts({ repo, runId });
  const listed = listedArtifacts.some((artifact) => artifact?.name === artifactName);
  if (!listed) {
    return {
      listed: false,
      artifactDir: null,
      downloadError: false,
    };
  }

  const download = tryDownloadRunArtifact({ repo, runId, artifactName, outputDir });
  return {
    listed,
    artifactDir: download.success ? outputDir : null,
    downloadError: !download.success,
    downloadErrorMessage: download.error,
  };
}

export async function runReleaseEvidenceBundle({
  repo,
  deployRun,
  tag,
  outputDir,
  productionUrl,
  windowsCanaryRun,
  linuxCanaryRun,
}) {
  const releaseEvidence = loadReleaseEvidenceFromCwd();
  if (tag && releaseEvidence?.release && typeof releaseEvidence.release === 'object') {
    releaseEvidence.release.tagName = tag;
  }

  ensureOutputDir(outputDir);

  const windowsArtifactDir = resolve(outputDir, 'tmp-windows-production-bootstrap-canary');
  const linuxArtifactDir = resolve(outputDir, 'tmp-linux-production-bootstrap-canary');
  const windowsEvidence = resolveArtifactEvidence({
    repo,
    runId: selectArtifactRunId(windowsCanaryRun, deployRun),
    artifactName: WINDOWS_ARTIFACT_NAME,
    outputDir: windowsArtifactDir,
  });
  const linuxEvidence = resolveArtifactEvidence({
    repo,
    runId: selectArtifactRunId(linuxCanaryRun, deployRun),
    artifactName: LINUX_ARTIFACT_NAME,
    outputDir: linuxArtifactDir,
  });

  const productionHealth = await collectProductionHealth(productionUrl);
  const bundle = buildReleaseEvidenceBundle({
    releaseEvidence,
    productionHealth,
    outputDir,
    windowsProductionBootstrapCanary: windowsEvidence,
    linuxProductionBootstrapCanary: linuxEvidence,
  });

  assertBundleCompleteness(bundle);
  return bundle;
}
