/**
 * Library: assembles, validates, and serializes the full release evidence bundle from per-platform artifacts.
 *
 * Invoked by: Imported by `scripts/release-evidence-bundle.mjs`; tested by `release-evidence-bundle.test.ts`.
 * Usage: (library module, not invoked directly)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  LINUX_PRODUCTION_BOOTSTRAP_CANARY_ARTIFACT,
  PREPRODUCTION_WINDOWS_BOOTSTRAP_CANARY_ARTIFACT,
  WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_ARTIFACT,
  assertReleaseEvidenceBundleCompleteness,
  buildCanaryEvidenceFallback,
  buildFallbackWindowsRedditHosts,
  isTrueFlag,
  parseLinuxBootstrapCanaryArtifact,
  parseWindowsBootstrapCanaryArtifact,
  shouldRequireCanaryArtifact,
  valueOrNull,
  verifyArtifactIntegrity,
  withReleaseTargetMetadata,
} from './release-evidence-contract.mjs';
import { renderReleaseEvidenceMarkdown } from './release-evidence.mjs';

export {
  parseLinuxBootstrapCanaryArtifact,
  parseWindowsBootstrapCanaryArtifact,
  validateReleaseEvidenceChecklist,
  verifyArtifactIntegrity,
} from './release-evidence-contract.mjs';

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

export function buildBundleCanaryEvidence({
  integrity,
  artifactDir,
  parser,
  fallbackFailureBoundary,
  fallbackDiagnosticPhases,
  fallbackRedditHosts,
}) {
  return integrity?.status === 'ok'
    ? parser(artifactDir)
    : buildCanaryEvidenceFallback({
        failureBoundary: fallbackFailureBoundary,
        diagnosticPhases: fallbackDiagnosticPhases,
        redditHosts: fallbackRedditHosts,
      });
}

export function buildReleaseEvidenceBundle({
  releaseEvidence,
  productionHealth,
  outputDir,
  preproductionWindowsBootstrapCanary,
  windowsProductionBootstrapCanary = {},
  linuxProductionBootstrapCanary = {},
}) {
  const preproductionWindowsEvidence =
    preproductionWindowsBootstrapCanary ?? windowsProductionBootstrapCanary;
  const artifactIntegrity = verifyArtifactIntegrity({
    releaseEvidence,
    preproductionWindowsBootstrapCanary: preproductionWindowsEvidence,
    windowsProductionBootstrapCanary,
    linuxProductionBootstrapCanary,
  });

  const windowsCanary = buildBundleCanaryEvidence({
    integrity: artifactIntegrity.preproductionWindowsBootstrapCanary,
    artifactDir: preproductionWindowsEvidence.artifactDir,
    parser: parseWindowsBootstrapCanaryArtifact,
    fallbackFailureBoundary:
      releaseEvidence?.diagnostics?.preproductionWindowsBootstrapFailureBoundary ??
      releaseEvidence?.diagnostics?.windowsProductionBootstrapFailureBoundary,
    fallbackRedditHosts: buildFallbackWindowsRedditHosts(),
  });

  const linuxCanary = buildBundleCanaryEvidence({
    integrity: artifactIntegrity.linuxProductionBootstrapCanary,
    artifactDir: linuxProductionBootstrapCanary.artifactDir,
    parser: parseLinuxBootstrapCanaryArtifact,
    fallbackFailureBoundary: releaseEvidence?.diagnostics?.linuxProductionBootstrapFailureBoundary,
  });

  const bundle = {
    ...releaseEvidence,
    artifactIntegrity,
    canaries: {
      windows: withReleaseTargetMetadata(windowsCanary, {
        targetUrl: releaseEvidence?.targets?.staging?.publicUrl,
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
      resolve(outputDir, 'canary-evidence/preproduction-windows-bootstrap.json'),
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

function selectArtifactRunId({ preferredRunId, deployRunId, highRisk, result }) {
  if (preferredRunId) {
    return preferredRunId;
  }

  return shouldRequireCanaryArtifact({ highRisk, result }) ? (deployRunId ?? null) : null;
}

function resolveArtifactEvidence({
  repo,
  runId,
  artifactName,
  fallbackArtifactNames = [],
  outputDir,
}) {
  if (!runId) {
    return {
      listed: false,
      artifactDir: null,
      downloadError: false,
    };
  }

  const listedArtifacts = listRunArtifacts({ repo, runId });
  const artifactNames = [artifactName, ...fallbackArtifactNames];
  for (const candidateArtifactName of artifactNames) {
    const listed = listedArtifacts.some((artifact) => artifact?.name === candidateArtifactName);
    if (!listed) {
      continue;
    }

    const download = tryDownloadRunArtifact({
      repo,
      runId,
      artifactName: candidateArtifactName,
      outputDir,
    });
    return {
      listed,
      artifactDir: download.success ? outputDir : null,
      downloadError: !download.success,
      downloadErrorMessage: download.error,
      artifactName: candidateArtifactName,
    };
  }

  return {
    listed: false,
    artifactDir: null,
    downloadError: false,
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

  const windowsFirefoxHighRisk = isTrueFlag(
    releaseEvidence?.stagingVerification?.windowsFirefoxHighRisk
  );
  const windowsArtifactDir = resolve(outputDir, 'tmp-preproduction-windows-bootstrap-canary');
  const linuxArtifactDir = resolve(outputDir, 'tmp-linux-production-bootstrap-canary');
  const windowsEvidence = resolveArtifactEvidence({
    repo,
    runId: selectArtifactRunId({
      preferredRunId: windowsCanaryRun,
      deployRunId: deployRun,
      highRisk: windowsFirefoxHighRisk,
      result:
        releaseEvidence?.jobs?.preproductionWindowsBootstrapCanary ??
        releaseEvidence?.jobs?.windowsProductionBootstrapCanary,
    }),
    artifactName: PREPRODUCTION_WINDOWS_BOOTSTRAP_CANARY_ARTIFACT,
    fallbackArtifactNames: [WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_ARTIFACT],
    outputDir: windowsArtifactDir,
  });
  const linuxEvidence = resolveArtifactEvidence({
    repo,
    runId: selectArtifactRunId({
      preferredRunId: linuxCanaryRun,
      deployRunId: deployRun,
      highRisk: windowsFirefoxHighRisk,
      result: releaseEvidence?.jobs?.linuxProductionBootstrapCanary,
    }),
    artifactName: LINUX_PRODUCTION_BOOTSTRAP_CANARY_ARTIFACT,
    outputDir: linuxArtifactDir,
  });

  const productionHealth = await collectProductionHealth(productionUrl);
  const bundle = buildReleaseEvidenceBundle({
    releaseEvidence,
    productionHealth,
    outputDir,
    preproductionWindowsBootstrapCanary: windowsEvidence,
    linuxProductionBootstrapCanary: linuxEvidence,
  });

  assertReleaseEvidenceBundleCompleteness(bundle);
  return bundle;
}
