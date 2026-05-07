#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDirectExecution, writeOutputs } from './lib/github-actions.mjs';

const FAILURE_STATES = new Set(['manual-review-required', 'timeout', 'hard-failure']);

function normalizeString(value) {
  return String(value ?? '').trim();
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  return ['1', 'true', 'yes'].includes(normalizeString(value).toLowerCase());
}

function extractLastAmoFileStatus(output) {
  const statuses = [...String(output ?? '').matchAll(/\bfileStatus=([^\s]+)/g)].map(
    (match) => match[1] ?? ''
  );

  return statuses.at(-1) ?? '';
}

function classifySigningFailure({ signExitCode, signOutput }) {
  const output = String(signOutput ?? '');
  const exitCode = normalizeString(signExitCode);

  if (/Approval:\s*timeout exceeded/i.test(output)) {
    return 'manual-review-required';
  }

  if (
    exitCode === '124' ||
    /(?:exhausted (?:the )?total timeout|parent process timeout|ETIMEDOUT|timed out)/i.test(output)
  ) {
    return 'timeout';
  }

  return 'hard-failure';
}

export function classifyFirefoxReleaseAssetEvidence({
  cacheResolved,
  cacheSourceRepo,
  cacheMissReason,
  signExitCode,
  signOutput,
  signedArtifactsPresent,
} = {}) {
  const normalizedCacheSourceRepo = normalizeString(cacheSourceRepo);
  const normalizedCacheMissReason = normalizeString(cacheMissReason);

  if (normalizeBoolean(cacheResolved)) {
    return {
      releaseState: 'cache-hit',
      artifactSource: 'cache',
      amoFileStatus: extractLastAmoFileStatus(signOutput),
      signedArtifactsPresent: true,
      amoSigningRequired: false,
      cacheSourceRepo: normalizedCacheSourceRepo,
      cacheMissReason: normalizedCacheMissReason,
    };
  }

  const normalizedSignExitCode = normalizeString(signExitCode);
  const normalizedSignOutput = String(signOutput ?? '');
  const artifactsPresent = normalizeBoolean(signedArtifactsPresent);
  const amoFileStatus = extractLastAmoFileStatus(normalizedSignOutput);

  if (normalizedSignExitCode === '0' && artifactsPresent) {
    return {
      releaseState: 'fresh-signing',
      artifactSource: 'signed',
      amoFileStatus,
      signedArtifactsPresent: true,
      amoSigningRequired: true,
      cacheSourceRepo: normalizedCacheSourceRepo,
      cacheMissReason: normalizedCacheMissReason,
    };
  }

  const releaseState = classifySigningFailure({
    signExitCode: normalizedSignExitCode,
    signOutput: normalizedSignOutput,
  });

  return {
    releaseState,
    artifactSource: releaseState,
    amoFileStatus,
    signedArtifactsPresent: artifactsPresent,
    amoSigningRequired: true,
    cacheSourceRepo: normalizedCacheSourceRepo,
    cacheMissReason: normalizedCacheMissReason,
  };
}

export function isFirefoxReleaseAssetFailureState(releaseState) {
  return FAILURE_STATES.has(normalizeString(releaseState));
}

export function formatFirefoxReleaseAssetEvidenceSummary(evidence) {
  return [
    '### Firefox release asset evidence',
    `- release_state: ${evidence.releaseState}`,
    `- artifact_source: ${evidence.artifactSource}`,
    `- amo_file_status: ${evidence.amoFileStatus || 'unknown'}`,
    `- signed_artifacts_present: ${String(evidence.signedArtifactsPresent)}`,
    `- amo_signing_required: ${String(evidence.amoSigningRequired)}`,
    `- cache_source_repo: ${evidence.cacheSourceRepo || 'none'}`,
    `- cache_miss_reason: ${evidence.cacheMissReason || 'none'}`,
  ].join('\n');
}

function parseArgs(argv) {
  const parsed = {
    cacheResolved: '',
    cacheSourceRepo: '',
    cacheMissReason: '',
    signExitCode: '',
    signOutputPath: '',
    releaseDir: '',
    signedArtifactsPresent: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    const next = argv[index + 1] ?? '';

    switch (arg) {
      case '--cache-resolved':
        parsed.cacheResolved = next;
        index += 1;
        break;
      case '--cache-source-repo':
        parsed.cacheSourceRepo = next;
        index += 1;
        break;
      case '--cache-miss-reason':
        parsed.cacheMissReason = next;
        index += 1;
        break;
      case '--sign-exit-code':
        parsed.signExitCode = next;
        index += 1;
        break;
      case '--sign-output-path':
        parsed.signOutputPath = next;
        index += 1;
        break;
      case '--release-dir':
        parsed.releaseDir = next;
        index += 1;
        break;
      case '--signed-artifacts-present':
        parsed.signedArtifactsPresent = next;
        index += 1;
        break;
      case '--help':
      case '-h':
        console.log(`Usage:
  node scripts/firefox-release-evidence.mjs --cache-resolved true|false --release-dir path [--sign-exit-code code] [--sign-output-path path]
`);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function inferSignedArtifactsPresent(releaseDir) {
  const normalizedReleaseDir = normalizeString(releaseDir);
  if (!normalizedReleaseDir) {
    return false;
  }

  const resolvedReleaseDir = resolve(normalizedReleaseDir);
  return (
    existsSync(join(resolvedReleaseDir, 'metadata.json')) &&
    existsSync(join(resolvedReleaseDir, 'openpath-firefox-extension.xpi'))
  );
}

function readOptionalFile(filePath) {
  const normalizedPath = normalizeString(filePath);
  return normalizedPath && existsSync(normalizedPath) ? readFileSync(normalizedPath, 'utf8') : '';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const signedArtifactsPresent =
    args.signedArtifactsPresent === ''
      ? inferSignedArtifactsPresent(args.releaseDir)
      : normalizeBoolean(args.signedArtifactsPresent);
  const evidence = classifyFirefoxReleaseAssetEvidence({
    cacheResolved: args.cacheResolved,
    cacheSourceRepo: args.cacheSourceRepo,
    cacheMissReason: args.cacheMissReason,
    signExitCode: args.signExitCode,
    signOutput: readOptionalFile(args.signOutputPath),
    signedArtifactsPresent,
  });

  writeOutputs({
    'release-state': evidence.releaseState,
    'artifact-source': evidence.artifactSource,
    'amo-file-status': evidence.amoFileStatus,
    'signed-artifacts-present': evidence.signedArtifactsPresent ? 'true' : 'false',
    'amo-signing-required': evidence.amoSigningRequired ? 'true' : 'false',
    'cache-source-repo': evidence.cacheSourceRepo,
    'cache-miss-reason': evidence.cacheMissReason,
  });
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(
      `[firefox-release-evidence] ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
}
