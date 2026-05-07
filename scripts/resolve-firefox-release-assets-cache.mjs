#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  cleanupTemporaryArtifactDir,
  copyArtifactContents,
  downloadArtifactById,
  listGitHubArtifacts,
} from './lib/github-actions-artifacts.mjs';
import {
  isDirectExecution,
  normalizeArtifacts,
  sortArtifactsNewestFirst,
  writeOutputs,
} from './lib/github-actions.mjs';

function fail(message) {
  throw new Error(message);
}

function readRequiredTextFile(filePath, label) {
  if (!existsSync(filePath)) {
    fail(`Firefox release asset cache is missing ${label}: ${filePath}`);
  }

  return readFileSync(filePath, 'utf8');
}

function requireFile(filePath, label) {
  if (!existsSync(filePath)) {
    fail(`Firefox release asset cache is missing ${label}: ${filePath}`);
  }
}

export function validateFirefoxReleaseAssetCache({ artifactDir, expectedPayloadHash }) {
  const resolvedArtifactDir = resolve(artifactDir ?? '');
  const normalizedExpectedHash = String(expectedPayloadHash ?? '').trim();

  if (!normalizedExpectedHash) {
    fail('expectedPayloadHash is required');
  }

  const actualPayloadHash = readRequiredTextFile(
    join(resolvedArtifactDir, 'payload-hash.txt'),
    'payload-hash.txt'
  ).trim();
  if (actualPayloadHash !== normalizedExpectedHash) {
    fail(
      `Firefox release asset payload hash mismatch: expected ${normalizedExpectedHash}, got ${actualPayloadHash}`
    );
  }

  const metadata = JSON.parse(
    readRequiredTextFile(
      join(resolvedArtifactDir, 'build', 'firefox-release', 'metadata.json'),
      'build/firefox-release/metadata.json'
    )
  );
  if (!metadata.extensionId || !metadata.version) {
    fail('Firefox release asset metadata must include extensionId and version');
  }
  if (metadata.signatureSource !== 'amo') {
    fail('Firefox release asset metadata must include signatureSource=amo');
  }
  if (metadata.signatureState !== 'signed') {
    fail('Firefox release asset metadata must include signatureState=signed');
  }

  requireFile(
    join(resolvedArtifactDir, 'build', 'firefox-release', 'openpath-firefox-extension.xpi'),
    'build/firefox-release/openpath-firefox-extension.xpi'
  );

  return {
    extensionId: String(metadata.extensionId),
    version: String(metadata.version),
    signatureSource: String(metadata.signatureSource),
    signatureState: String(metadata.signatureState),
  };
}

function parseArgs(argv) {
  const parsed = {
    repo: '',
    fallbackRepo: '',
    artifactName: '',
    payloadHash: '',
    outputDir: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    const next = argv[index + 1] ?? '';

    switch (arg) {
      case '--repo':
        parsed.repo = next;
        index += 1;
        break;
      case '--fallback-repo':
        parsed.fallbackRepo = next;
        index += 1;
        break;
      case '--artifact-name':
        parsed.artifactName = next;
        index += 1;
        break;
      case '--payload-hash':
        parsed.payloadHash = next;
        index += 1;
        break;
      case '--output-dir':
        parsed.outputDir = next;
        index += 1;
        break;
      case '--help':
      case '-h':
        console.log(`Usage:
  node scripts/resolve-firefox-release-assets-cache.mjs --repo owner/repo [--fallback-repo owner/repo] --artifact-name name --payload-hash sha256 --output-dir path
`);
        process.exit(0);
        break;
      default:
        fail(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function findReusableArtifact({ repo, artifactName }) {
  const payload = listGitHubArtifacts({ repo, artifactName });
  return sortArtifactsNewestFirst({
    artifacts: normalizeArtifacts(payload).filter((artifact) => artifact.expired !== true),
  })[0];
}

export function resolveFirefoxReleaseAssetCache({
  repo,
  fallbackRepo,
  artifactName,
  payloadHash,
  outputDir,
  findArtifact = findReusableArtifact,
  downloadArtifact = downloadArtifactById,
  cleanupArtifact = cleanupTemporaryArtifactDir,
  copyContents = copyArtifactContents,
} = {}) {
  const normalizedRepo = String(repo ?? '').trim();
  const normalizedFallbackRepo = String(fallbackRepo ?? '').trim();
  const normalizedArtifactName = String(artifactName ?? '').trim();
  const normalizedOutputDir = String(outputDir ?? '').trim();

  if (!normalizedRepo || !normalizedArtifactName || !payloadHash || !normalizedOutputDir) {
    fail('--repo, --artifact-name, --payload-hash, and --output-dir are required');
  }

  const repositories = [
    ...new Set([normalizedRepo, normalizedFallbackRepo].filter((entry) => entry.length > 0)),
  ];
  let artifact = null;
  let sourceRepo = '';
  for (const candidateRepo of repositories) {
    artifact = findArtifact({
      repo: candidateRepo,
      artifactName: normalizedArtifactName,
    });
    if (artifact) {
      sourceRepo = candidateRepo;
      break;
    }
  }

  if (!artifact) {
    return {
      resolved: false,
      artifactName: normalizedArtifactName,
      cacheMissReason:
        repositories.length > 1
          ? `artifact_not_found_in_${repositories.join(',')}`
          : `artifact_not_found_in_${normalizedRepo}`,
    };
  }

  const artifactId = artifact.id ?? artifact.databaseId;
  if (!artifactId) {
    fail(`Reusable Firefox release asset ${normalizedArtifactName} has no artifact id`);
  }

  const { artifactDir } = downloadArtifact({
    repo: sourceRepo,
    artifactId,
    tempPrefix: 'classroompath-firefox-assets-cache-',
  });

  try {
    const metadata = validateFirefoxReleaseAssetCache({
      artifactDir,
      expectedPayloadHash: payloadHash,
    });
    copyContents({ artifactDir, outputDir: normalizedOutputDir });

    return {
      resolved: true,
      artifactId,
      artifactName: normalizedArtifactName,
      sourceRepo,
      cacheMissReason: '',
      releaseState: 'cache-hit',
      artifactSource: 'cache',
      amoFileStatus: '',
      ...metadata,
    };
  } finally {
    cleanupArtifact(artifactDir);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = resolveFirefoxReleaseAssetCache({
    repo: args.repo,
    fallbackRepo: args.fallbackRepo,
    artifactName: args.artifactName,
    payloadHash: args.payloadHash,
    outputDir: args.outputDir,
  });

  writeOutputs({
    resolved: result.resolved ? 'true' : 'false',
    payload_hash: args.payloadHash,
    artifact_id: result.artifactId ?? '',
    artifact_name: result.artifactName ?? '',
    source_repo: result.sourceRepo ?? '',
    cache_miss_reason: result.cacheMissReason ?? '',
    release_state: result.releaseState ?? '',
    artifact_source: result.artifactSource ?? '',
    amo_file_status: result.amoFileStatus ?? '',
    extension_id: result.extensionId ?? '',
    version: result.version ?? '',
    signature_source: result.signatureSource ?? '',
    signature_state: result.signatureState ?? '',
  });
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(
      `[resolve-firefox-release-assets-cache] ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exitCode = 1;
  }
}
